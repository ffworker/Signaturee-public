# Configuration reference — Signaturee

For the **recommended deployment** (`SIGNATUREE_CONFIG_MODE=env`), the project-root `.env` is the source of business settings. Copy [`.env.example`](../.env.example) to `.env` once, then edit the ignored local file. The Admin UI reads and can safely edit selected allowlisted settings in that file. An older database/file configuration mode remains in the code for compatibility; it is **not the default onboarding path**.

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
| `SIGNATUREE_RTF_ENGINE` | `libreoffice` (web backend default); `word` is a legacy compatibility selection. The direct PowerShell script defaults to Word unless passed `-RtfEngine LibreOffice`. |
| `SIGNATUREE_LIBREOFFICE_PATH` | Optional absolute path to `soffice.com` or `soffice.exe`; leave unset for standard system-wide installation. |
| `SIGNATUREE_SIGNATURES_AUTO_DISCOVER` | Auto-recognize complete template pairs |
| `SIGNATUREE_AUTO_GROUP_PREFIX` | AD group prefix, default `Signature-` |
| `SIGNATUREE_SIGNATURES_JSON` | Optional manual mapping when auto-discovery is false |
| `SIGNATUREE_VARIABLES_EXTRA_JSON` | Additive variables and overrides saved by Admin, preserving the built-in schema |
| `SIGNATUREE_VARIABLES_JSON` | Advanced full variable schema replacement; not the ordinary Admin editor |

## RTF engine and failure behavior

The **web backend defaults to LibreOffice** and passes `-RtfEngine LibreOffice` to the PowerShell generator. Install LibreOffice system-wide, preferably with its full executable path configured when the backend is run as a Scheduled Task. A Microsoft Office license is not required for this engine. `SIGNATUREE_RTF_ENGINE=word` explicitly selects the old unattended Word-COM implementation for compatibility testing only. There is no silent fallback between engines.

RTF output is validated for basic structure before replacing the existing RTF file. A failed conversion reports an error and preserves the previous RTF where possible; it does not deliberately generate an empty placeholder. A structural check cannot verify logo fidelity—validate the generated HTML and RTF in Classic Outlook. Configuration changes require activating/restarting the backend.

## Templates and signature group membership

With `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true`, the effective profile scans the configured `TEMPLATE_DIR` when it is read:

- `AD_Template.htm` + `AD_Template.txt` → signatur `AD` → existing AD group `Signature-AD`
- `FF_Template.htm` + `FF_Template.txt` → signature `FF` → `Signature-FF`
- An optional `AD-Dateien/` folder supplies matching resources.

`.html` is also accepted, and extensions are matched case-insensitively. Files named `example_template.*` are skipped if present. Both HTML and TXT must be present; incomplete pairs fail configuration validation. After manually adding/renaming templates, refresh the relevant Admin profile/catalog view; the `+ Signatur` wizard also refreshes the catalog. A **backend reload is needed for changes to `.env`**, not simply for discovery of a new complete on-disk pair.

**The group must already exist in AD and the user must belong to it.** The default mapping compares the AD group **CN**, while a manual full-DN mapping compares the **complete DN**. Direct membership is the reliable baseline; nested membership is not automatically expanded in every workflow.

To use groups named `Signatur-XY`, configure `SIGNATUREE_AUTO_GROUP_PREFIX=Signatur-`. For special cases, disable discovery and write a one-line `SIGNATUREE_SIGNATURES_JSON`. When discovery is true, the JSON map is ignored.

## Three different identities — do not mix them up

1. **LDAP sign-in:** validates each employee's **own** AD password using `AUTH_LDAP_DOMAIN` and optional LDAP overrides. No LDAP role rules are required for Self-Service; they only affect authorization level (IT vs Self-Service), never which signature is assigned.
2. **AD user lookup:** queries `Get-ADUser` using `AD_SERVER` and `OU_SEARCH_BASE`. By default this uses the backend Scheduled Task identity; optional `AD_QUERY_USERNAME` and `AD_QUERY_PASSWORD` provide a dedicated least-privilege **read-only** account. These credentials do not change the SMB identity.
3. **SMB output:** uses the **Windows principal of the backend task**. When running as SYSTEM this is normally `DOMAIN\SERVER$` across a domain share. The identity needs share and NTFS rights, including the ability to modify folder ACLs.

`OU_SEARCH_BASE` must be an existing **distinguished name** such as `DC=example,DC=local`. The built-in AD Users container is generally `CN=Users`, not `OU=Users`. Leave `AUTH_LDAP_CONTAINER` unset until the correct OU is known.

## Safe Admin editing

The local Admin web page can update only explicitly allowed organization, AD/LDAP lookup, group prefix and deployment path keys. It saves directly to the project-root `.env` after validation, creates a timestamped `.env.bak-...` backup and requires a backend restart to apply changes. Files changed outside the UI cause a revision conflict rather than silent overwrites. The backend task must have the necessary NTFS access. Secrets, ports, task identities and authentication policy remain outside the web editor.

The **Variablen** page can edit existing standard mappings and add new ones. An additive `SIGNATUREE_VARIABLES_EXTRA_JSON` list stores only differences and new attributes, preserving the entire built-in schema. The advanced complete replacement `SIGNATUREE_VARIABLES_JSON` or complete `SIGNATUREE_PROFILE_JSON` must be removed from .env before using the Admin variable editor, to prevent conflicting owners of the schema.

The save action writes the file, while **Gespeicherte .env aktivieren** initiates a backend restart and checks that the live process has loaded the current revision. If that operation fails, run `.\scripts\reload-config.ps1` elevated.

## On-disk layout and reload

| Path | Contents |
| --- | --- |
| `.env` | Settings and possibly secrets; do not commit |
| `config/templates/` | Active templates, logos and resource folders |
| `config/signaturee_auth.db` | Local password hashes/accounts |
| `config/signaturee.db` | Runtime state |
| `generatedsignatures/` | Local output (unless overridden) |
| `Logs/` | Generator logs |

A newly uploaded template is stored as a file; it does not add a second configuration entry. In the Admin deployment view, approved business path fields can be saved back to the existing `.env` with validation and backup. The saved values become active after backend activation/reload; an ad hoc **Pfad testen** check does not save them.

The Node process loads `.env` at startup. Automatic template discovery separately reads the template directory for the effective profile; these are not the same lifecycle. An explicitly inherited parent-process environment value can override the file for direct Node runs. Use one-line JSON values, without inline comments.

~~~powershell
cd C:\Signaturee
node .\backend\server.js --check
.\scripts\reload-config.ps1
~~~

`--check` verifies configuration, **not** live AD login, AD searches, Word/RTF output or SMB access. Use the independent in-app diagnostics and an isolated sample generation.

[Data sources and workflow limits](data-sources.md) explains why a CSV worklist in **Generieren** still requires live AD; the older full-file generation mode is a separate compatibility path.

[Quickstart](../README.md#quickstart--standard-ad-deployment) · [Templates](templates.md) · [AD onboarding](ad-onboarding.md) · [SMB permissions](network-share-permissions.md)
