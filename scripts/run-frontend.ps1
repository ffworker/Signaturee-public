param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$EnvFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Import-EnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Host "Runner env file not found at '$Path'. Using existing process env only."
        return
    }

    Write-Host "Loading runner env from '$Path'..."
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = [string]$line
        if (-not $trimmed) { continue }
        $trimmed = $trimmed.Trim()
        if (-not $trimmed) { continue }
        if ($trimmed.StartsWith("#")) { continue }

        $idx = $trimmed.IndexOf("=")
        if ($idx -lt 1) { continue }

        $key = $trimmed.Substring(0, $idx).Trim()
        $value = $trimmed.Substring($idx + 1).Trim()
        if (-not $key) { continue }

        [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
}

if (-not $EnvFile) {
    $EnvFile = Join-Path $RepoRoot ".env"
}

if (-not (Test-Path -LiteralPath $RepoRoot)) {
    throw "RepoRoot does not exist: $RepoRoot"
}

Import-EnvFile -Path $EnvFile

if (-not $env:FRONTEND_HOST) { $env:FRONTEND_HOST = "0.0.0.0" }
if (-not $env:FRONTEND_PORT) { $env:FRONTEND_PORT = "3000" }

$scriptPath = Join-Path $RepoRoot "scripts\start-frontend.js"
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Could not find scripts/start-frontend.js at: $scriptPath"
}

$nodeCmd = Get-Command node -ErrorAction Stop

Write-Host "Starting Signaturee frontend..."
Write-Host "RepoRoot: $RepoRoot"
Write-Host "Host/Port: $($env:FRONTEND_HOST):$($env:FRONTEND_PORT)"

Push-Location $RepoRoot
try {
    & $nodeCmd.Source $scriptPath
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
