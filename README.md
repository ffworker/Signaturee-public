# Signaturee

[![Quality Gate](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 22.13+](https://img.shields.io/badge/node-22.13%2B-339933.svg)](package.json)

**Self-service and IT-managed Outlook signatures generated from live Active Directory data.**

Signaturee is a small Windows-hosted web application for centrally managing, validating and generating Outlook signatures without maintaining a separate user CSV. It combines a browser UI, a Node.js backend, live Active Directory lookups and the existing PowerShell signature generator into one deployable workflow.

The repository is intentionally environment-neutral: company-specific AD paths, signature mappings, deployment targets and credentials stay outside the source tree and are configured after installation.

## What Signaturee does

Signaturee provides three browser workflows:

- **Administration** — configure the AD connection/search base, deployment targets, signature definitions, AD group mappings, templates, variables, local accounts and optional LDAP self-service.
- **IT generation** — search users directly in AD, choose signatures, run a technical preflight and generate only after the plan is valid.
- **Self-Service** — employees authenticate with AD/LDAP and generate only signatures for their own account.

The generation flow deliberately separates **preview/test output** from **production deployment**. Preflight checks the selected users, AD-to-signature mapping, required data, templates and target before generation is enabled.

## Repository architecture

~~~text
Browser
  |
  +-- Admin UI
  +-- IT generation UI
  +-- Self-Service UI
  |
  v
Frontend :3000
  |
  v
Node.js backend :3001
  |
  +-- authentication / sessions
  +-- env-backed v2 profile + SQLite runtime storage
  +-- live Active Directory queries
  +-- preflight / target validation
  +-- template management
  |
  v
PowerShell generator
  |
  +-- local preview target
  +-- production UNC / SMB target
~~~

Main parts of the repository:

| Path | Purpose |
| --- | --- |
| `frontend/` | Admin, IT, login and self-service browser UI |
| `backend/` | API, authentication, AD integration, profile/storage and runner controls |
| `GenerateSignatures.ps1` | Signature generation engine |
| `Functions/` | PowerShell helper functions used by the generator |
| `Templatefiles/` | Tracked example templates for onboarding |
| `config/templates/` | Active untracked site templates and images in env mode |
| `config/example/` | Safe configuration examples only |
| `scripts/` | startup, account management, Scheduled Task install and quality-gate helpers |
| `tests/` | PowerShell/Pester tests |
| `docs/` | focused deployment and administration documentation |

## Quickstart

Requirements: Windows with Node.js 22.13+, Windows PowerShell 5.1+, RSAT/ActiveDirectory module. Word is optional for RTF.

~~~powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee-clean
cd C:\Signaturee-clean
npm ci --omit=dev

# Your ONLY local configuration file:
Copy-Item .env.example .env
notepad .env

# Create the ignored templates directory and copy the assets you actually use.
New-Item -ItemType Directory -Force config\templates | Out-Null
Copy-Item .\Templatefiles\* .\config\templates\ -Recurse -Force

# Validate env JSON and inspect resolved settings before starting.
node backend/server.js --check
~~~

**Edit .env before creating accounts or starting the server:** change AD_SERVER, OU_SEARCH_BASE, NETWORK_DEPLOYMENT_PATH and the ONE required SIGNATUREE_SIGNATURES_JSON line. You can **remove or leave commented** SIGNATUREE_VARIABLES_JSON: Signaturee already includes normal AD fields (name, email, department, phone, etc.). LDAP role-rule paths must remain commented unless the referenced file exists; LDAP login itself doesn't require custom role rules. Each template name must exist in TEMPLATE_DIR. The example is NOT a usable company configuration.

Create your new local Admin account without putting its password on the command line:

~~~powershell
$secure = Read-Host "Choose an Admin password" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | node .\scripts\manage-auth-users.js add --username admin --password-stdin --role admin }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

# For initial local testing; use Scheduled Tasks in production:
npm start
~~~

Visit http://localhost:3000/. Local Admin and AD/LDAP login are separate selectable providers.

## Configuration

**Single source of truth: the root .env file.** Copy [.env.example](.env.example) and update the settings. The required SIGNATUREE_CONFIG_MODE=env makes the v2 profile (organization, directory, preview/SMB targets, signatures, AD group mapping and variables) derive entirely from environment values at startup.

| Where | What belongs there |
| --- | --- |
| .env | Runtime ports, authentication/LDAP, AD, preview and SMB paths, signature/group JSON and variable JSON |
| config/templates/ | Managed HTML/TXT templates, embedded images and resource folders; Git-ignored |
| config/signaturee_auth.db | Local account password hashes and role records; Git-ignored |
| config/signaturee.db | Runtime state/legacy data; **not** the v2 business configuration in env mode |

The Admin page is **read-only** for v2 business configuration in env mode. Local accounts, template imports, service status and target tests remain functional. Edit .env and restart the backend to apply changes. This deliberately eliminates the disagreement between saved Admin settings and old secrets/runner files.

Simple business settings (edit individually): SIGNATUREE_ORGANIZATION_NAME, AD_SERVER, OU_SEARCH_BASE, LOCAL_DEPLOYMENT_PATH, NETWORK_DEPLOYMENT_PATH and TEMPLATE_DIR. Complex values are one-line JSON (SIGNATUREE_SIGNATURES_JSON and optionally SIGNATUREE_VARIABLES_JSON). Inline LDAP IT-role rules use AUTH_LDAP_ROLE_RULES_JSON. You may also use SIGNATUREE_PROFILE_JSON for a full export, but individual keys override the corresponding JSON fields. See [Environment reference](docs/environment.md) for examples and precedence rules.

A fresh deployment **does not need config/runner.env, config/secrets.env or config/config.json**. An active `AUTH_LDAP_ROLE_RULES_PATH` pointing at a nonexistent file **blocks backend startup**; comment it out until configured. Never copy those files into the clean clone. Historical installations without .env can still use database mode while you migrate them deliberately. Files with binary templates and the hashed local-auth database are intentionally not stored inside .env.

## Production

Install frontend and backend as Windows Scheduled Tasks:

~~~powershell
.\scripts\install-backend-task.ps1  -RepoRoot C:\Signaturee-clean -EnvFile C:\Signaturee-clean\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee-clean -EnvFile C:\Signaturee-clean\.env -StartNow
~~~

Recommended production access:

~~~text
Browser
  |
  v
HTTPS reverse proxy / DNS
  +-- /       -> frontend :3000
  +-- /api/*  -> backend  :3001
~~~

With that reverse-proxy layout, explicitly list the public Signaturee origin in `CORS_ORIGINS`. Automatic same-origin acceptance only covers the backend's exact HTTP origin (same scheme, host and port).

If the backend Scheduled Task runs as `SYSTEM`, remote SMB access normally uses the computer account:

~~~text
DOMAIN\SIGNATUREE-SERVER$
~~~

Grant that identity the required **Share + NTFS** permissions on the dedicated production signature target.

## Services

Production uses two Windows Scheduled Tasks (default names: Signaturee-Backend-Runner and Signaturee-Frontend-Runner). Install them from an **elevated PowerShell**:

~~~powershell
cd C:\Signaturee-clean
.\scripts\install-backend-task.ps1 -RepoRoot C:\Signaturee-clean -EnvFile C:\Signaturee-clean\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee-clean -EnvFile C:\Signaturee-clean\.env -StartNow

Get-ScheduledTask -TaskName Signaturee-Backend-Runner,Signaturee-Frontend-Runner |
    Select-Object TaskName,State

# Maintenance
.\scripts\stop-runner-tasks.ps1
.\scripts\start-runner-tasks.ps1
~~~

Avoid running npm start at the same time as these Scheduled Tasks. The tasks use the specified .env and reject a missing file instead of silently starting with defaults.

### Reload .env (during migration)

After saving `C:\Signaturee-clean\.env`, run elevated PowerShell:

~~~powershell
cd C:\Signaturee-clean
.\scripts\reload-config.ps1

# Optional during migration: automatically apply each valid .env save.
# Keep the elevated PowerShell window open; Ctrl+C stops watching.
.\scripts\reload-config.ps1 -Watch
~~~

This reload does not pull Git, reinstall dependencies or change `.env`. It validates the configuration before stopping tasks, restarts both Windows Tasks even if Task Scheduler reports `Ready`, and verifies actual Node listeners and ownership. It does not terminate unrelated processes; when old installations still own a port it stops with an error.

Configuration changes require a process restart; scheduled tasks need not be reinstalled for every `.env` edit. `-Watch` checks the .env file every three seconds, validates it and safely restarts both tasks after a change. Invalid edits are rejected; fix the file and save again. The watcher runs only in your foreground PowerShell session, not as an additional Windows service.

## Update

After the first clean installation, updates are a single command in **elevated PowerShell**:

~~~powershell
cd C:\Signaturee-clean
.\scripts\update-signaturee.ps1
~~~

The updater stops both tasks, waits for the old listener processes to release their ports, fast-forwards the currently selected Git branch, runs npm ci --omit=dev, restarts both tasks and checks the ports. It refuses tracked local changes instead of overwriting them. It will not migrate databases or create backups, and cannot automatically roll back a failed upgrade. Keep your ignored .env and templates on a backup volume.

## Migrate

**Recommended when you have several old installations: create ONE completely fresh working tree and leave all existing folders intact.** Do not merge three historical SQLite databases or copy old configuration trees into the new clone.

**1. Inventory and preserve:** Record the old three installation paths and the two existing Scheduled Task configurations. Back up each old installation's config, template directory, SQLite files and any local passwords/secrets to protected storage, and identify which directory contains the latest desired templates. Do not delete the old copies.

~~~powershell
# Run in elevated PowerShell on the Windows host.
Get-ScheduledTask -TaskName Signaturee-Backend-Runner,Signaturee-Frontend-Runner |
    Select-Object TaskName,State,Actions

# Stop old tasks before redirecting them to the new code.
Stop-ScheduledTask -TaskName Signaturee-Backend-Runner
Stop-ScheduledTask -TaskName Signaturee-Frontend-Runner

# Check for leftover listeners. Investigate them before starting a new instance.
Get-NetTCPConnection -State Listen -LocalPort 3000,3001 -ErrorAction SilentlyContinue
~~~

**2. Clone fresh** into a new folder (example path; adjust to your environment):

~~~powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee-clean
cd C:\Signaturee-clean
npm ci --omit=dev
Copy-Item .env.example .env
New-Item -ItemType Directory -Force .\config\templates | Out-Null
~~~

**3. Optional: export settings from each old version without modifying it.** The exporter detects a v2 profile in SQLite, or falls back to a v1 config/config.json. It exports business configuration only, **not credentials**. Compare the three results manually and paste the chosen values into the new .env, replacing the example assignments.

~~~powershell
node .\scripts\export-profile-env.js --root "C:\Signaturee-old-v1" > C:\sig-v1-settings.txt
node .\scripts\export-profile-env.js --root "C:\Signaturee-old-v2" > C:\sig-v2-settings.txt
node .\scripts\export-profile-env.js --root "C:\Signaturee-old-v3" > C:\sig-v3-settings.txt

notepad .env
~~~

The importer is intentionally **not** an automatic overwrite/merge. Check AD groups, directory paths, preview/production paths and variable ordering; fill in AUTH_LDAP_ENABLED, credentials, URL/CORS and other runtime keys yourself. The profile exporter does not export user hashes or secrets.

**4. Import templates and assets:** copy the full contents of the chosen old Templatefiles folder into the new ignored config/templates directory. Images and subdirectories must be preserved. If older versions differ, review files before replacing similarly named assets.

~~~powershell
Copy-Item "C:\Signaturee-old-v3\Templatefiles\*" "C:\Signaturee-clean\config\templates\" -Recurse -Force
~~~

Check that HTML/TXT filenames, resourceFolder names and AD group mapping in .env match the imported files. In env mode the same TEMPLATE_DIR is used for Admin checks, preview and production PowerShell generation.

**5. Validate and create new local accounts** (do NOT copy old auth databases unless a deliberate account-retention migration is needed):

~~~powershell
cd C:\Signaturee-clean
node backend/server.js --check
$secure = Read-Host "New Admin password" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | node .\scripts\manage-auth-users.js add --username admin --password-stdin --role admin }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
~~~

**6. Redirect the Scheduled Tasks to the new folder** (this re-registers tasks with their default names; verify first if your old task names differ). Run in elevated PowerShell, only after confirming ports are free:

~~~powershell
cd C:\Signaturee-clean
.\scripts\install-backend-task.ps1 -RepoRoot C:\Signaturee-clean -EnvFile C:\Signaturee-clean\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee-clean -EnvFile C:\Signaturee-clean\.env -StartNow
~~~

**7. Smoke test:** local login, AD/LDAP login, colliding usernames, Admin profile source = environment (.env), template checks, SMB target test and a single safe test signature. Confirm no local Git changes:

~~~powershell
git status --short
git check-ignore -v .env config\templates
~~~

If any test fails, stop the new tasks, leave all old folders unchanged and restore the old task actions from your inventory. Delete old installations only after you have a verified backup and production sign-off.

## Troubleshooting

- **Wrong values in Admin:** the v2 profile is read-only in env mode. Check the root .env; ensure SIGNATUREE_CONFIG_MODE=env and that explicit environment variables or overlapping SIGNATUREE_PROFILE_JSON keys are not overriding values. Restart backend.
- **LDAP fails:** Under **Administration → Benutzer & Zugriff → LDAP / Active Directory**, first click **Konfiguration anzeigen** (shows which domain, DC, container and UPN suffix the backend actually loaded). Then enter a real AD username/password and click **LDAP-Login testen**; this uses the exact login authenticator but does not create a session or store credentials. Use HTTPS or localhost when transmitting a password. Missing custom role rules are not required for normal LDAP login. If account lookup fails even though the credentials were accepted, try commenting out AUTH_LDAP_CONTAINER and restarting the backend. Local Admin needs AUTH_DB_LOGIN_ENABLED=true.
- **Local preview path doesn't exist:** **Pfad testen** now creates an absent local preview directory and verifies access; it does not create remote production UNC directories. Relative preview paths resolve against the Signaturee repository root.
- **SMB test reports EPERM:** the backend's execution identity has insufficient permissions. For a Scheduled Task running as SYSTEM, check **both Share and NTFS** permissions for the machine account on the file server, including directory creation and ACL modification. Test using an FQDN UNC instead of an IP UNC when Kerberos/NTLM authentication is restricted; don't grant Everyone/Full Control as a workaround.
- **Signatures/templates missing:** check TEMPLATE_DIR and every referenced HTML/TXT resource, including images. A template filename alone is not the file.
- **SMB fails:** verify share and NTFS permissions for the Scheduled Task identity (under SYSTEM this is often DOMAIN\HOST$), and confirm ACL modification rights. Use the Admin production-target check and a test user.
- **Update refuses to pull:** git status --short shows tracked changes; preserve them manually. .env and config/templates are ignored, but tracked files from an old checkout may still be tracked and require deliberate migration.
- **Tasks don't start:** run node backend/server.js --check and Get-ScheduledTask; make sure the task was reinstalled pointing to the new root and selected .env. Check port ownership before restarting.

## Backup

Back up your ignored .env, full config/templates tree, config/signaturee_auth.db, config/signaturee.db, and any other selected runtime paths, plus logs when relevant. Stop both tasks before copying live SQLite databases (or use a SQLite-consistent backup). Protect backups, because .env may include secrets and the databases contain user data. The app's settings-only JSON backup is **not** a full backup. Keep the three originals until the new installation is verified.

## CI / delivery

Every pull request and push to `main` runs the Windows quality gate:

~~~text
Windows runner
  |
  v
Node.js 22 + npm ci --omit=dev
  |
  +-- frontend syntax
  +-- backend config check
  +-- backend unit tests
  +-- PowerShell / Pester
  |
  v
green main
~~~

Run the same checks locally:

~~~powershell
npm run quality-gate
~~~

There is intentionally **no automatic production deployment**. Every installation owns its Windows host, Active Directory environment and file-share permissions.

## Docs

- [Environment & authentication](docs/environment.md)
- [Windows setup / Scheduled Tasks](docs/prepare-machine-dependencies.md)
- [Templates](docs/templates.md)
- [AD onboarding](docs/ad-onboarding.md)
- [Network share permissions](docs/network-share-permissions.md)
- [Reverse proxy / DNS](docs/reverse-proxy.md)
- [API](docs/api.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT — see [LICENSE](LICENSE).
