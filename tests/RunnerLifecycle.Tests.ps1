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

    It 'treats missing TCP listeners as not ready instead of throwing under StrictMode' {
        $entry = [pscustomobject]@{
            Port = 3001
            Scripts = @('C:\Signaturee-clean\backend\server.js')
        }
        $nodes = @([pscustomobject]@{
            ProcessId = 1234
            CommandLine = 'node.exe C:\Signaturee-clean\backend\server.js'
        })
        Test-SignatureeListenerOwnership -Entry $entry -Nodes $nodes -Listeners @() |
            Should -BeFalse
    }

    It 'accepts only a matching port owner AND this installations entrypoint' {
        $entry = [pscustomobject]@{
            Port = 3001
            Scripts = @('C:\Signaturee-clean\backend\server.js')
        }
        $nodes = @(
            [pscustomobject]@{ ProcessId = 1234; CommandLine = 'node.exe C:\Signaturee-clean\backend\server.js' },
            [pscustomobject]@{ ProcessId = 5678; CommandLine = 'node.exe C:\Other\backend\server.js' }
        )
        $matching = @([pscustomobject]@{ LocalPort = 3001; OwningProcess = 1234 })
        $otherPort = @([pscustomobject]@{ LocalPort = 3000; OwningProcess = 1234 })
        $otherProcess = @([pscustomobject]@{ LocalPort = 3001; OwningProcess = 5678 })
        Test-SignatureeListenerOwnership -Entry $entry -Nodes $nodes -Listeners $matching |
            Should -BeTrue
        Test-SignatureeListenerOwnership -Entry $entry -Nodes $nodes -Listeners $otherPort |
            Should -BeFalse
        Test-SignatureeListenerOwnership -Entry $entry -Nodes $nodes -Listeners $otherProcess |
            Should -BeFalse
    }

    It 'does not report a port belonging to an unrelated Node service as Signaturee' {
        $entry = [pscustomobject]@{
            Port = 3000
            Scripts = @('C:\Signaturee-clean\node_modules\http-server\bin\http-server')
        }
        $nodes = @([pscustomobject]@{ ProcessId = 7777; CommandLine = 'node C:\AnotherApp\http-server' })
        $listeners = @([pscustomobject]@{ LocalPort = 3000; OwningProcess = 7777 })
        Test-SignatureeListenerOwnership -Entry $entry -Nodes $nodes -Listeners $listeners |
            Should -BeFalse
    }

    It 'parses all lifecycle scripts without PowerShell syntax errors' {
        foreach ($filename in @('runner-lifecycle.ps1', 'reload-config.ps1', 'update-signaturee.ps1', 'run-backend.ps1', 'run-frontend.ps1', 'install-backend-task.ps1', 'install-frontend-task.ps1')) {
            $path = Join-Path $PSScriptRoot "..\scripts\$filename"
            $tokens = $null
            $errors = $null
            [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
            @($errors).Count | Should -Be 0
        }
    }
}
