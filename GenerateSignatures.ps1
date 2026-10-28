<# 
    GenerateSignatures.ps1

    Outlook Signature Automation Script (refactored for public use)

    - Uses config/config.json for domain & template configuration
    - Uses config/secrets.env for AD server and paths
    - Supports production templates (Templatefiles) and testing templates (Templatefiles_test) via -UseTestTemplates
#>

param(
    [Parameter(Mandatory=$false, HelpMessage="Specify domains to generate signatures for (comma-separated). Use 'ALL' or 'A' for all domains.")]
    [string]$DomainSelection = "",

    [Parameter(Mandatory=$false, HelpMessage="Specify username(s) to process (comma-separated). Leave blank for all users.")]
    [string]$UserSelection = "",

    [Parameter(Mandatory=$false, HelpMessage="Specify the domain controller FQDN. If omitted, value from secrets.env (AD_SERVER) will be used.")]
    [string]$Server,

    [Parameter(Mandatory=$false, HelpMessage="Generate signatures in %APPDATA%\\Microsoft\\Signatures for direct Outlook testing")]
    [switch]$UseOutlookFolder = $false,

    [Parameter(Mandatory=$false, HelpMessage="Deployment mode: Local, Network or Prompt (default)")]
    [ValidateSet("Local", "Network", "Prompt")]
    [string]$DeploymentMode = "Prompt",
    
    [Parameter(Mandatory=$false, HelpMessage="Generate signatures for all active users based on their security groups")]
    [switch]$MassGeneration = $false,

    [Parameter(Mandatory=$false, HelpMessage="Load user data from a CSV/JSON/YAML file instead of querying Active Directory")]
    [Alias("UseUserCsv")]
    [switch]$UseUserFile = $false,

    [Parameter(Mandatory=$false, HelpMessage="Path to the user data file (CSV/JSON/YAML) when -UseUserFile is specified")]
    [Alias("UserCsvPath")]
    [string]$UserFilePath,

    [Parameter(Mandatory=$false, HelpMessage="Use templates from 'Templatefiles_test' instead of 'Templatefiles'")]
    [switch]$UseTestTemplates = $false,

    [Parameter(Mandatory=$false, HelpMessage="Force refreshing group memberships from AD even if memberOf is populated")]
    [switch]$RefreshGroupMembership = $false,

    [Parameter(Mandatory=$false, HelpMessage="Validate configuration and template paths, then exit")]
    [switch]$ValidateOnly = $false,

    [Parameter(Mandatory=$false, HelpMessage="Skip setting ACLs on generated signature folders")]
    [switch]$SkipAcls = $false,

    [Parameter(Mandatory=$false, HelpMessage="Export resolved user data (AD or file) to a CSV with columns derived from variables.json")]
    [string]$ExportCsvPath,

    [Parameter(Mandatory=$false, HelpMessage="Optional runtime domain configuration path. Used by Signaturee v2.")]
    [string]$ConfigFilePath,

    [Parameter(Mandatory=$false, HelpMessage="Optional runtime variable schema path. Used by Signaturee v2.")]
    [string]$VariablesFilePath,

    [Parameter(Mandatory=$false, HelpMessage="Absolute or relative template directory. Shared with the v2 backend.")]
    [string]$TemplateDirectory,

    [Parameter(Mandatory=$false, HelpMessage="Optional local deployment path override. Used by Signaturee v2.")]
    [string]$LocalDeploymentPath,

    [Parameter(Mandatory=$false, HelpMessage="Optional network deployment path override. Used by Signaturee v2.")]
    [string]$NetworkDeploymentPath,

    [Parameter(Mandatory=$false, HelpMessage="Render a temporary preview without RTF/report side effects.")]
    [switch]$PreviewOnly = $false
)

# =========================
# Paths & logging (initialized early so Write-Log is always available)
# =========================
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path -Path $scriptDir -ChildPath "Logs"
if (-not (Test-Path $logDir)) {
    New-Item -Path $logDir -ItemType Directory -Force | Out-Null
}
$logPath = Join-Path -Path $logDir -ChildPath "EmailSignatures_$(Get-Date -Format 'yyyy-MM-dd').log"
$ErrorActionPreference = "Stop"
$logEncoding = [System.Text.Encoding]::GetEncoding([System.Globalization.CultureInfo]::CurrentCulture.TextInfo.ANSICodePage)
$maxLogWriteRetries = 8

function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    $logWritten = $false

    for ($attempt = 1; $attempt -le $maxLogWriteRetries -and -not $logWritten; $attempt++) {
        try {
            $stream = [System.IO.File]::Open($logPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
            try {
                $bytes = $logEncoding.GetBytes("$logEntry`r`n")
                $stream.Write($bytes, 0, $bytes.Length)
            } finally {
                $stream.Dispose()
            }
            $logWritten = $true
        } catch [System.IO.IOException] {
            if ($attempt -lt $maxLogWriteRetries) {
                Start-Sleep -Milliseconds (30 * $attempt)
            }
        } catch {
            break
        }
    }

    if (-not $logWritten) {
        Write-Warning "Could not append to log file '$logPath' after $maxLogWriteRetries attempts."
    }

    Write-Host $logEntry
}

# =========================
# User data source selection
# =========================
$usingUserFile = $false
if ($UseUserFile -or (-not [string]::IsNullOrWhiteSpace($UserFilePath))) {
    $usingUserFile = $true
}

$dataSourceParamSpecified = $PSBoundParameters.ContainsKey("UseUserFile") -or $PSBoundParameters.ContainsKey("UserFilePath")
if (-not $ValidateOnly -and -not $dataSourceParamSpecified) {
    $shouldPrompt = -not $MassGeneration

    if (-not $shouldPrompt) {
        Write-Log "Non-interactive mode (MassGeneration): defaulting to Active Directory data source."
    } else {
        $selection = $null
        do {
            Write-Host ""
            Write-Host "Select user data source:" -ForegroundColor Cyan
            Write-Host "  [1] Active Directory (default)" -ForegroundColor Green
            Write-Host "  [2] User data file (CSV/JSON/YAML)" -ForegroundColor Yellow
            $selection = Read-Host "Enter your choice (1 or 2)"
            if ($selection -notin @("1","2")) {
                Write-Host "Invalid selection. Please choose 1 or 2." -ForegroundColor Red
                $selection = $null
            }
        } while (-not $selection)

        if ($selection -eq "2") {
            $usingUserFile = $true
            Write-Log "Interactive selection: user data file chosen."
        } else {
            Write-Log "Interactive selection: Active Directory data source chosen."
        }
    }
}

# =========================
# Required modules
# =========================
if (-not $usingUserFile) {
    Import-Module ActiveDirectory
} else {
    Write-Host "User file mode enabled. ActiveDirectory module import skipped." -ForegroundColor Yellow
}
Add-Type -AssemblyName System.Web

function New-CaseInsensitiveHashtable {
    return [System.Collections.Hashtable]::new([System.StringComparer]::OrdinalIgnoreCase)
}

function Normalize-NullLikeValue {
    param($Value)
    if ($Value -is [string]) {
        $trimmed = $Value.Trim()
        if ($trimmed -and $trimmed.ToUpperInvariant() -eq "NULL") {
            return $null
        }
    }
    return $Value
}

function Get-FirstValue {
    param(
        [Parameter(Mandatory=$true)]
        $User,
        [Parameter(Mandatory=$true)]
        [string[]]$Keys
    )
    foreach ($k in $Keys) {
        if ($User.PSObject.Properties[$k]) {
            $candidate = Normalize-NullLikeValue $User.$k
            if ($candidate -and -not [string]::IsNullOrWhiteSpace([string]$candidate)) {
                return $candidate
            }
        }
    }
    return $null
}

# =========================
# User data file configuration (CSV / JSON / YAML)
# =========================
if ($usingUserFile -and [string]::IsNullOrWhiteSpace($UserFilePath)) {
    $candidateFiles = @(
        "config\users.csv",
        "config\users.json",
        "config\users.yml",
        "config\users.yaml"
    ) | ForEach-Object { Join-Path -Path $scriptDir -ChildPath $_ }

    $existingCandidate = $candidateFiles | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($existingCandidate) {
        $UserFilePath = $existingCandidate
    } else {
        # default to CSV path for clearer error messaging downstream
        $UserFilePath = $candidateFiles[0]
    }
}

if ($usingUserFile) {
    if (-not (Test-Path -LiteralPath $UserFilePath)) {
        Write-Log "User data mode requested but file not found at $UserFilePath" -Level "ERROR"
        exit 1
    }

    try {
        $resolvedCsvPath = (Resolve-Path -LiteralPath $UserFilePath).Path
        $UserFilePath = $resolvedCsvPath
        Write-Log "User data mode enabled with data from $UserFilePath"
    } catch {
        Write-Log "Unable to resolve user data path $UserFilePath : $_" -Level "ERROR"
        exit 1
    }
}

$userDomainHelperPath = Join-Path -Path $scriptDir -ChildPath (Join-Path "Functions" "UserDomainHelpers.ps1")
if (-not (Test-Path -LiteralPath $userDomainHelperPath)) {
    Write-Log "User domain helper file not found at $userDomainHelperPath" -Level "ERROR"
    exit 1
}
. $userDomainHelperPath

# =========================
# Helper: encode user data
# =========================
function Convert-UserData {
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$UserData
    )

    $htmlData = @{}
    $textData = @{}
    $brRegexOptions = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

    foreach ($key in $UserData.Keys) {
        $value = $UserData[$key]
        if ($null -eq $value) {
            $value = ""
        } else {
            $value = [string]$value
        }

        $encodedValue = [System.Web.HttpUtility]::HtmlEncode($value)
        $encodedValue = [System.Text.RegularExpressions.Regex]::Replace(
            $encodedValue,
            '&lt;br\s*/?&gt;',
            '<br>',
            $brRegexOptions
        )

        $textValue = [System.Text.RegularExpressions.Regex]::Replace(
            $value,
            '<br\s*/?>',
            "`r`n",
            $brRegexOptions
        )

        $htmlData[$key] = $encodedValue
        $textData[$key] = $textValue
    }

    return @{
        Html = $htmlData
        Text = $textData
    }
}

# Extract domain part from an email address; falls back to provided default if missing
function Get-MailDomain {
    param(
        [string]$Email,
        [string]$Default = ""
    )

    if (-not [string]::IsNullOrWhiteSpace($Email) -and $Email -match "@") {
        return ($Email -split "@", 2)[1]
    }

    return $Default
}

# =========================
# Helper: load .env style file
# =========================
function Get-DotEnv {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Path
    )
    $data = @{}
    if (-not (Test-Path $Path)) {
        Write-Log "Secrets file not found at $Path" -Level "WARNING"
        return $data
    }

    foreach ($line in Get-Content -Path $Path) {
        $trim = $line.Trim()
        if (-not $trim) { continue }
        if ($trim.StartsWith("#")) { continue }

        $parts = $trim -split "=", 2
        if ($parts.Count -ne 2) { continue }

        $key = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($key) {
            $data[$key] = $value
        }
    }

    Write-Log "Loaded $($data.Keys.Count) values from secrets file"
    return $data
}

# =========================
# User data import helpers
# =========================
function ConvertTo-CaseInsensitiveHashtable {
    param(
        [Parameter(Mandatory=$true)]
        [psobject]$InputObject
    )

    if ($InputObject -is [hashtable]) {
        $target = New-CaseInsensitiveHashtable
        foreach ($key in $InputObject.Keys) {
            $target[$key] = Normalize-NullLikeValue $InputObject[$key]
        }
        return $target
    }

    $table = New-CaseInsensitiveHashtable
    foreach ($prop in $InputObject.PSObject.Properties) {
        $table[$prop.Name] = Normalize-NullLikeValue $prop.Value
    }
    return $table
}

function Get-FallbackSamAccountName {
    param(
        [Parameter(Mandatory=$false)][string]$ExplicitSam,
        [Parameter(Mandatory=$false)][string]$Mail,
        [Parameter(Mandatory=$false)][string]$UserPrincipalName,
        [Parameter(Mandatory=$false)][string]$GivenName,
        [Parameter(Mandatory=$false)][string]$Sn
    )

    # Priority: explicit SAM -> mail local part -> UPN local part -> givenName.sn
    if (-not [string]::IsNullOrWhiteSpace($ExplicitSam)) { return $ExplicitSam }

    if (-not [string]::IsNullOrWhiteSpace($Mail) -and $Mail -match "@") {
        return ($Mail -split "@", 2)[0]
    }

    if (-not [string]::IsNullOrWhiteSpace($UserPrincipalName) -and $UserPrincipalName -match "@") {
        return ($UserPrincipalName -split "@", 2)[0]
    }

    if (-not [string]::IsNullOrWhiteSpace($GivenName) -or -not [string]::IsNullOrWhiteSpace($Sn)) {
        return ($GivenName + "." + $Sn).Trim(".")
    }

    return ""
}

function ConvertTo-SignatureUserObject {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$RawUser,
        
        [Parameter(Mandatory=$true)]
        [string]$SourceDescription
    )

    Write-Log "DEBUG: ConvertTo-SignatureUserObject called for $SourceDescription"
    
    # Derive a usable sAMAccountName when missing (fallback to mail local part, UPN, or given.sn)
    $explicitSam = $RawUser["sAMAccountName"]
    $samFallback = Get-FallbackSamAccountName `
        -ExplicitSam $explicitSam `
        -Mail $RawUser["mail"] `
        -UserPrincipalName $RawUser["userPrincipalName"] `
        -GivenName $RawUser["givenName"] `
        -Sn $RawUser["sn"]

    if (-not [string]::IsNullOrWhiteSpace($samFallback)) {
        $RawUser["sAMAccountName"] = $samFallback
    }

    $requiredFields = @("sAMAccountName", "mail", "givenName", "sn")
    foreach ($field in $requiredFields) {
        if (-not $RawUser.ContainsKey($field) -or [string]::IsNullOrWhiteSpace($RawUser[$field])) {
            Write-Log "User record in $SourceDescription is missing required field '$field' even after fallbacks. Entry skipped." -Level "WARNING"
            return $null
        }
    }

    # Parse Enabled field
    $enabledValue = $true
    if ($RawUser.ContainsKey("Enabled") -and -not [string]::IsNullOrWhiteSpace($RawUser["Enabled"])) {
        try {
            $enabledValue = [System.Convert]::ToBoolean($RawUser["Enabled"])
        } catch {
            Write-Log "User $($RawUser["sAMAccountName"]) has invalid Enabled value '$($RawUser["Enabled"])'. Defaulting to True." -Level "WARNING"
            $enabledValue = $true
        }
    }

    # Parse SID field
    $sidValue = $null
    if ($RawUser.ContainsKey("SID") -and -not [string]::IsNullOrWhiteSpace($RawUser["SID"])) {
        try {
            $sidValue = New-Object System.Security.Principal.SecurityIdentifier($RawUser["SID"])
        } catch {
            Write-Log "User $($RawUser["sAMAccountName"]) has invalid SID '$($RawUser["SID"])'. Ignoring SID value." -Level "WARNING"
        }
    }

    # Parse memberOf field
    $memberOfValue = @()
    if ($RawUser.ContainsKey("memberOf")) {
        $memberOfRaw = $RawUser["memberOf"]
        if ($memberOfRaw -is [string]) {
            $memberOfValue = $memberOfRaw -split '[;,]' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
        } elseif ($memberOfRaw -is [System.Collections.IEnumerable] -and -not ($memberOfRaw -is [string])) {
            $memberOfValue = @($memberOfRaw | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
        }
    }

    # Parse Domains field
    $domainList = @()
    if ($RawUser.ContainsKey("Domains")) {
        $domainField = $RawUser["Domains"]
        if ($domainField -is [string]) {
            if (-not [string]::IsNullOrWhiteSpace($domainField)) {
                $domainList = $domainField -split '[;,]' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
            }
        } elseif ($domainField -is [System.Collections.IEnumerable]) {
            $domainList = @($domainField | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
        }
    }

    # Create normalized PSObject
    $normalized = New-Object PSObject
    
    # Copy all original properties
    foreach ($key in $RawUser.Keys) {
        $normalized | Add-Member -NotePropertyName $key -NotePropertyValue $RawUser[$key] -Force
    }

    # Normalize phone/fax to canonical property names
    $phoneVal = Get-FirstValue -User $RawUser -Keys @("telephoneNumber","telephonenumber","otherTelephone","businessPhone","phone")
    if ($phoneVal) {
        $normalized | Add-Member -NotePropertyName "telephoneNumber" -NotePropertyValue $phoneVal -Force
        $normalized | Add-Member -NotePropertyName "telephonenumber" -NotePropertyValue $phoneVal -Force
    }
    $faxVal = Get-FirstValue -User $RawUser -Keys @("facsimileTelephoneNumber","fax","otherFacsimileTelephoneNumber")
    if ($faxVal) {
        $normalized | Add-Member -NotePropertyName "facsimileTelephoneNumber" -NotePropertyValue $faxVal -Force
        $normalized | Add-Member -NotePropertyName "fax" -NotePropertyValue $faxVal -Force
    }

    # Add/override computed properties
    $normalized | Add-Member -NotePropertyName "Enabled" -NotePropertyValue $enabledValue -Force
    $normalized | Add-Member -NotePropertyName "SID" -NotePropertyValue $sidValue -Force
    $normalized | Add-Member -NotePropertyName "memberOf" -NotePropertyValue $memberOfValue -Force
    $normalized | Add-Member -NotePropertyName "CsvDomains" -NotePropertyValue $domainList -Force

    Write-Log "DEBUG: Created user object for $($RawUser["sAMAccountName"]) with domains: $($domainList -join ', ')"

    return $normalized
}
function Get-SignatureUserData {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$Path
    )

    Write-Log "DEBUG: Attempting to load user data from: $Path"
    
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Log "User data file does not exist at: $Path" -Level "ERROR"
        return @()
    }

    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    Write-Log "DEBUG: Detected file extension: $extension"

    $rawEntries = @()
    
    try {
        if ($extension -in @('.yml', '.yaml')) {
            Write-Log "DEBUG: Processing YAML file"
            if (-not (Get-Command -Name ConvertFrom-Yaml -ErrorAction SilentlyContinue)) {
                Write-Log "YAML user data requested but ConvertFrom-Yaml is not available. Install: Install-Module -Name powershell-yaml" -Level "ERROR"
                return @()
            }

            $yamlContent = Get-Content -Path $Path -Raw -Encoding UTF8
            $rawEntries = ConvertFrom-Yaml -Yaml $yamlContent
            $rawEntries = if ($rawEntries -is [System.Collections.IEnumerable] -and -not ($rawEntries -is [string])) { 
                $rawEntries 
            } else { 
                @($rawEntries) 
            }
            Write-Log "DEBUG: YAML parsed, entry count: $($rawEntries.Count)"
        }
        elseif ($extension -eq '.csv') {
            Write-Log "DEBUG: Processing CSV file"
            $rawEntries = @(Import-Csv -Path $Path -Encoding UTF8)
            Write-Log "DEBUG: CSV imported, entry count: $($rawEntries.Count)"
            
            if ($rawEntries.Count -gt 0) {
                Write-Log "DEBUG: First CSV entry properties: $($rawEntries[0].PSObject.Properties.Name -join ', ')"
            }
        }
        elseif ($extension -eq '.json') {
            Write-Log "DEBUG: Processing JSON file"
            $rawJson = Get-Content -Path $Path -Raw -Encoding UTF8
            $jsonData = ConvertFrom-Json -InputObject $rawJson
            $rawEntries = if ($jsonData -is [System.Collections.IEnumerable] -and -not ($jsonData -is [string])) { 
                @($jsonData)
            } else { 
                @($jsonData) 
            }
            Write-Log "DEBUG: JSON parsed, entry count: $($rawEntries.Count)"
        }
        else {
            Write-Log "Unsupported user data format '$extension'. Use CSV, JSON or YAML." -Level "ERROR"
            return @()
        }
    } catch {
        Write-Log "Failed to import user data file at $Path : $($_.Exception.Message)" -Level "ERROR"
        Write-Log "Stack trace: $($_.ScriptStackTrace)" -Level "ERROR"
        return @()
    }

    Write-Log "DEBUG: Starting to process $($rawEntries.Count) raw entries"
    
    $processedUsers = @()
    $index = 0
    foreach ($entry in $rawEntries) {
        $index++
        if (-not $entry) { 
            Write-Log "DEBUG: Entry #$index is null, skipping"
            continue 
        }
        
        try {
            $entryTable = ConvertTo-CaseInsensitiveHashtable -InputObject $entry
            Write-Log "DEBUG: Entry #$index converted to hashtable with keys: $($entryTable.Keys -join ', ')"
            
            $processed = ConvertTo-SignatureUserObject -RawUser $entryTable -SourceDescription "$Path (entry #$index)"
            if ($null -ne $processed) {
                $processedUsers += $processed
                Write-Log "DEBUG: Entry #$index processed successfully: $($processed.sAMAccountName)"
            } else {
                Write-Log "DEBUG: Entry #$index returned null from ConvertTo-SignatureUserObject"
            }
        } catch {
            Write-Log "ERROR processing entry #$index : $($_.Exception.Message)" -Level "ERROR"
            Write-Log "Stack trace: $($_.ScriptStackTrace)" -Level "ERROR"
        }
    }

    Write-Log "Loaded $($processedUsers.Count) valid entries from user data file $Path"
    return $processedUsers
}
function Get-SignatureCsvUsers {
    [CmdletBinding(DefaultParameterSetName='CsvPath')]
    param(
        [Parameter(Mandatory=$true, ParameterSetName='CsvPath')]
        [string]$Path
    )

    return Get-SignatureUserData -Path $Path
}

function Import-UserCsvRecords {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$Path
    )

    return Get-SignatureUserData -Path $Path
}

function Import-SignatureUserCsv {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$Path
    )

    return Get-SignatureUserData -Path $Path
}

function Select-CsvUsers {
    param(
        [Parameter(Mandatory=$true)]
        [array]$CsvUsers,
        [Parameter(Mandatory=$true)]
        [string]$UserSelection
    )

    function Test-UserMatch {
        param(
            [Parameter(Mandatory=$true)]$User,
            [Parameter(Mandatory=$true)][string]$Selection
        )

        $needle = $Selection.Trim()
        if (-not $needle) { return $false }

        $sam = $User.sAMAccountName
        $mail = $User.mail
        $upn = $User.userPrincipalName

        return ($sam -and ($sam -ieq $needle)) -or ($mail -and ($mail -ieq $needle)) -or ($upn -and ($upn -ieq $needle))
    }

    $enabledUsers = @($CsvUsers | Where-Object { $_.Enabled })
    if ([string]::IsNullOrWhiteSpace($UserSelection) -or $UserSelection -eq "ALL" -or $UserSelection -eq "A") {
        return $enabledUsers
    }

    $usernames = $UserSelection.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    $selected = @()
    foreach ($name in $usernames) {
        $treffer = $enabledUsers | Where-Object { Test-UserMatch -User $_ -Selection $name }
        if ($treffer) {
            $selected += $treffer
        } else {
            Write-Log "CSV entry for '$name' not found or disabled. Skipping." -Level "WARNING"
        }
    }

    return $selected
}

# =========================
# Variable mapping helpers
# =========================
function Load-VariableMappings {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Path
    )

    $map = New-CaseInsensitiveHashtable
    $script:VariableSchema = $null

    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Log "Variable mapping file not found at $Path" -Level "WARNING"
        return $map
    }

    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()

    if ($extension -eq ".json") {
        try {
            $raw = Get-Content -Path $Path -Raw -Encoding UTF8
            $schema = ConvertFrom-Json -InputObject $raw
            $script:VariableSchema = $schema

            foreach ($variable in @($schema.variables)) {
                $placeholders = @($variable.placeholders)
                if (-not $placeholders -or $placeholders.Count -eq 0) {
                    if ($variable.id) { $placeholders = @("$" + $variable.id) }
                }
                $attributes = @($variable.adProperties)
                if (-not $attributes -or $attributes.Count -eq 0) {
                    if ($variable.id) { $attributes = @($variable.id) }
                }

                foreach ($ph in $placeholders) {
                    if (-not $ph) { continue }
                    $map[$ph] = @($attributes | Where-Object { $_ })
                }
            }
        } catch {
            Write-Log "Failed to parse variables.json at $Path : $_" -Level "ERROR"
        }

        return $map
    }

    # Legacy TXT fallback (kept for backward compatibility)
    $lineNumber = 0
    foreach ($line in Get-Content -Path $Path -Encoding UTF8) {
        $lineNumber++
        $trim = $line.Trim()
        if (-not $trim) { continue }
        if ($trim.StartsWith("#") -or $trim.StartsWith(";")) { continue }

        $parts = $trim -split "=", 2
        if ($parts.Count -ne 2) {
            Write-Log "Invalid mapping line $lineNumber in ${Path}: $line" -Level "WARNING"
            continue
        }

        $placeholder = $parts[0].Trim()
        $attributes = $parts[1].Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }

        if (-not $placeholder) {
            Write-Log "Missing placeholder name on line $lineNumber in $Path" -Level "WARNING"
            continue
        }

        $map[$placeholder] = @($attributes)
    }

    return $map
}

function Build-UserDataFromMapping {
    param(
        [Parameter(Mandatory=$true)]
        $User,

        [Parameter(Mandatory=$true)]
        [string]$Domain,

        [Parameter(Mandatory=$true)]
        [hashtable]$PlaceholderMap,

        [Parameter(Mandatory=$true)]
        [string[]]$SecondaryTitleAttributes,

        [Parameter(Mandatory=$true)]
        [hashtable]$CustomTitleAttrMap
    )

    $data = @{}

    foreach ($placeholder in $PlaceholderMap.Keys) {
        $attributes = @($PlaceholderMap[$placeholder])
        $value = ""

        switch ($placeholder) {
            '$domain' {
                $value = Get-MailDomain -Email $User.mail -Default $Domain
            }
            '$description' {
                $baseTitle = Get-FirstValue -User $User -Keys $attributes
                $customAttr = $CustomTitleAttrMap[$Domain]

                if ($customAttr -and $User.PSObject.Properties[$customAttr] -and -not [string]::IsNullOrWhiteSpace($User.$customAttr)) {
                    $baseTitle = $User.$customAttr
                    Write-Log "Using custom title from $customAttr for $($User.sAMAccountName) in domain $Domain $baseTitle"
                }

                $additionalTitles = @()
                foreach ($attrName in $SecondaryTitleAttributes) {
                    if ($User.PSObject.Properties[$attrName] -and -not [string]::IsNullOrWhiteSpace($User.$attrName)) {
                        $additionalTitles += $User.$attrName
                    }
                }

                if ($additionalTitles.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($baseTitle)) {
                    $value = "$baseTitle<br>$($additionalTitles -join '<br>')"
                } elseif ($additionalTitles.Count -gt 0) {
                    $value = $additionalTitles -join '<br>'
                } else {
                    $value = $baseTitle
                }
            }
            default {
                if ($attributes.Count -gt 0) {
                    $value = Get-FirstValue -User $User -Keys $attributes
                }
            }
        }

        if ($null -eq $value) { $value = "" }
        $data[$placeholder] = $value
    }

    return $data
}

function Export-SignatureUsersToCsv {
    param(
        [Parameter(Mandatory=$true)]
        [array]$Users,

        [Parameter(Mandatory=$true)]
        [string]$Path,

        [Parameter(Mandatory=$true)]
        [hashtable]$VariableMappings,

        [Parameter(Mandatory=$false)]
        [hashtable]$VariableSchema
    )

    $columns = @("sAMAccountName","mail","givenName","sn")
    if ($VariableSchema -and $VariableSchema.variables) {
        foreach ($var in $VariableSchema.variables) {
            $col = $null
            if ($var.PSObject.Properties['csvHeader']) {
                $col = $var.csvHeader
            }
            if (-not $col -and $var.PSObject.Properties['id']) {
                $col = $var.id
            }
            if ($col) { $columns += $col }
        }
    } else {
        foreach ($attrs in $VariableMappings.Values) {
            $columns += $attrs
        }
    }
    $columns = $columns | Where-Object { $_ }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $orderedColumns = @()
    foreach ($c in $columns) {
        if ($seen.Add($c)) { $orderedColumns += $c }
    }
    $columns = $orderedColumns

    $rows = @()
    foreach ($u in $Users) {
        $row = [ordered]@{}
        foreach ($col in $columns) {
            $value = ""
            foreach ($prop in $u.PSObject.Properties) {
                if ($prop.Name -ieq $col) {
                    $value = $prop.Value
                    break
                }
            }
            $row[$col] = $value
        }
        $rows += [pscustomobject]$row
    }

    $exportDir = Split-Path -Parent $Path
    if ($exportDir -and -not (Test-Path -LiteralPath $exportDir)) {
        New-Item -Path $exportDir -ItemType Directory -Force | Out-Null
    }

    $rows | Export-Csv -Path $Path -NoTypeInformation -Encoding UTF8
    Write-Log "Exported $($rows.Count) users to $Path with columns: $($columns -join ', ')"
}

# =========================
# Load secrets
# =========================
$secretsPath = Join-Path -Path $scriptDir -ChildPath "config\secrets.env"
$secrets = Get-DotEnv -Path $secretsPath

if (-not $usingUserFile) {
    if (-not $Server -and $secrets.ContainsKey("AD_SERVER")) {
        $Server = $secrets["AD_SERVER"]
        Write-Log "Using AD server from secrets.env: $Server"
    }

    if (-not $Server) {
        Write-Log "No AD server specified via parameter or secrets.env (AD_SERVER). Aborting." -Level "ERROR"
        Write-Host "No AD server configured. Please set AD_SERVER in config\secrets.env or pass -Server." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Log "User file mode active: skipping AD server lookup."
}

# =========================
# Load JSON configuration
# =========================
$configPath = if (-not [string]::IsNullOrWhiteSpace($ConfigFilePath)) {
    $ConfigFilePath
} else {
    Join-Path -Path $scriptDir -ChildPath "config\config.json"
}
if (-not (Test-Path $configPath)) {
    Write-Log "Configuration file not found at $configPath" -Level "ERROR"
    Write-Host "Configuration file not found: $configPath" -ForegroundColor Red
    Write-Host "Create it based on config\example\config.example.json" -ForegroundColor Yellow
    exit 1
}

try {
    $configContent = Get-Content -Path $configPath -Raw -Encoding UTF8
    $convertParams = @{
        InputObject = $configContent
    }
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey("Depth")) {
        $convertParams["Depth"] = 10
    }
    $config = ConvertFrom-Json @convertParams
    Write-Log "Loaded configuration from $configPath"
} catch {
    Write-Log "Error reading configuration file: $_" -Level "ERROR"
    Write-Host "Error parsing config.json, please check JSON syntax." -ForegroundColor Red
    exit 1
}

# =========================
# OU / group mapping config
# =========================
$ouSearchBase = $null
if ($config.ouSearchBase) {
    $ouSearchBase = $config.ouSearchBase
} elseif ($secrets.ContainsKey("OU_SEARCH_BASE")) {
    $ouSearchBase = $secrets["OU_SEARCH_BASE"]
}
if ($MassGeneration -and -not $usingUserFile -and -not $ouSearchBase) {
    Write-Log "MassGeneration requested but no ouSearchBase configured." -Level "ERROR"
    Write-Host "MassGeneration needs 'ouSearchBase' in config.json or OU_SEARCH_BASE in secrets.env." -ForegroundColor Red
    exit 1
}

$securityGroupMapping = New-CaseInsensitiveHashtable
if ($config.securityGroupMapping) {
    if ($config.securityGroupMapping -is [hashtable]) {
        foreach ($k in $config.securityGroupMapping.Keys) {
            $mappedDomain = [string]$config.securityGroupMapping[$k]
            if ($mappedDomain.Trim()) {
                $securityGroupMapping[$k] = $mappedDomain.Trim()
            }
        }
    } else {
        foreach ($prop in $config.securityGroupMapping.PSObject.Properties) {
            $mappedDomain = [string]$prop.Value
            if ($mappedDomain.Trim()) {
                $securityGroupMapping[$prop.Name] = $mappedDomain.Trim()
            }
        }
    }
}
if ($securityGroupMapping.Count -eq 0) {
    $msg = "No securityGroupMapping entries found in config.json."
    if ($MassGeneration -and -not $usingUserFile) {
        Write-Log "$msg MassGeneration requires Signatur-* group mappings to resolve domains." -Level "ERROR"
        Write-Host "MassGeneration needs securityGroupMapping (Signatur-* -> domain) in config.json." -ForegroundColor Red
        exit 1
    } else {
        Write-Log $msg -Level "WARNING"
    }
} else {
    Write-Log "Loaded security group mapping: $($securityGroupMapping.Keys -join ', ')"
}
# Expose mappings for helper functions
$script:securityGroupMapping = $securityGroupMapping

$secondaryTitleAttributes = @()
if ($config.secondaryTitleAttributes) {
    $secondaryTitleAttributes = @($config.secondaryTitleAttributes)
} else {
    $secondaryTitleAttributes = @("extensionAttribute6","extensionAttribute7","extensionAttribute8")
}

# =========================
# Variable mapping configuration
# =========================
$variablesFilePath = if (-not [string]::IsNullOrWhiteSpace($VariablesFilePath)) {
    $VariablesFilePath
} else {
    Join-Path -Path $scriptDir -ChildPath "config\variables.json"
}
$defaultVariableMappings = @{
    '$givenname'      = @('givenName')
    '$sn'             = @('sn')
    '$domain'         = @('mail') # used to derive domain from mail if no explicit domain is set
    '$department'     = @('department')
    '$description'    = @('description')
    '$telephonenumber'= @('telephoneNumber','telephonenumber','otherTelephone','businessPhone','phone')
    '$sAMAccountName' = @('sAMAccountName')
    '$mail'           = @('mail')
    '$mobile'         = @('mobile')
    '$fax'            = @('facsimileTelephoneNumber','fax','otherFacsimileTelephoneNumber')
}

$variableMappings = Load-VariableMappings -Path $variablesFilePath
if (-not $variableMappings -or $variableMappings.Count -eq 0) {
    $variableMappings = New-CaseInsensitiveHashtable
    foreach ($k in $defaultVariableMappings.Keys) {
        $variableMappings[$k] = $defaultVariableMappings[$k]
    }
    $script:VariableSchema = @{ variables = @() }
    Write-Log "Using default variable mappings (file missing or empty)."
} else {
    Write-Log "Loaded variable mappings from ${variablesFilePath}: $($variableMappings.Keys -join ', ')"
}

# =========================
# Template folder selection
# =========================
$templateFolder = "Templatefiles"
if ($UseTestTemplates) { $templateFolder = "Templatefiles_test" }
if ($TemplateDirectory) {
    $templateRootPath = [System.IO.Path]::GetFullPath($(if ([System.IO.Path]::IsPathRooted($TemplateDirectory)) { $TemplateDirectory } else { Join-Path $scriptDir $TemplateDirectory }))
} else {
    $templateRootPath = Join-Path $scriptDir $templateFolder
}
Write-Log "Using templates from '$templateRootPath'"

# =========================
# Build domain structures from config
# =========================
$allDomains = New-CaseInsensitiveHashtable
$domainFaxFallbacks = New-CaseInsensitiveHashtable
$domainResourceFolders = New-CaseInsensitiveHashtable
$customTitleAttrMap = New-CaseInsensitiveHashtable

if (-not $config.domains) {
    Write-Log "No domains defined in config.json (section 'domains')." -Level "ERROR"
    Write-Host "No domains defined in config.json. See config.example.json." -ForegroundColor Red
    exit 1
}

if ($config.domains -isnot [hashtable]) {
    $domainHashtable = New-CaseInsensitiveHashtable
    foreach ($prop in $config.domains.PSObject.Properties) {
        $domainHashtable[$prop.Name] = $prop.Value
    }
    $config.domains = $domainHashtable
}

foreach ($domainKey in $config.domains.Keys) {
    $domCfg = $config.domains[$domainKey]

    if (-not $domCfg.templateHtml) {
        Write-Log "Domain '$domainKey' has no 'templateHtml' configured." -Level "ERROR"
        continue
    }

    $htmlRel = $domCfg.templateHtml
    $resRel  = $domCfg.resourceFolder

    $allDomains[$domainKey] = Join-Path -Path $templateRootPath -ChildPath $htmlRel

    if ($domCfg.faxFallback) {
        $domainFaxFallbacks[$domainKey] = $domCfg.faxFallback
    } else {
        $domainFaxFallbacks[$domainKey] = ""
    }

    if ($resRel) {
        $domainResourceFolders[$domainKey] = Join-Path -Path $templateRootPath -ChildPath $resRel
    }

    if ($domCfg.customTitleAttr) {
        $customTitleAttrMap[$domainKey] = $domCfg.customTitleAttr
    }
}

Write-Log "Configured domains: $($allDomains.Keys -join ', ')"
# Expose domains for helper functions (e.g., Signatur-ALLE)
$script:allDomains = $allDomains

# Validate security group mapping targets against configured domains
$invalidMappings = @()
foreach ($sgKey in $securityGroupMapping.Keys) {
    $mappedDomain = $securityGroupMapping[$sgKey]
    if (-not $allDomains.ContainsKey($mappedDomain)) {
        $invalidMappings += "$sgKey -> $mappedDomain"
    }
}
if ($invalidMappings.Count -gt 0) {
    Write-Log "Security group mappings point to unknown domains: $($invalidMappings -join '; ')" -Level "WARNING"
}

# =========================
# Configuration validation helper
# =========================
function Test-SignatureConfiguration {
    param(
        [Parameter(Mandatory=$true)]
        [hashtable]$DomainsConfig,

        [Parameter(Mandatory=$true)]
        [string]$TemplateRoot,

        [Parameter(Mandatory=$true)]
        [hashtable]$AllDomains,

        [Parameter(Mandatory=$false)]
        [switch]$AllowPartialTemplates
    )

    $validationPassed = $true

    foreach ($domainKey in $DomainsConfig.Keys) {
        $domCfg = $DomainsConfig[$domainKey]
        $domainDisplay = "$domainKey domain"

        $htmlPath = $AllDomains[$domainKey]
        if (-not (Test-Path -LiteralPath $htmlPath)) {
            $logLevel = "ERROR"
            if ($AllowPartialTemplates) {
                $logLevel = "WARNING"
            } else {
                $validationPassed = $false
            }
            Write-Log "Validation: Missing HTML template for $domainDisplay at $htmlPath" -Level $logLevel
            continue
        } else {
            Write-Log "Validation: HTML template found for $domainDisplay -> $htmlPath"
        }

        if (-not $domCfg.templateTxt) {
            $logLevel = "ERROR"
            if ($AllowPartialTemplates) {
                $logLevel = "WARNING"
            } else {
                $validationPassed = $false
            }
            Write-Log "Validation: No TXT template configured for $domainDisplay" -Level $logLevel
        } else {
            $txtPath = Join-Path -Path $TemplateRoot -ChildPath $domCfg.templateTxt
            if (-not (Test-Path -LiteralPath $txtPath)) {
                $logLevel = "ERROR"
                if ($AllowPartialTemplates) {
                    $logLevel = "WARNING"
                } else {
                    $validationPassed = $false
                }
                Write-Log "Validation: Missing TXT template for $domainDisplay at $txtPath" -Level $logLevel
            } else {
                Write-Log "Validation: TXT template found for $domainDisplay -> $txtPath"
            }
        }

        if ($domCfg.resourceFolder) {
            $resourcePath = Join-Path -Path $TemplateRoot -ChildPath $domCfg.resourceFolder
            if (-not (Test-Path -LiteralPath $resourcePath)) {
                Write-Log "Validation: Resource folder not found for $domainDisplay at $resourcePath" -Level "WARNING"
            } else {
                Write-Log "Validation: Resource folder available for $domainDisplay -> $resourcePath"
            }
        } else {
            Write-Log "Validation: No resource folder configured for $domainDisplay" -Level "WARNING"
        }
    }

    if ($validationPassed) {
        Write-Log "Configuration validation successful for all configured domains"
    } else {
        Write-Log "Configuration validation detected blocking issues" -Level "ERROR"
    }

    return $validationPassed
}

# $templateRootPath was resolved above and is shared with the v2 backend.

if ($ValidateOnly) {
    $allowPartialTemplates = [bool]$UseTestTemplates
    $validationOk = Test-SignatureConfiguration -DomainsConfig $config.domains -TemplateRoot $templateRootPath -AllDomains $allDomains -AllowPartialTemplates:$allowPartialTemplates
    if ($validationOk) {
        Write-Log "Validation completed successfully. Exiting due to -ValidateOnly switch."
        exit 0
    } else {
        Write-Log "Validation failed. Fix the issues above and rerun -ValidateOnly." -Level "ERROR"
        exit 1
    }
}

# =========================
# User data preload
# =========================
$fileUsers = @()
if ($usingUserFile) {
    $fileUsers = Get-SignatureCsvUsers -Path $UserFilePath
    if (-not $fileUsers) { $fileUsers = @() }
    if ($fileUsers.Count -eq 0) {
        Write-Log "User data mode enabled but no usable entries were found in $UserFilePath" -Level "WARNING"
    }
}

# =========================
# Word availability (RTF)
# =========================
function Test-WordAvailability {
    try {
        $word = New-Object -ComObject Word.Application
        $word.Quit()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
        [System.GC]::Collect()
        [System.GC]::WaitForPendingFinalizers()
        return $true
    } catch {
        Write-Log "Microsoft Word is not available on this system. RTF files will be created as empty placeholders." -Level "WARNING"
        return $false
    }
}
$global:wordAvailable = Test-WordAvailability
if ($global:wordAvailable) {
    Write-Host "Microsoft Word is available for RTF generation." -ForegroundColor Green
} else {
    Write-Host "Microsoft Word is NOT available. RTF files will be created as empty placeholders." -ForegroundColor Red
}

# =========================
# HTML helpers
# =========================
function Convert-HtmlToPlainText {
    param([string]$HtmlContent)
    
    $plainText = $HtmlContent -replace '&nbsp;', ' '
    $plainText = $plainText -replace '&lt;', '<'
    $plainText = $plainText -replace '&gt;', '>'
    $plainText = $plainText -replace '&amp;', '&'
    $plainText = $plainText -replace '&quot;', '"'
    $plainText = $plainText -replace '&apos;', "'"
    $plainText = $plainText -replace '&szlig;', 'ÃŸ'
    
    $plainText = $plainText -replace '&#160;', ' '
    $plainText = $plainText -replace '&#223;', 'ÃŸ'
    $plainText = $plainText -replace '&#60;', '<'
    $plainText = $plainText -replace '&#62;', '>'
    $plainText = $plainText -replace '&#38;', '&'
    
    $plainText = $plainText -replace '<[^>]+>', ' '
    $plainText = $plainText -replace '\s+', ' '
    $plainText = $plainText.Trim()
    return $plainText
}

function ConvertTo-RtfVersion {
    param(
        [string]$HtmlPath,
        [string]$RtfPath
    )

    if (-not $global:wordAvailable) {
        "{\rtf1}" | Out-File -FilePath $RtfPath -Encoding ASCII
        Write-Log "Created empty RTF placeholder (Word not available)" -Level "WARNING"
        return $false
    }

    try {
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        
        $doc = $word.Documents.Open($HtmlPath)
        $doc.SaveAs([ref]$RtfPath, [ref]6)
        $doc.Close()
        $word.Quit()
        
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($doc) | Out-Null
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
        [System.GC]::Collect()
        [System.GC]::WaitForPendingFinalizers()
        
        Write-Log "Created RTF version of signature"
        return $true
    } catch {
        Write-Log "Error creating RTF version: $_" -Level "WARNING"
        "{\rtf1}" | Out-File -FilePath $RtfPath -Encoding ASCII
        return $false
    }
}

# =========================
# File/folder helpers
# =========================
function Copy-ResourceFolder {
    param(
        [string]$SourceFolder,
        [string]$Username,
        [string]$Domain,
        [string]$Email,
        [string]$DestinationPath
    )

    try {
        if (-not (Test-Path $SourceFolder)) {
            Write-Log "Resource folder not found: $SourceFolder" -Level "WARNING"
            return $false
        }

        $userEmail = $Email
        $targetFolderName = "$Domain ($userEmail)-Dateien"
        $targetFolderPath = Join-Path -Path $DestinationPath -ChildPath $targetFolderName
        
        if (Test-Path $targetFolderPath) {
            Remove-Item -Path $targetFolderPath -Recurse -Force
            Write-Log "Removed existing resource folder: $targetFolderPath"
        }
        
        Copy-Item -Path $SourceFolder -Destination $targetFolderPath -Recurse -Force
        Write-Log "Copied resource folder from $SourceFolder to $targetFolderPath"
        return $true
    } catch {
        Write-Log "Error copying resource folder for $Username ($Domain): $_" -Level "ERROR"
        return $false
    }
}

function Grant-UserAccessToFolder {
    param (
        [string]$Username,
        [string]$FolderPath,
        [System.Security.Principal.SecurityIdentifier]$UserSid,
        [string]$UserPrincipal
    )

    if ($SkipAcls) {
        Write-Log "SkipAcls is set. Skipping ACL grant for $Username on $FolderPath"
        return $true
    }

    try {
        $identityReference = $null
        if ($UserSid) {
            $identityReference = $UserSid
        } elseif (-not [string]::IsNullOrWhiteSpace($UserPrincipal)) {
            $identityReference = New-Object System.Security.Principal.NTAccount($UserPrincipal)
        } else {
            $identityReference = New-Object System.Security.Principal.NTAccount($Username)
        }

        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $identityReference,
            "FullControl",
            "ContainerInherit,ObjectInherit",
            "None",
            "Allow"
        )

        $acl = Get-Acl -Path $FolderPath
        $acl.SetAccessRule($rule)
        Set-Acl -Path $FolderPath -AclObject $acl

        $identityDescription = if ($identityReference -is [System.Security.Principal.SecurityIdentifier]) {
            $identityReference.Value
        } else {
            $identityReference.Value
        }

        Write-Log "Granted Full Control to $identityDescription on $FolderPath"
        return $true
    } catch {
        Write-Log "Failed to grant access to $Username on $FolderPath $_" -Level "WARNING"
        return $false
    }
}

# =========================
# Main signature generation
# =========================
function New-OutlookSignatures {
    param(
        [string]$Username,
        [string]$Domain,
        [hashtable]$UserData,
        [string]$TemplateHtmlPath,
        [string]$OutputRootPath,
        [switch]$UseOutlookFolder
    )
    
    try {
        if (-not (Test-SafeUsernameSegment -Username $Username)) {
            throw "Invalid account name for output directory."
        }
        $userSignaturePath = if ($UseOutlookFolder) { $OutputRootPath } else { Join-Path -Path $OutputRootPath -ChildPath $Username }
        if (-not (Test-Path $userSignaturePath)) {
            New-Item -Path $userSignaturePath -ItemType Directory -Force | Out-Null
        }
        
        $signatureName = "$Domain ($($UserData['$mail']))"
        
        $htmlTemplate = [System.IO.File]::ReadAllText($TemplateHtmlPath, [System.Text.Encoding]::GetEncoding(1252))
        Write-Log "Template loaded for $Username - $Domain. Length: $(($htmlTemplate).Length) characters"
        
        # Adjust fax/mobile rows: auto-insert mobile after fax, drop fax row if empty
        $mobileVal = $UserData['$mobile']
        $faxVal = $UserData['$fax']
        if (-not [string]::IsNullOrWhiteSpace($mobileVal) -or [string]::IsNullOrWhiteSpace($faxVal)) {
            try {
                $lines = [System.Collections.ArrayList]($htmlTemplate -split "`r`n")
                $faxIndex = -1
                for ($i = 0; $i -lt $lines.Count; $i++) {
                    if ($lines[$i] -match "Fax:") { $faxIndex = $i; break }
                }
                if ($faxIndex -ge 0) {
                    # Find enclosing <tr> for fax to anchor changes
                    $rowStart = $faxIndex
                    while ($rowStart -gt 0 -and -not ($lines[$rowStart] -match "<tr")) { $rowStart-- }
                    $rowEnd = $faxIndex
                    while ($rowEnd -lt $lines.Count -and -not ($lines[$rowEnd] -match "</tr>")) { $rowEnd++ }

                    if (-not [string]::IsNullOrWhiteSpace($mobileVal)) {
                        $mobileRow = @'
<tr><td width=49 valign=top style="width:36.9pt;padding:0cm 5.4pt 0cm 5.4pt"><p class=MsoNormal style="mso-margin-top-alt:auto;line-height:15.0pt"><span style="font-size:10.0pt;font-family:Calibri;mso-fareast-font-family:Calibri;mso-hansi-font-family:Calibri;mso-bidi-font-family:Calibri;color:#767171;mso-font-kerning:0pt;mso-ligatures:none;mso-fareast-language:EN-US"><i>Mobil:</i><o:p></o:p></span></p></td><td valign=top style="padding:0cm 5.4pt 0cm 5.4pt"><p class=MsoNormal style="mso-margin-top-alt:auto;line-height:15.0pt"><span style="font-size:10.0pt;font-family:Calibri;mso-fareast-font-family:Calibri;mso-hansi-font-family:Calibri;mso-bidi-font-family:Calibri;color:#767171;mso-font-kerning:0pt;mso-ligatures:none;mso-fareast-language:EN-US"><i>$mobile</i></span><span style="font-size:10.0pt;font-family:Calibri;color:#767171;mso-fareast-language:EN-US"><o:p></o:p></span></p></td></tr>
'@
                        $insertIndex = [Math]::Min($rowEnd + 1, $lines.Count)
                        $lines.Insert($insertIndex, $mobileRow)
                        Write-Log "Added mobile number row for $Username after fax field"
                    }

                    if ([string]::IsNullOrWhiteSpace($faxVal)) {
                        for ($i = $rowEnd; $i -ge $rowStart; $i--) {
                            $lines.RemoveAt($i)
                        }
                        Write-Log "Removed fax row for $Username because fax is empty"
                    }

                    $htmlTemplate = $lines -join "`r`n"
                } else {
                    Write-Log "Could not find Fax: field to adjust mobile/fax rows - please check template structure" -Level "WARNING"
                }
            } catch {
                Write-Log "Error while adjusting mobile/fax rows for ${Username}: $_" -Level "WARNING"
            }
        }

        $placeholders = [regex]::Matches($htmlTemplate, '\$\w+') | ForEach-Object { $_.Value } | Select-Object -Unique
        Write-Log "Detected placeholders in template: $($placeholders -join ', ')"
        Write-Log "User data for replacement: $($UserData.Keys -join ', ')"

        $convertedUserData = Convert-UserData -UserData $UserData
        $htmlEncodedData = $convertedUserData.Html
        $plainTextData = $convertedUserData.Text

        foreach ($key in $htmlEncodedData.Keys) {
            $oldValue = $htmlTemplate
            $replacement = if ($null -ne $htmlEncodedData[$key]) { $htmlEncodedData[$key] } else { "" }
            $htmlTemplate = $htmlTemplate -replace [regex]::Escape($key), $replacement
            if ($oldValue -ne $htmlTemplate) {
                Write-Log "Replaced $key with $replacement"
            }
        }
        
        $userSignaturePath = Join-Path -Path $OutputRootPath -ChildPath $Username
        if (-not (Test-Path $userSignaturePath)) {
            New-Item -Path $userSignaturePath -ItemType Directory -Force | Out-Null
        }

        $htmlPath = Join-Path -Path $userSignaturePath -ChildPath "$signatureName.htm"
        [System.IO.File]::WriteAllText($htmlPath, $htmlTemplate, [System.Text.Encoding]::GetEncoding(1252))
        
        # TXT template from config for this domain
        $domainCfg = $config.domains[$Domain]
        if (-not $domainCfg -or -not $domainCfg.templateTxt) {
            Write-Log "TXT template not configured for domain $Domain" -Level "ERROR"
            throw "Missing TXT template configuration for domain $Domain"
        }
        $txtTemplatePath = Join-Path -Path $templateRootPath -ChildPath $domainCfg.templateTxt
        if (-not (Test-Path -LiteralPath $txtTemplatePath)) {
            Write-Log "TXT template not found for $Username - $Domain at $txtTemplatePath" -Level "ERROR"
            throw "Missing TXT template: $txtTemplatePath"
        }

        $txtTemplateRaw = [System.IO.File]::ReadAllText($txtTemplatePath, [System.Text.Encoding]::GetEncoding(1252))
        $txtLines = New-Object System.Collections.ArrayList
        $txtLines.AddRange(($txtTemplateRaw -split "`r`n")) | Out-Null

        $preserveKeys = @('$telephonenumber')
        foreach ($key in $plainTextData.Keys) {
            $val = $plainTextData[$key]
            if ([string]::IsNullOrWhiteSpace($val) -and -not ($preserveKeys -contains $key)) {
                for ($i = $txtLines.Count - 1; $i -ge 0; $i--) {
                    if ($txtLines[$i] -match [regex]::Escape($key)) {
                        $txtLines.RemoveAt($i)
                    }
                }
            }
        }
        $txtTemplate = ($txtLines -join "`r`n")

        foreach ($key in $plainTextData.Keys) {
            $oldTxt = $txtTemplate
            $replacement = if (-not [string]::IsNullOrWhiteSpace($plainTextData[$key])) { $plainTextData[$key] } else { "" }
            $txtTemplate = $txtTemplate -replace [regex]::Escape($key), $replacement
            if ($oldTxt -ne $txtTemplate) {
                Write-Log "Replaced (TXT) $key with '$replacement'"
            }
        }

        $txtPath = Join-Path -Path $userSignaturePath -ChildPath "$signatureName.txt"
        [System.IO.File]::WriteAllText($txtPath, $txtTemplate, [System.Text.Encoding]::GetEncoding(1252))
        
        if (-not $PreviewOnly) {
            $rtfPath = Join-Path -Path $userSignaturePath -ChildPath "$signatureName.rtf"
            ConvertTo-RtfVersion -HtmlPath $htmlPath -RtfPath $rtfPath
        } else {
            Write-Log "PreviewOnly enabled. Skipping RTF generation for $Username - $Domain"
        }
        
        $email = $UserData['$mail']
        $resourceFolder = $domainResourceFolders[$Domain]
        $resourceFolderSuccess = $false
        if ($resourceFolder) {
            $resourceFolderSuccess = Copy-ResourceFolder -SourceFolder $resourceFolder -Username $Username -Domain $Domain -Email $email -DestinationPath $userSignaturePath
        } else {
            Write-Log "No resource folder configured for domain $Domain" -Level "WARNING"
        }
        
        if ($resourceFolderSuccess) {
            Write-Log "Created resource folder for $Username ($Domain)"
        } elseif ($resourceFolder) {
            Write-Log "Required resource folder could not be copied for $Username ($Domain)" -Level "ERROR"
            return $false
        }
        
        Write-Log "Created Outlook signatures for user $Username for domain $Domain"
        return $true
    } catch {
        Write-Log "Error creating Outlook signatures for user $Username for domain $Domain $_" -Level "ERROR"
        return $false
    }
}

# =========================
# Optional: deploy to Outlook (kept as in original)
# =========================
function Set-UserSignatures {
    param(
        [string]$Username,
        [string]$CentralPath
    )
    
    try {
        $userAppData = "\\$env:USERDOMAIN\$Username\AppData\Roaming"
        $outlookSignaturesPath = Join-Path -Path $userAppData -ChildPath "Microsoft\Signatures"
        
        if (Test-Path -Path $userAppData) {
            if (-not (Test-Path $outlookSignaturesPath)) {
                New-Item -Path $outlookSignaturesPath -ItemType Directory -Force | Out-Null
            }
            
            $sourcePath = $CentralPath
            if (Test-Path $sourcePath) {
                Copy-Item -Path "$sourcePath\*" -Destination $outlookSignaturesPath -Force
                Write-Log "Deployed signatures to $Username's Outlook folder"
                return $true
            } else {
                Write-Log "Source path not found: $sourcePath" -Level "WARNING"
                return $false
            }
        } else {
            Write-Log "User profile not accessible: $userAppData" -Level "WARNING"
            return $false
        }
    } catch {
        Write-Log "Error deploying signatures to user $Username $_" -Level "ERROR"
        return $false
    }
}

# =========================
# Determine central signature path
# =========================
switch ($DeploymentMode) {
    "Local" {
        $localPath = $LocalDeploymentPath
        if (-not $localPath) { $localPath = $secrets["LOCAL_DEPLOYMENT_PATH"] }
        if (-not $localPath) { $localPath = "generatedsignatures" }
        if ($localPath -like "\\*") {
            $centralSignaturePath = $localPath
        } elseif ([System.IO.Path]::IsPathRooted($localPath)) {
            $centralSignaturePath = $localPath
        } else {
            $centralSignaturePath = Join-Path -Path $scriptDir -ChildPath $localPath
        }
        Write-Log "Deployment mode: Local ($centralSignaturePath)"
    }
    "Network" {
        $centralSignaturePath = $NetworkDeploymentPath
        if (-not $centralSignaturePath) { $centralSignaturePath = $secrets["NETWORK_DEPLOYMENT_PATH"] }
        if (-not $centralSignaturePath) {
            Write-Log "NETWORK_DEPLOYMENT_PATH not set in secrets.env." -Level "ERROR"
            Write-Host "NETWORK_DEPLOYMENT_PATH not configured in config\secrets.env" -ForegroundColor Red
            exit 1
        }
        Write-Log "Deployment mode: Network ($centralSignaturePath)"
    }
    Default {
        if ($MassGeneration) {
            $centralSignaturePath = $secrets["NETWORK_DEPLOYMENT_PATH"]
            if (-not $centralSignaturePath) {
                Write-Log "NETWORK_DEPLOYMENT_PATH not set in secrets.env for MassGeneration." -Level "ERROR"
                Write-Host "NETWORK_DEPLOYMENT_PATH not configured in config\secrets.env" -ForegroundColor Red
                exit 1
            }
            Write-Log "Deployment mode for Mass Generation: Network ($centralSignaturePath)"
        } else {
            do {
                Write-Host ""
                Write-Host "Please choose the location to generate signatures:" -ForegroundColor Cyan
                Write-Host "  [1] Local testing (generatedsignatures in script directory)" -ForegroundColor Green
                Write-Host "  [2] Final deployment (user-based network path)" -ForegroundColor Yellow
                Write-Host "  [3] Mass-Generation for all active users" -ForegroundColor Magenta
                $choice = Read-Host "Enter your choice (1, 2, or 3)"

                if ($choice -in @("1", "2", "3")) {
                    $validChoice = $true
                } else {
                    Write-Host "Invalid input. Please enter 1, 2, or 3." -ForegroundColor Red
                    $validChoice = $false
                }
            } while (-not $validChoice)

            if ($choice -eq "1") {
                $localPath = $secrets["LOCAL_DEPLOYMENT_PATH"]
                if (-not $localPath) { $localPath = "generatedsignatures" }
                if ($localPath -like "\\*") {
                    $centralSignaturePath = $localPath
                } elseif ([System.IO.Path]::IsPathRooted($localPath)) {
                    $centralSignaturePath = $localPath
                } else {
                    $centralSignaturePath = Join-Path -Path $scriptDir -ChildPath $localPath
                }
            } else {
                $centralSignaturePath = $secrets["NETWORK_DEPLOYMENT_PATH"]
                if (-not $centralSignaturePath) {
                    Write-Log "NETWORK_DEPLOYMENT_PATH not set in secrets.env for interactive Network deployment." -Level "ERROR"
                    Write-Host "NETWORK_DEPLOYMENT_PATH not configured in config\secrets.env" -ForegroundColor Red
                    exit 1
                }
            }
            
            if ($choice -eq "3") {
                $MassGeneration = $true
            }

            Write-Log "Deployment mode selected interactively: $($choice) -> $centralSignaturePath"
        }
    }
}

# Override to Outlook signatures folder when requested
if ($UseOutlookFolder) {
    if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
        Write-Log "UseOutlookFolder requested but APPDATA is not set. Falling back to configured path." -Level "WARNING"
    } else {
        $centralSignaturePath = Join-Path -Path $env:APPDATA -ChildPath "Microsoft\Signatures"
        Write-Log "UseOutlookFolder enabled: deploying to $centralSignaturePath"
    }
}

if (-not (Test-Path $centralSignaturePath)) {
    New-Item -Path $centralSignaturePath -ItemType Directory -Force | Out-Null
    Write-Log "Created central signature storage at $centralSignaturePath"
}

# =========================
# AD queries â€“ get users
# =========================
  $requiredProperties = @("sAMAccountName","mail","memberOf","SID","userPrincipalName")
  $mappingProperties = @()
  foreach ($vals in $variableMappings.Values) {
      $mappingProperties += $vals
  }
  $customTitleAttrs = @($customTitleAttrMap.Values | Where-Object { $_ })

  $baseProperties = @(
      $requiredProperties +
      $mappingProperties +
      $secondaryTitleAttributes +
      $customTitleAttrs +
      @("description")
  ) | Where-Object { $_ } | Select-Object -Unique

# Filter out AD-unsupported property names to avoid Get-ADUser errors
$unsupportedAdProps = @("businessPhone","phone","example-custom")
$filteredOutProps = @()
$sanitizedProps = @()
foreach ($prop in $baseProperties) {
    if (-not $prop) { continue }
    # AD property names are typically alphanumeric/underscore; drop anything with other characters or explicitly unsupported
    if ($prop -in $unsupportedAdProps -or ($prop -match '[^A-Za-z0-9_]')) {
        $filteredOutProps += $prop
        continue
    }
    $sanitizedProps += $prop
}
$baseProperties = $sanitizedProps | Select-Object -Unique
if ($filteredOutProps.Count -gt 0) {
    Write-Log "Filtered unsupported AD properties: $($filteredOutProps -join ', ')" -Level "WARNING"
}

  Write-Log "Base AD properties: $($baseProperties -join ', ')"

$users = @()
if ($MassGeneration) {
    $DomainSelection = "ALL"

    if ($usingUserFile) {
        Write-Host "Starting Mass Generation using user data file..." -ForegroundColor Magenta
        $users = @($fileUsers | Where-Object { $_.Enabled })
        Write-Log "Mass Generation (File): Prepared $($users.Count) enabled entries from $UserFilePath"
    } else {
        Write-Host "Starting Mass Generation for all active users in $ouSearchBase..." -ForegroundColor Magenta
        try {
            $users = Get-ADUser -Filter {Enabled -eq $true} -SearchBase $ouSearchBase `
                    -Properties $baseProperties -Server $Server
            
            Write-Log "Mass Generation: Retrieved $($users.Count) active users from $ouSearchBase"
        } catch {
            Write-Log "Error retrieving users for Mass Generation: $_" -Level "ERROR"
            exit 1
        }
    }
} else {
    if ([string]::IsNullOrWhiteSpace($DomainSelection)) {
        Write-Host "Available domains: " -ForegroundColor Cyan
        Write-Host "- ALL or A: All domains" -ForegroundColor Cyan
        foreach ($domain in $allDomains.Keys) {
            Write-Host "- $domain" -ForegroundColor Cyan
        }
        
        $DomainSelection = Read-Host "Enter domain(s) to generate signatures for (comma-separated)"
    }

    if ([string]::IsNullOrWhiteSpace($UserSelection)) {
        do {
            $UserSelection = Read-Host "Enter username(s) to process (comma-separated)"
            if ([string]::IsNullOrWhiteSpace($UserSelection)) {
                Write-Host "No username provided. Please enter at least one username." -ForegroundColor Yellow
            }
        } while ([string]::IsNullOrWhiteSpace($UserSelection))
    }

    if ($usingUserFile) {
        if (-not $fileUsers -or $fileUsers.Count -eq 0) {
            Write-Log "User file mode: no CSV users loaded to select from. Aborting." -Level "ERROR"
            Write-Host "No users available in $UserFilePath. Import or populate the file, then retry." -ForegroundColor Red
            exit 1
        }
        $users = Select-CsvUsers -CsvUsers $fileUsers -UserSelection $UserSelection
        Write-Log "User file mode: Selected $($users.Count) users for processing ($UserSelection)"
    } else {
        try {
            if ($UserSelection -eq "ALL" -or $UserSelection -eq "A" -or [string]::IsNullOrWhiteSpace($UserSelection)) {
                $users = Get-ADUser -Filter {Enabled -eq $true} -Properties $baseProperties -Server $Server
                Write-Log "Processing all enabled users using server $Server"
            } else {
                $userList = $UserSelection.Split(',') | ForEach-Object { $_.Trim() }
                $users = @()
                foreach ($username in $userList) {
                    try {
                        $user = Get-ADUser -Identity $username -Properties $baseProperties -Server $Server
                        if ($user.Enabled) {
                            $users += $user
                        } else {
                            Write-Log "Skipping disabled user: $username" -Level "WARNING"
                        }
                    } catch {
                        Write-Log "User not found or error: $username - $_" -Level "ERROR"
                    }
                }
                Write-Log "Processing specific users: $($userList -join ', ') using server $Server"
            }
            
            Write-Log "Retrieved $($users.Count) users from Active Directory"
        } catch {
            Write-Log "Error connecting to Active Directory: $_" -Level "ERROR"
            exit 1
        }
    }
}

# =========================
# Optional: export resolved users to CSV using variable mappings
# =========================
if (-not [string]::IsNullOrWhiteSpace($ExportCsvPath)) {
    try {
        $targetPath = $ExportCsvPath
        if (-not [System.IO.Path]::IsPathRooted($targetPath)) {
            $targetPath = Join-Path -Path $scriptDir -ChildPath $targetPath
        }
        Export-SignatureUsersToCsv -Users $users -Path $targetPath -VariableMappings $variableMappings -VariableSchema $script:VariableSchema
    } catch {
        Write-Log "Failed to export users to CSV at $ExportCsvPath : $_" -Level "ERROR"
    }
}

# =========================
# Domain selection
# =========================
$selectedDomains = New-CaseInsensitiveHashtable
if ($DomainSelection -eq "ALL" -or $DomainSelection -eq "A") {
    $selectedDomains = $allDomains
    Write-Log "Selected all domains for signature generation"
} else {
    $domainList = $DomainSelection.Split(',') | ForEach-Object { $_.Trim() }
    foreach ($domain in $domainList) {
        $resolvedDomain = Resolve-ConfiguredDomainKey -Domains $allDomains -LookupKey $domain
        if ($resolvedDomain) {
            $selectedDomains[$resolvedDomain] = $allDomains[$resolvedDomain]
        } else {
            Write-Log "Warning: Domain '$domain' is not recognized and will be skipped" -Level "WARNING"
        }
    }
    Write-Log "Selected domains: $($selectedDomains.Keys -join ', ')"
}

# =========================
# Processing loop
# =========================
$totalUsers = $users.Count
$currentUser = 0
$successfulUsers = 0
$failedUsers = @()

Write-Log "Starting signature generation for $totalUsers users"

foreach ($user in $users) {
    $currentUser++
    $percentComplete = if ($totalUsers -gt 0) { [math]::Round(($currentUser / $totalUsers) * 100, 1) } else { 100 }
    Write-Progress -Activity "Generating Signatures" -Status "Processing $($user.sAMAccountName) ($currentUser of $totalUsers)" -PercentComplete $percentComplete
    Write-Log "Processing user $($user.sAMAccountName) ($currentUser/$totalUsers)"

    try {
        $username = $user.sAMAccountName
        if (-not (Test-SafeUsernameSegment -Username $username)) {
            throw "Invalid account name for output directory."
        }
        $userSuccess = $true
        $userPrincipal = $null

        if ($user.SID) {
            try {
                $userPrincipal = $user.SID.Translate([System.Security.Principal.NTAccount]).Value
            } catch {
                Write-Log "Unable to translate SID for $username to NTAccount: $_" -Level "WARNING"
            }
        }

        if (-not $userPrincipal -and $user.userPrincipalName) {
            $userPrincipal = $user.userPrincipalName
        }

        if ($MassGeneration) {
            if ($usingUserFile) {
                $userDomains = Get-CsvUserDomains -User $user -Domains $allDomains
            } else {
                $userDomains = Get-UserDomains -User $user -MemberOf $user.memberOf -RefreshMembership:$RefreshGroupMembership -LogDiagnostics
            }

            if ($userDomains.Count -eq 0) {
                $noDomainMessage = if ($usingUserFile) {
                    "CSV entry $username has no domains assigned, skipping"
                } else {
                    "User $username has no domain security groups, skipping"
                }
                Write-Log $noDomainMessage -Level "WARNING"
                continue
            }

            Write-Log "User $username belongs to domains: $($userDomains -join ', ')"

            if (-not $UseOutlookFolder) {
                $userSignaturePath = Join-Path -Path $centralSignaturePath -ChildPath $username
                if (-not (Test-Path $userSignaturePath)) {
                    New-Item -Path $userSignaturePath -ItemType Directory -Force | Out-Null
                    Write-Log "Created signature folder: $userSignaturePath"
                }
                if (-not (Grant-UserAccessToFolder -Username $username -FolderPath $userSignaturePath -UserSid $user.SID -UserPrincipal $userPrincipal)) {
                    throw "Could not assign signature directory ACL to $username at $userSignaturePath"
                }
            }

            foreach ($domain in $userDomains) {
                if ($selectedDomains.ContainsKey($domain)) {
                    $userData = Build-UserDataFromMapping `
                        -User $user `
                        -Domain $domain `
                        -PlaceholderMap $variableMappings `
                        -SecondaryTitleAttributes $secondaryTitleAttributes `
                        -CustomTitleAttrMap $customTitleAttrMap

                    $success = New-OutlookSignatures -Username $username -Domain $domain -UserData $userData -TemplateHtmlPath $selectedDomains[$domain] -OutputRootPath $centralSignaturePath -UseOutlookFolder:$UseOutlookFolder
                    if (-not $success) { $userSuccess = $false }
                }
            }
        } else {
        if (-not $UseOutlookFolder) {
            $userSignaturePath = Join-Path -Path $centralSignaturePath -ChildPath $username
            if (-not (Test-Path $userSignaturePath)) {
                New-Item -Path $userSignaturePath -ItemType Directory -Force | Out-Null
                Write-Log "Created signature folder: $userSignaturePath"
            }
            if (-not (Grant-UserAccessToFolder -Username $username -FolderPath $userSignaturePath -UserSid $user.SID -UserPrincipal $userPrincipal)) {
                throw "Could not assign signature directory ACL to $username at $userSignaturePath"
            }
        }

        foreach ($domain in $selectedDomains.Keys) {
            $userData = Build-UserDataFromMapping `
                -User $user `
                -Domain $domain `
                -PlaceholderMap $variableMappings `
                -SecondaryTitleAttributes $secondaryTitleAttributes `
                -CustomTitleAttrMap $customTitleAttrMap

            $success = New-OutlookSignatures -Username $username -Domain $domain -UserData $userData -TemplateHtmlPath $selectedDomains[$domain] -OutputRootPath $centralSignaturePath -UseOutlookFolder:$UseOutlookFolder
            if (-not $success) { $userSuccess = $false }
        }
    }

        if ($userSuccess) {
            $successfulUsers++
            Write-Log "Success for user $username"
        } else {
            $failedUsers += $username
            Write-Log "Failed for user $username" -Level "WARNING"
        }
    } catch {
        Write-Log "Error processing user $($user.sAMAccountName): $_" -Level "ERROR"
        $failedUsers += $user.sAMAccountName
    }
}

Write-Progress -Activity "Generating Signatures" -Completed

# =========================
# Summary
# =========================
$summaryReport = @"
Email Signature Generation Summary
=================================
Date: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Total Users Processed: $totalUsers
Successful: $successfulUsers
Failed: $($failedUsers.Count)
Success Rate: $([math]::Round(($successfulUsers / [math]::Max($totalUsers,1)) * 100, 1))%

Domains Processed: $($selectedDomains.Keys -join ", ")

Failed Users:
$($failedUsers -join "`n")
"@

if (-not $PreviewOnly) {
    $reportPath = Join-Path -Path $scriptDir -ChildPath "summary_$(Get-Date -Format 'yyyy-MM-dd_HHmmss').txt"
    [System.IO.File]::WriteAllText($reportPath, $summaryReport, [System.Text.Encoding]::GetEncoding(1252))
    Write-Log "Signature generation complete. Report saved to $reportPath"
} else {
    Write-Log "PreviewOnly enabled. Skipping summary report file."
}

Write-Host "`nSignature generation complete." -ForegroundColor Green
Write-Host "Successful users: $successfulUsers of $totalUsers" -ForegroundColor $(if ($successfulUsers -eq $totalUsers) { "Green" } else { "Yellow" })
if (-not $PreviewOnly) {
    Write-Host "Report saved to $reportPath" -ForegroundColor Cyan
}

# The Node backend must not report HTTP success when a user or resource failed.
if ($failedUsers.Count -gt 0) {
    Write-Log "Generation failed for $($failedUsers.Count) user(s): $($failedUsers -join ', ')" -Level "ERROR"
    exit 1
}

