<#
.SYNOPSIS
  Update Signaturee code and restart both Windows Scheduled Tasks.
.DESCRIPTION
  Works even if Task Scheduler reports Ready. Checks actual Node listeners and
  identifies old Node processes from this clone before stopping them. Refuses
  to kill unrelated processes on 3000/3001. Local .env is never overwritten.
  For ONLY reloading .env, use scripts/reload-config.ps1 instead.
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
. (Join-Path $PSScriptRoot 'runner-lifecycle.ps1')

$config = Get-SignatureeRunnerConfig -RepoRoot $RepoRoot -EnvFile $EnvFile -BackendTaskName $BackendTaskName -FrontendTaskName $FrontendTaskName
$git = (Get-Command git.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$branch = & $git -C $config.RepoRoot symbolic-ref --quiet --short HEAD
if ($LASTEXITCODE -ne 0 -or -not $branch) { throw 'Detached HEAD; checkout a branch first.' }

$dirty = @(& $git -C $config.RepoRoot status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine Git working-tree status.' }
if (($dirty -join '').Trim()) {
    throw "Tracked Git changes must be preserved before updating: $($dirty -join '; ')"
}
Test-SignatureeConfiguration -Config $config

Write-Host "Updating Signaturee from branch $branch; local .env will remain untouched." -ForegroundColor Cyan
$complete = $false
try {
    Stop-SignatureeRunner -Config $config -TimeoutSeconds $TimeoutSeconds

    if (-not $SkipPull) {
        Write-Host 'Pulling current branch (fast-forward only)...' -ForegroundColor Cyan
        & $git -C $config.RepoRoot pull --ff-only
        if ($LASTEXITCODE -ne 0) { throw "git pull failed ($LASTEXITCODE)." }
    }

    Push-Location $config.RepoRoot
    try {
        Write-Host 'Installing locked npm runtime dependencies...' -ForegroundColor Cyan
        & $npm ci --omit=dev
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)." }
    } finally {
        Pop-Location
    }

    # Re-read .env; editing ports during migration is supported.
    $config = Get-SignatureeRunnerConfig -RepoRoot $config.RepoRoot -EnvFile $config.EnvFile -BackendTaskName $BackendTaskName -FrontendTaskName $FrontendTaskName
    Test-SignatureeConfiguration -Config $config
    Start-SignatureeRunner -Config $config -TimeoutSeconds $TimeoutSeconds
    $complete = $true
} finally {
    if (-not $complete) {
        Write-Warning 'Update incomplete. No automatic rollback; tasks may be stopped or partially started.'
        Write-Warning 'Inspect the specific failure, update your .env, then run scripts/reload-config.ps1.'
    }
}
Write-Host "Signaturee update complete on $branch, .env reloaded." -ForegroundColor Green
