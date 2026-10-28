BeforeAll {
    $root = Split-Path -Parent $PSScriptRoot
    $helperPath = Join-Path -Path $root -ChildPath "Functions/UserDomainHelpers.ps1"

    if (-not ('Microsoft.ActiveDirectory.Management.ADUser' -as [type])) {
        Add-Type -TypeDefinition "namespace Microsoft.ActiveDirectory.Management { public class ADUser { public string SamAccountName { get; set; } } }"
    }

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

Describe "Get-UserDomains" {
    BeforeEach {
        $script:allDomains = [System.Collections.Hashtable]::new([System.StringComparer]::OrdinalIgnoreCase)
        $script:allDomains["example"] = "Templatefiles/example_template.htm"
        $script:securityGroupMapping = [System.Collections.Hashtable]::new([System.StringComparer]::OrdinalIgnoreCase)
        $script:securityGroupMapping["Signatur-example"] = "example"
        $script:Server = "test"
    }

    It "returns mapped domains when MemberOf contains matching CN" {
        $user = [Microsoft.ActiveDirectory.Management.ADUser]::new()
        $user.SamAccountName = "caseuser"

        $memberOf = @("CN=Signatur-example,OU=Groups,DC=example,DC=com")

        $domains = Get-UserDomains -User $user -MemberOf $memberOf

        ($domains -contains "example") | Should -BeTrue
        $domains.Count | Should -Be 1
    }

    It "does not map a group name mentioned only in an OU" {
        $user = [Microsoft.ActiveDirectory.Management.ADUser]::new()
        $user.SamAccountName = "caseuser"
        $memberOf = @("CN=OtherGroup,OU=Signatur-example,DC=example,DC=com")
        $domains = Get-UserDomains -User $user -MemberOf $memberOf
        $domains.Count | Should -Be 0
    }

    It "maps a full DN exactly and rejects the same CN in a different OU" {
        $user = [Microsoft.ActiveDirectory.Management.ADUser]::new()
        $user.SamAccountName = "caseuser"
        $script:securityGroupMapping.Clear()
        $script:securityGroupMapping["CN=Signature-AD,OU=Groups,DC=example,DC=com"] = "example"

        $match = Get-UserDomains -User $user -MemberOf @("CN=Signature-AD,OU=Groups,DC=example,DC=com")
        ($match -contains "example") | Should -BeTrue

        $noMatch = Get-UserDomains -User $user -MemberOf @("CN=Signature-AD,OU=Other,DC=example,DC=com")
        $noMatch.Count | Should -Be 0
    }

    It "maps the configured Signature-AD short CN" {
        $user = [Microsoft.ActiveDirectory.Management.ADUser]::new()
        $user.SamAccountName = "caseuser"
        $script:securityGroupMapping.Clear()
        $script:securityGroupMapping["Signature-AD"] = "example"

        $match = Get-UserDomains -User $user -MemberOf @("CN=Signature-AD,OU=Groups,DC=example,DC=com")
        ($match -contains "example") | Should -BeTrue
    }

    It "returns empty list when no matching mapping exists" {
        $user = [Microsoft.ActiveDirectory.Management.ADUser]::new()
        $user.SamAccountName = "caseuser"

        $memberOf = @("CN=OtherGroup,OU=Groups,DC=example,DC=com")

        $domains = Get-UserDomains -User $user -MemberOf $memberOf

        $domains.Count | Should -Be 0
    }
}
