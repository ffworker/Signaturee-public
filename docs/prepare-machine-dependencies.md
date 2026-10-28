# Windows host preparation — Signaturee v2

Use the [Quickstart](../README.md#quickstart) for the complete installation sequence. This page covers the required Windows components and scheduled runtime.

## Windows prerequisites

- Supported Windows Server/Windows host on the AD network.
- Node.js **22.13+**, Git and Windows PowerShell **5.1**.
- RSAT **ActiveDirectory** PowerShell module for `Get-ADUser` queries.
- DNS/DC connectivity for AD; SMB access when generating productive network signatures.
- **Microsoft Word for real RTF output**. Without Word, the current generator emits an empty RTF placeholder even if HTML/TXT are generated. Validate Word/RTF output before production.

On Windows Server:

~~~powershell
Install-WindowsFeature RSAT-AD-PowerShell
Import-Module ActiveDirectory
Get-Module -ListAvailable ActiveDirectory
~~~

On supported Windows client editions:

~~~powershell
Add-WindowsCapability -Online -Name Rsat.ActiveDirectory.DS-LDS.Tools~~~~0.0.1.0
Import-Module ActiveDirectory
Get-Command Get-ADUser
~~~

The capability name above is the one documented by [Microsoft for Windows clients](https://learn.microsoft.com/en-us/windows-server/administration/install-remote-server-administration-tools). On Windows Server, use the Windows Feature command shown earlier. Make sure `Get-ADUser` is actually available under the environment in which Signaturee runs.

## Application layout

~~~powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee
cd C:\Signaturee
npm ci --omit=dev
Copy-Item .env.example .env
New-Item -ItemType Directory -Force config\templates | Out-Null
notepad .env
~~~

Fill in your DC, domain, search base and production UNC path. Standard `XY_Template` file pairs belong in `config/templates/`; set `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true` (already enabled in `.env.example`) to assign them to existing `Signature-XY` AD security groups.

~~~powershell
node .\backend\server.js --check
~~~

Create your local Admin account:

~~~powershell
$pw = Read-Host "Signaturee Admin password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) |
        node .\scripts\manage-auth-users.js add --username admin --role admin --password-stdin
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
~~~

## Windows Scheduled Tasks

Run from an **elevated PowerShell**:

~~~powershell
.\scripts\install-backend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
~~~

The two tasks are `Signaturee-Backend-Runner` (default 3001) and `Signaturee-Frontend-Runner` (default 3000). Node reads the selected `.env` on startup. Do not run `npm start` simultaneously on the same ports.

Apply configuration changes **without a Git pull**:

~~~powershell
.\scripts\reload-config.ps1
~~~

Update the repository version and restart both tasks:

~~~powershell
.\scripts\update-signaturee.ps1
~~~

These operations verify real Node listeners; a Scheduled Task `Ready` state by itself does not prove the application is healthy.

## Validate before production

In Admin, verify that **Signaturen** lists all discovered pairs, run **AD-Suche testen** and **LDAP-Login testen** independently (if LDAP is enabled), then use the local and production output-path tests. Refresh the catalog after adding template files; `+ Signatur` uploads are discovered without a backend restart. **Changing `.env` requires activation/reload.** Preflight with a known employee in `Signature-XY` before generating. The current **Generieren** web workflow takes AD accounts, including when the selection came from a CSV/TXT worklist (maximum 50 selected users per run). It is not an offline-CSV renderer.

For productive SMB, the Windows task identity needs share/NTFS write and ACL modification rights. Under SYSTEM, remote domain access normally uses `DOMAIN\COMPUTER$`. An optional AD read account in `.env` does **not** change the SMB identity.

## Backup

Protect `.env`, `config/templates/` (including images), `config/signaturee_auth.db` and `config/signaturee.db`. Stop tasks or use a consistent SQLite backup mechanism before copying active databases.

[Environment reference](environment.md) · [Templates](templates.md) · [Data sources](data-sources.md) · [SMB permissions](network-share-permissions.md)
