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
        foreach ($name in @('Test-GeneratedRtfFile', 'ConvertTo-RtfVersion')) {
            $functionAst = $ast.FindAll({
                param($node)
                $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
            }, $true) | Where-Object Name -EQ $name | Select-Object -First 1
            if (-not $functionAst) { throw "Missing RTF function $name" }
            . ([scriptblock]::Create($functionAst.Extent.Text))
        }
        function Write-Log { param([string]$Message, [string]$Level = 'INFO') }
        $script:originalWordAvailable = $global:wordAvailable
    }

    AfterAll {
        $global:wordAvailable = $script:originalWordAvailable
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

    It 'does not overwrite a pre-existing RTF when Word is unavailable' {
        $global:wordAvailable = $false
        $existing = Join-Path $TestDrive 'existing.rtf'
        $original = '{\rtf1\ansi ' + ('preserve ' * 20) + '}'
        [System.IO.File]::WriteAllText($existing, $original, [System.Text.Encoding]::ASCII)

        $result = ConvertTo-RtfVersion -HtmlPath (Join-Path $TestDrive 'missing.html') -RtfPath $existing

        $result | Should -BeFalse
        [System.IO.File]::ReadAllText($existing) | Should -Be $original
        @(Get-ChildItem -Path $TestDrive -Filter 'existing.rtf.signaturee-*').Count | Should -Be 0
    }

    It 'never creates an empty RTF placeholder when Word is unavailable' {
        $global:wordAvailable = $false
        $outputPath = Join-Path $TestDrive 'missing-output.rtf'
        (ConvertTo-RtfVersion -HtmlPath (Join-Path $TestDrive 'missing.html') -RtfPath $outputPath) |
            Should -BeFalse
        [System.IO.File]::Exists($outputPath) | Should -BeFalse
    }
}
