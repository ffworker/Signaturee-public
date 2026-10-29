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
