BeforeAll {
    $root = Split-Path -Parent $PSScriptRoot
    $helperPath = Join-Path -Path $root -ChildPath "Functions/UserDomainHelpers.ps1"

    if (-not (Test-Path -LiteralPath $helperPath)) {
        throw "Unable to locate helper file at $helperPath"
    }

    if (-not (Get-Command -Name Write-Log -ErrorAction SilentlyContinue)) {
        function Write-Log {
            param(
                [string]$Message,
                [string]$Level = "INFO"
            )
        }
    }

    . $helperPath
}

Describe "Get-CsvUserDomains" {
    BeforeEach {
        $script:allDomains = [System.Collections.Hashtable]::new([System.StringComparer]::OrdinalIgnoreCase)
        $script:allDomains["example"] = "Templatefiles/example_template.htm"
        $script:allDomains["example-int"] = "Templatefiles/example-int_template.htm"
    }

    It "returns only domains that exist in configuration" {
        $user = [pscustomobject]@{
            sAMAccountName = "csv.user"
            CsvDomains     = @("example", "example-int", "unknown")
        }

        $domains = Get-CsvUserDomains -User $user -Domains $allDomains

        $domains.Count | Should -Be 2
        ($domains -contains "example") | Should -BeTrue
        ($domains -contains "example-int") | Should -BeTrue
    }

    It "returns empty when user has no matching configured domains" {
        $user = [pscustomobject]@{
            sAMAccountName = "csv.user"
            CsvDomains     = @("missing1", "missing2")
        }

        $domains = Get-CsvUserDomains -User $user -Domains $allDomains

        $domains.Count | Should -Be 0
    }
}
