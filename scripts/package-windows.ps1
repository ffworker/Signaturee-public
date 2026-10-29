<#
    Build a Windows source distribution ZIP from a committed Git revision.
    The package is intentionally not an EXE and does not bundle Node.js,
    LibreOffice, private templates, user data, or runtime databases.

    Works with Windows PowerShell 5.1. Requires Git on the build machine.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = (Join-Path $PSScriptRoot '..'),
    [string]$OutputDirectory = '',
    [string]$Ref = 'HEAD'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot -ErrorAction Stop).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $RepoRoot 'dist' }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

if ($Ref -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$') {
    throw 'Invalid Git revision. Provide a branch, tag, or commit ID.'
}

$packageFile = Join-Path $RepoRoot 'package.json'
if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
    throw "Missing package.json: $packageFile"
}
$version = [string](Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json).version
if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$') {
    throw "Invalid release version in package.json: $version"
}

$git = (Get-Command git.exe -ErrorAction SilentlyContinue)
if (-not $git) { $git = Get-Command git -ErrorAction Stop }
$gitPath = $git.Source

$worktree = & $gitPath -C $RepoRoot status --porcelain --untracked-files=normal
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Git worktree.' }
if (@($worktree | Where-Object { $_ }).Count -gt 0) {
    # Tests/installation can create untracked build files. git archive reads
    # the selected committed tree and cannot include those local changes.
    Write-Warning 'The worktree has local changes; they are excluded from this commit-based ZIP.'
}

$commit = & $gitPath -C $RepoRoot rev-parse --verify "$Ref^{commit}"
if ($LASTEXITCODE -ne 0 -or @($commit).Count -ne 1) {
    throw "Cannot resolve Git revision: $Ref"
}
$commit = [string]$commit
if ($commit -notmatch '^[0-9a-f]{40,64}$') { throw "Unexpected commit ID: $commit" }

# Avoid attaching a version from the working tree to an unrelated release ref.
$versionAtCommit = & $gitPath -C $RepoRoot show "$($commit):package.json"
if ($LASTEXITCODE -ne 0) { throw 'Cannot read package.json from chosen commit.' }
$refVersion = [string](($versionAtCommit -join [Environment]::NewLine | ConvertFrom-Json).version)
if ($refVersion -ne $version) {
    throw "Version differs between working tree ($version) and selected commit ($refVersion)."
}

$packageRoot = "signaturee-win-v$version"
$archivePath = Join-Path $OutputDirectory "$packageRoot.zip"
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
if (Test-Path -LiteralPath $archivePath) {
    throw "Archive already exists; refusing to overwrite: $archivePath"
}

# git archive packages tracked files only (never local ignored .env, databases
# or templates); safety-check the archive contents before declaring success.
try {
    & $gitPath -C $RepoRoot archive '--format=zip' "--prefix=$packageRoot/" "--output=$archivePath" $commit
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $archivePath)) {
        throw 'git archive failed.'
    }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $prefix = "$packageRoot/"
        $names = @($zip.Entries | ForEach-Object { $_.FullName })
        foreach ($required in @(
            'README.md',
            'LICENSE',
            '.env.example',
            'package.json',
            'package-lock.json',
            'GenerateSignatures.ps1',
            'backend/server.js',
            'frontend/login.html',
            'scripts/install-backend-task.ps1',
            'scripts/install-frontend-task.ps1'
        )) {
            if ($names -notcontains ($prefix + $required)) {
                throw "Package missing required file: $required"
            }
        }
        $sensitive = @($names | Where-Object {
            $relative = $_.Substring($prefix.Length)
            ($_.StartsWith($prefix) -eq $false) -or
            ($relative -eq '.env') -or
            ($relative -like '.env.*' -and $relative -ne '.env.example') -or
            ($relative -match '^config/(?:templates/|users\.csv$|secrets\.env$|.*\.db$)') -or
            ($relative -match '^(?:Logs|generatedsignatures|node_modules)/')
        })
        if ($sensitive.Count -gt 0) {
            throw "Package contains unexpected/private paths: $($sensitive -join ', ')"
        }
    } finally {
        $zip.Dispose()
    }
} catch {
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    }
    throw
}

Write-Host "Windows ZIP built from $commit : $archivePath"
Write-Output $archivePath
