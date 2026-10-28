# Prepare Machine / Dependencies

Use this page to prepare a Windows machine for Signaturee v2.

## 1) Install software

- Node.js 22.13+
- Git
- Windows PowerShell 5.1+
- ActiveDirectory PowerShell module

Depending on the Windows edition:

```powershell
Install-WindowsFeature RSAT-AD-PowerShell
```

or:

```powershell
Add-WindowsCapability -Online -Name Rsat.ActiveDirectory.DS-LDS.Tools~~~~0.0.1.0
```

## 2) Clone and install

```powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\signaturee
cd C:\signaturee
npm ci --omit=dev
```

## 3) Prepare runtime environment

```powershell
Copy-Item .env.example .env
notepad .env
```

Set at minimum:
- backend/frontend bind settings,
- authentication,
- CORS when frontend and backend are not same-origin.

For employee AD login:

```env
AUTH_REQUIRED=true
AUTH_DB_LOGIN_ENABLED=true
AUTH_LDAP_ENABLED=true
```

LDAP defaults to Self-Service. To grant IT from AD attributes or direct groups, configure a local rules file as described in [Environment](environment.md). LDAP never grants full Admin access.

## 4) Bootstrap a local Admin

```powershell
$secure = Read-Host "Choose an Admin password" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | npm run auth:users -- add --username admin --password-stdin --role admin }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
```

After first login, create additional Admin/IT accounts from:

**Administration → Benutzer & Zugriff**

Normal employees should use LDAP/AD login rather than local Signaturee accounts.

## 5) Start Signaturee

```powershell
npm start
```

`npm start` loads `.env` and starts backend + frontend.

Open:

```text
http://localhost:3000/
```

For troubleshooting, the services can also be started separately with `npm run start:backend` and `npm run start:frontend`.

## 6) Configure Signaturee v2

Open the Admin UI and configure:
- **Übersicht**: organization and AD connection/search base,
- **Ausgabe & Deployment**: local preview and productive UNC path,
- **Signaturen**: templates and AD group mappings,
- **Variablen**: AD fields/placeholders,
- **Benutzer & Zugriff**: Admin/IT access and LDAP status,
- **Onboarding**: generated AD onboarding requirements.

Use the path test buttons under **Ausgabe & Deployment** before the first productive run.

### Network share permissions

The account that runs the backend must also have SMB **and** NTFS access to the productive UNC target.

If the Backend Scheduled Task runs as `NT AUTHORITY\SYSTEM`, remote SMB access normally uses the server's AD computer account:

```text
DOMAIN\SIGNATUREE-SERVER$
```

Because productive generation applies ACLs to generated user folders, grant sufficient permission to manage ACLs on the dedicated Signaturee output subtree.

See `docs/network-share-permissions.md` for the complete setup.

## 7) Scheduled Tasks

For production:

```powershell
.\scripts\install-backend-task.ps1 -RepoRoot C:\signaturee -EnvFile C:\signaturee\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\signaturee -EnvFile C:\signaturee\.env -StartNow
```

Control both:

```powershell
.\scripts\start-runner-tasks.ps1
.\scripts\stop-runner-tasks.ps1
```

The Admin **System** page shows Backend and Frontend health/task state.

## 8) Backup

Before manual repository recovery, stop both tasks and back up at least:
- `.env`,
- `config/signaturee.db`,
- `config/signaturee_auth.db`,
- `config/templates/`,
- optional `frontend/runtime-config.js`.

The v2 profile is stored in `signaturee.db`.

Repository Markdown under `docs/` is documentation only; Signaturee does not run a separate documentation web service.
