# Invoked by a separate, one-shot Windows Scheduled Task, not by Signaturee's
# own process tree. Otherwise Stop-ScheduledTask may kill its restart helper.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$TargetTask,
    [Parameter(Mandatory=$true)][string]$HelperTask,
    [Parameter(Mandatory=$true)][string]$RepoRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$logDir = Join-Path $RepoRoot 'Logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$log = Join-Path $logDir 'backend-restart.log'
function Write-RestartLog([string]$message) {
    Add-Content -LiteralPath $log -Encoding UTF8 -Value ("{0:u} {1}" -f (Get-Date),$message)
}

try {
    # The HTTP request must finish before we shut down the backend.
    Start-Sleep -Seconds 2
    $task = Get-ScheduledTask -TaskName $TargetTask -ErrorAction Stop
    $args = [string](($task.Actions | ForEach-Object { $_.Arguments }) -join ' ')
    $expected = Join-Path $RepoRoot 'scripts\run-backend.ps1'
    if ($args.IndexOf($expected,[StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Refusing to restart an unexpected task target: $TargetTask"
    }

    Write-RestartLog "Stopping $TargetTask"
    Stop-ScheduledTask -TaskName $TargetTask -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 500
        $task = Get-ScheduledTask -TaskName $TargetTask -ErrorAction Stop
    } while ([string]$task.State -eq 'Running' -and (Get-Date) -lt $deadline)
    if ([string]$task.State -eq 'Running') { throw "Task did not stop in time: $TargetTask" }

    Write-RestartLog "Starting $TargetTask"
    Start-ScheduledTask -TaskName $TargetTask -ErrorAction Stop
    Write-RestartLog "Restart requested successfully"
} catch {
    Write-RestartLog ("Restart failed: " + $_.Exception.Message)
    throw
} finally {
    # This is not the backend runner task; it can be unregistered independently.
    Unregister-ScheduledTask -TaskName $HelperTask -Confirm:$false -ErrorAction SilentlyContinue
}
