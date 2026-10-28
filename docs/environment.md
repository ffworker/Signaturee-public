# Environment — single source of truth

Fresh Signaturee v2 installations use ONE ignored project-root .env file and SIGNATUREE_CONFIG_MODE=env. Runtime and business settings come from that file at process start. The Admin UI shows the effective business profile **read-only**; it cannot overwrite it, and changes require a backend restart.

## Setup

~~~powershell
Copy-Item .env.example .env
notepad .env
node backend/server.js --check
~~~

A valid env installation responds with source "environment (.env)" on GET /api/v2/profile. Attempting PUT /api/v2/profile returns HTTP 409.

## Business configuration in .env

| Key | Purpose |
| --- | --- |
| SIGNATUREE_CONFIG_MODE=env | Authoritative business config |
| SIGNATUREE_ORGANIZATION_NAME | Organization name |
| AD_SERVER | Domain controller for directory queries and generator |
| OU_SEARCH_BASE | AD search base |
| LOCAL_DEPLOYMENT_PATH | Preview and self-service output |
| NETWORK_DEPLOYMENT_PATH | Production UNC/SMB target |
| TEMPLATE_DIR | Templates and resources; recommended config/templates (ignored by Git) |
| SIGNATUREE_SIGNATURES_JSON | One-line JSON: signature keys, AD groups, template names and extra attributes |
| SIGNATUREE_VARIABLES_JSON | One-line JSON: variables and ordering; optional built-in defaults |
| SIGNATUREE_SECONDARY_TITLE_ATTRIBUTES | Comma-separated AD attributes |
| SIGNATUREE_PROFILE_JSON | Optional full v2 JSON profile for bulk migrations |
| AUTH_LDAP_ROLE_RULES_JSON | One-line JSON object with a rules array; no extra role rules file required |

Example:

~~~dotenv
SIGNATUREE_SIGNATURES_JSON={"company":{"label":"Company","adGroups":["CN=Signature-Company,OU=Groups,DC=example,DC=local"],"templateHtml":"company.htm","templateTxt":"company.txt","resourceFolder":"company_files"}}
AUTH_LDAP_ROLE_RULES_JSON={"rules":[{"groupDn":"CN=Signaturee-IT,OU=Groups,DC=example,DC=local","role":"it"}]}
~~~

JSON values must be one line without trailing comments. See the full [.env.example](../.env.example).

## Runtime and login settings

The same .env file also holds BACKEND_HOST/PORT, FRONTEND_HOST/PORT, CORS_ORIGINS, AUTH_REQUIRED, AUTH_DB_LOGIN_ENABLED, AUTH_LDAP_ENABLED, AUTH_LDAP_DOMAIN/SERVER, AUTH_DB_PATH, DB_PATH and optional RUNNER_* values. Keep AUTH_REQUIRED=true for network-facing installations. Set AUTH_DB_LOGIN_ENABLED=true and AUTH_LDAP_ENABLED=true for simultaneous local and AD login.

### Precedence and compatibility

A parent-process environment variable overrides the file. Otherwise an existing root .env wins over legacy config/runner.env; SIGNATUREE_ENV_FILE selects a particular env file. Windows Scheduled Tasks import their selected UTF-8 file and reject missing files. Do not maintain two different environment files concurrently.

When SIGNATUREE_PROFILE_JSON is provided, individually specified fields above override its corresponding fields. Remove overlapping example entries or edit them to match. A fresh installation does not read an old profile_v2 from SQLite. Previous installs without root .env continue in database mode until deliberately migrated.

### What cannot live in .env

Templates/images are binary files in TEMPLATE_DIR. Local Admin/IT password hashes are account records in AUTH_DB_PATH. DB_PATH still contains ancillary application and legacy data, but the old stored profile is ignored in env mode. Generated signatures and logs are output artifacts.

The legacy write endpoints for domain, variable and restored configuration are blocked in env mode. Template imports and local-user account management remain available.

## Starting services

All Node entrypoints use the same env loader: npm start, npm run start:backend, npm run start:frontend, npm run auth:users and node backend/server.js --check.

~~~powershell
.\scripts\install-backend-task.ps1  -RepoRoot C:\Signaturee-clean -EnvFile C:\Signaturee-clean\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee-clean -EnvFile C:\Signaturee-clean\.env -StartNow
~~~

For a new install do NOT copy config/secrets.env or config/runner.env. See [Migrate](../README.md#migrate) and [Network permissions](network-share-permissions.md).
