# Security

Please do not report security issues in a public GitHub issue.

For a private disclosure, contact the repository owner through GitHub.

## Deployment notes

Signaturee is intended for trusted Windows/Active Directory environments.

For production:

- keep authentication enabled,
- use HTTPS through a reverse proxy,
- do not expose backend port `3001` directly to untrusted networks,
- grant the backend identity only the AD read and file-share permissions it needs,
- avoid Domain Admin or other highly privileged service identities,
- protect `config/runner.env`, the SQLite databases and template files.

See [Network share permissions](docs/network-share-permissions.md) and [Reverse proxy / DNS](docs/reverse-proxy.md).
