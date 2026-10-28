param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$TaskName = "Signaturee-Frontend-Runner",
    [string]$EnvFile = "",
    [switch]$Remove,
    [switch]$StartNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
        throw "This script must be run as Administrator."
    }
}

Assert-Admin

if (-not $EnvFile) {
    $EnvFile = Join-Path $RepoRoot ".env"
}

$runScript = Join-Path $PSScriptRoot "run-frontend.ps1"
if (-not (Test-Path -LiteralPath $runScript)) {
    throw "Missing run script: $runScript"
}

if ($Remove) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'."
    } else {
        Write-Host "Task '$TaskName' does not exist."
    }
    return
}

$psExe = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$argList = "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`" -RepoRoot `"$RepoRoot`" -EnvFile `"$EnvFile`""

$action = New-ScheduledTaskAction -Execute $psExe -Argument $argList -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Runs Signaturee frontend static server at startup on dedicated VM runner."

Write-Host "Registered scheduled task '$TaskName'."
Write-Host "RepoRoot: $RepoRoot"
Write-Host "EnvFile:  $EnvFile"

if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Task '$TaskName' started."
}
