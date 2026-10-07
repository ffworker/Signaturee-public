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

## Quick start

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

# Optional fallback to local accounts. LDAP defaults to self-service.
AUTH_LDAP_FALLBACK_TO_DB=true

# Optional role rules; copy config/example/ldap-role-rules.example.json first.
AUTH_LDAP_ROLE_RULES_PATH=config/ldap-role-rules.json
~~~

Rules can match an AD attribute (for example `department`, `sn` or `extensionAttribute5`) or an exact, direct `memberOf` group DN. Multiple rules are allowed; a match currently grants `it`, otherwise the user stays `selfservice`. LDAP can never grant `admin`; full Admin accounts are local. Invalid rule files stop backend startup rather than silently granting a role. `AUTH_LDAP_ROLE_MAP` remains compatible for canonical `username:it` entries only; `admin` entries and `AUTH_LDAP_DEFAULT_ROLE` no longer grant elevated LDAP access. AD identity and role data require a successful post-bind directory lookup.

You do **not** have to set both `AUTH_LDAP_DOMAIN` and `AUTH_LDAP_SERVER`; Signaturee can use the Windows machine's domain context when appropriate. An explicit server/domain is recommended when you want predictable production behavior.

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
