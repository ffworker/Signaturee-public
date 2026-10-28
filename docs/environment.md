# Signaturee v2 — environment reference

The project-root `.env` is the **only business configuration source** in v2 env mode (`SIGNATUREE_CONFIG_MODE=env`). Copy [.env.example](../.env.example) once and keep the real `.env` private and untracked. The Admin UI displays the effective values. See the [v2 README](../README.md) for a complete Quickstart, service commands, diagnostics and backup instructions.

## Which setting is for which operation?

| Operation | Required settings | Windows identity |
| --- | --- | --- |
| Admin login | `AUTH_REQUIRED=true`, `AUTH_DB_LOGIN_ENABLED=true` | Local account database, not AD |
| Employee LDAP login | `AUTH_LDAP_ENABLED`, `AUTH_LDAP_DOMAIN`; optional `AUTH_LDAP_SERVER`, `AUTH_LDAP_UPN_SUFFIX` and `AUTH_LDAP_CONTAINER` | User's own supplied AD credentials |
| IT user search (`Get-ADUser`) | `AD_SERVER`, `OU_SEARCH_BASE` | Backend task identity (usually SYSTEM/computer account), or optional AD read-only account |
| Production SMB output | `NETWORK_DEPLOYMENT_PATH` | **Windows backend Scheduled Task identity**, independent from LDAP/AD search credentials |
| Local preview | `LOCAL_DEPLOYMENT_PATH` | Backend task identity; folder created on backend startup |
| Templates / assets | `TEMPLATE_DIR` | Files on disk; default `config/templates` |
| Signature assignment | `SIGNATUREE_SIGNATURES_JSON` | Maps AD group DNs to filenames |

### AD user search

`OU_SEARCH_BASE` is the DN of an existing container, **not** an OU display name. Start broad, such as `DC=example,DC=local`. The normal AD `Users` container is generally `CN=Users`, not `OU=Users`.

Most domain-joined backend machines can query AD using their task identity without a special account. When required, set **both** `AD_QUERY_USERNAME` and `AD_QUERY_PASSWORD` to a least-privilege AD reader, never Domain Administrator. This only changes `Get-ADUser` queries, not LDAP login or SMB permissions.

### LDAP login

Start with domain only:

~~~dotenv
AUTH_DB_LOGIN_ENABLED=true
AUTH_LDAP_ENABLED=true
AUTH_LDAP_DOMAIN=example.local
# AUTH_LDAP_SERVER=dc01.example.local
# AUTH_LDAP_UPN_SUFFIX=example.local
# AUTH_LDAP_CONTAINER=OU=ActualUsers,DC=example,DC=local
~~~

Leave `AUTH_LDAP_CONTAINER` disabled initially. It restricts lookup inside `PrincipalContext` and may exclude users outside the named OU. `AUTH_LDAP_UPN_SUFFIX` must match the users' actual UPN suffix if enabled; it is not an LDAP server path.

`AUTH_LDAP_ROLE_RULES_JSON` is optional for assigning IT rights; local Admin is never assigned by LDAP. No role rules are needed for self-service login. Avoid `AUTH_LDAP_ROLE_RULES_PATH` unless the referenced JSON file exists.

### Output and filesystem permissions

Use `LOCAL_DEPLOYMENT_PATH=generatedsignatures` for preview. This resolves relative to the repository root and is created at backend startup when the task account has permission. Production output needs a real UNC `\\fileserver.example.local\Signatures` and suitable **share + NTFS + ACL modification permissions** for the backend execution identity; setting an AD-read password does not solve SMB access.

### Signatures and variables

`SIGNATUREE_SIGNATURES_JSON` is a one-line JSON map. Each key needs `label` (optional), `adGroups` (one or more DNs), `templateHtml` and `templateTxt`; `resourceFolder` and additional title attributes are optional. The built-in variable schema covers normal AD contact fields. Only set `SIGNATUREE_VARIABLES_JSON` to override that schema.

### Local files / restart

- `.env`: business/runtime configuration and possibly read-only AD query credentials. Keep ACLs restrictive.
- `config/templates/`: image, HTML, TXT and resource files; Git-ignored.
- `config/signaturee_auth.db`: local accounts and password hashes; Git-ignored.
- `config/signaturee.db`: runtime state. An old SQLite business profile does **not** override .env in env mode.
- `generatedsignatures/`: local output; Git-ignored.

Edit `.env` and execute `.\scripts\reload-config.ps1` (Admin PowerShell) to apply changes. Alternatively use `.\scripts\reload-config.ps1 -Watch` during installation. The Admin deployment screen supports drafting/copying the two path variables; it doesn't modify `.env` invisibly.

The Windows Scheduled Tasks and direct Node commands use the same env loader. Avoid defining the same keys in parent process environment; those may override file values for direct Node execution. The tasks import their explicitly selected `.env` when they start. For JSON values, use a single line without an inline comment. Both quoted and unquoted simple values are accepted.

## Diagnostics

In **Administration → Benutzer & Zugriff** there are two different diagnostics:

1. **AD-Suche testen** — calls `Get-ADUser` under the backend identity/optional read-only account; reports effective server/search base and sanitized error code.
2. **LDAP-Login testen** — authenticates a test employee using their real AD password. Only use localhost/HTTPS; no session is created and the password is not saved.

In **Administration → Ausgabe & Deployment**, **Pfad testen** creates/checks a local preview folder. **Netzwerkpfad testen** checks filesystem and ACL access under the backend identity. An `EPERM` failure requires file-server access troubleshooting, not LDAP credential changes.

[Full README](../README.md) · [SMB permissions](network-share-permissions.md)
