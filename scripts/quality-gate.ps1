param(
    [switch]$SkipPester
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $repoRoot

$results = @()
$failed = $false

function Add-Result {
    param(
        [string]$Step,
        [string]$Status,
        [string]$Detail = ""
    )
    $script:results += [pscustomobject]@{
        Step   = $Step
        Status = $Status
        Detail = $Detail
    }
}

function Run-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )
    try {
        & $Action
        Add-Result -Step $Name -Status "PASS"
    }
    catch {
        $script:failed = $true
        Add-Result -Step $Name -Status "FAIL" -Detail $_.Exception.Message
    }
}

try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js is not available in PATH."
    }

    Run-Step -Name "Frontend syntax" -Action {
        $frontendFiles = @(
            "frontend/generate-v2.js",
            "frontend/admin-v2.js",
            "frontend/login.js",
            "frontend/self-service.js"
        )
        foreach ($file in $frontendFiles) {
            node --check $file
            if ($LASTEXITCODE -ne 0) {
                throw "node --check $file exited with code $LASTEXITCODE"
            }
        }
    }

    Run-Step -Name "Backend config check" -Action {
        node backend/server.js --check | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "node backend/server.js --check exited with code $LASTEXITCODE"
        }
    }

    Run-Step -Name "Backend unit tests" -Action {
        npm run test:backend
        if ($LASTEXITCODE -ne 0) {
            throw "npm run test:backend exited with code $LASTEXITCODE"
        }
    }

    if ($SkipPester) {
        Add-Result -Step "PowerShell tests (Pester)" -Status "SKIP" -Detail "Skipped by -SkipPester."
    } else {
        Run-Step -Name "PowerShell tests (Pester)" -Action {
            if (-not (Get-Command Invoke-Pester -ErrorAction SilentlyContinue)) {
                throw "Invoke-Pester not found. Install Pester module or run with -SkipPester."
            }
            $pesterResult = Invoke-Pester -Path tests -PassThru
            if ($null -eq $pesterResult) {
                throw "Invoke-Pester returned no result."
            }
            if ($pesterResult.FailedCount -gt 0) {
                throw "$($pesterResult.FailedCount) Pester test(s) failed."
            }
        }
    }
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "Quality Gate Results"
$results | Format-Table -AutoSize
Write-Host ""

if ($failed) {
    Write-Error "Quality gate failed."
    exit 1
}

Write-Host "Quality gate passed."
exit 0
