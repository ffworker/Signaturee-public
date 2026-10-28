# API reference

Signaturee exposes a Node.js HTTP API. The **web UI is the supported primary entry point** for normal administration, targeted generation and LDAP self-service. The API also retains older routes for compatibility.

Use `AUTH_REQUIRED=true`, HTTPS when accessing the API across a network, and the intended account role. A local Signaturee **Admin** login is required for the administrative endpoints below; an LDAP account is not silently promoted to Admin.

## Authentication and health

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | Basic backend status and instance ID; not a test of AD/SMB/Word |
| POST | `/api/auth/login` | Login; send JSON with `username`, `password` and `source` (`local` or `ldap`) |
| GET | `/api/auth/me` | Current session, role and identity source |
| POST | `/api/auth/logout` | End current session |

For identical local/AD usernames, the login UI lets users choose their source explicitly.

## Configuration, templates and diagnostics (Admin)

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v2/profile` | Effective signature and variable profile; automatic template discovery is reevaluated when read |
| PUT | `/api/v2/profile` | Database-profile compatibility only; **409 in `SIGNATUREE_CONFIG_MODE=env`** |
| GET | `/api/v2/admin/env` | Read editable, allowlisted `.env` settings and revision state (no secrets) |
| PUT | `/api/v2/admin/env` | Validate/write allowlisted settings; revision check and backup; activate separately |
| POST | `/api/v2/signatures/create` | **New-signature wizard:** create a conventional HTML/TXT pair in automatic-discovery mode |
| POST | `/api/v2/templates/import` | General template file upload to the active template directory |
| POST | `/api/v2/targets/check` | Probe configured or temporary local/production path using backend task identity |
| POST | `/api/v2/ad/test` | AD lookup diagnostic |
| POST | `/api/v2/auth/ldap/test` | LDAP configuration or credential diagnostic |
| GET | `/api/v2/auth/users` | List local accounts |
| POST | `/api/v2/auth/users` | Add local account |
| PATCH | `/api/v2/auth/users/:username` | Modify local account |
| DELETE | `/api/v2/auth/users/:username` | Delete local account |

### Create a signature

In `SIGNATUREE_CONFIG_MODE=env` with `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true`, `POST /api/v2/signatures/create` accepts **multipart/form-data**:

- `key`: a technical signature key, e.g. `HR` (1–40 characters; letters, numbers, `_` and `-`).
- `html`: one nonempty `.htm` or `.html` upload (max 1 MiB).
- `txt`: one nonempty `.txt` upload (max 1 MiB).

A successful request returns **201**, with files `HR_Template.htm` and `HR_Template.txt` created under the configured `TEMPLATE_DIR`, and the automatically derived group `Signature-HR` (or your effective prefix). Duplicate keys/files are rejected (409) without overwriting existing templates. The endpoint **does not edit `.env` or create AD groups**; a subsequent profile request discovers the new pair without a backend restart. The group must already exist for employee assignment. An existing template pair may also be installed manually on disk.

This new constrained wizard endpoint is separate from the general `/api/v2/templates/import` route. Do not assume the general import provides the same no-overwrite transaction semantics.

### Test a target

`POST /api/v2/targets/check` accepts JSON with `target` (`preview` or `production`) and optionally `path`. If `path` is supplied, it is only tested—not saved to `.env`. An arbitrary test path is **not auto-created**. The probe uses temporary filesystem operations, cleans up after itself and checks ACL modification for the production target.

### LDAP test

An empty JSON object runs a configuration check; supplying AD credentials triggers an actual login test and does not create a session. **Do not transmit employee passwords over unencrypted remote HTTP.**

## Current AD-first generation (IT/Admin)

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/users/ad` | AD employee lookup |
| POST | `/api/run/preflight` | Resolve identifiers against live AD, group assignments, required attributes and templates |
| POST | `/api/run/preview` | Render one assigned signature in temporary local output |
| POST | `/api/run/generate` | Generate selected employees/signatures into an allowed output target |

The targeted Preflight/Generate workflow accepts a `users` list and an optional `signatureSelection` mapping. It rejects requests with more than **50 distinct identifiers**. These requests **do not accept full CSV records as employee data**; they query AD again. Preview uses temporary rendering and does not write to the selected production target.

## Employee self-service

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/self/bootstrap` | Authenticated user's record and assignable signatures |
| POST | `/api/self/generate` | Generate own assigned signature(s) |
| GET | `/api/self/signature/download` | Download own signature files |

A local Admin/IT role or an eligible LDAP session is required; self-service must not be confused with an endpoint for generating arbitrary other employees' signatures.

## Operations and backup

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/runner/status` | Backend/frontend Windows runner health |
| POST | `/api/runner/control` | Start/stop/restart runner task(s); Admin-only |
| GET | `/api/logs/latest` | Read most recent generator log |
| GET | `/api/logs/download` | Download generator log |
| GET | `/api/storage/backup` | **Settings-oriented backup only**; not an installation backup |

The scoped backend restart request `{"scope":"backend","action":"restart"}` acknowledges **202** when queued. The Admin UI subsequently checks a new backend instance ID rather than treating the queue acknowledgement as completion. Review `Logs/backend-restart.log` for host-side errors.

Back up the actual `.env`, templates/resources, SQLite databases and any configured output/state paths independently.

## Legacy/compatibility routes

The API still contains `/api/generate`, `/api/generate/single`, `/api/users/import`, `/api/users/import-single` and older domain/variable/preset/storage routes. Some of these require the historical `config/config.json`/database configuration or have different semantics from the current AD-first web workflow.

- `/api/users/import` uploads full CSV data for an **older** workflow. It does not change `/api/run/preflight` into an offline-CSV renderer.
- `/api/generate/single` accepts supplied user attributes but reads the historical configuration path.
- `/api/storage/restore` and older business-profile writes return **409** under `SIGNATUREE_CONFIG_MODE=env`.

These routes are **not removed**, but their complete compatibility contract is pending a separate acceptance-test audit. Avoid presenting them as supported replacements for the current UI.

[README](../README.md) · [Data sources](data-sources.md) · [Environment](environment.md) · [Security](../SECURITY.md)
