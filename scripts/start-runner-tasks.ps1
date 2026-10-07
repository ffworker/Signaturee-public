param(
    [string]$BackendTaskName = "Signaturee-Backend-Runner",
    [string]$FrontendTaskName = "Signaturee-Frontend-Runner"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Start-RunnerTask {
    param([string]$TaskName)

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) {
        Write-Warning "Task '$TaskName' not found."
        return
    }

    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Milliseconds 400

    $updated = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    $state = if ($updated) { $updated.State } else { "Unknown" }
    Write-Host "$TaskName -> LastTaskResult=$($info.LastTaskResult) State=$state"
}

Start-RunnerTask -TaskName $BackendTaskName
Start-RunnerTask -TaskName $FrontendTaskName