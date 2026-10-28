# Windows host preparation — Signaturee v2

This page covers only the current v2 installation. For the full setup, authentication, AD search, SMB rights and service lifecycle, use the [README](../README.md).

## Dependencies

- Windows Server with PowerShell 5.1, Git and Node.js 22.13+.
- RSAT Active Directory module for `Get-ADUser`, installed using the applicable Windows feature/capability.
- Working DNS/DC discovery, accessible AD users, and appropriate Windows service identity permissions.

Install/check the AD module (Windows Server):

~~~powershell
Install-WindowsFeature RSAT-AD-PowerShell
Import-Module ActiveDirectory
Get-Module -ListAvailable ActiveDirectory
~~~

On supported Windows desktop editions:

~~~powershell
Add-WindowsCapability -Online -Name Rsat.ActiveDirectory.DS-LDS.Tools~~~~0.0.1.0
~~~

## Application

~~~powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee
cd C:\Signaturee
npm ci --omit=dev
Copy-Item .env.example .env
notepad .env
New-Item -ItemType Directory -Force config\templates | Out-Null
node .\backend\server.js --check
~~~

The **single local .env** contains runtime, LDAP login, AD search, and local/SMB target configuration. Templates/images remain files in `config/templates/`, while local Admin password hashes are in `config/signaturee_auth.db`. In env mode the v2 business profile **is not** stored in SQLite.

Create a local Admin:

~~~powershell
$pw = Read-Host "New Admin password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) |
        node .\scripts\manage-auth-users.js add --username admin --role admin --password-stdin
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
~~~

Install two Windows Scheduled Tasks from elevated PowerShell:

~~~powershell
.\scripts\install-backend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
~~~

Reload local configuration and update code using separate commands:

~~~powershell
.\scripts\reload-config.ps1
.\scripts\update-signaturee.ps1
~~~

## Validate before production

Use Admin → **Benutzer & Zugriff** for separate **AD-Suche testen** and **LDAP-Login testen** checks. Use Admin → **Ausgabe & Deployment** to test both the automatically created local preview folder and the remote UNC target. A successful interactive AD command does not prove that SYSTEM (or your configured task account) has the same AD/SMB permissions.

For production SMB, the task identity needs **share + NTFS write, create and ACL modification** rights on the **dedicated** target. When SYSTEM accesses a domain SMB server, it commonly uses `DOMAIN\COMPUTER$`. This is unrelated to optional read-only credentials in `AD_QUERY_USERNAME/AD_QUERY_PASSWORD`.

Back up `.env`, the complete `config/templates/` tree and both SQLite databases. Stop tasks or perform consistent SQLite backups before copying databases.

[Environment reference](environment.md) · [SMB permissions](network-share-permissions.md)
