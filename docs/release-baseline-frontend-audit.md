# Windows release baseline and frontend reuse audit

**Scope:** read-only audit of the public `v2.0.0` Windows release and the current frontend/backend boundary. This document does not modify the release, create a tag, or claim customer acceptance.

## Immutable release baseline

The audit was run against the repository's `main` at commit `a04de381b66e7d908cc4b6daad11efa0ae3b2340`. The published release was inspected through the GitHub release API and its assets were downloaded to a temporary audit directory.

| Item | Observed value |
| --- | --- |
| Release | `v2.0.0` |
| Published | `2026-10-29T12:00:18Z` |
| Release target commit | `d0b7a7d8337a4d7db170b004f7c098979398fe4f` |
| Tag resolves to | `d0b7a7d8337a4d7db170b004f7c098979398fe4f` |
| Draft / prerelease | `false` / `false` |
| ZIP | `signaturee-win-v2.0.0.zip` (259,588 bytes) |
| ZIP SHA-256 | `b891ab575db01efb2e8a3401bbbdd67f24817cf8eee3a3562b7bc170ce587210` |
| Published checksum file | `SHA256SUMS.txt` (93 bytes) |
| Checksum file SHA-256 | `3788032e3fb4552381bdff91c2cb087ce144c04ee21be14f503cb17173c0dfd7` |

The ZIP digest matches the release checksum manifest. This verifies asset integrity and tag targeting only. It does **not** verify a clean install, upgrade/rollback, AD/LDAP authentication, SMB permissions, LibreOffice conversion, or Classic Outlook rendering.

### Release safety conclusions

- Do not replace or regenerate the `v2.0.0` tag or assets.
- Stable promotion must be an explicit approval after all required quality gates, package inspection, reproducible-build comparison, clean-install/upgrade/rollback checks, and the manual acceptance checklist.
- The ZIP is a tracked-source package: it is not an executable, does not contain Node.js or LibreOffice, and must not contain credentials, employee data, private templates, databases, or `node_modules`.
- A passing CI run is a regression signal, not customer acceptance.

## Frontend reuse assessment

The frontend is static HTML/CSS/JavaScript and is a strong reuse candidate for a future Linux/Docker target. Reuse means retaining browser routes, user-facing workflow semantics, and API contracts; it does not mean that the current Windows backend can run unchanged on Linux.

| Frontend area | Current contract | Windows status | Linux/Docker assessment |
| --- | --- | --- | --- |
| Login and session | `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`; bearer token stored in browser `localStorage` | Local account and optional AD/LDAP login | **KEEP UI contract.** Linux must provide the same response fields and secure cookie/token policy; do not weaken auth or store secrets in images. |
| Roles and routes | Admin, IT/operator, and employee self-service route selection | Role checks are enforced by backend and UI | **KEEP semantics.** Backend authorization remains authoritative; UI hiding is not an authorization boundary. |
| Admin configuration | `/api/v2/admin/*` profile, signatures, variables, user and diagnostic endpoints | AD-, LDAP-, template-, output- and runner-oriented | **KEEP selectively.** Preserve shared profile/signature/variable views; hide or mark Windows-only task/ACL diagnostics until Linux adapters exist. |
| AD employee search | `/api/users/ad` with normalized user/group fields | Uses PowerShell `Get-ADUser` | **KEEP request/response shape.** Replace only the directory provider with strict LDAP/LDAPS; preserve direct group assignment and preflight semantics. |
| Preflight and preview | `/api/run/preflight`, `/api/run/preview`; selected users, signatures, targets, validation messages | Current web generator supports individual and targeted multi-user runs (up to 50) | **KEEP workflow.** Linux must match validation and preview contracts before any generation claim. |
| Generation/download | `/api/run/generate/stream`; self-service `/api/self/generate` and download | Generates HTML/TXT/RTF and optional resources through Windows/PowerShell paths | **KEEP UI only.** Rendering, RTF conversion, output publication and atomic failure behavior require platform adapters and parity fixtures. |
| Browser persistence | `localStorage` for API discovery, role/session token and theme preferences | Works in supported browsers | **KEEP cautiously.** Do not place employee data or credentials in persistent browser storage; preserve HTTPS requirements for remote use. |
| Static serving | `http-server`/Node launcher with frontend assets | Windows Scheduled Task runners | **KEEP assets.** Linux can serve the same static files behind Node/reverse proxy; process supervision is platform-specific. |

### Platform contracts that must remain explicit

1. **Directory provider:** Windows uses PowerShell/RSAT AD APIs. Linux requires a native LDAP/LDAPS adapter with escaped filters, timeouts, certificate validation, normalized users, and equivalent group/role isolation.
2. **Renderer:** Extract a deterministic shared renderer only after sanitized golden fixtures cover HTML/TXT, resource folders, variable substitution, filenames, special characters, and Windows-1252 behavior. Keep the Windows generator as the default until parity is proven.
3. **RTF converter:** Windows currently uses LibreOffice through the Windows generation path. Linux must use an isolated `soffice` profile, timeout, validation, temporary output and atomic replacement; a failed conversion must not publish an empty or partial artifact.
4. **Publisher:** Windows output and NTFS/SMB permissions are not equivalent to Linux POSIX permissions. Linux should publish only to an explicitly mounted path; it must not pretend to reproduce Windows ACL semantics.
5. **Runtime administration:** Windows Scheduled Task install/restart controls are not portable. Linux process health and restart belong to the container/orchestrator, with unsupported Windows controls hidden or clearly labeled.
6. **Outlook target:** Generated files are for **Classic Outlook** validation. Local HTML/TXT/RTF files are not a deployment mechanism for **new Outlook or Outlook on the web**; those require a separately verified server-side/signature policy integration.

## Baseline tests and remaining evidence

The existing portable backend tests and Ubuntu Node syntax/configuration checks are useful reuse evidence. The Windows Pester and ZIP smoke checks remain required for Windows changes. Neither proves live AD, authenticated LDAP, SMB, LibreOffice, or Outlook behavior.

Before a Linux artifact is labeled supported, add sanitized golden fixtures, LDAP adapter tests, non-root output/conversion tests, and an end-to-end browser-to-output test. Before promoting a Windows stable release, run the clean-install, upgrade, rollback, package-safety, checksum/reproducible-build, and Classic Outlook manual checklist on a clean Windows environment.

## Non-goals

- No Linux implementation, Docker image, dependency migration, or frontend rewrite.
- No change to Windows generator behavior.
- No stable release/tag creation and no modification of `v2.0.0` assets.
- No inclusion of private infrastructure, credentials, employee data, customer templates, or customer acceptance claims.
