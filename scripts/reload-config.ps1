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
    [int]$TimeoutSeconds = 45
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
