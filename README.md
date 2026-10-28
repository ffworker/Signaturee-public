# Signaturee v2

[![Windows quality gate](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml) · [License: MIT](LICENSE)

**Outlook signatures from Active Directory — locally hosted, with Admin, IT generation and employee self-service.**

Signaturee v2 runs on Windows as a Node.js API, static web frontend and PowerShell generator. Users and signature groups are read from AD; production signatures can be written to a Windows SMB share.

This README documents **v2 only**. New configurations live in one git-ignored file: **`C:\Signaturee\.env`** (adjust install directory). The Admin UI shows the effective settings; it does **not** maintain a second configuration database for business settings.

## Quickstart

**Prerequisites:** Windows Server or Windows workstation, Node.js 22.13+, Windows PowerShell 5.1, RSAT ActiveDirectory PowerShell module for searching AD users, a domain/network path to your DC, and write access for the chosen output. Outlook/Word may be required for optional RTF conversion.

In an **elevated Windows PowerShell**:

~~~powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee
cd C:\Signaturee
npm ci --omit=dev

Copy-Item .env.example .env
notepad .env
New-Item -ItemType Directory -Force .\config\templates | Out-Null

# Only a syntax/profile check; DOES NOT verify AD, LDAP or SMB credentials.
node .\backend\server.js --check
~~~

Edit `.env` before starting. At minimum replace: `AD_SERVER`, `OU_SEARCH_BASE`, `AUTH_LDAP_DOMAIN`, and `NETWORK_DEPLOYMENT_PATH`; for standard `XY_Template` filenames you can use `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true` instead of writing JSON. Copy your actual `.htm`, `.txt` and associated image/resource folders into `config\templates`; filenames must match the JSON signature definition. `SIGNATUREE_VARIABLES_JSON` is **not required** for normal AD fields.

Create the local Admin account (password is prompted, not passed as a command-line argument):

~~~powershell
$pw = Read-Host "New Signaturee Admin password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) |
        node .\scripts\manage-auth-users.js add --username admin --role admin --password-stdin
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
node .\scripts\manage-auth-users.js list
~~~

Then either run `npm start` temporarily for an interactive smoke test **or** install the production Scheduled Tasks described below. **Never run both at once** on the same ports.

Open `http://127.0.0.1:3000/login.html`. Choose **Lokales Signaturee-Konto** for your Admin login. Do not select AD login for the local Admin.

## Configuration: one .env, five short sections

The committed [`.env.example`](.env.example) is the complete template. Copy it **once**, edit the ignored local `.env`, then use `.\scripts\reload-config.ps1` to apply changes. Do not keep competing `runner.env` or `secrets.env` files.

| Section | Settings | What it does |
| --- | --- | --- |
| Web & login | `BACKEND_PORT`, `FRONTEND_PORT`, `CORS_ORIGINS`, `AUTH_REQUIRED` | Browser/API connectivity and authentication |
| AD user search | `AD_SERVER`, `OU_SEARCH_BASE`, optional `AD_QUERY_USERNAME`/`AD_QUERY_PASSWORD` | Reads users for IT search, preflight and generation |
| Employee LDAP login | `AUTH_LDAP_ENABLED`, `AUTH_LDAP_DOMAIN`; optional `AUTH_LDAP_SERVER`, `AUTH_LDAP_CONTAINER`, `AUTH_LDAP_UPN_SUFFIX` | Validates employees' own AD passwords |
| Paths | `LOCAL_DEPLOYMENT_PATH`, `NETWORK_DEPLOYMENT_PATH`, `TEMPLATE_DIR` | Preview output, SMB production output and template sources |
| Signatures | `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true` (recommended), alternatively `SIGNATUREE_SIGNATURES_JSON` | Discover template pairs and map `XY` to `Signature-XY`, or configure explicit groups |

**Do not confuse these:** `AD_SERVER`/`OU_SEARCH_BASE` are for **Get-ADUser searches**; `AUTH_LDAP_DOMAIN`/`AUTH_LDAP_CONTAINER` are for **employee sign-in**. Working LDAP login does **not** prove Get-ADUser searches work, and vice versa.

### AD user search: Get-ADUser

- `AD_SERVER` should be a resolvable DC hostname such as `dc01.example.local`.
- `OU_SEARCH_BASE` must be an **existing DN**. Start with `DC=example,DC=local` to search the whole domain, and narrow it later. The default AD Users container is usually `CN=Users`, **not** `OU=Users`.
- By default, the backend runs Get-ADUser as the **Windows Scheduled Task identity**. If the task is SYSTEM on a domain-joined server, that generally means the computer account. Most AD environments allow reads without Domain Admin.
- If AD search fails under that identity, configure **both** `AD_QUERY_USERNAME` and `AD_QUERY_PASSWORD` using a dedicated, least-privilege **read-only** AD account. **Do not use Domain Administrator**. These credentials are used for directory searches, **not for employee LDAP login and not for SMB authentication**.
- Install/test the module with `Get-Module -ListAvailable ActiveDirectory`. Admin → **Benutzer & Zugriff → AD-Suche testen** checks the effective settings as the backend identity.

### LDAP employee sign-in

Recommended initial settings:

~~~dotenv
AUTH_DB_LOGIN_ENABLED=true
AUTH_LDAP_ENABLED=true
AUTH_LDAP_DOMAIN=example.local
# AUTH_LDAP_SERVER=dc01.example.local
# AUTH_LDAP_UPN_SUFFIX=example.local
# AUTH_LDAP_CONTAINER=OU=Staff,DC=example,DC=local
~~~

**Leave AUTH_LDAP_CONTAINER commented out initially.** A wrongly restricted container can cause login failures even if the account exists. Add it only after verifying the exact OU in AD. `AUTH_LDAP_UPN_SUFFIX` is optional; only set it to the user's **actual UPN suffix**. Use the Firmenkonto login option to test a genuine AD account; local Admin uses the local-login option.

Admin → **Benutzer & Zugriff → Konfiguration anzeigen** displays loaded LDAP settings, but does **not** contact the domain. The separate **LDAP-Login testen** button performs a real credential check. Use it only from localhost or HTTPS; it does not create a login session or store the test password.

Custom IT-role mapping is optional. No LDAP role rules are required for normal self-service. LDAP does **not** grant local Admin privileges.

### Templates and signature assignment

**Recommended for v2:** If your templates are named `AD_Template.htm` + `AD_Template.txt`,
`FF_Template.htm` + `FF_Template.txt`, etc., enable automatic discovery in your local `.env`:

~~~dotenv
TEMPLATE_DIR=config/templates
SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true
# SIGNATUREE_AUTO_GROUP_PREFIX=Signature-
~~~

Signaturee then scans `config/templates` at backend startup for **complete HTML/TXT pairs**, displays each as a signature in Admin, and maps it to the corresponding AD security group by **CN**:

| Files (both required) | Signature | AD security group |
| --- | --- | --- |
| `AD_Template.htm` + `AD_Template.txt` | AD | `Signature-AD` |
| `FF_Template.htm` + `FF_Template.txt` | FF | `Signature-FF` |
| `HG_Template.htm` + `HG_Template.txt` | HG | `Signature-HG` |

The optional `AD-Dateien`, `FF-Dateien`, etc. resource folders are detected automatically. `example_template.*` is ignored. **This does not create AD groups**: each corresponding group must already exist, and the employee must be a member of it. The relevant AD membership is evaluated independently from LDAP's login-role rules (which only grant IT/self-service privileges).

**When auto-discovery is enabled, `SIGNATUREE_SIGNATURES_JSON` is ignored.** You can comment out the old example JSON. To define groups manually instead, set `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=false` and use the explicit JSON mappings below. Full group DNs are matched exactly; short group names match the AD group CN. Nested group memberships may require separate AD handling, so first validate direct memberships.


Active files belong in the ignored folder `config\templates\`. The committed `Templatefiles\` contains **examples**, not your installed production files. Import/copy whole template folders including assets. The backend and PowerShell generator use the same `TEMPLATE_DIR`.

`SIGNATUREE_SIGNATURES_JSON` has one object per signature type:

~~~dotenv
SIGNATUREE_SIGNATURES_JSON={"sales":{"label":"Sales","adGroups":["CN=Signature-Sales,OU=Groups,DC=example,DC=local"],"templateHtml":"sales.htm","templateTxt":"sales.txt"},"it":{"label":"IT","adGroups":["CN=Signature-IT,OU=Groups,DC=example,DC=local"],"templateHtml":"it.htm","templateTxt":"it.txt"}}
~~~

For every signature, provide its **real AD group DN** and files that exist in `TEMPLATE_DIR`. Keep JSON on one line inside `.env`. The default variables already cover first/last name, email, department, phone, mobile, fax and other common AD attributes. Customize `SIGNATUREE_VARIABLES_JSON` only when necessary.

### Local preview and production SMB

~~~dotenv
LOCAL_DEPLOYMENT_PATH=generatedsignatures
NETWORK_DEPLOYMENT_PATH=\\fileserver.example.local\Signatures
TEMPLATE_DIR=config/templates
~~~

The local `generatedsignatures` directory is created on backend startup or by **Pfad testen** (if the service account has local write access). It is ignored by Git.

The production path must be a **real Windows UNC** (`\\server\share\folder`). Avoid mapped drive letters for Scheduled Tasks. **An AD-query password does not grant access to a file share.** For a backend task running as SYSTEM on a domain-joined server, grant the machine account `DOMAIN\SERVERNAME$` appropriate **share + NTFS** write/create permissions and the ability to modify ACLs on the dedicated signature target. The production target check tests access under the **actual backend identity**. `EPERM` means permissions or network authentication need fixing on the server/share; do not grant Everyone Full Control as a workaround.

The Admin deployment page lets you **draft** local and UNC paths and copy the corresponding `.env` assignments. It does **not** secretly save to a separate profile. Paste the copied lines into `.env`, reload the backend, then test the paths.

## Services

Signaturee runs as **two Windows Scheduled Tasks**, not as Windows Services:

- `Signaturee-Backend-Runner` → Node API, default port **3001**
- `Signaturee-Frontend-Runner` → static web frontend, default port **3000**

Install from **elevated PowerShell** after the configuration check and local Admin creation:

~~~powershell
cd C:\Signaturee
.\scripts\install-backend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
~~~

Task Scheduler showing **Ready** alone is not proof of failure or success: inspect actual listeners/PIDs and the web UI. Both tasks usually run as SYSTEM unless you deliberately change their principals. Prefer HTTPS through a reverse proxy for LAN access, and add its origin to `CORS_ORIGINS`.

### Reload .env (no Git update)

Save `.env`, then from elevated PowerShell:

~~~powershell
cd C:\Signaturee
.\scripts\reload-config.ps1
~~~

The script validates `.env` first, then restarts both tasks and verifies the actual Node listeners from this clone. It does not modify the file or reinstall anything.

During initial setup you can optionally leave a foreground watcher running:

~~~powershell
.\scripts\reload-config.ps1 -Watch
~~~

Each valid saved change triggers a restart. Press Ctrl+C to stop the watcher; it does not stop Signaturee. Disable the watcher after commissioning.

## Update

For normal releases:

~~~powershell
cd C:\Signaturee
.\scripts\update-signaturee.ps1
~~~

The updater checks the Git working tree, stops old Signaturee tasks/processes, runs `git pull --ff-only` and `npm ci --omit=dev`, restarts and verifies both listeners. The local ignored `.env`, `config\templates` and SQLite files are not overwritten. This is **not a rollback or backup tool**. If the old updater is broken, fetch the current scripts once with `git pull --ff-only` and then run the new command.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Login page works, AD users cannot sign in | Admin → LDAP-Login testen. Check `AUTH_LDAP_DOMAIN` and remove incorrect `AUTH_LDAP_CONTAINER`. |
| Local Admin cannot sign in | Choose **Lokales Signaturee-Konto**, check `AUTH_DB_LOGIN_ENABLED=true` and `node scripts/manage-auth-users.js list`. |
| IT user search shows no users / fails | Admin → **AD-Suche testen**. Verify `AD_SERVER`, `OU_SEARCH_BASE`, RSAT ActiveDirectory module, and the backend task identity or optional read-only AD account. LDAP settings alone will not fix Get-ADUser. |
| Generated output directory missing | Check `LOCAL_DEPLOYMENT_PATH` and click **Pfad testen** or restart the backend; the local folder is created automatically when possible. |
| Production path says `EPERM` or access denied | Verify server/share name, **share + NTFS** access for the actual task identity and ACL modification rights. Prefer DNS/FQDN UNC instead of IP when domain auth is involved. |
| Admin path field appears read-only or stale | In env mode it is a draft/copy workflow. Paste new assignments into `.env`, run `reload-config.ps1`, refresh the page. |
| Tasks show Ready, but the site is unavailable | Run `reload-config.ps1` and inspect its process/port diagnostics; check the task's configured repository path. |
| Updating refuses local tracked changes | Preserve tracked changes explicitly; `.env` and `config\templates` are Git-ignored. Do not blindly reset files. |
| Browser cannot reach API | Check ports 3000/3001, firewall, reverse-proxy routing and `CORS_ORIGINS`. |

For command-line verification of the configured AD search base (runs under **your current Windows identity**, not automatically as the task account):

~~~powershell
Import-Module ActiveDirectory
Get-ADUser -Filter * -Server 'dc01.example.local' -SearchBase 'DC=example,DC=local' -ResultSetSize 1
~~~

Do not treat a successful interactive Get-ADUser as proof the backend task has permissions. The **AD-Suche testen** button checks the task's actual context.

## Backup

Protect and back up: `.env` (may contain secrets), `config\templates\` with all images and resources, `config\signaturee_auth.db` (local account hashes), `config\signaturee.db` (runtime state), and any other customized paths. Stop the two tasks or use a consistent SQLite backup method before copying live DB files. Test restore before relying on the backup. Settings-only API JSON export is **not** a full installation backup.

## Development

- Run `npm run test:backend` for Node integration tests.
- Run `npm run quality-gate` on Windows with Pester installed.
- See [environment settings](docs/environment.md) and [Windows SMB permissions](docs/network-share-permissions.md) for more detailed reference.
- Source and issues: [GitHub](https://github.com/ffworker/Signaturee-public).

MIT License.
