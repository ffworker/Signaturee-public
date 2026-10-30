Describe 'Windows package private-path safety' {
    BeforeAll {
        $scriptPath = Join-Path $PSScriptRoot '..\scripts\package-windows.ps1' | Resolve-Path
        $required = @(
            'README.md', 'LICENSE', '.env.example', 'package.json',
            'package-lock.json', 'GenerateSignatures.ps1', 'backend\server.js',
            'frontend\login.html', 'scripts\install-backend-task.ps1',
            'scripts\install-frontend-task.ps1'
        )
    }

    It 'rejects recursive runtime and private material: <forbidden>' -ForEach @(
        @{ forbidden = 'backend\.env' },
        @{ forbidden = 'state\cache.sqlite' },
        @{ forbidden = 'state\cache.sqlite-wal' },
        @{ forbidden = 'state\cache.db-shm' },
        @{ forbidden = 'config\templates\private.htm' },
        @{ forbidden = 'nested\node_modules\private.txt' },
        @{ forbidden = 'private\client.key' },
        @{ forbidden = 'certs\server.pem' },
        @{ forbidden = 'config\employees.json' },
        @{ forbidden = 'generatedsignatures\employee.txt' },
        @{ forbidden = 'runtime-data\output.txt' }
    ) {
        param($forbidden)
        $repo = Join-Path ([System.IO.Path]::GetTempPath()) ('signaturee-package-test-' + [guid]::NewGuid())
        $out = Join-Path $repo 'out'
        try {
            New-Item -ItemType Directory -Force -Path $repo | Out-Null
            foreach ($file in $required) {
                $path = Join-Path $repo $file
                New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
                if ($file -eq 'package.json') {
                    '{"name":"signaturee","version":"2.0.0"}' | Set-Content -LiteralPath $path
                } else {
                    'fixture' | Set-Content -LiteralPath $path
                }
            }
            $bad = Join-Path $repo $forbidden
            New-Item -ItemType Directory -Force -Path (Split-Path $bad) | Out-Null
            'private fixture' | Set-Content -LiteralPath $bad
            git -C $repo init --quiet
            git -C $repo config user.email test@example.invalid
            git -C $repo config user.name package-test
            git -C $repo add .
            git -C $repo commit --quiet -m fixture

            & powershell.exe -NoProfile -File $scriptPath -RepoRoot $repo -OutputDirectory $out
            $LASTEXITCODE | Should -Not -Be 0
            Test-Path (Join-Path $out 'signaturee-win-v2.0.0.zip') | Should -BeFalse
        } finally {
            Remove-Item -LiteralPath $repo -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
