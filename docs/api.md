# Signaturee v2 — API reference

The web UI is the primary interface. The endpoints below are useful for integrations, health checks and diagnostics. Use authenticated requests, and give diagnostic/administrative calls the required Admin role.

## Health and login

| Method | Route | Description |
| --- | --- | --- |
| GET | `/health` | Backend health |
| POST | `/api/auth/login` | Login (explicit `source: "local"` or `source: "ldap"`) |
| GET | `/api/auth/me` | Session and role |
| POST | `/api/auth/logout` | End session |

Local Admin and LDAP employee accounts are separate providers. To resolve an identical username in both, select the login source explicitly.

## Admin configuration and diagnostics

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/v2/admin/env` | Local Admin-only allowlisted .env draft, revision hash, default/extra variables and restart state; never secrets |
| PUT | `/api/v2/admin/env` | Local Admin-only validated save to .env with backup; expected revision, approved values and merged variables |
| GET | `/api/v2/profile` | Effective v2 profile derived from `.env` and available templates |
| PUT | `/api/v2/profile` | **HTTP 409** in env mode: edit `.env` and reload instead |
| POST | `/api/v2/templates/import` | Upload template files to the active template directory |
| POST | `/api/v2/targets/check` | Probe the configured path or a supplied `path` temporarily (admin-only); never saves to `.env` and does not create trial folders |
| POST | `/api/v2/ad/test` | Admin-only `Get-ADUser` search diagnostic |
| POST | `/api/v2/auth/ldap/test` | Admin-only config or AD credential diagnostic |
| GET | `/api/v2/auth/users` | Local-account list |
| POST | `/api/v2/auth/users` | Create local account |
| PATCH | `/api/v2/auth/users/:username` | Update local account |
| DELETE | `/api/v2/auth/users/:username` | Delete local account |

The LDAP test accepts an empty JSON body for **configuration only**; submitting an AD username/password performs a real credential check and does not create a session. Do not transmit passwords over ordinary remote HTTP.

The **signature catalog** is discovered from `XY_Template` HTML/TXT pairs in `TEMPLATE_DIR` on startup when `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true`. Which ones a user may generate depends on AD security group membership `Signature-XY`, **not** LDAP role rules.

## AD / generation

- `GET /api/users/ad` — search employees.
- `POST /api/run/preflight` — resolve users, group assignments, templates and target constraints.
- `POST /api/run/generate` — generate signatures after validation.

## Employee self-service

- `GET /api/self/bootstrap` — discover the authenticated user's available signatures.
- `POST /api/self/generate` — generate own signature.
- `GET /api/self/signature/download` — download signature package.

## Operations and backup

- `GET /api/runner/status`, `POST /api/runner/control` — Scheduled Task monitoring/control.
- `GET /api/logs/latest`, `GET /api/logs/download` — generation logs.
- `GET /api/storage/backup` — **settings-only** export; not an installation-level backup.

Keep `.env` and full template/resource files in a separate protected backup. The old persisted-business-profile restore/write path is not the configuration mechanism in env mode.

[README](../README.md) · [Environment](environment.md)

The scoped backend `POST /api/runner/control` with `{ "scope": "backend", "action": "restart" }` runs via a separate one-shot Windows Scheduled Task; the response is only a queued acknowledgement. The Admin UI confirms a new backend instance before showing success. See `Logs/backend-restart.log` for host-side errors.
