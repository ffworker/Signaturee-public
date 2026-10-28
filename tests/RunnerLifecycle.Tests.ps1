Describe 'Signaturee runner lifecycle' {
    BeforeAll {
        . (Join-Path $PSScriptRoot '..\scripts\runner-lifecycle.ps1')
    }

    It 'parses ports from the local .env without touching the system' {
        $file = Join-Path $TestDrive 'runner.env'
        @('BACKEND_PORT=3131', 'FRONTEND_PORT="4141"', '# BACKEND_PORT=9999') |
            Set-Content -LiteralPath $file -Encoding UTF8
        Get-SignatureeEnvPort -EnvFile $file -Name 'BACKEND_PORT' -Default 3001 |
            Should -Be 3131
        Get-SignatureeEnvPort -EnvFile $file -Name 'FRONTEND_PORT' -Default 3000 |
            Should -Be 4141
    }

    It 'rejects invalid TCP port configurations before any restart' {
        $file = Join-Path $TestDrive 'invalid.env'
        'BACKEND_PORT=123456' | Set-Content -LiteralPath $file -Encoding UTF8
        { Get-SignatureeEnvPort -EnvFile $file -Name 'BACKEND_PORT' -Default 3001 } |
            Should -Throw
    }

    It 'uses the documented default port when a key is absent' {
        $file = Join-Path $TestDrive 'empty.env'
        'AUTH_REQUIRED=true' | Set-Content -LiteralPath $file -Encoding UTF8
        Get-SignatureeEnvPort -EnvFile $file -Name 'BACKEND_PORT' -Default 3001 |
            Should -Be 3001
    }

    It 'parses all lifecycle scripts without PowerShell syntax errors' {
        foreach ($filename in @('runner-lifecycle.ps1', 'reload-config.ps1', 'update-signaturee.ps1')) {
            $path = Join-Path $PSScriptRoot "..\scripts\$filename"
            $tokens = $null
            $errors = $null
            [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
            @($errors).Count | Should -Be 0
        }
    }
}
