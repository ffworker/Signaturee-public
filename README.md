# Signaturee v2

[![Windows quality gate](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml) · [MIT License](LICENSE)

**Generate and deliver Outlook signatures using Active Directory group membership.**

Signaturee is a Windows-hosted application with a Node.js API, a web frontend and a PowerShell signature generator. IT can find employees, preview their signatures, run preflight checks and deploy to a Windows file share. Employees can use their own AD credentials for self-service.

**One configuration file: `.env`. One active template directory: `config/templates/`.** Signaturee v2 discovers conventional templates and assigns them according to existing `Signature-XY` AD security groups.

## Quickstart

**Requirements:** Windows Server or Windows, Node.js 22.13+, Git, Windows PowerShell 5.1 and the RSAT **ActiveDirectory** PowerShell module. The host needs connectivity to your AD domain controller. A production UNC target additionally needs Windows file-server permissions.

Open **PowerShell as Administrator**:

~~~powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee
cd C:\Signaturee
npm ci --omit=dev

Copy-Item .env.example .env
New-Item -ItemType Directory -Force .\config\templates | Out-Null
notepad .env
~~~

Edit the example settings for **your** domain, DC, user search base, production UNC and CORS origin. Keep these lines for the standard template/group convention:

~~~dotenv
SIGNATUREE_CONFIG_MODE=env
TEMPLATE_DIR=config/templates
SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true
~~~

Copy the full contents of your signature template directory (including image/resource subfolders) to `C:\Signaturee\config\templates\`. Use file pairs such as `AD_Template.htm` and `AD_Template.txt`.

Check the configuration before starting anything:

~~~powershell
node .\backend\server.js --check
~~~

This checks the configuration and template definitions, **not** live AD login, AD query permissions or SMB access.

Create a local Administrator account; its password is prompted and is not part of `.env`:

~~~powershell
$pw = Read-Host "Signaturee Admin password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) |
        node .\scripts\manage-auth-users.js add --username admin --role admin --password-stdin
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
node .\scripts\manage-auth-users.js list
~~~

Install and start both Windows Scheduled Tasks:

~~~powershell
.\scripts\install-backend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
~~~

Open [http://127.0.0.1:3000/login.html](http://127.0.0.1:3000/login.html) locally and select **Lokales Signaturee-Konto** for the Admin account. For another host, configure the origin and preferably an HTTPS reverse proxy.

## Add signatures from Admin

In the default automatic template-discovery mode, open **Administration → Signaturen → + Signatur**. Provide a technical key (e.g. `HR`), one HTML file (`.htm`/`.html`) and one `.txt` file. The built-in help shows example placeholders such as `$givenname`, `$sn` and `$mail`.

Signaturee creates **`HR_Template.htm` + `HR_Template.txt`** in the active `TEMPLATE_DIR`, detects the pair on the next profile request, and assigns it to the *existing* group `Signature-HR` (or the configured prefix). It does not edit `.env`, create groups, overwrite templates or require a restart just to refresh the catalog. Uploaded source files retain their original bytes.

The AD group-prefix setting is intentionally an **advanced** action, under **Erweiterte Gruppenzuordnung → Bearbeiten**. Changing it affects all convention-based signature assignments and requires the normal save/activate flow.

The current Classic Outlook generator requires HTML and TXT sources and creates RTF output during productive generation. For future HTML-only clients and non-Outlook delivery, see [Product direction](docs/product-direction.md). Never assume that local classic Outlook signature files install into new Outlook.

## How signatures are assigned

Signaturee scans `TEMPLATE_DIR` **on backend startup** when `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true`.

| Files in `config/templates/` | Signature shown in Admin | Required AD group (CN) |
| --- | --- | --- |
| `AD_Template.htm` + `AD_Template.txt` | `AD` | `Signature-AD` |
| `FF_Template.htm` + `FF_Template.txt` | `FF` | `Signature-FF` |
| `HG_Template.htm` + `HG_Template.txt` | `HG` | `Signature-HG` |
| `KS_Template.htm` + `KS_Template.txt` | `KS` | `Signature-KS` |
| `LS_Template.htm` + `LS_Template.txt` | `LS` | `Signature-LS` |

`.html` also works in place of `.htm`. File extension matching is case-insensitive. Optional matching folders, for example `AD-Dateien/` or `LS-Dateien/`, are picked up as resource folders. The supplied `example_template.*` files are ignored by auto-discovery.

**Both HTML and TXT must exist for each signature.** An incomplete pair fails configuration validation rather than hiding a signature. To activate newly added or renamed templates, reload the backend (see [Services](#services)).

The matching AD **security group must already exist** and the employee must belong to it. Signaturee does **not** create AD groups or change group memberships. The standard automatic rule matches the **group CN**; for example, a direct membership in `CN=Signature-LS,OU=Groups,DC=example,DC=local` permits the `LS` signature. Test direct memberships first; nested memberships are not automatically expanded in every path.

The group prefix is configurable:

~~~dotenv
SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true
# SIGNATUREE_AUTO_GROUP_PREFIX=Signatur-
~~~

Use `SIGNATUREE_AUTO_GROUP_PREFIX=Signatur-` only if **your actual groups** use `Signatur-XY` instead of `Signature-XY`.

**Custom mapping (optional):** set `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=false` and define each signature in the one-line `SIGNATUREE_SIGNATURES_JSON`. Full group DNs match exactly; short group names match the CN. With automatic discovery **enabled**, the JSON mapping is ignored.

See [Template reference](docs/templates.md) for filenames, placeholders, resource folders and manual mappings.

## Configuration: one `.env`

The project-root `.env` is the authoritative source for v2 configuration. It is Git-ignored. The supplied [`.env.example`](.env.example) is organized into five short groups:

| Section | Primary settings | Purpose |
| --- | --- | --- |
| Web & authentication | `BACKEND_PORT`, `FRONTEND_PORT`, `CORS_ORIGINS`, `AUTH_REQUIRED` | Site, API and local login |
| AD search | `AD_SERVER`, `OU_SEARCH_BASE`, optional `AD_QUERY_USERNAME`/`AD_QUERY_PASSWORD` | Find employees with `Get-ADUser` |
| LDAP login | `AUTH_LDAP_ENABLED`, `AUTH_LDAP_DOMAIN`, optionally `AUTH_LDAP_SERVER`, `AUTH_LDAP_CONTAINER` | Validate each employee's AD credentials |
| Targets & templates | `LOCAL_DEPLOYMENT_PATH`, `NETWORK_DEPLOYMENT_PATH`, `TEMPLATE_DIR` | Preview, SMB output and source files |
| Signatures | `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true` | Map `XY_Template` to `Signature-XY` |

**Do not mix up these independent functions:**

- **LDAP authentication** decides *who is signing in*. LDAP role rules are **optional**. Employees are Self-Service by default; additional LDAP rules may grant IT privileges. **LDAP roles do not assign signatures.** Full Admin privileges require a local account.
- **AD user queries** supply employee data and direct group membership for search, preflight and generation. `OU_SEARCH_BASE` must be an actual distinguished name; starting with `DC=example,DC=local` is often easier than selecting a narrow OU.
- **SMB output** uses the Windows account running the backend Scheduled Task, **not** an LDAP login or optional AD-query password. A task running as SYSTEM normally accesses a domain SMB share as the machine account `DOMAIN\SERVER$`.

For initial LDAP testing, leave `AUTH_LDAP_CONTAINER` commented out until you have confirmed the correct OU. An AD `Users` container is commonly `CN=Users`, not `OU=Users`. No Domain Administrator account is required for Signaturee user searches; if your task identity cannot query AD, use an appropriate least-privilege AD read account.

The Admin interface edits approved business settings directly in the single `.env`, with validation and backup. All other settings remain file-managed; no second business configuration database is created.

See the [Environment reference](docs/environment.md) for every setting and its scope.

### Night Sky interface: modern panels and preview status

The same `frontend/ui-polish.css` finishing layer applies across Admin,
Generate, Login and Self-Service, after the shared light/dark theme. It keeps
the Night Sky color system but reduces nested box outlines, standardizes
interactive surfaces and shows readable, semantically colored Preflight
(success/warning/error) and Preview loading/completion states. Status details
remain accessible through the existing expandable panels.

The rendered HTML signature **intentionally stays on a white canvas inside a
labeled app frame**: this is separate from the UI theme and preserves its
Outlook-style colors. Neither the preview's Shadow DOM nor the backend
generation logic is changed by this styling update.

### Compact administration workspace

The Admin interface keeps a small **Template status** strip at the top of every section, showing all discovered signatures and missing files at a glance. Hover/focus on a signature to inspect its files, or select it and open **Details** for a complete, keyboard-accessible list.

Signatures and variables appear as compact rows by default; select **Zuordnung & Dateien** or **Bearbeiten** to edit. LDAP settings, role explanations and Windows Task details are collapsed until needed. **Onboarding / Check-Liste** is deliberately expanded by default: every required AD field, signature-group assignment and step-by-step check is visible without hovering or clicking. The Save/Activate bar appears only for unsaved or not-yet-activated changes. These are display changes only: existing configuration sources, permissions and signature generation remain unchanged.

## Manage configuration in the Admin UI

Sign in with a **local Admin** account and open **Administration**. In v2 env mode, approved business settings can be edited directly and saved back to the **existing project-root .env**:

- Organization, AD server/search base, LDAP domain/server/container/UPN suffix.
- Local preview and productive UNC output paths.
- The automatic `Signature-XY` group prefix.
- Existing standard variable mappings plus extra AD attributes and template placeholders.

The Admin editor **does not edit passwords, tokens, ports, Windows task identities, authentication policy or the full manual signature JSON**. These remain under file/deployment control.

Click **Konfiguration speichern** to validate the candidate, confirm the .env has not changed since it was opened, and save an atomic replacement with a `.env.bak-...` backup beside it. Click **Gespeicherte .env aktivieren** to initiate a controlled backend restart. The UI verifies that the restarted backend actually loaded the new file; if it cannot restart, run `.\scripts\reload-config.ps1` from elevated PowerShell. A saved file is not an active configuration until restart.

Under **Variablen**, built-in fields cannot be deleted, but their AD source/placeholder mapping can be adjusted. Added variables such as `$standort` → `extensionAttribute10` are saved as `SIGNATUREE_VARIABLES_EXTRA_JSON` **without replacing the standard schema**. `SIGNATUREE_VARIABLES_JSON` is a full replacement and must be removed manually before using the Admin variable editor.

The Windows backend task identity must have permission to replace the project-root .env and create protected backups; it should not be given broad write access to unrelated files. Local admin sessions should use HTTPS, or localhost while setting up.

## Services

Signaturee runs as **two Windows Scheduled Tasks**, rather than Windows Services:

| Task | Purpose | Default port |
| --- | --- | --- |
| `Signaturee-Backend-Runner` | API, AD searches, generator | 3001 |
| `Signaturee-Frontend-Runner` | Static web UI | 3000 |

### Reload configuration

Save `.env`, then execute in **elevated PowerShell**:

~~~powershell
cd C:\Signaturee
.\scripts\reload-config.ps1
~~~

This validates the configuration, stops the runners from the chosen installation, starts them again and checks their actual listening processes. **No Git pull or task reinstallation is needed** to apply an env change.

For a temporary interactive development session, you can use:

~~~powershell
.\scripts\reload-config.ps1 -Watch
~~~

It monitors the local `.env` and reloads valid saves. Stop watching with **Ctrl+C**; do not leave the watcher running as a normal production service. Never run `npm start` simultaneously with the Scheduled Tasks on the same ports.

### Update application code

~~~powershell
cd C:\Signaturee
.\scripts\update-signaturee.ps1
~~~

The updater stops the runners, performs `git pull --ff-only` and `npm ci --omit=dev`, and verifies both newly started applications. It preserves the ignored `.env`, `config/templates/` and local SQLite databases. Check backups before updating: this script does **not** provide rollback.

Task Scheduler may show `Ready` after a task exits. The useful indicators are the task exit result, the actual Node processes, open ports and application response—not the status label alone.

## Admin interface

The Admin, login and generation pages share a high-contrast **Night Sky** dark appearance by default (navy panels, blue interactive controls, readable checked/disabled states and an equally dark generator progress strip). Use the **☀ Hell / ☾ Dunkel** switch in the header to toggle the light theme. Your preference is saved locally in the browser.

### Testing a path without saving it

Under **Administration → Ausgabe**, type a local preview directory or a production UNC target and click **Testen**. This performs an authenticated one-time directory/write/ACL check using the actual backend identity **without changing .env**. A temporary path that does not exist will **not** be created by the test. If you want to use the working path permanently, click **Konfiguration speichern** and then activate it.

### Backend restart from Admin

Under **System → Backend neu starten**, Signaturee registers and starts a separate one-shot Windows Scheduled Task to restart the backend, avoiding termination of the restart helper when the main task stops. The UI only reports success once a *new backend process instance* answers. The Admin save bar's **Gespeicherte .env aktivieren** uses the same verified mechanism. If Windows denies task registration, check the error and restart manually using `scripts/reload-config.ps1`. The separate helper writes status/errors to `Logs/backend-restart.log`.

## Validate the installation

Start from **Administration** after local Admin login:

1. **Signaturen:** confirm all discovered types (AD, FF, HG, etc.) appear. If only an example is visible, check `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true`, `TEMPLATE_DIR` and whether you reloaded.
2. **Benutzer & Zugriff → AD-Suche testen:** confirm `Get-ADUser` can find employees with the actual backend identity and configured search base.
3. **Benutzer & Zugriff → LDAP-Login testen:** confirm a normal employee can authenticate with their own AD credentials. The configuration-only check does **not** verify login.
4. **Ausgabe & Deployment:** test the local preview and productive SMB paths under the backend service identity.
5. **Generieren:** select a test employee who belongs directly to `Signature-XY`, run preflight, then preview before a controlled production run.

A correct template catalog is **not proof** that AD lookup, group membership or SMB output is working. Those checks are intentionally separate.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Only `example` appears | Enable `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true`; check `TEMPLATE_DIR=config/templates`, complete template pairs and restart |
| A signature is visible but not assigned | Check the employee's actual `memberOf` groups, the `Signature-XY` CN, the configured prefix and the AD search response |
| LDAP login fails | Try **LDAP-Login testen** and check `AUTH_LDAP_DOMAIN`, DC and an overly restrictive `AUTH_LDAP_CONTAINER` |
| AD user search fails | Run **AD-Suche testen**; check `AD_SERVER`, `OU_SEARCH_BASE`, RSAT module and Windows task/query-account permissions |
| Local Admin login fails | Choose **Lokales Signaturee-Konto**; check `AUTH_DB_LOGIN_ENABLED` and `node scripts/manage-auth-users.js list` |
| Local preview directory missing | Verify `LOCAL_DEPLOYMENT_PATH` and local write rights; start/reload backend or click **Pfad testen** |
| SMB returns `EPERM` | Check both share and NTFS permissions, including the backend identity's ability to set folder ACLs; prefer DNS/FQDN UNC paths |
| Admin save fails | Check local Admin privileges, .env file access, revision conflict and the validation error; secrets and runtime ports cannot be edited through the UI |
| Scheduled Tasks show `Ready` but site is down | Run `reload-config.ps1` and inspect its port/process errors; verify the registered installation and env-file paths |

For detailed diagnostics and permission examples see [AD onboarding](docs/ad-onboarding.md), [SMB permissions](docs/network-share-permissions.md) and [Reverse proxy](docs/reverse-proxy.md).

## Backup

Back up the **complete** local `.env` (contains configuration and possibly secrets), `config/templates/` (HTML/TXT and resources), `config/signaturee_auth.db` (local account password hashes), `config/signaturee.db` (runtime state) and any explicitly configured other paths. Stop the runners or use a consistent SQLite backup method when saving live databases.

Keep backups access-controlled and test recovery. The settings-only API backup is **not** a full installation backup.

## Development and reference

- `npm run test:backend` — Node tests.
- `npm run quality-gate` — complete Windows/Pester quality gate.
- [Environment](docs/environment.md) · [Templates](docs/templates.md) · [AD onboarding](docs/ad-onboarding.md) · [API](docs/api.md) · [Windows setup](docs/prepare-machine-dependencies.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

MIT License.
