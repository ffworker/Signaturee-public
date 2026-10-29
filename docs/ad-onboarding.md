# Active Directory onboarding — Signaturee

Signaturee uses AD for employee data and signature-group membership. A local **Admin** account configures the application; employees use their own AD credentials for Self-Service. The in-app **Administration → Onboarding / Check-Liste** page shows the effective profile's requirements.

## Ready-to-generate checklist

1. The employee account is enabled and has a usable `sAMAccountName`.
2. Required AD attributes for the selected template are populated (for example names and email).
3. A complete `XY_Template.htm` / `XY_Template.txt` pair exists in `config/templates/`.
4. The matching **AD security group** `Signature-XY` exists and the employee is a member.
5. **AD-Suche testen** succeeds under the backend service identity or configured read account.
6. **Generieren → Preflight → Vorschau** shows no blocking issues and renders the right values before productive SMB output.

For standard files, `SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true` supplies the mapping. For example, `HG_Template.htm` and `HG_Template.txt` map to group `Signature-HG`. The application does not add users to groups or create groups. Direct membership should be tested first; nested membership is not automatically expanded in every workflow.

## Login roles are independent from signature groups

| Identity | Permissions | Source |
| --- | --- | --- |
| **Admin** | Configuration and local account management, operations and generation | Local Signaturee account |
| **IT** | Search AD users, run preflight and generate signatures | Local IT account or eligible LDAP role rule |
| **Self-Service** | Sign in with AD credentials and generate own assigned signatures | LDAP login, default role |

LDAP role rules are **optional** and only change the login role to IT; they are **not** required for an employee to receive a `Signature-XY` signature. LDAP never grants the local Admin role.

The domain controller and OU used for `Get-ADUser` are set by `AD_SERVER` and `OU_SEARCH_BASE`. LDAP sign-in uses `AUTH_LDAP_DOMAIN` and optional LDAP context settings. These two operations can succeed or fail independently.

## Validate in Admin

Under **Benutzer & Zugriff**, use **AD-Suche testen** to check the actual server/search base and the Windows task's directory permissions. Use **LDAP-Login testen** separately with a normal AD account; only enter a password over localhost or HTTPS.

After verifying direct group membership, use the generate screen's Preflight to see which signatures are available to that user. The current web UI resolves users **through AD**, even when their identifiers were pasted or loaded from CSV/TXT; it processes no more than 50 selected users per targeted run. A full offline-CSV source is currently a separate legacy generator path. Network generation additionally requires the backend task's SMB/NTFS/ACL rights.

[Environment](environment.md) · [Templates](templates.md) · [Data sources](data-sources.md) · [README](../README.md)
