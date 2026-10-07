# AD onboarding

The authoritative onboarding checklist is generated inside:

**Administration → Onboarding**

It follows the current `profile_v2` configuration, so documentation cannot drift from required variables or signature groups.

A user is ready when:

1. the AD account is enabled,
2. `sAMAccountName` is set,
3. all variables marked **required** have a usable AD value,
4. the user belongs to at least one configured signature group,
5. any signature-specific custom attributes are populated,
6. Signaturee Preflight has no blocking errors.

## Roles

- **Admin** — configuration, local Admin/IT users, system controls and generation.
- **IT** — live AD search, selection, Preflight and generation.
- **AD user / Self-Service** — LDAP login and own signatures only.

Normal employees do not need a local Signaturee account.

## LDAP self-service

Minimum runtime settings:

```env
AUTH_REQUIRED=true
AUTH_LDAP_ENABLED=true
```

LDAP users default to Self-Service. Optional attribute/group-based IT rules are configured with `AUTH_LDAP_ROLE_RULES_PATH`; see [Environment](environment.md). Full Admin access requires a local Signaturee account.

Optional LDAP domain/server/container settings are documented in [Environment](environment.md).
