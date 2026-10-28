# Signaturee backend Scheduled Task entrypoint.
# The Node application itself parses SIGNATUREE_ENV_FILE with scripts/load-env.js.
# Never parse or duplicate .env logic in PowerShell (prevents configuration drift).
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
$entry = Join-Path $RepoRoot 'backend\server.js'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
    throw "Signaturee backend entrypoint not found: $entry"
}

# A SYSTEM Scheduled Task may have a different PATH from an interactive user.
$nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "Node.js executable not found for the Scheduled Task identity. Install Node.js system-wide."
}

$env:SIGNATUREE_ENV_FILE = $EnvFile
Write-Host "Starting Signaturee backend from $RepoRoot with env file $EnvFile"
Push-Location $RepoRoot
try {
    & $nodePath $entry
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($null -eq $exitCode) { exit 1 }
exit [int]$exitCode
