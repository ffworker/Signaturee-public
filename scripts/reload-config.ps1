<#
.SYNOPSIS
    Apply edits to this installation's .env without git pull or reinstalling tasks.
.EXAMPLE
    .\scripts\reload-config.ps1
.DESCRIPTION
    Requires elevated Windows PowerShell. Validates .env before stopping anything,
    stops only tasks/Node children belonging to this clone, restarts both tasks and
    checks that the expected listeners are owned by this clone. Never modifies .env.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = (Join-Path $PSScriptRoot '..'),
    [string]$EnvFile = '',
    [string]$BackendTaskName = 'Signaturee-Backend-Runner',
    [string]$FrontendTaskName = 'Signaturee-Frontend-Runner',
    [int]$TimeoutSeconds = 45,
    [switch]$Watch,
    [int]$WatchIntervalSeconds = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runner-lifecycle.ps1')

$config = Get-SignatureeRunnerConfig -RepoRoot $RepoRoot -EnvFile $EnvFile -BackendTaskName $BackendTaskName -FrontendTaskName $FrontendTaskName

Test-SignatureeConfiguration -Config $config
Write-Host 'Reloading Signaturee .env (no Git pull, no npm install)...' -ForegroundColor Cyan
Stop-SignatureeRunner -Config $config -TimeoutSeconds $TimeoutSeconds
Start-SignatureeRunner -Config $config -TimeoutSeconds $TimeoutSeconds
Write-Host 'Configuration reloaded. Refresh the browser and test LDAP/SMB again.' -ForegroundColor Green

if ($Watch) {
    if ($WatchIntervalSeconds -lt 1) { throw 'WatchIntervalSeconds must be >= 1.' }
    Write-Host 'Watching .env for changes. Keep this PowerShell window open; Ctrl+C stops watching, not the application.' -ForegroundColor Cyan
    $lastHash = (Get-FileHash -LiteralPath $config.EnvFile -Algorithm SHA256).Hash
    while ($true) {
        Start-Sleep -Seconds $WatchIntervalSeconds
        try {
            $nextHash = (Get-FileHash -LiteralPath $config.EnvFile -Algorithm SHA256).Hash
            if ($nextHash -eq $lastHash) { continue }
            $lastHash = $nextHash
            Write-Host 'Detected .env change; validating and reloading...' -ForegroundColor Cyan
            $nextConfig = Get-SignatureeRunnerConfig -RepoRoot $config.RepoRoot -EnvFile $config.EnvFile -BackendTaskName $BackendTaskName -FrontendTaskName $FrontendTaskName
            Test-SignatureeConfiguration -Config $nextConfig
            Stop-SignatureeRunner -Config $nextConfig -TimeoutSeconds $TimeoutSeconds
            Start-SignatureeRunner -Config $nextConfig -TimeoutSeconds $TimeoutSeconds
            $config = $nextConfig
            Write-Host '.env change is active.' -ForegroundColor Green
        } catch {
            Write-Warning ("Cannot apply .env edit: " + $_.Exception.Message)
            Write-Warning 'Fix the file and save again. Watching remains active; unrelated processes will not be stopped.'
        }
    }
}
