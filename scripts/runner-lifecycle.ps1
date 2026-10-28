# Shared Windows runner controls for Signaturee's Scheduled Tasks.
# Stops only Signaturee Node processes from the specified clone; never all node.exe.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-SignatureeAdministrator {
    $principal = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
        throw 'Run PowerShell as Administrator to control Signaturee Scheduled Tasks.'
    }
}

function Get-SignatureeEnvPort {
    param([string]$EnvFile, [string]$Name, [int]$Default)
    $result = $Default
    foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
        if ($line -match ('^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*?)\s*$')) {
            $value = $Matches[1].Trim().Trim('"').Trim("'")
            if ($value -notmatch '^\d{1,5}$') { throw "Invalid $Name in .env: expected a port number." }
            $result = [int]$value
        }
    }
    if ($result -le 0 -or $result -gt 65535) { throw "Invalid $Name port: $result." }
    return $result
}

function Get-SignatureeRunnerConfig {
    param(
        [string]$RepoRoot,
        [string]$EnvFile = '',
        [string]$BackendTaskName = 'Signaturee-Backend-Runner',
        [string]$FrontendTaskName = 'Signaturee-Frontend-Runner'
    )
    Assert-SignatureeAdministrator
    $root = (Resolve-Path -LiteralPath $RepoRoot -ErrorAction Stop).Path
    if (-not $EnvFile) { $EnvFile = Join-Path $root '.env' }
    $envPath = [System.IO.Path]::GetFullPath($EnvFile)
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
        throw "Missing environment file $envPath. Create .env before restarting."
    }
    $backendPort = Get-SignatureeEnvPort -EnvFile $envPath -Name 'BACKEND_PORT' -Default 3001
    $frontendPort = Get-SignatureeEnvPort -EnvFile $envPath -Name 'FRONTEND_PORT' -Default 3000
    if ($backendPort -eq $frontendPort) { throw 'BACKEND_PORT and FRONTEND_PORT must differ.' }

    $tasks = @(
        [pscustomobject]@{ Name = $BackendTaskName; Script = (Join-Path $root 'scripts\run-backend.ps1') },
        [pscustomobject]@{ Name = $FrontendTaskName; Script = (Join-Path $root 'scripts\run-frontend.ps1') }
    )
    foreach ($item in $tasks) {
        $task = Get-ScheduledTask -TaskName $item.Name -ErrorAction SilentlyContinue
        if (-not $task) { throw "Scheduled Task missing: $($item.Name). Install it first." }
        $argsText = [string](($task.Actions | ForEach-Object { $_.Arguments }) -join ' ')
        foreach ($expected in @($item.Script, $root, $envPath)) {
            if ($argsText.IndexOf($expected, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
                throw "Task '$($item.Name)' points elsewhere. Expected '$expected' in its arguments. Re-register that task against this clone before a reload."
            }
        }
    }
    return [pscustomobject]@{
        RepoRoot = $root
        EnvFile = $envPath
        BackendPort = $backendPort
        FrontendPort = $frontendPort
        Tasks = $tasks
        BackendEntry = (Join-Path $root 'backend\server.js')
        FrontendEntry = (Join-Path $root 'scripts\start-frontend.js')
    }
}

function Get-SignatureeOwnedNodes {
    param($Config)
    $entries = @($Config.BackendEntry, $Config.FrontendEntry)
    @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop |
        Where-Object {
            $cmd = [string]$_.CommandLine
            $found = $false
            foreach ($entry in $entries) {
                if ($cmd.IndexOf($entry, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                    $found = $true
                }
            }
            $found
        })
}

function Get-SignatureePortListeners {
    param($Config)
    $ports = @($Config.BackendPort, $Config.FrontendPort)
    @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $ports -contains [int]$_.LocalPort })
}

function Stop-SignatureeRunner {
    param($Config, [int]$TimeoutSeconds = 30)
    foreach ($item in $Config.Tasks) {
        Write-Host "Stopping task $($item.Name) (even if Task Scheduler reports Ready)..."
        Stop-ScheduledTask -TaskName $item.Name -ErrorAction SilentlyContinue
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $running = @($Config.Tasks | Where-Object {
            [string](Get-ScheduledTask -TaskName $_.Name -ErrorAction Stop).State -eq 'Running'
        })
        if ($running.Count -eq 0) { break }
        Start-Sleep -Milliseconds 400
    } while ((Get-Date) -lt $deadline)
    if ($running.Count) { throw "Tasks did not stop: $(($running.Name) -join ', ')" }

    # A task can be Ready while its previous node.exe child is still listening.
    # Stop only Node processes whose command line names THIS clone's entrypoints.
    foreach ($node in @(Get-SignatureeOwnedNodes -Config $Config)) {
        Write-Host "Stopping old Signaturee node.exe PID $($node.ProcessId)..."
        Stop-Process -Id $node.ProcessId -Force -ErrorAction SilentlyContinue
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $nodes = @(Get-SignatureeOwnedNodes -Config $Config)
        $listeners = @(Get-SignatureePortListeners -Config $Config)
        if (-not $nodes.Count -and -not $listeners.Count) { return }
        Start-Sleep -Milliseconds 400
    } while ((Get-Date) -lt $deadline)

    $details = @($listeners | ForEach-Object { "port $($_.LocalPort) PID $($_.OwningProcess)" })
    if ($nodes.Count) { $details += @($nodes | ForEach-Object { "Signaturee PID $($_.ProcessId)" }) }
    throw "Cannot safely reload. Remaining processes/listeners: $($details -join '; '). Check their command lines; unrelated processes were NOT killed."
}

function Start-SignatureeRunner {
    param($Config, [int]$TimeoutSeconds = 45)
    foreach ($item in $Config.Tasks) {
        Write-Host "Starting $($item.Name)..."
        Start-ScheduledTask -TaskName $item.Name -ErrorAction Stop
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $nodes = @(Get-SignatureeOwnedNodes -Config $Config)
        $listeners = @(Get-SignatureePortListeners -Config $Config)
        $ready = $true
        foreach ($entry in @(
            [pscustomobject]@{ Port = $Config.BackendPort; Script = $Config.BackendEntry },
            [pscustomobject]@{ Port = $Config.FrontendPort; Script = $Config.FrontendEntry }
        )) {
            $listener = @($listeners | Where-Object { $_.LocalPort -eq $entry.Port })
            $owner = @($nodes | Where-Object {
                $_.CommandLine.IndexOf($entry.Script, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                @($listener.OwningProcess) -contains $_.ProcessId
            })
            if ($owner.Count -eq 0) { $ready = $false }
        }
        if ($ready) {
            Write-Host "Verified: Backend on $($Config.BackendPort), Frontend on $($Config.FrontendPort), both from $($Config.RepoRoot)." -ForegroundColor Green
            return
        }
        Start-Sleep -Milliseconds 600
    } while ((Get-Date) -lt $deadline)

    foreach ($item in $Config.Tasks) {
        $task = Get-ScheduledTask -TaskName $item.Name
        $info = Get-ScheduledTaskInfo -TaskName $item.Name
        Write-Warning "$($item.Name): State=$($task.State) LastTaskResult=$($info.LastTaskResult)"
    }
    throw 'Signaturee failed to reach healthy listeners for this clone. Inspect Task Scheduler history and the backend startup errors; the updater will not report false success.'
}

function Test-SignatureeConfiguration {
    param($Config)
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $server = Join-Path $Config.RepoRoot 'backend\server.js'
    Write-Host "Checking the new configuration in $($Config.EnvFile)..."
    # Run the config checker in an isolated child with explicit env-file selection.
    $previous = [Environment]::GetEnvironmentVariable('SIGNATUREE_ENV_FILE', 'Process')
    try {
        $env:SIGNATUREE_ENV_FILE = $Config.EnvFile
        & $node $server --check | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "backend/server.js --check failed with exit code $LASTEXITCODE. No restart performed." }
    } finally {
        if ($null -eq $previous) {
            [Environment]::SetEnvironmentVariable('SIGNATUREE_ENV_FILE', $null, 'Process')
        } else {
            $env:SIGNATUREE_ENV_FILE = $previous
        }
    }
}
