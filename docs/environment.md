# Environment

Signaturee separates runtime settings from business configuration.

## Runtime

Copy:

```powershell
Copy-Item config\example\runner.example.env config\runner.env
```

Common settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKEND_HOST` | `0.0.0.0` | backend bind address |
| `BACKEND_PORT` | `3001` | backend port |
| `BACKEND_BASE_PATH` | `/` | backend base path |
| `FRONTEND_HOST` | `0.0.0.0` | frontend bind address |
| `FRONTEND_PORT` | `3000` | frontend port |
| `CORS_ORIGINS` | localhost frontend | allowed browser origins |
| `AUTH_REQUIRED` | `true` | require authentication; an explicit false value only starts when `BACKEND_HOST` is loopback (`127.0.0.1`, `::1`, `localhost`) |
| `AUTH_TOKENS` | unset | optional service tokens; maximum IT privileges, never full Admin |
| `AUTH_DB_PATH` | `config/signaturee_auth.db` | local Admin/IT accounts |
| `AUTH_DB_LOGIN_ENABLED` | `true` | local Admin/IT login |
| `AUTH_LDAP_ENABLED` | `false` | employee AD login |
| `AUTH_LDAP_DOMAIN` | empty | AD domain |
| `AUTH_LDAP_SERVER` | empty | optional domain controller |
| `AUTH_LDAP_CONTAINER` | empty | optional LDAP container |
| `AUTH_LDAP_DEFAULT_ROLE` | fixed `selfservice` | legacy setting ignored; LDAP users cannot become Admin by default |
| `AUTH_LDAP_ROLE_RULES_PATH` | unset | local JSON file with exact AD attribute/group-DN rules for IT assignment |
| `AUTH_LDAP_ROLE_MAP` | unset | legacy canonical username-to-IT mapping only; Admin entries are ignored |
| `DB_PATH` | `config/signaturee.db` | main v2 database |
| `SELF_SERVICE_ARTIFACT_PATH` | generated output | self-service ZIP staging |

See `config/example/runner.example.env` for the full reference.

### LDAP role rules

For attribute- or group-based IT access, copy `config/example/ldap-role-rules.example.json` to the ignored `config/ldap-role-rules.json`, review the example rules, then set `AUTH_LDAP_ROLE_RULES_PATH=config/ldap-role-rules.json` in `runner.env`. Rules match exact values case-insensitively; group rules match the full direct `memberOf` DN, not substrings or nested groups. Any matching rule grants `it`; otherwise the account remains `selfservice`. LDAP cannot grant `admin` (including through legacy settings). `sn` is normally the surname in AD, so prefer `department`, a dedicated extension attribute, or an IT security group for organizational role assignment. A malformed or missing configured file fails backend startup. This is an environment-local file for now, not a setting in the Admin UI.

## Business configuration

Do not maintain AD search settings, signatures or deployment paths in environment files for v2.

The source of truth is `profile_v2`, managed in **Administration**:

- organization
- AD server + search base
- preview path
- productive UNC path
- signature definitions
- AD group mappings
- templates
- variables / required fields

## Deployment paths

Configure under **Administration → Ausgabe & Deployment**.

For UNC/SMB targets, the backend execution identity needs both Share and NTFS permissions. When the backend Scheduled Task runs as `SYSTEM`, remote access normally uses:

```text
DOMAIN\SIGNATUREE-SERVER$
```

See [Network share permissions](network-share-permissions.md).

## Browser runtime override

Only needed when the browser cannot discover the backend automatically:

```js
window.__SIGNATUREE_RUNTIME__ = {
  apiBase: "https://signature.example.com"
};
```

Save as `frontend/runtime-config.js`.

For same-origin reverse-proxy deployments, leave it unset.
