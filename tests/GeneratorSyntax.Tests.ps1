# Parse the full generator without executing any installation, AD or SMB code.
Describe 'Signaturee PowerShell generator structure' {
    It 'has valid PowerShell syntax and preserves its generation entry points' {
        $generatorPath = Join-Path $PSScriptRoot '..\GenerateSignatures.ps1'
        $tokens = $null
        $parseErrors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile(
            $generatorPath, [ref]$tokens, [ref]$parseErrors
        )

        @($parseErrors).Count | Should -Be 0
        $ast | Should -Not -BeNullOrEmpty

        $functionNames = @(
            $ast.FindAll({
                param($node)
                $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
            }, $true) | ForEach-Object { $_.Name }
        )
        foreach ($requiredFunction in @(
            'Get-SignatureUserData',
            'Get-SignatureCsvUsers',
            'ConvertTo-RtfVersion',
            'New-OutlookSignatures'
        )) {
            $functionNames | Should -Contain $requiredFunction
        }
    }
}

# Exercise only the extracted functions: never run the real AD/SMB generator
# or start Microsoft Word as part of the Windows quality gate.
Describe 'RTF output integrity' {
    BeforeAll {
        $generatorPath = Join-Path $PSScriptRoot '..\GenerateSignatures.ps1'
        $tokens = $null
        $parseErrors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile(
            $generatorPath, [ref]$tokens, [ref]$parseErrors
        )
        foreach ($name in @('Test-GeneratedRtfFile', 'ConvertTo-RtfVersion', 'New-WordRtfApplication', 'New-LibreOfficeRtfOutput', 'Resolve-LibreOfficeExecutable')) {
            $functionAst = $ast.FindAll({
                param($node)
                $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
            }, $true) | Where-Object Name -EQ $name | Select-Object -First 1
            if (-not $functionAst) { throw "Missing RTF function $name" }
            . ([scriptblock]::Create($functionAst.Extent.Text))
        }
        function Write-Log { param([string]$Message, [string]$Level = 'INFO') }
    }

    BeforeEach {
        $script:wordComStartupFailed = $false
        $script:RtfEngine = 'Word'
    }

    It 'rejects empty placeholders and invalid RTF headers' {
        $tiny = Join-Path $TestDrive 'placeholder.rtf'
        [System.IO.File]::WriteAllText($tiny, '{\rtf1}', [System.Text.Encoding]::ASCII)
        (Test-GeneratedRtfFile -Path $tiny) | Should -BeFalse

        $invalid = Join-Path $TestDrive 'not-rtf.rtf'
        [System.IO.File]::WriteAllText($invalid, 'NOT RTF ' + ('x' * 128), [System.Text.Encoding]::ASCII)
        (Test-GeneratedRtfFile -Path $invalid) | Should -BeFalse

        (Test-GeneratedRtfFile -Path (Join-Path $TestDrive 'not-found.rtf')) | Should -BeFalse
    }

    It 'accepts a plausible RTF document for staging' {
        $valid = Join-Path $TestDrive 'staged.rtf'
        [System.IO.File]::WriteAllText($valid, ('{\rtf1\ansi ' + ('text ' * 30) + '}'), [System.Text.Encoding]::ASCII)
        (Test-GeneratedRtfFile -Path $valid) | Should -BeTrue
    }

    It 'does not overwrite a pre-existing RTF when Word COM activation fails' {
        Mock New-WordRtfApplication { throw 'Simulated Word COM startup failure' }
        $existing = Join-Path $TestDrive 'existing.rtf'
        $original = '{\rtf1\ansi ' + ('preserve ' * 20) + '}'
        [System.IO.File]::WriteAllText($existing, $original, [System.Text.Encoding]::ASCII)

        $result = ConvertTo-RtfVersion -HtmlPath (Join-Path $TestDrive 'missing.html') -RtfPath $existing

        $result | Should -BeFalse
        [System.IO.File]::ReadAllText($existing) | Should -Be $original
        @(Get-ChildItem -Path $TestDrive -Filter 'existing.rtf.signaturee-*').Count | Should -Be 0
    }

    It 'never creates an empty RTF placeholder when Word COM startup fails' {
        Mock New-WordRtfApplication { throw 'Simulated Word COM startup failure' }
        $outputPath = Join-Path $TestDrive 'missing-output.rtf'
        (ConvertTo-RtfVersion -HtmlPath (Join-Path $TestDrive 'missing.html') -RtfPath $outputPath) |
            Should -BeFalse
        [System.IO.File]::Exists($outputPath) | Should -BeFalse
    }

    It 'does not repeat Word COM activation after a startup failure in one run' {
        Mock New-WordRtfApplication { throw 'Simulated Word COM startup failure' }
        $inputPath = Join-Path $TestDrive 'input.html'
        $first = Join-Path $TestDrive 'first.rtf'
        $second = Join-Path $TestDrive 'second.rtf'
        [System.IO.File]::WriteAllText($inputPath, '<html><body>test</body></html>')

        (ConvertTo-RtfVersion -HtmlPath $inputPath -RtfPath $first) | Should -BeFalse
        (ConvertTo-RtfVersion -HtmlPath $inputPath -RtfPath $second) | Should -BeFalse

        Should -Invoke New-WordRtfApplication -Exactly 1
        [System.IO.File]::Exists($first) | Should -BeFalse
        [System.IO.File]::Exists($second) | Should -BeFalse
    }

    It 'attempts Word COM again in a fresh generation run' {
        Mock New-WordRtfApplication { throw 'Simulated Word COM startup failure' }
        $script:wordComStartupFailed = $true
        # Each invocation of GenerateSignatures.ps1 initializes the circuit
        # breaker to false. Simulate that reset without starting live Word.
        $script:wordComStartupFailed = $false
        $rtf = Join-Path $TestDrive 'fresh-run.rtf'
        (ConvertTo-RtfVersion -HtmlPath (Join-Path $TestDrive 'input.html') -RtfPath $rtf) |
            Should -BeFalse
        Should -Invoke New-WordRtfApplication -Exactly 1
    }


    It 'uses LibreOffice only when explicitly selected and preserves successful RTF output' {
        $script:RtfEngine = 'LibreOffice'
        Mock New-WordRtfApplication { throw 'Word must not be started' }
        Mock New-LibreOfficeRtfOutput {
            param($HtmlPath, $StagedRtfPath)
            [System.IO.File]::WriteAllText(
                $StagedRtfPath, ('{\rtf1\ansi ' + ('LibreOffice output ' * 12) + '}'),
                [System.Text.Encoding]::ASCII
            )
        }

        $old = Join-Path $TestDrive 'output.rtf'
        [System.IO.File]::WriteAllText($old, ('{\rtf1\ansi ' + ('old ' * 25) + '}'))
        $result = ConvertTo-RtfVersion -HtmlPath (Join-Path $TestDrive 'input.htm') -RtfPath $old

        $result | Should -BeTrue
        [System.IO.File]::ReadAllText($old) | Should -Match 'LibreOffice output'
        Should -Invoke New-WordRtfApplication -Exactly 0
        Should -Invoke New-LibreOfficeRtfOutput -Exactly 1
    }

    It 'preserves existing RTF if the LibreOffice converter fails' {
        $script:RtfEngine = 'LibreOffice'
        Mock New-WordRtfApplication { throw 'Word must not be started' }
        Mock New-LibreOfficeRtfOutput { throw 'Simulated LibreOffice failure' }

        $old = Join-Path $TestDrive 'keep.rtf'
        $original = '{\rtf1\ansi ' + ('old ' * 25) + '}'
        [System.IO.File]::WriteAllText($old, $original)
        (ConvertTo-RtfVersion -HtmlPath (Join-Path $TestDrive 'input.htm') -RtfPath $old) |
            Should -BeFalse

        [System.IO.File]::ReadAllText($old) | Should -Be $original
        @(Get-ChildItem $TestDrive -Filter 'keep.rtf.signaturee-*').Count | Should -Be 0
        Should -Invoke New-WordRtfApplication -Exactly 0
    }

    It 'does not publish incomplete LibreOffice RTF output' {
        $script:RtfEngine = 'LibreOffice'
        Mock New-LibreOfficeRtfOutput {
            param($HtmlPath, $StagedRtfPath)
            [System.IO.File]::WriteAllText($StagedRtfPath, '{\rtf1}')
        }

        $outputPath = Join-Path $TestDrive 'placeholder-from-lo.rtf'
        (ConvertTo-RtfVersion -HtmlPath (Join-Path $TestDrive 'input.htm') -RtfPath $outputPath) |
            Should -BeFalse
        [System.IO.File]::Exists($outputPath) | Should -BeFalse
    }

}
