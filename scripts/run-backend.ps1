param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$EnvFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Import-EnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Signaturee .env file not found at '$Path'. Create it from .env.example."
    }

    Write-Host "Loading runner env from '$Path'..."
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
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

$EnvFile = [System.IO.Path]::GetFullPath($EnvFile)
$env:SIGNATUREE_ENV_FILE = $EnvFile
Import-EnvFile -Path $EnvFile

if (-not $env:BACKEND_HOST) { $env:BACKEND_HOST = "0.0.0.0" }
if (-not $env:BACKEND_PORT) { $env:BACKEND_PORT = "3001" }
if (-not $env:BACKEND_BASE_PATH) { $env:BACKEND_BASE_PATH = "/" }

$serverPath = Join-Path $RepoRoot "backend\server.js"
if (-not (Test-Path -LiteralPath $serverPath)) {
    throw "Could not find backend/server.js at: $serverPath"
}

$nodeCmd = Get-Command node -ErrorAction Stop

Write-Host "Starting Signaturee backend..."
Write-Host "RepoRoot: $RepoRoot"
Write-Host "Host/Port/BasePath: $($env:BACKEND_HOST):$($env:BACKEND_PORT)$($env:BACKEND_BASE_PATH)"

Push-Location $RepoRoot
try {
    & $nodeCmd.Source $serverPath
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
