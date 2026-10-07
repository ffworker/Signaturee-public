param(
    [string]$BackendTaskName = "Signaturee-Backend-Runner",
    [string]$FrontendTaskName = "Signaturee-Frontend-Runner"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stop-RunnerTask {
    param([string]$TaskName)

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) {
        Write-Warning "Task '$TaskName' not found."
        return
    }

    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400

    $updated = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    $state = if ($updated) { $updated.State } else { "Unknown" }
    $result = if ($info) { $info.LastTaskResult } else { "n/a" }
    Write-Host "$TaskName -> LastTaskResult=$result State=$state"
}

Stop-RunnerTask -TaskName $BackendTaskName
Stop-RunnerTask -TaskName $FrontendTaskName