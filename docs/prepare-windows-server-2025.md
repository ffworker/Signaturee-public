# Prepare your VM (Windows Server 2025)

This is the **fresh-VM walkthrough** for Signaturee's first Windows release: Windows Server 2025 **with Desktop Experience**, Classic Outlook signatures, and **LibreOffice** as the default headless RTF converter. It prepares a **separate test machine**; it does not upgrade an existing production server.

The original Windows installation has passed real local/network generation and Classic Outlook HTML-signature checks. A fresh-VM installation using the distributed ZIP remains a **release acceptance test**, not a result we can claim before running it.

> **Scope:** The supported application workflow uses live Active Directory. This VM is a **member/application server**, **not a domain controller**. Server Core, Linux and new Outlook are not validated installation targets for this guide. No Microsoft Word installation or Office license is required.

## 0. VM and access checklist

- Install **Windows Server 2025 Standard/Datacenter with Desktop Experience** (x64), apply current Windows Updates and restart if needed. Desktop Experience is our **initial validation choice** because LibreOffice and its installer are being verified here; it does **not** mean Server Core is proven incompatible.
- Give the server a stable hostname and IP/DNS configuration, sufficient free disk space for Node dependencies, LibreOffice, templates and generated signatures, and a reliable system clock.
- Use **AD DNS servers**, not public resolvers, for the domain. Verify domain-controller discovery; use a permitted **test domain or test OU**, test account, test group and test SMB share.
- Run preparation steps in **Windows PowerShell 5.1 as Administrator**. Do not promote the VM to a DC, disable security controls, or store domain admin passwords in scripts.
- Domain membership is **recommended for the default backend Scheduled Task running as SYSTEM**: on an AD domain share, SYSTEM normally authenticates remotely as the **machine account**. A non-domain deployment would require a separately designed and verified authentication model.
- Keep the backend API internal. Do not expose ports 3001/3000 directly to the Internet; configure HTTPS and access restrictions with a reverse proxy before remote access.

References: [Microsoft — Server Core vs Desktop Experience](https://learn.microsoft.com/en-us/windows-server/get-started/install-options-server-core-desktop-experience), [Microsoft — domain join](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/join-computer-to-domain).

## 1. Hostname, DNS and AD domain membership

Run these **read-only** checks first (replace the example domain/DC):

~~~powershell
$domain = 'example.local'
$dc = 'dc01.example.local'

hostname
(Get-CimInstance Win32_ComputerSystem) | Select-Object Name, PartOfDomain, Domain
Get-DnsClientServerAddress -AddressFamily IPv4
Resolve-DnsName -Name "_ldap._tcp.dc._msdcs.$domain" -Type SRV
Resolve-DnsName -Name $dc
Test-NetConnection -ComputerName $dc -Port 389
w32tm /query /status
~~~

If the VM is not yet domain-joined, **only if approved for your environment**, join using the domain's delegated computer-join credentials. This changes the machine's domain membership and requires a restart:

~~~powershell
Add-Computer -DomainName 'example.local' -Credential (Get-Credential)
Restart-Computer
~~~

After reboot, check the domain membership and secure channel:

~~~powershell
(Get-CimInstance Win32_ComputerSystem) | Select-Object Name, PartOfDomain, Domain
Test-ComputerSecureChannel
~~~

**Troubleshooting:** If DNS discovery fails, fix the VM's AD DNS configuration before installing Signaturee. A reachable DC does not by itself prove that LDAP sign-in, AD queries, or SMB permissions will work.

## 2. Install the Active Directory PowerShell module (RSAT)

On **Windows Server 2025**, use the Windows **feature** command, **not** the Windows 11 client capability command:

~~~powershell
Get-WindowsFeature RSAT-AD-PowerShell
Install-WindowsFeature -Name RSAT-AD-PowerShell
Import-Module ActiveDirectory
Get-Command Get-ADUser
~~~

`Get-Command Get-ADUser` must resolve. With a delegated account that can read the test directory, you can separately verify the query against the chosen DC:

~~~powershell
Get-ADDomain -Server 'dc01.example.local'
# Choose a known test username; AD lookup can fail under a local account
# that has no domain identity, even if the module is installed correctly.
Get-ADUser -Identity 'test.user' -Server 'dc01.example.local' -Properties mail
~~~

The backend may run as SYSTEM rather than as your interactive administrator; the application's **AD search test** is still required later.

Reference: [Microsoft — RSAT installation on Windows Server 2025](https://learn.microsoft.com/en-us/windows-server/administration/install-remote-server-administration-tools).

## 3. Install Node.js and npm

Signaturee currently tests against **Node.js 22** and requires **Node.js >=22.13**. For this release acceptance test, install the **latest supported 22.x x64 Windows MSI** from [Node.js official downloads](https://nodejs.org/en/download) (or the [v22 archive](https://nodejs.org/en/download/archive/)), using the **all-users** installation and PATH option. Do not silently switch the test to Node.js 24/26; those versions need their own verification.

After installation, open a **new** elevated Windows PowerShell session:

~~~powershell
node.exe --version
npm.cmd --version
(Get-Command node.exe).Source
(Get-Command npm.cmd).Source
~~~

Use `npm.cmd` in PowerShell if the `npm.ps1` launcher is blocked by your execution policy; changing the system execution policy is not required.

## 4. Install LibreOffice (Windows x64, system-wide)

Download the **Windows x86-64 installer** from [LibreOffice's official download page](https://www.libreoffice.org/download/). Install it **for all users** using the standard installer. LibreOffice is a separate prerequisite and is **not included in the Signaturee ZIP**. Microsoft Office/Word is **not** required.

Check the installed executable and version:

~~~powershell
$lo = 'C:\Program Files\LibreOffice\program\soffice.com'
if (-not (Test-Path -LiteralPath $lo -PathType Leaf)) {
    throw 'LibreOffice soffice.com not found. Check the installation path.'
}
& $lo --version
~~~

This confirms LibreOffice for **your current user**, not yet the backend's SYSTEM identity. The actual headless/SYSTEM conversion will be verified during a local web-generated signature run (step 9). Avoid using an interactive Word-COM configuration as a workaround.

Reference: [LibreOffice — Windows installation](https://www.libreoffice.org/installation-instructions/).

## 5. Obtain and extract the Windows ZIP (no Git needed on target)

On GitHub, open the successful Windows [Actions quality gate](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml), select the tested commit's run, and download the `signaturee-win-...` **artifact**. The Actions download is a wrapper containing `signaturee-win-v2.0.0.zip`. Extract the inner ZIP: it contains one `signaturee-win-v2.0.0/` directory.

Place the **contents of that directory** in a **new empty** `C:\Signaturee` directory. You should have:

~~~text
C:\Signaturee\
  .env.example
  GenerateSignatures.ps1
  package.json
  package-lock.json
  backend\
  frontend\
  scripts\
  docs\
~~~

Do **not** unpack over an existing installation, confuse the Actions artifact wrapper with the inner package, or copy private configuration out of source control. The Actions ZIP is a **candidate artifact** until a release is formally published; build from the validated SHA rather than assuming that the latest `main` is your release.

For source-based installations only, Git is required and the alternative is:

~~~powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee
~~~

Choose **either** ZIP **or** Git checkout, not both in the same destination. The existing `scripts/update-signaturee.ps1` only updates Git checkouts.

See [Windows release packaging, acceptance and rollback](windows-release.md).

## 6. Install dependencies and configure Signaturee

From an **elevated PowerShell** session in the fresh directory:

~~~powershell
Set-Location C:\Signaturee
npm.cmd ci --omit=dev
Copy-Item -LiteralPath .\.env.example -Destination .\.env
New-Item -ItemType Directory -Path .\config\templates -Force | Out-Null
notepad .env
~~~

Edit the private `.env` for the **test domain**, not a production environment. Confirm at minimum:

| .env setting | Required test value / meaning |
| --- | --- |
| `SIGNATUREE_CONFIG_MODE` | `env` |
| `AD_SERVER` | Actual DC FQDN (not an arbitrary IP) |
| `OU_SEARCH_BASE` | Real AD distinguished name (e.g., `DC=example,DC=local`) |
| `AUTH_LDAP_DOMAIN` | AD DNS domain when using employee sign-in |
| `AUTH_LDAP_ENABLED` | `true` if testing self-service; `false` if intentionally omitted |
| `TEMPLATE_DIR` | `config/templates` |
| `SIGNATUREE_SIGNATURES_AUTO_DISCOVER` | `true` |
| `LOCAL_DEPLOYMENT_PATH` | `generatedsignatures` |
| `NETWORK_DEPLOYMENT_PATH` | Valid **test** UNC share; not a mapped drive |
| `SIGNATUREE_RTF_ENGINE` | `libreoffice` (optional: already the web default) |
| `SIGNATUREE_LIBREOFFICE_PATH` | `C:\Program Files\LibreOffice\program\soffice.com` recommended for SYSTEM |
| `CORS_ORIGINS` | Exact browser origin(s); add HTTPS reverse-proxy origin if used |
| `AUTH_REQUIRED` | Keep `true` |

Do not put LDAP/admin passwords or customer templates in Git. Keep `AUTH_REQUIRED=true` and restrict access to the private `.env`.

Add **your own** matching test files to `config\templates\`:

~~~text
config\templates\
  TEST_Template.htm
  TEST_Template.txt
  TEST-Dateien\        # optional logo/image assets
~~~

With auto-discovery and the default prefix, the **existing AD group** `Signature-TEST` must assign the test employee to that template. Signaturee does **not** create that AD group. The HTML file's referenced image paths and the on-disk folder must match.

Validate configuration (this **does not** contact AD or test LibreOffice conversion):

~~~powershell
node.exe .\backend\server.js --check
~~~

Read the [template rules](templates.md) and [AD onboarding](ad-onboarding.md) if discovery or group assignment fails.

## 7. Create the first local Admin account

Create the application account (distinct from domain group assignment). The password is entered securely, not stored in `.env`:

~~~powershell
$pw = Read-Host 'Signaturee Admin password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) |
        node.exe .\scripts\manage-auth-users.js add --username admin --role admin --password-stdin
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
~~~

## 8. Install and start the Windows Scheduled Tasks

The included scripts create two **startup Scheduled Tasks**, normally under `NT AUTHORITY\SYSTEM`. Execute from the new `C:\Signaturee` directory as Administrator:

~~~powershell
.\scripts\install-backend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow

Get-ScheduledTask -TaskName 'Signaturee-Backend-Runner','Signaturee-Frontend-Runner' |
    Select-Object TaskName,State,@{Name='Identity';Expression={$_.Principal.UserId}}
Get-NetTCPConnection -State Listen -LocalPort 3000,3001 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,OwningProcess
~~~

Verify locally:

~~~powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing |
    Select-Object StatusCode
Start-Process 'http://127.0.0.1:3000/login.html'
~~~

A Scheduled Task marked `Ready` is **not proof that the API is running**. Check listeners and application responses. Do **not** run `npm start` alongside the Scheduled Tasks on the same ports.

Only after local tests should you expose the UI on a trusted network through a properly configured **HTTPS reverse proxy**. See [reverse proxy guidance](reverse-proxy.md).

## 8a. Allow the new VM's computer account on the SMB file server

**Required before the network-output acceptance test when using the default SYSTEM backend.** On the Signaturee VM, the task runs as `NT AUTHORITY\SYSTEM`, but **on the remote domain file server it authenticates as the VM's AD computer account**, e.g. `CONTOSO\SIG-VM01# Prepare your VM (Windows Server 2025)

This is the **fresh-VM walkthrough** for Signaturee's first Windows release: Windows Server 2025 **with Desktop Experience**, Classic Outlook signatures, and **LibreOffice** as the default headless RTF converter. It prepares a **separate test machine**; it does not upgrade an existing production server.

The original Windows installation has passed real local/network generation and Classic Outlook HTML-signature checks. A fresh-VM installation using the distributed ZIP remains a **release acceptance test**, not a result we can claim before running it.

> **Scope:** The supported application workflow uses live Active Directory. This VM is a **member/application server**, **not a domain controller**. Server Core, Linux and new Outlook are not validated installation targets for this guide. No Microsoft Word installation or Office license is required.

## 0. VM and access checklist

- Install **Windows Server 2025 Standard/Datacenter with Desktop Experience** (x64), apply current Windows Updates and restart if needed. Desktop Experience is our **initial validation choice** because LibreOffice and its installer are being verified here; it does **not** mean Server Core is proven incompatible.
- Give the server a stable hostname and IP/DNS configuration, sufficient free disk space for Node dependencies, LibreOffice, templates and generated signatures, and a reliable system clock.
- Use **AD DNS servers**, not public resolvers, for the domain. Verify domain-controller discovery; use a permitted **test domain or test OU**, test account, test group and test SMB share.
- Run preparation steps in **Windows PowerShell 5.1 as Administrator**. Do not promote the VM to a DC, disable security controls, or store domain admin passwords in scripts.
- Domain membership is **recommended for the default backend Scheduled Task running as SYSTEM**: on an AD domain share, SYSTEM normally authenticates remotely as the **machine account**. A non-domain deployment would require a separately designed and verified authentication model.
- Keep the backend API internal. Do not expose ports 3001/3000 directly to the Internet; configure HTTPS and access restrictions with a reverse proxy before remote access.

References: [Microsoft — Server Core vs Desktop Experience](https://learn.microsoft.com/en-us/windows-server/get-started/install-options-server-core-desktop-experience), [Microsoft — domain join](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/join-computer-to-domain).

## 1. Hostname, DNS and AD domain membership

Run these **read-only** checks first (replace the example domain/DC):

~~~powershell
$domain = 'example.local'
$dc = 'dc01.example.local'

hostname
(Get-CimInstance Win32_ComputerSystem) | Select-Object Name, PartOfDomain, Domain
Get-DnsClientServerAddress -AddressFamily IPv4
Resolve-DnsName -Name "_ldap._tcp.dc._msdcs.$domain" -Type SRV
Resolve-DnsName -Name $dc
Test-NetConnection -ComputerName $dc -Port 389
w32tm /query /status
~~~

If the VM is not yet domain-joined, **only if approved for your environment**, join using the domain's delegated computer-join credentials. This changes the machine's domain membership and requires a restart:

~~~powershell
Add-Computer -DomainName 'example.local' -Credential (Get-Credential)
Restart-Computer
~~~

After reboot, check the domain membership and secure channel:

~~~powershell
(Get-CimInstance Win32_ComputerSystem) | Select-Object Name, PartOfDomain, Domain
Test-ComputerSecureChannel
~~~

**Troubleshooting:** If DNS discovery fails, fix the VM's AD DNS configuration before installing Signaturee. A reachable DC does not by itself prove that LDAP sign-in, AD queries, or SMB permissions will work.

## 2. Install the Active Directory PowerShell module (RSAT)

On **Windows Server 2025**, use the Windows **feature** command, **not** the Windows 11 client capability command:

~~~powershell
Get-WindowsFeature RSAT-AD-PowerShell
Install-WindowsFeature -Name RSAT-AD-PowerShell
Import-Module ActiveDirectory
Get-Command Get-ADUser
~~~

`Get-Command Get-ADUser` must resolve. With a delegated account that can read the test directory, you can separately verify the query against the chosen DC:

~~~powershell
Get-ADDomain -Server 'dc01.example.local'
# Choose a known test username; AD lookup can fail under a local account
# that has no domain identity, even if the module is installed correctly.
Get-ADUser -Identity 'test.user' -Server 'dc01.example.local' -Properties mail
~~~

The backend may run as SYSTEM rather than as your interactive administrator; the application's **AD search test** is still required later.

Reference: [Microsoft — RSAT installation on Windows Server 2025](https://learn.microsoft.com/en-us/windows-server/administration/install-remote-server-administration-tools).

## 3. Install Node.js and npm

Signaturee currently tests against **Node.js 22** and requires **Node.js >=22.13**. For this release acceptance test, install the **latest supported 22.x x64 Windows MSI** from [Node.js official downloads](https://nodejs.org/en/download) (or the [v22 archive](https://nodejs.org/en/download/archive/)), using the **all-users** installation and PATH option. Do not silently switch the test to Node.js 24/26; those versions need their own verification.

After installation, open a **new** elevated Windows PowerShell session:

~~~powershell
node.exe --version
npm.cmd --version
(Get-Command node.exe).Source
(Get-Command npm.cmd).Source
~~~

Use `npm.cmd` in PowerShell if the `npm.ps1` launcher is blocked by your execution policy; changing the system execution policy is not required.

## 4. Install LibreOffice (Windows x64, system-wide)

Download the **Windows x86-64 installer** from [LibreOffice's official download page](https://www.libreoffice.org/download/). Install it **for all users** using the standard installer. LibreOffice is a separate prerequisite and is **not included in the Signaturee ZIP**. Microsoft Office/Word is **not** required.

Check the installed executable and version:

~~~powershell
$lo = 'C:\Program Files\LibreOffice\program\soffice.com'
if (-not (Test-Path -LiteralPath $lo -PathType Leaf)) {
    throw 'LibreOffice soffice.com not found. Check the installation path.'
}
& $lo --version
~~~

This confirms LibreOffice for **your current user**, not yet the backend's SYSTEM identity. The actual headless/SYSTEM conversion will be verified during a local web-generated signature run (step 9). Avoid using an interactive Word-COM configuration as a workaround.

Reference: [LibreOffice — Windows installation](https://www.libreoffice.org/installation-instructions/).

## 5. Obtain and extract the Windows ZIP (no Git needed on target)

On GitHub, open the successful Windows [Actions quality gate](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml), select the tested commit's run, and download the `signaturee-win-...` **artifact**. The Actions download is a wrapper containing `signaturee-win-v2.0.0.zip`. Extract the inner ZIP: it contains one `signaturee-win-v2.0.0/` directory.

Place the **contents of that directory** in a **new empty** `C:\Signaturee` directory. You should have:

~~~text
C:\Signaturee\
  .env.example
  GenerateSignatures.ps1
  package.json
  package-lock.json
  backend\
  frontend\
  scripts\
  docs\
~~~

Do **not** unpack over an existing installation, confuse the Actions artifact wrapper with the inner package, or copy private configuration out of source control. The Actions ZIP is a **candidate artifact** until a release is formally published; build from the validated SHA rather than assuming that the latest `main` is your release.

For source-based installations only, Git is required and the alternative is:

~~~powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee
~~~

Choose **either** ZIP **or** Git checkout, not both in the same destination. The existing `scripts/update-signaturee.ps1` only updates Git checkouts.

See [Windows release packaging, acceptance and rollback](windows-release.md).

## 6. Install dependencies and configure Signaturee

From an **elevated PowerShell** session in the fresh directory:

~~~powershell
Set-Location C:\Signaturee
npm.cmd ci --omit=dev
Copy-Item -LiteralPath .\.env.example -Destination .\.env
New-Item -ItemType Directory -Path .\config\templates -Force | Out-Null
notepad .env
~~~

Edit the private `.env` for the **test domain**, not a production environment. Confirm at minimum:

| .env setting | Required test value / meaning |
| --- | --- |
| `SIGNATUREE_CONFIG_MODE` | `env` |
| `AD_SERVER` | Actual DC FQDN (not an arbitrary IP) |
| `OU_SEARCH_BASE` | Real AD distinguished name (e.g., `DC=example,DC=local`) |
| `AUTH_LDAP_DOMAIN` | AD DNS domain when using employee sign-in |
| `AUTH_LDAP_ENABLED` | `true` if testing self-service; `false` if intentionally omitted |
| `TEMPLATE_DIR` | `config/templates` |
| `SIGNATUREE_SIGNATURES_AUTO_DISCOVER` | `true` |
| `LOCAL_DEPLOYMENT_PATH` | `generatedsignatures` |
| `NETWORK_DEPLOYMENT_PATH` | Valid **test** UNC share; not a mapped drive |
| `SIGNATUREE_RTF_ENGINE` | `libreoffice` (optional: already the web default) |
| `SIGNATUREE_LIBREOFFICE_PATH` | `C:\Program Files\LibreOffice\program\soffice.com` recommended for SYSTEM |
| `CORS_ORIGINS` | Exact browser origin(s); add HTTPS reverse-proxy origin if used |
| `AUTH_REQUIRED` | Keep `true` |

Do not put LDAP/admin passwords or customer templates in Git. Keep `AUTH_REQUIRED=true` and restrict access to the private `.env`.

Add **your own** matching test files to `config\templates\`:

~~~text
config\templates\
  TEST_Template.htm
  TEST_Template.txt
  TEST-Dateien\        # optional logo/image assets
~~~

With auto-discovery and the default prefix, the **existing AD group** `Signature-TEST` must assign the test employee to that template. Signaturee does **not** create that AD group. The HTML file's referenced image paths and the on-disk folder must match.

Validate configuration (this **does not** contact AD or test LibreOffice conversion):

~~~powershell
node.exe .\backend\server.js --check
~~~

Read the [template rules](templates.md) and [AD onboarding](ad-onboarding.md) if discovery or group assignment fails.

## 7. Create the first local Admin account

Create the application account (distinct from domain group assignment). The password is entered securely, not stored in `.env`:

~~~powershell
$pw = Read-Host 'Signaturee Admin password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) |
        node.exe .\scripts\manage-auth-users.js add --username admin --role admin --password-stdin
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
~~~

## 8. Install and start the Windows Scheduled Tasks

The included scripts create two **startup Scheduled Tasks**, normally under `NT AUTHORITY\SYSTEM`. Execute from the new `C:\Signaturee` directory as Administrator:

~~~powershell
.\scripts\install-backend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow

Get-ScheduledTask -TaskName 'Signaturee-Backend-Runner','Signaturee-Frontend-Runner' |
    Select-Object TaskName,State,@{Name='Identity';Expression={$_.Principal.UserId}}
Get-NetTCPConnection -State Listen -LocalPort 3000,3001 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,OwningProcess
~~~

Verify locally:

~~~powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing |
    Select-Object StatusCode
Start-Process 'http://127.0.0.1:3000/login.html'
~~~

A Scheduled Task marked `Ready` is **not proof that the API is running**. Check listeners and application responses. Do **not** run `npm start` alongside the Scheduled Tasks on the same ports.

Only after local tests should you expose the UI on a trusted network through a properly configured **HTTPS reverse proxy**. See [reverse proxy guidance](reverse-proxy.md).

. Granting rights to `NT AUTHORITY\SYSTEM` *on the file server* would refer to the file server's own local SYSTEM identity; it would **not** grant the Signaturee VM access.

On the Signaturee VM, identify the account (substitute the actual name if needed):

~~~powershell
$vmName = $env:COMPUTERNAME
Get-ADComputer -Identity $vmName | Select-Object Name,SamAccountName
~~~

On the **Windows file server**, for the **dedicated test Signaturee output share/folder**, configure **both** permission layers:

1. **Share permissions:** Open the share's **Properties → Sharing → Advanced Sharing → Permissions**. Choose **Add → Object Types → Computers**, select your AD domain and resolve the new VM name (e.g. `SIG-VM01`, resolved to `CONTOSO\SIG-VM01# Prepare your VM (Windows Server 2025)

This is the **fresh-VM walkthrough** for Signaturee's first Windows release: Windows Server 2025 **with Desktop Experience**, Classic Outlook signatures, and **LibreOffice** as the default headless RTF converter. It prepares a **separate test machine**; it does not upgrade an existing production server.

The original Windows installation has passed real local/network generation and Classic Outlook HTML-signature checks. A fresh-VM installation using the distributed ZIP remains a **release acceptance test**, not a result we can claim before running it.

> **Scope:** The supported application workflow uses live Active Directory. This VM is a **member/application server**, **not a domain controller**. Server Core, Linux and new Outlook are not validated installation targets for this guide. No Microsoft Word installation or Office license is required.

## 0. VM and access checklist

- Install **Windows Server 2025 Standard/Datacenter with Desktop Experience** (x64), apply current Windows Updates and restart if needed. Desktop Experience is our **initial validation choice** because LibreOffice and its installer are being verified here; it does **not** mean Server Core is proven incompatible.
- Give the server a stable hostname and IP/DNS configuration, sufficient free disk space for Node dependencies, LibreOffice, templates and generated signatures, and a reliable system clock.
- Use **AD DNS servers**, not public resolvers, for the domain. Verify domain-controller discovery; use a permitted **test domain or test OU**, test account, test group and test SMB share.
- Run preparation steps in **Windows PowerShell 5.1 as Administrator**. Do not promote the VM to a DC, disable security controls, or store domain admin passwords in scripts.
- Domain membership is **recommended for the default backend Scheduled Task running as SYSTEM**: on an AD domain share, SYSTEM normally authenticates remotely as the **machine account**. A non-domain deployment would require a separately designed and verified authentication model.
- Keep the backend API internal. Do not expose ports 3001/3000 directly to the Internet; configure HTTPS and access restrictions with a reverse proxy before remote access.

References: [Microsoft — Server Core vs Desktop Experience](https://learn.microsoft.com/en-us/windows-server/get-started/install-options-server-core-desktop-experience), [Microsoft — domain join](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/join-computer-to-domain).

## 1. Hostname, DNS and AD domain membership

Run these **read-only** checks first (replace the example domain/DC):

~~~powershell
$domain = 'example.local'
$dc = 'dc01.example.local'

hostname
(Get-CimInstance Win32_ComputerSystem) | Select-Object Name, PartOfDomain, Domain
Get-DnsClientServerAddress -AddressFamily IPv4
Resolve-DnsName -Name "_ldap._tcp.dc._msdcs.$domain" -Type SRV
Resolve-DnsName -Name $dc
Test-NetConnection -ComputerName $dc -Port 389
w32tm /query /status
~~~

If the VM is not yet domain-joined, **only if approved for your environment**, join using the domain's delegated computer-join credentials. This changes the machine's domain membership and requires a restart:

~~~powershell
Add-Computer -DomainName 'example.local' -Credential (Get-Credential)
Restart-Computer
~~~

After reboot, check the domain membership and secure channel:

~~~powershell
(Get-CimInstance Win32_ComputerSystem) | Select-Object Name, PartOfDomain, Domain
Test-ComputerSecureChannel
~~~

**Troubleshooting:** If DNS discovery fails, fix the VM's AD DNS configuration before installing Signaturee. A reachable DC does not by itself prove that LDAP sign-in, AD queries, or SMB permissions will work.

## 2. Install the Active Directory PowerShell module (RSAT)

On **Windows Server 2025**, use the Windows **feature** command, **not** the Windows 11 client capability command:

~~~powershell
Get-WindowsFeature RSAT-AD-PowerShell
Install-WindowsFeature -Name RSAT-AD-PowerShell
Import-Module ActiveDirectory
Get-Command Get-ADUser
~~~

`Get-Command Get-ADUser` must resolve. With a delegated account that can read the test directory, you can separately verify the query against the chosen DC:

~~~powershell
Get-ADDomain -Server 'dc01.example.local'
# Choose a known test username; AD lookup can fail under a local account
# that has no domain identity, even if the module is installed correctly.
Get-ADUser -Identity 'test.user' -Server 'dc01.example.local' -Properties mail
~~~

The backend may run as SYSTEM rather than as your interactive administrator; the application's **AD search test** is still required later.

Reference: [Microsoft — RSAT installation on Windows Server 2025](https://learn.microsoft.com/en-us/windows-server/administration/install-remote-server-administration-tools).

## 3. Install Node.js and npm

Signaturee currently tests against **Node.js 22** and requires **Node.js >=22.13**. For this release acceptance test, install the **latest supported 22.x x64 Windows MSI** from [Node.js official downloads](https://nodejs.org/en/download) (or the [v22 archive](https://nodejs.org/en/download/archive/)), using the **all-users** installation and PATH option. Do not silently switch the test to Node.js 24/26; those versions need their own verification.

After installation, open a **new** elevated Windows PowerShell session:

~~~powershell
node.exe --version
npm.cmd --version
(Get-Command node.exe).Source
(Get-Command npm.cmd).Source
~~~

Use `npm.cmd` in PowerShell if the `npm.ps1` launcher is blocked by your execution policy; changing the system execution policy is not required.

## 4. Install LibreOffice (Windows x64, system-wide)

Download the **Windows x86-64 installer** from [LibreOffice's official download page](https://www.libreoffice.org/download/). Install it **for all users** using the standard installer. LibreOffice is a separate prerequisite and is **not included in the Signaturee ZIP**. Microsoft Office/Word is **not** required.

Check the installed executable and version:

~~~powershell
$lo = 'C:\Program Files\LibreOffice\program\soffice.com'
if (-not (Test-Path -LiteralPath $lo -PathType Leaf)) {
    throw 'LibreOffice soffice.com not found. Check the installation path.'
}
& $lo --version
~~~

This confirms LibreOffice for **your current user**, not yet the backend's SYSTEM identity. The actual headless/SYSTEM conversion will be verified during a local web-generated signature run (step 9). Avoid using an interactive Word-COM configuration as a workaround.

Reference: [LibreOffice — Windows installation](https://www.libreoffice.org/installation-instructions/).

## 5. Obtain and extract the Windows ZIP (no Git needed on target)

On GitHub, open the successful Windows [Actions quality gate](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml), select the tested commit's run, and download the `signaturee-win-...` **artifact**. The Actions download is a wrapper containing `signaturee-win-v2.0.0.zip`. Extract the inner ZIP: it contains one `signaturee-win-v2.0.0/` directory.

Place the **contents of that directory** in a **new empty** `C:\Signaturee` directory. You should have:

~~~text
C:\Signaturee\
  .env.example
  GenerateSignatures.ps1
  package.json
  package-lock.json
  backend\
  frontend\
  scripts\
  docs\
~~~

Do **not** unpack over an existing installation, confuse the Actions artifact wrapper with the inner package, or copy private configuration out of source control. The Actions ZIP is a **candidate artifact** until a release is formally published; build from the validated SHA rather than assuming that the latest `main` is your release.

For source-based installations only, Git is required and the alternative is:

~~~powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee
~~~

Choose **either** ZIP **or** Git checkout, not both in the same destination. The existing `scripts/update-signaturee.ps1` only updates Git checkouts.

See [Windows release packaging, acceptance and rollback](windows-release.md).

## 6. Install dependencies and configure Signaturee

From an **elevated PowerShell** session in the fresh directory:

~~~powershell
Set-Location C:\Signaturee
npm.cmd ci --omit=dev
Copy-Item -LiteralPath .\.env.example -Destination .\.env
New-Item -ItemType Directory -Path .\config\templates -Force | Out-Null
notepad .env
~~~

Edit the private `.env` for the **test domain**, not a production environment. Confirm at minimum:

| .env setting | Required test value / meaning |
| --- | --- |
| `SIGNATUREE_CONFIG_MODE` | `env` |
| `AD_SERVER` | Actual DC FQDN (not an arbitrary IP) |
| `OU_SEARCH_BASE` | Real AD distinguished name (e.g., `DC=example,DC=local`) |
| `AUTH_LDAP_DOMAIN` | AD DNS domain when using employee sign-in |
| `AUTH_LDAP_ENABLED` | `true` if testing self-service; `false` if intentionally omitted |
| `TEMPLATE_DIR` | `config/templates` |
| `SIGNATUREE_SIGNATURES_AUTO_DISCOVER` | `true` |
| `LOCAL_DEPLOYMENT_PATH` | `generatedsignatures` |
| `NETWORK_DEPLOYMENT_PATH` | Valid **test** UNC share; not a mapped drive |
| `SIGNATUREE_RTF_ENGINE` | `libreoffice` (optional: already the web default) |
| `SIGNATUREE_LIBREOFFICE_PATH` | `C:\Program Files\LibreOffice\program\soffice.com` recommended for SYSTEM |
| `CORS_ORIGINS` | Exact browser origin(s); add HTTPS reverse-proxy origin if used |
| `AUTH_REQUIRED` | Keep `true` |

Do not put LDAP/admin passwords or customer templates in Git. Keep `AUTH_REQUIRED=true` and restrict access to the private `.env`.

Add **your own** matching test files to `config\templates\`:

~~~text
config\templates\
  TEST_Template.htm
  TEST_Template.txt
  TEST-Dateien\        # optional logo/image assets
~~~

With auto-discovery and the default prefix, the **existing AD group** `Signature-TEST` must assign the test employee to that template. Signaturee does **not** create that AD group. The HTML file's referenced image paths and the on-disk folder must match.

Validate configuration (this **does not** contact AD or test LibreOffice conversion):

~~~powershell
node.exe .\backend\server.js --check
~~~

Read the [template rules](templates.md) and [AD onboarding](ad-onboarding.md) if discovery or group assignment fails.

## 7. Create the first local Admin account

Create the application account (distinct from domain group assignment). The password is entered securely, not stored in `.env`:

~~~powershell
$pw = Read-Host 'Signaturee Admin password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) |
        node.exe .\scripts\manage-auth-users.js add --username admin --role admin --password-stdin
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
~~~

## 8. Install and start the Windows Scheduled Tasks

The included scripts create two **startup Scheduled Tasks**, normally under `NT AUTHORITY\SYSTEM`. Execute from the new `C:\Signaturee` directory as Administrator:

~~~powershell
.\scripts\install-backend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow

Get-ScheduledTask -TaskName 'Signaturee-Backend-Runner','Signaturee-Frontend-Runner' |
    Select-Object TaskName,State,@{Name='Identity';Expression={$_.Principal.UserId}}
Get-NetTCPConnection -State Listen -LocalPort 3000,3001 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,OwningProcess
~~~

Verify locally:

~~~powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing |
    Select-Object StatusCode
Start-Process 'http://127.0.0.1:3000/login.html'
~~~

A Scheduled Task marked `Ready` is **not proof that the API is running**. Check listeners and application responses. Do **not** run `npm start` alongside the Scheduled Tasks on the same ports.

Only after local tests should you expose the UI on a trusted network through a properly configured **HTTPS reverse proxy**. See [reverse proxy guidance](reverse-proxy.md).

). Grant the permissions your dedicated Signaturee share needs. If the generator must modify ACLs, its effective share permissions must not prevent that.
2. **NTFS permissions:** Open the backing output folder's **Properties → Security → Edit/Advanced → Add**. Again enable **Computers**, resolve the **same domain computer account**, and grant the necessary permissions on that Signaturee-specific subtree. The generator creates files and user directories and **modifies ACLs**; Full Control on the **dedicated output tree** is a practical choice where the ACL-update behavior requires it.
3. Keep the permission scope narrow. **Do not grant the entire `Domain Computers` group access** or change unrelated shares. If a broader share already delegates access through NTFS, follow the existing file-server permission model while ensuring the effective result permits ACL changes.

Set the real **UNC** destination in `.env` (e.g. `\\fileserver.example.local\Signatures\Users`), reload the backend if the setting changed, and run **Administration → Ausgabe → Netzwerkpfad testen**. This test checks write and ACL operations as the backend's actual identity. **A successful interactive Explorer/`Test-Path` check as Administrator is not enough** to verify SYSTEM access.

If that check fails with `EPERM`/access denied, inspect both share and NTFS permissions for `DOMAIN\VMNAME# Prepare your VM (Windows Server 2025)

This is the **fresh-VM walkthrough** for Signaturee's first Windows release: Windows Server 2025 **with Desktop Experience**, Classic Outlook signatures, and **LibreOffice** as the default headless RTF converter. It prepares a **separate test machine**; it does not upgrade an existing production server.

The original Windows installation has passed real local/network generation and Classic Outlook HTML-signature checks. A fresh-VM installation using the distributed ZIP remains a **release acceptance test**, not a result we can claim before running it.

> **Scope:** The supported application workflow uses live Active Directory. This VM is a **member/application server**, **not a domain controller**. Server Core, Linux and new Outlook are not validated installation targets for this guide. No Microsoft Word installation or Office license is required.

## 0. VM and access checklist

- Install **Windows Server 2025 Standard/Datacenter with Desktop Experience** (x64), apply current Windows Updates and restart if needed. Desktop Experience is our **initial validation choice** because LibreOffice and its installer are being verified here; it does **not** mean Server Core is proven incompatible.
- Give the server a stable hostname and IP/DNS configuration, sufficient free disk space for Node dependencies, LibreOffice, templates and generated signatures, and a reliable system clock.
- Use **AD DNS servers**, not public resolvers, for the domain. Verify domain-controller discovery; use a permitted **test domain or test OU**, test account, test group and test SMB share.
- Run preparation steps in **Windows PowerShell 5.1 as Administrator**. Do not promote the VM to a DC, disable security controls, or store domain admin passwords in scripts.
- Domain membership is **recommended for the default backend Scheduled Task running as SYSTEM**: on an AD domain share, SYSTEM normally authenticates remotely as the **machine account**. A non-domain deployment would require a separately designed and verified authentication model.
- Keep the backend API internal. Do not expose ports 3001/3000 directly to the Internet; configure HTTPS and access restrictions with a reverse proxy before remote access.

References: [Microsoft — Server Core vs Desktop Experience](https://learn.microsoft.com/en-us/windows-server/get-started/install-options-server-core-desktop-experience), [Microsoft — domain join](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/join-computer-to-domain).

## 1. Hostname, DNS and AD domain membership

Run these **read-only** checks first (replace the example domain/DC):

~~~powershell
$domain = 'example.local'
$dc = 'dc01.example.local'

hostname
(Get-CimInstance Win32_ComputerSystem) | Select-Object Name, PartOfDomain, Domain
Get-DnsClientServerAddress -AddressFamily IPv4
Resolve-DnsName -Name "_ldap._tcp.dc._msdcs.$domain" -Type SRV
Resolve-DnsName -Name $dc
Test-NetConnection -ComputerName $dc -Port 389
w32tm /query /status
~~~

If the VM is not yet domain-joined, **only if approved for your environment**, join using the domain's delegated computer-join credentials. This changes the machine's domain membership and requires a restart:

~~~powershell
Add-Computer -DomainName 'example.local' -Credential (Get-Credential)
Restart-Computer
~~~

After reboot, check the domain membership and secure channel:

~~~powershell
(Get-CimInstance Win32_ComputerSystem) | Select-Object Name, PartOfDomain, Domain
Test-ComputerSecureChannel
~~~

**Troubleshooting:** If DNS discovery fails, fix the VM's AD DNS configuration before installing Signaturee. A reachable DC does not by itself prove that LDAP sign-in, AD queries, or SMB permissions will work.

## 2. Install the Active Directory PowerShell module (RSAT)

On **Windows Server 2025**, use the Windows **feature** command, **not** the Windows 11 client capability command:

~~~powershell
Get-WindowsFeature RSAT-AD-PowerShell
Install-WindowsFeature -Name RSAT-AD-PowerShell
Import-Module ActiveDirectory
Get-Command Get-ADUser
~~~

`Get-Command Get-ADUser` must resolve. With a delegated account that can read the test directory, you can separately verify the query against the chosen DC:

~~~powershell
Get-ADDomain -Server 'dc01.example.local'
# Choose a known test username; AD lookup can fail under a local account
# that has no domain identity, even if the module is installed correctly.
Get-ADUser -Identity 'test.user' -Server 'dc01.example.local' -Properties mail
~~~

The backend may run as SYSTEM rather than as your interactive administrator; the application's **AD search test** is still required later.

Reference: [Microsoft — RSAT installation on Windows Server 2025](https://learn.microsoft.com/en-us/windows-server/administration/install-remote-server-administration-tools).

## 3. Install Node.js and npm

Signaturee currently tests against **Node.js 22** and requires **Node.js >=22.13**. For this release acceptance test, install the **latest supported 22.x x64 Windows MSI** from [Node.js official downloads](https://nodejs.org/en/download) (or the [v22 archive](https://nodejs.org/en/download/archive/)), using the **all-users** installation and PATH option. Do not silently switch the test to Node.js 24/26; those versions need their own verification.

After installation, open a **new** elevated Windows PowerShell session:

~~~powershell
node.exe --version
npm.cmd --version
(Get-Command node.exe).Source
(Get-Command npm.cmd).Source
~~~

Use `npm.cmd` in PowerShell if the `npm.ps1` launcher is blocked by your execution policy; changing the system execution policy is not required.

## 4. Install LibreOffice (Windows x64, system-wide)

Download the **Windows x86-64 installer** from [LibreOffice's official download page](https://www.libreoffice.org/download/). Install it **for all users** using the standard installer. LibreOffice is a separate prerequisite and is **not included in the Signaturee ZIP**. Microsoft Office/Word is **not** required.

Check the installed executable and version:

~~~powershell
$lo = 'C:\Program Files\LibreOffice\program\soffice.com'
if (-not (Test-Path -LiteralPath $lo -PathType Leaf)) {
    throw 'LibreOffice soffice.com not found. Check the installation path.'
}
& $lo --version
~~~

This confirms LibreOffice for **your current user**, not yet the backend's SYSTEM identity. The actual headless/SYSTEM conversion will be verified during a local web-generated signature run (step 9). Avoid using an interactive Word-COM configuration as a workaround.

Reference: [LibreOffice — Windows installation](https://www.libreoffice.org/installation-instructions/).

## 5. Obtain and extract the Windows ZIP (no Git needed on target)

On GitHub, open the successful Windows [Actions quality gate](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml), select the tested commit's run, and download the `signaturee-win-...` **artifact**. The Actions download is a wrapper containing `signaturee-win-v2.0.0.zip`. Extract the inner ZIP: it contains one `signaturee-win-v2.0.0/` directory.

Place the **contents of that directory** in a **new empty** `C:\Signaturee` directory. You should have:

~~~text
C:\Signaturee\
  .env.example
  GenerateSignatures.ps1
  package.json
  package-lock.json
  backend\
  frontend\
  scripts\
  docs\
~~~

Do **not** unpack over an existing installation, confuse the Actions artifact wrapper with the inner package, or copy private configuration out of source control. The Actions ZIP is a **candidate artifact** until a release is formally published; build from the validated SHA rather than assuming that the latest `main` is your release.

For source-based installations only, Git is required and the alternative is:

~~~powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee
~~~

Choose **either** ZIP **or** Git checkout, not both in the same destination. The existing `scripts/update-signaturee.ps1` only updates Git checkouts.

See [Windows release packaging, acceptance and rollback](windows-release.md).

## 6. Install dependencies and configure Signaturee

From an **elevated PowerShell** session in the fresh directory:

~~~powershell
Set-Location C:\Signaturee
npm.cmd ci --omit=dev
Copy-Item -LiteralPath .\.env.example -Destination .\.env
New-Item -ItemType Directory -Path .\config\templates -Force | Out-Null
notepad .env
~~~

Edit the private `.env` for the **test domain**, not a production environment. Confirm at minimum:

| .env setting | Required test value / meaning |
| --- | --- |
| `SIGNATUREE_CONFIG_MODE` | `env` |
| `AD_SERVER` | Actual DC FQDN (not an arbitrary IP) |
| `OU_SEARCH_BASE` | Real AD distinguished name (e.g., `DC=example,DC=local`) |
| `AUTH_LDAP_DOMAIN` | AD DNS domain when using employee sign-in |
| `AUTH_LDAP_ENABLED` | `true` if testing self-service; `false` if intentionally omitted |
| `TEMPLATE_DIR` | `config/templates` |
| `SIGNATUREE_SIGNATURES_AUTO_DISCOVER` | `true` |
| `LOCAL_DEPLOYMENT_PATH` | `generatedsignatures` |
| `NETWORK_DEPLOYMENT_PATH` | Valid **test** UNC share; not a mapped drive |
| `SIGNATUREE_RTF_ENGINE` | `libreoffice` (optional: already the web default) |
| `SIGNATUREE_LIBREOFFICE_PATH` | `C:\Program Files\LibreOffice\program\soffice.com` recommended for SYSTEM |
| `CORS_ORIGINS` | Exact browser origin(s); add HTTPS reverse-proxy origin if used |
| `AUTH_REQUIRED` | Keep `true` |

Do not put LDAP/admin passwords or customer templates in Git. Keep `AUTH_REQUIRED=true` and restrict access to the private `.env`.

Add **your own** matching test files to `config\templates\`:

~~~text
config\templates\
  TEST_Template.htm
  TEST_Template.txt
  TEST-Dateien\        # optional logo/image assets
~~~

With auto-discovery and the default prefix, the **existing AD group** `Signature-TEST` must assign the test employee to that template. Signaturee does **not** create that AD group. The HTML file's referenced image paths and the on-disk folder must match.

Validate configuration (this **does not** contact AD or test LibreOffice conversion):

~~~powershell
node.exe .\backend\server.js --check
~~~

Read the [template rules](templates.md) and [AD onboarding](ad-onboarding.md) if discovery or group assignment fails.

## 7. Create the first local Admin account

Create the application account (distinct from domain group assignment). The password is entered securely, not stored in `.env`:

~~~powershell
$pw = Read-Host 'Signaturee Admin password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) |
        node.exe .\scripts\manage-auth-users.js add --username admin --role admin --password-stdin
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
~~~

## 8. Install and start the Windows Scheduled Tasks

The included scripts create two **startup Scheduled Tasks**, normally under `NT AUTHORITY\SYSTEM`. Execute from the new `C:\Signaturee` directory as Administrator:

~~~powershell
.\scripts\install-backend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow

Get-ScheduledTask -TaskName 'Signaturee-Backend-Runner','Signaturee-Frontend-Runner' |
    Select-Object TaskName,State,@{Name='Identity';Expression={$_.Principal.UserId}}
Get-NetTCPConnection -State Listen -LocalPort 3000,3001 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,OwningProcess
~~~

Verify locally:

~~~powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing |
    Select-Object StatusCode
Start-Process 'http://127.0.0.1:3000/login.html'
~~~

A Scheduled Task marked `Ready` is **not proof that the API is running**. Check listeners and application responses. Do **not** run `npm start` alongside the Scheduled Tasks on the same ports.

Only after local tests should you expose the UI on a trusted network through a properly configured **HTTPS reverse proxy**. See [reverse proxy guidance](reverse-proxy.md).

, and confirm AD DNS/domain trust. A separate `AD_QUERY_USERNAME` only changes AD lookup, **not SMB authentication**.

For the complete file-server permission walkthrough, see [Network Share Permissions](network-share-permissions.md).

## 9. Acceptance checklist — test real output, not only prerequisites

Run these checks from the UI **while the backend is actually running under SYSTEM**:

- [ ] Admin sign-in succeeds; the expected template pair and optional logo folder are discovered.
- [ ] `AD-Suche testen` returns the **test** user; when enabled, `LDAP-Login testen` succeeds separately.
- [ ] User `test.user` is **directly** in the expected signature AD group.
- [ ] `Preflight → Vorschau → Generieren` produces one local signature with `.htm`, `.txt`, **non-empty valid `.rtf`**, and the matching `-Dateien` folder.
- [ ] Logs show successful **LibreOffice** conversion under the task; there is no Word-COM requirement. If RTF conversion fails, Signaturee reports failure rather than intentionally publishing an empty placeholder.
- [ ] On a separate workstation, copy the signature set to `%APPDATA%\Microsoft\Signatures` while **Classic Outlook** is closed. Reopen Outlook and test a new **HTML** email: logo, links, umlauts, font, layout, and values.
- [ ] If you intend to support Rich Text emails, switch to the **Rich Text** format and inspect the RTF **separately**. A valid `{\rtf` header alone does not guarantee the image rendered.
- [ ] Generate **multiple** assigned signatures in one run and repeat generation without corrupting the previous output.
- [ ] Test the **network** output on a **test UNC share**. Verify the backend machine account (`DOMAIN\SERVER$` under SYSTEM) has share and NTFS rights, including the ACL-management rights required by the generator.
- [ ] Reload the tasks/reboot the VM and confirm both runners start, remain healthy and still resolve LibreOffice.
- [ ] Record the exact Windows build, Node/LibreOffice versions, Git commit/ZIP SHA256, test outcomes and any unresolved formatting defects.

**Release rule:** The first already-working Windows server is functional evidence. Publish a version tag and downloadable stable Windows release **only after this fresh-install checklist passes**. Do not change `main`, update the existing production server or create a stable tag as part of preparing this guide.

## Next: Linux / Docker

Once Windows is tagged and frozen, Linux development can share the **same repository, frontend, Node.js API, configuration format, template rules and test fixtures**. Introduce a Linux-compatible **directory adapter** (e.g. LDAP-based lookup/group resolution) and filesystem/SMB deployment adapter without rewriting the complete UI. LibreOffice headless can remain the shared RTF engine. Linux image/Compose delivery is a **separate future milestone**; no Linux support is implied by this Windows guide.
