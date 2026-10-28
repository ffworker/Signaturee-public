# Signaturee frontend Scheduled Task. Node alone loads SIGNATUREE_ENV_FILE.
param(
    [string]$RepoRoot = (Join-Path $PSScriptRoot '..'),
    [string]$EnvFile = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot -ErrorAction Stop).Path
if (-not $EnvFile) { $EnvFile = Join-Path $RepoRoot '.env' }
$EnvFile = [System.IO.Path]::GetFullPath($EnvFile)
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw "Signaturee .env not found: $EnvFile"
}
$entry = Join-Path $RepoRoot 'scripts\start-frontend.js'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
    throw "Signaturee frontend entrypoint not found: $entry"
}
$nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw 'Node.js is not installed system-wide or in the task PATH.'
}
$env:SIGNATUREE_ENV_FILE = $EnvFile
Write-Host "Starting Signaturee frontend from $RepoRoot with $EnvFile"
Push-Location $RepoRoot
try {
    & $nodePath $entry
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($null -eq $exitCode) { exit 1 }
exit [int]$exitCode
