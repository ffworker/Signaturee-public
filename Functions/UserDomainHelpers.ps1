# Functions\UserDomainHelpers.ps1

function Test-SafeUsernameSegment {
    param([string]$Username)

    if ([string]::IsNullOrWhiteSpace($Username) -or $Username -ne $Username.Trim()) { return $false }
    if ($Username -eq '.' -or $Username -eq '..' -or $Username -match '[<>:"/\\|?*\x00-\x1f]' -or $Username -match '[. ]$') { return $false }
    if ($Username -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)') { return $false }
    return $true
}

function Get-CsvUserDomains {
    param(
        [Parameter(Mandatory=$true)]
        $User,
        
        [Parameter(Mandatory=$true)]
        [hashtable]$Domains
    )
    
    $userDomains = @()
    
    # Check if user has CsvDomains property (set by ConvertTo-SignatureUserObject)
    if ($User.PSObject.Properties['CsvDomains'] -and $User.CsvDomains) {
        $userDomains = @($User.CsvDomains | Where-Object { $Domains.ContainsKey($_) })
    }
    
    # Always return an array, even for 0/1 elements.
    return ,$userDomains
}

function Get-UserDomains {
    param(
        [Parameter(Mandatory=$true)]
        $User,
        
        [Parameter(Mandatory=$false)]
        [object[]]$MemberOf = @(),
        
        [switch]$RefreshMembership,

        [switch]$LogDiagnostics
    )
    
    $domains = @()
    $memberOfList = @()

    if ($null -ne $MemberOf -and $MemberOf.Count -gt 0) {
        $memberOfList = @($MemberOf)
    }

    if ($RefreshMembership -or $memberOfList.Count -eq 0) {
        try {
            $serverParam = @{}
            if ($script:Server) { $serverParam["Server"] = $script:Server }
            $groupMembership = Get-ADPrincipalGroupMembership -Identity $User @serverParam
            $memberOfList = @($groupMembership | ForEach-Object { $_.DistinguishedName })
            Write-Log "Refreshed group membership for $($User.sAMAccountName): $($memberOfList.Count) groups"
        } catch {
            Write-Log "Unable to refresh group membership for $($User.sAMAccountName): $_" -Level "WARNING"
        }
    }

    if ($memberOfList.Count -eq 0) {
        if ($LogDiagnostics) {
            Write-Log "User $($User.sAMAccountName): no group memberships available for domain resolution." -Level "WARNING"
        }
        # Always return an array, even when empty.
        return ,@()
    }

    foreach ($groupDn in $memberOfList) {
        if (-not $groupDn) { continue }

        $groupName = $groupDn
        if ($groupDn -is [string] -and $groupDn -match 'CN=([^,]+)') {
            $groupName = $Matches[1]
        }

        # Special case: "Signatur-ALLE" grants all configured domains
        if ($groupName -and $groupName -ieq "Signatur-ALLE") {
            foreach ($domKey in $script:allDomains.Keys) {
                if (-not ($domains -contains $domKey)) {
                    $domains += $domKey
                }
            }
            Write-Log "User $($User.sAMAccountName): mapped Signatur-ALLE to all domains [$($script:allDomains.Keys -join ', ')]"
            continue
        }

        foreach ($sgKey in $script:securityGroupMapping.Keys) {
            if ($groupName -ieq $sgKey) {
                $domainKey = $script:securityGroupMapping[$sgKey]
                if ($domainKey -and -not ($domains -contains $domainKey)) {
                    $domains += $domainKey
                }
            }
        }
    }

    if ($LogDiagnostics) {
        if ($domains.Count -gt 0) {
            Write-Log "User $($User.sAMAccountName): mapped $($memberOfList.Count) groups to domains [$($domains -join ', ')]"
        } else {
            $sampleGroups = $memberOfList | Select-Object -First 5
            Write-Log "User $($User.sAMAccountName): $($memberOfList.Count) groups found but none mapped. Sample: $($sampleGroups -join '; ')" -Level "WARNING"
        }
    }

    # Always return an array, even for 0/1 elements.
    return ,$domains
}

function Resolve-ConfiguredDomainKey {
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$Domains,
        
        [Parameter(Mandatory=$true)]
        [string]$LookupKey
    )
    
    foreach ($key in $Domains.Keys) {
        if ($key -ieq $LookupKey) {
            return $key
        }
    }
    
    return $null
}
