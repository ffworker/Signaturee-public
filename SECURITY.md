# Security

Please report potential security vulnerabilities privately to the repository owner through GitHub, not through a public issue.

## Deployment

Signaturee is intended for a trusted Windows/Active Directory environment.

- Keep `AUTH_REQUIRED=true` and use HTTPS (prefer a same-origin reverse proxy).
- Restrict direct access to the backend API port (default **3001**).
- Protect the **project-root `.env`**: it can hold AD read credentials or other secrets. Never commit it.
- Protect `config/signaturee_auth.db`, `config/signaturee.db` and the entire `config/templates/` tree.
- Use a **least-privilege AD read identity** when necessary for `Get-ADUser`. Domain Administrator is not required for ordinary search.
- The backend Windows task identity, not an AD-query/LDAP password, controls productive SMB access. Grant only the necessary share, NTFS and ACL rights on the dedicated output tree.
- Use separate local Admin accounts for full administration. LDAP users default to Self-Service; optional rules can grant IT, but LDAP does not grant Admin.
- Keep the default **`Signature-XY`** group membership mapping intentional and audited: group membership determines which signature types are available.
- Do not accept employee passwords for LDAP diagnosis on unencrypted remote HTTP.
- Back up `.env`, databases and templates securely and verify restore.

See [Configuration](docs/environment.md), [SMB permissions](docs/network-share-permissions.md) and [Reverse proxy / DNS](docs/reverse-proxy.md).
