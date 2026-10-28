# Configuration reference — Signaturee v2

The project-root `.env` is the **only source for v2 runtime and business settings** (`SIGNATUREE_CONFIG_MODE=env`). Copy [`.env.example`](../.env.example) to `.env` once, then edit the ignored local file. The Admin UI displays the effective settings; it does not maintain a second writable business profile.

Apply changes with `.\scripts\reload-config.ps1` from elevated PowerShell. During initial setup, `.\scripts\reload-config.ps1 -Watch` can monitor and reload valid saves.

## Configuration keys

| Setting | Function |
| --- | --- |
| `BACKEND_HOST` / `BACKEND_PORT` | Node API listener, default port 3001 |
| `FRONTEND_HOST` / `FRONTEND_PORT` | Web frontend, default port 3000 |
| `CORS_ORIGINS` | Allowed browser origins, including your HTTPS proxy |
| `AUTH_REQUIRED` / `AUTH_DB_LOGIN_ENABLED` | Authentication and local Admin/IT accounts |
| `AUTH_DB_PATH` / `DB_PATH` | SQLite account/runtime stores |
| `AD_SERVER` / `OU_SEARCH_BASE` | DC and search subtree used by `Get-ADUser` |
| `AD_QUERY_USERNAME` / `AD_QUERY_PASSWORD` | Optional *read-only* AD lookup identity (both or neither) |
| `AUTH_LDAP_ENABLED` / `AUTH_LDAP_DOMAIN` | Employee login with AD password |
| `AUTH_LDAP_SERVER` / `AUTH_LDAP_UPN_SUFFIX` | Optional LDAP context overrides |
| `AUTH_LDAP_CONTAINER` | Optional restriction to a verified AD OU |
| `AUTH_LDAP_ROLE_RULES_JSON` | Optional Self-Service-to-IT login role rules, **not** signature assignment |
| `SIGNATUREE_ORGANIZATION_NAME` | Organization display |
| `LOCAL_DEPLOYMENT_PATH` | Local preview output |
| `NETWORK_DEPLOYMENT_PATH` | Production SMB/UNC target |
| `TEMPLATE_DIR` | Active HTML/TXT and resource directory, normally `config/templates` |
| `SIGNATUREE_SIGNATURES_AUTO_DISCOVER` | Auto-recognize complete template pairs |
| `SIGNATUREE_AUTO_GROUP_PREFIX` | AD group prefix, default `Signature-` |
| `SIGNATUREE_SIGNATURES_JSON` | Optional manual mapping when auto-discovery is false |
| `SIGNATUREE_VARIABLES_JSON` | Advanced variable schema override; normally unnecessary |

## Templates and signature group membership

With `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true`, the backend scans `config/templates/` on startup:

- `AD_Template.htm` + `AD_Template.txt` → signatur `AD` → existing AD group `Signature-AD`
- `FF_Template.htm` + `FF_Template.txt` → signature `FF` → `Signature-FF`
- An optional `AD-Dateien/` folder supplies matching resources.

`.html` is also accepted, and extensions are matched case-insensitively. The shipped `example_template.*` pair is skipped. Both HTML and TXT must be present; incomplete pairs fail configuration validation. Restart after adding/renaming templates.

**The group must already exist in AD and the user must belong to it.** The default mapping compares the AD group **CN**, while a manual full-DN mapping compares the **complete DN**. Direct membership is the reliable baseline; nested membership is not automatically expanded in every workflow.

To use groups named `Signatur-XY`, configure `SIGNATUREE_AUTO_GROUP_PREFIX=Signatur-`. For special cases, disable discovery and write a one-line `SIGNATUREE_SIGNATURES_JSON`. When discovery is true, the JSON map is ignored.

## Three different identities — do not mix them up

1. **LDAP sign-in:** validates each employee's **own** AD password using `AUTH_LDAP_DOMAIN` and optional LDAP overrides. No LDAP role rules are required for Self-Service; they only affect authorization level (IT vs Self-Service), never which signature is assigned.
2. **AD user lookup:** queries `Get-ADUser` using `AD_SERVER` and `OU_SEARCH_BASE`. By default this uses the backend Scheduled Task identity; optional `AD_QUERY_USERNAME` and `AD_QUERY_PASSWORD` provide a dedicated least-privilege **read-only** account. These credentials do not change the SMB identity.
3. **SMB output:** uses the **Windows principal of the backend task**. When running as SYSTEM this is normally `DOMAIN\SERVER$` across a domain share. The identity needs share and NTFS rights, including the ability to modify folder ACLs.

`OU_SEARCH_BASE` must be an existing **distinguished name** such as `DC=example,DC=local`. The built-in AD Users container is generally `CN=Users`, not `OU=Users`. Leave `AUTH_LDAP_CONTAINER` unset until the correct OU is known.

## On-disk layout and reload

| Path | Contents |
| --- | --- |
| `.env` | Settings and possibly secrets; do not commit |
| `config/templates/` | Active templates, logos and resource folders |
| `config/signaturee_auth.db` | Local password hashes/accounts |
| `config/signaturee.db` | Runtime state |
| `generatedsignatures/` | Local output (unless overridden) |
| `Logs/` | Generator logs |

A newly uploaded template is stored as a file; it does not add a second configuration entry. In the Admin deployment view you may draft path values and copy the corresponding `.env` lines. Applying the new values requires editing `.env` and restarting.

The Node process reads `.env` at startup. An explicitly inherited parent-process environment value can override the file for direct Node runs. Use one-line JSON values, without inline comments.

~~~powershell
cd C:\Signaturee
node .\backend\server.js --check
.\scripts\reload-config.ps1
~~~

`--check` verifies configuration, **not** live AD login, AD searches or SMB access. Use the three separate in-app tests.

[Quickstart](../README.md#quickstart) · [Templates](templates.md) · [AD onboarding](ad-onboarding.md) · [SMB permissions](network-share-permissions.md)
