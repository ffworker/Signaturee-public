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
        if ($key -notmatch '^[a-zA-Z_][a-zA-Z_0-9]*
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
) {
            throw "Invalid key in env file: $key"
        }
        if ($value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
             ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

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
