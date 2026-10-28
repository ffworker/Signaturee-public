<#
.SYNOPSIS
  Update a running Signaturee Scheduled Task installation.
.DESCRIPTION
  Stop old tasks, wait for ports to close, fast-forward pull the current branch,
  run npm ci, and restart the tasks that were running before the update.
  Never modifies ignored local config or silently overwrites tracked changes.
  On failure, makes no rollback attempt; tasks may remain stopped or partially running.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = (Join-Path $PSScriptRoot '..'),
    [string]$EnvFile = '',
    [string]$BackendTaskName = 'Signaturee-Backend-Runner',
    [string]$FrontendTaskName = 'Signaturee-Frontend-Runner',
    [int]$TimeoutSeconds = 45,
    [switch]$SkipPull
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw 'Open PowerShell as Administrator to manage the Signaturee Scheduled Tasks.'
}

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
if (-not $EnvFile) { $EnvFile = Join-Path $RepoRoot 'config\runner.env' }

function Get-EnvValue {
    param([string]$Name, [string]$Default)
    if (-not (Test-Path -LiteralPath $EnvFile)) { return $Default }
    $value = $Default
    foreach ($line in Get-Content -LiteralPath $EnvFile) {
        if ($line -match ('^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*?)\s*$')) {
            $value = $Matches[1]
        }
    }
    return $value
}
function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable exited with code $LASTEXITCODE."
    }
}

$ports = @(
    [int](Get-EnvValue -Name 'BACKEND_PORT' -Default '3001'),
    [int](Get-EnvValue -Name 'FRONTEND_PORT' -Default '3000')
) | Select-Object -Unique

$git = (Get-Command git.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$branch = (& $git -C $RepoRoot symbolic-ref --quiet --short HEAD)
if ($LASTEXITCODE -ne 0 -or -not $branch) { throw 'A named Git branch must be checked out.' }

$dirty = @(& $git -C $RepoRoot status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Git status.' }
if (($dirty -join '').Trim()) {
    throw "Tracked files have local changes. Preserve them before updating: $($dirty -join '; ')"
}

$tasks = @($FrontendTaskName, $BackendTaskName)
$wasRunning = @()
foreach ($name in $tasks) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if (-not $task) { throw "Missing Scheduled Task: $name. Install both tasks before using this updater." }
    if ([string]$task.State -eq 'Running') { $wasRunning += $name }
}
if ($wasRunning.Count -ne 2) {
    throw 'Both Signaturee tasks must be running before an update. Check their state first.'
}

Write-Host "Updating $RepoRoot (branch: $branch)" -ForegroundColor Cyan
$completed = $false
try {
    foreach ($name in $wasRunning) {
        Write-Host "Stopping $name..."
        Stop-ScheduledTask -TaskName $name -ErrorAction Stop
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $running = @($wasRunning | Where-Object {
            [string](Get-ScheduledTask -TaskName $_ -ErrorAction Stop).State -eq 'Running'
        })
        if ($running.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if ($running.Count -gt 0) { throw "Scheduled Tasks did not stop: $($running -join ', ')" }

    # Task state alone cannot detect orphaned Node child processes.
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
            Where-Object { $ports -contains [int]$_.LocalPort })
        if ($listeners.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if ($listeners.Count -gt 0) {
        $details = ($listeners | ForEach-Object { "$($_.LocalPort) (PID $($_.OwningProcess))" }) -join ', '
        throw "Old TCP listeners still present: $details. Investigate them manually before pulling."
    }

    if (-not $SkipPull) {
        Write-Host 'Pulling current branch (fast-forward only)...' -ForegroundColor Cyan
        Invoke-Checked -Executable $git -Arguments @('-C', $RepoRoot, 'pull', '--ff-only')
    }
    Push-Location $RepoRoot
    try {
        Write-Host 'Installing npm dependencies...' -ForegroundColor Cyan
        Invoke-Checked -Executable $npm -Arguments @('ci', '--omit=dev')
    } finally { Pop-Location }

    foreach ($name in $wasRunning) {
        Write-Host "Starting $name..."
        Start-ScheduledTask -TaskName $name -ErrorAction Stop
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $notRunning = @($wasRunning | Where-Object {
            [string](Get-ScheduledTask -TaskName $_ -ErrorAction Stop).State -ne 'Running'
        })
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
            Where-Object { $ports -contains [int]$_.LocalPort })
        $listeningPorts = @($listeners | ForEach-Object { [int]$_.LocalPort } | Select-Object -Unique)
        $missingPorts = @($ports | Where-Object { $listeningPorts -notcontains $_ })
        if ($notRunning.Count -eq 0 -and $missingPorts.Count -eq 0) { break }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    if ($notRunning.Count -gt 0 -or $missingPorts.Count -gt 0) {
        throw "Startup incomplete. Stopped tasks: $($notRunning -join ', '); missing listeners: $($missingPorts -join ', ')"
    }
    $completed = $true
} finally {
    if (-not $completed) {
        Write-Warning 'Update was NOT completed. No automatic rollback or restart is attempted after an error.'
        Write-Warning 'Inspect Git status, process listeners and task state before retrying.'
    }
}
Write-Host "Signaturee update complete ($branch). Both tasks are running." -ForegroundColor Green
Write-Host 'Next: test local login, AD login, and the production SMB target from the Admin UI.'
