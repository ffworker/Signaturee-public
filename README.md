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
  +-- v2 profile + SQLite storage
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
| `Templatefiles/` | Example / managed signature template assets |
| `config/example/` | Safe configuration examples only |
| `scripts/` | startup, account management, Scheduled Task install and quality-gate helpers |
| `tests/` | PowerShell/Pester tests |
| `docs/` | focused deployment and administration documentation |

## Quickstart

**Requirements:** Windows, Node.js 22.13+, Windows PowerShell 5.1+, RSAT / ActiveDirectory module. Microsoft Word is optional and only needed for RTF generation.

~~~powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee
cd C:\Signaturee

npm ci --omit=dev
Copy-Item config\example\runner.example.env config\runner.env

notepad config\runner.env

$secure = Read-Host "Choose an Admin password" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | npm run auth:users -- add --username admin --password-stdin --role admin }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
npm start
~~~

Open **http://localhost:3000/**.

`npm start` loads `config\runner.env` automatically and starts frontend + backend.

`--password-stdin` avoids placing the password in command-line arguments and shell history. The prompt requires at least eight characters.

## Configuration: what actually needs changing?

For a normal v2 installation, **`config/runner.env` is the only env file you need to create**. You do not need a project-root `.env`.

Start from:

~~~powershell
Copy-Item config\example\runner.example.env config\runner.env
~~~

The file is git-ignored and should remain local to the installation.

### Runtime settings

| Setting | Example / default | What to do |
| --- | --- | --- |
| `BACKEND_HOST` | `0.0.0.0` | **Usually keep.** Allows the service to listen on the host interfaces. |
| `BACKEND_PORT` | `3001` | **Usually keep.** Change only if the port conflicts with another service. |
| `BACKEND_BASE_PATH` | `/` | **Keep** unless you deliberately host the API below another base path. |
| `CORS_ORIGINS` | localhost frontend URLs | **Review for non-local access.** Add the exact browser origin, for example `https://signature.example.com`, for a reverse proxy or separate frontend. Avoid `*` for normal production use. |
| `AUTH_REQUIRED` | `true` by default | **Keep `true`.** Authentication remains on if the env file is missing or the value is unrecognized; only an explicit false value disables it. |
| `AUTH_DB_LOGIN_ENABLED` | `true` | **Recommended.** Keeps local Admin/IT accounts available. |
| `AUTH_DB_PATH` | `config/signaturee_auth.db` | **Usually keep.** Change only if you intentionally relocate runtime data. |
| `DB_PATH` | `config/signaturee.db` | **Usually keep.** Main v2 configuration/storage database. |
| `FRONTEND_HOST` | `0.0.0.0` when unset | Optional override. Normally no need to add it. |
| `FRONTEND_PORT` | `3000` when unset | Optional override. Normally no need to add it. |

### LDAP / AD employee login

LDAP login is **optional**. Leave it disabled if only local Admin/IT accounts are required.

To enable employee self-service, add/uncomment the LDAP settings in `config/runner.env`:

~~~dotenv
AUTH_LDAP_ENABLED=true

# Set the domain and/or an explicit domain controller for your environment.
AUTH_LDAP_DOMAIN=contoso.local
AUTH_LDAP_SERVER=dc01.contoso.local

# Optional restrictions / identity formatting.
AUTH_LDAP_CONTAINER=OU=Users,DC=contoso,DC=local
AUTH_LDAP_UPN_SUFFIX=contoso.local

# Local and LDAP accounts coexist. Select the provider in the browser login form.
# Legacy API clients without a source keep the original local-first behavior.

# Optional role rules; copy config/example/ldap-role-rules.example.json first.
AUTH_LDAP_ROLE_RULES_PATH=config/ldap-role-rules.json
~~~

Rules can match an AD attribute (for example `department`, `sn` or `extensionAttribute5`) or an exact, direct `memberOf` group DN. Multiple rules are allowed; a match currently grants `it`, otherwise the user stays `selfservice`. LDAP can never grant `admin`; full Admin accounts are local. Invalid rule files stop backend startup rather than silently granting a role. `AUTH_LDAP_ROLE_MAP` remains compatible for canonical `username:it` entries only; `admin` entries and `AUTH_LDAP_DEFAULT_ROLE` no longer grant elevated LDAP access. AD identity and role data require a successful post-bind directory lookup.

You do **not** have to set both `AUTH_LDAP_DOMAIN` and `AUTH_LDAP_SERVER`; Signaturee can use the Windows machine's domain context when appropriate. An explicit server/domain is recommended when you want predictable production behavior.

**LDAP and local login at the same time:** set `AUTH_DB_LOGIN_ENABLED=true` and `AUTH_LDAP_ENABLED=true`. On the login page select **Firmenkonto (Active Directory)** or **Lokales Signaturee-Konto**. This is important if the same username exists in both providers: local passwords cannot sign in to LDAP, and LDAP passwords do not authenticate local Admin accounts. API consumers can send `source: "ldap"` or `source: "local"` to `POST /api/auth/login`; clients without `source` keep the legacy local-first behavior. `AUTH_LDAP_FALLBACK_TO_DB` is a legacy setting and is **not** a substitute for selecting the provider.

### Settings you should normally leave alone

The following values only need changing for non-standard deployments:

- `RUNNER_BACKEND_TASK_NAME`, `RUNNER_FRONTEND_TASK_NAME`, `RUNNER_FRONTEND_STATUS_URL` — only when you use different Scheduled Task names or status endpoints.
- `RUNNER_STATUS_TIMEOUT_MS` — only when health checks need a different timeout.
- `frontend/runtime-config.js` — only when the browser cannot discover/reach the backend through the normal same-origin setup. For a reverse proxy with `/api/*` routed to the backend, do not create it.
- `config/example/config.example.json` — **legacy/direct PowerShell example only.** Normal v2 installations should not use this as their main configuration.

### Business configuration is not an env-file job

After first login, finish the installation in **Administration**. That UI is the source of truth for:

- organization name
- AD server and search base
- local preview path
- productive UNC / SMB path
- signature definitions
- AD group → signature mappings
- HTML / TXT templates and resources
- variables, placeholders and required AD fields
- local Admin / IT users
- deployment-path checks and system status

In other words: **runtime/service behavior lives in `runner.env`; signature/business behavior lives in the Admin UI.**

## Production

Install frontend and backend as Windows Scheduled Tasks:

~~~powershell
.\scripts\install-backend-task.ps1  -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\config\runner.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\config\runner.env -StartNow
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

## Services (Windows Scheduled Tasks)

For production, Signaturee runs as **two Windows Scheduled Tasks**, not as a single Windows Service:

- `Signaturee-Backend-Runner` (Node API, normally port 3001)
- `Signaturee-Frontend-Runner` (static UI, normally port 3000)

Run the following **in an elevated PowerShell** from the repository directory:

~~~powershell
cd C:\Signaturee
# Current state
Get-ScheduledTask -TaskName Signaturee-Backend-Runner,Signaturee-Frontend-Runner |
    Select-Object TaskName,State

# Stop both
.\scripts\stop-runner-tasks.ps1

# Start both
.\scripts\start-runner-tasks.ps1
~~~

If you configured custom task names, pass `-BackendTaskName` and `-FrontendTaskName` to the scripts. Do not simultaneously run `npm start` and the Scheduled Tasks (port and SQLite conflicts). The Admin **System** view provides service/task status.

## Update

**Existing production installation — recommended command after the updater is already present:**

~~~powershell
# Run PowerShell as Administrator, from the installed repository.
cd C:\Signaturee
.\scripts\update-signaturee.ps1
~~~

The script stops both tasks, waits for TCP ports 3000/3001 (or the configured ports) to become free, runs `git pull --ff-only` for the **currently checked-out branch**, executes `npm ci --omit=dev`, restarts both tasks and checks their state/listening ports. It refuses a dirty tracked working tree, does not switch branches, and never overwrites ignored `.env`, SQLite DBs or templates intentionally. **It is not a backup or a rollback script.** On failure it does not silently restart the old processes; inspect the error and task state.

**One-time upgrade from an older checkout without `scripts/update-signaturee.ps1`:**

~~~powershell
# Run elevated; make a configuration/template backup before upgrading.
cd C:\Signaturee
git status --short
.\scripts\stop-runner-tasks.ps1

# Confirm old services are gone before changing code.
Get-ScheduledTask -TaskName Signaturee-Backend-Runner,Signaturee-Frontend-Runner |
    Select-Object TaskName,State
Get-NetTCPConnection -State Listen -LocalPort 3000,3001 -ErrorAction SilentlyContinue

# Continue ONLY if both tasks are stopped and ports are free.
git pull --ff-only
npm ci --omit=dev
.\scripts\start-runner-tasks.ps1
~~~

If Git reports modified tracked files (particularly `config/variables.json`), preserve your local changes **before** pulling; never reset them blindly. Adjust the install directory, task names and port numbers if your installation differs from the defaults.

**Smoke test after updating:** use a local Admin account and an AD account from the login-method selector, check **Administration → Ausgabe & Deployment → Netzwerkpfad testen**, run Preflight against a dedicated test AD user, then (only if safe) test one production signature. The Network preflight checks write and ACL access to the share; the backend must execute under the Windows identity authorized on the file server.

## Troubleshooting

- **Login fails:** confirm both `AUTH_DB_LOGIN_ENABLED=true` and `AUTH_LDAP_ENABLED=true` when both providers are needed; choose the right login method. Check the actual `config/runner.env` used by the task. A local username also present in AD requires explicit provider selection.
- **Backend/frontend is unreachable:** check `Get-ScheduledTask` and `Get-NetTCPConnection`, the configured ports, and the reverse-proxy `/api/*` and `/health` routes. A separately launched `npm run start:backend` does **not** automatically load `runner.env`; prefer the installed tasks for production diagnostics.
- **SMB fails:** test the production UNC path in the Admin UI and verify both SMB share permissions and NTFS ACL/WRITE_DAC rights for the identity running the backend (often the computer account `DOMAIN\SERVER$` when running as SYSTEM). Do not rely on access from your interactive Windows user.
- **Partial generation / missing signatures:** inspect the API error and `Logs/`. The generator now returns failure for unsuccessful user generation or ACL/resource errors instead of reporting an overall success.

More detail: [Windows setup](docs/prepare-machine-dependencies.md), [Network share permissions](docs/network-share-permissions.md) and [Reverse proxy](docs/reverse-proxy.md).

## Backup

**Before upgrading or migrating**, stop both Scheduled Tasks and create a consistent offline backup of the local installation. Preserve at least `config/runner.env`, `config/signaturee.db`, `config/signaturee_auth.db`, `Templatefiles/` (including images), plus any active `config/secrets.env`, `config/config.json`, `config/variables.json`, `config/presets/`, `config/ldap-role-rules.json`, `Templatefiles_test/` and `frontend/runtime-config.js`.

The built-in `GET /api/storage/backup` exports **application settings**, not credentials, template/image files or the full installation. Do not use it alone as a disaster-recovery backup. Keep backup archives protected because they may contain credentials and personal data. A dedicated backup/restore tool and verified migration procedure are planned after the LDAP and SMB smoke tests.

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
