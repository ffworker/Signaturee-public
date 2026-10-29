# Linux / Docker architecture — foundation audit

**Status:** Design and CI reconnaissance only. Signaturee v2.0.0 is a **Windows release**, not a Linux-compatible application. Use the exact [Windows v2.0.0 tag](https://github.com/ffworker/Signaturee-public/releases/tag/v2.0.0) as the immutable known-good baseline; do not change that release or the running Windows production installation.

## Decision

**One repository, shared frontend and backend/application model, two platform-specific adapters and distribution targets.** Do **not** fork the complete application to a permanent `signaturee-linux` repository or translate the entire PowerShell generator line by line. Use an incremental transition: preserve the proven Windows implementation while extracting a portable signature-rendering core with golden fixtures, then provide Linux directory/deployment adapters. The long-term Linux distribution should be a rootless-oriented OCI image plus Compose example, **not** a standalone Windows executable.

Initial Linux target: **Linux x86-64 container runtime** with a mounted, externally managed writable output path. ARM64 images may follow after verification. No Linux CLI or Docker distribution is promised by this PR.

## Findings from the actual v2.0.0 code

| Concern | Current implementation | Linux action | Risk |
| --- | --- | --- | --- |
| Frontend | Static HTML/CSS/JS served by Node's `http-server` package | **KEEP** existing frontend and API, avoid UI duplication | Low |
| Configuration | Project-level `.env` and JSON profiles via Node | **KEEP** schema and loader; support container environment/secret files safely | Low–medium |
| Login/local accounts | Node sessions, role checks, SQLite | **KEEP**, validate paths/permissions under non-root container | Medium |
| User lookup/search | `backend/server.js → queryAdUsers()` spawns PowerShell `Import-Module ActiveDirectory` and `Get-ADUser` | **ADAPTER**: implement a Linux-native LDAP/LDAPS directory provider returning the same normalized user shape | High |
| Employee LDAP login | `authenticateLdapUser()` spawns PowerShell `System.DirectoryServices.AccountManagement`, Windows-specific | **ADAPTER**: secure native LDAP bind and attribute/group lookup preserving role isolation; no insecure TLS bypass | High |
| Assignment/preflight | JS group-name resolution, selected users, preview, streaming API | **KEEP** semantics. Normalize AD LDAP values and preserve direct-membership rules unless explicitly expanded | Medium–high |
| Templates and variables | Node template discovery/variable schema; actual HTML/TXT replacement in `GenerateSignatures.ps1` | **EXTRACT** portable renderer; no silent changes to output filenames, email domains, resource names or Windows-1252 character handling | High |
| RTF | LibreOffice command-line invoked from PowerShell via unique temp profile and staged output | **ADAPTER**: invoke `soffice` headlessly from Node on Linux with per-job profile, timeout and validation; preserve previous output on error | Medium |
| Output and ACLs | Windows generator writes user directories and sets Windows NTFS ACLs via `Get-Acl`/`Set-Acl`; Node target probe explicitly rejects ACL checks on non-Windows | **ADAPTER**: local POSIX output with atomic publishing. SMB mount managed by host; no fabricated Windows ACL parity | High |
| Runtime | Windows startup Scheduled Tasks and Windows-specific `runner` admin endpoints | **ADAPTER**: container liveness/restart policy; hide/disable unsupported Windows task actions on Linux | Medium |
| Character encoding | Windows generator reads Word-exported HTML as code page 1252; also references `System.Web` | **VERIFY** with byte/golden output fixtures: umlauts, HTML entities, rows, links, inline resources and mixed encodings | High |
| Existing tests | Backend unit/integration tests and Windows PowerShell/Pester quality gate | **ADD** Ubuntu Node/backend smoke job now. This does **not** prove Linux generation | Low |

**Architectural trap to avoid:** Merely installing PowerShell 7 and LibreOffice inside a Docker image is not a Linux port. The current app still calls Windows-specific `Get-ADUser`, `System.DirectoryServices.AccountManagement`, `System.Web`, `Set-Acl`, and Windows Scheduled Tasks, and path/encoding/SMB semantics remain different. No `Dockerfile` should be presented as production-ready until those boundaries are addressed.

## Proposed component boundaries

The eventual Node-side services, using the existing API request/response shapes, should expose testable contracts:

- `directory.searchUsers(query, attributes, scope)`, `directory.getUser(id)` and `directory.authenticate(username, password)`: Windows implementation uses the current verified bridge, Linux uses LDAPS/StartTLS with strict certificate validation and escaped search filters. Group/role authorization stays in shared logic.
- `renderer.render({ user, signature, variables, templates })`: deterministic HTM/TXT content and resource references. Must match Windows golden fixtures before changing Windows production defaults.
- `converter.toRtf({ htmlPath, resourceDir, outputPath })`: LibreOffice service, dedicated user profile, timeout, temporary output, header/size checks and atomic replacement.
- `publisher.publish({ artifacts, user, target })`: Windows ACL/SMB implementation remains; Linux writes under an explicitly mounted POSIX path and **does not** emulate Windows per-user ACLs.
- `runtime.status()/restart()`: Windows Scheduled Tasks versus Linux container runtime; self-restart is delegated to the orchestrator where possible.

Contracts are design targets, **not** already-existing modules or implemented services.

## Test strategy (before any real Docker release)

1. Run the unchanged Node/frontend/backend suite on Ubuntu in CI to discover portability defects. Keep the Windows gate, including Pester and Windows ZIP packaging, mandatory. Linux CI success means **only Node/backend compatibility tests passed**.
2. Capture sanitized deterministic golden fixtures from a real test Windows installation: HTML/TXT templates, `-Dateien` image resources, generated HTML/TXT, expected filenames, dynamic mobile/fax row cases, special characters and group assignments. **Never** commit employee information, credentials or actual customer logos.
3. Extract and test the shared renderer behind a non-default selection; compare output and resource paths against golden fixtures byte-by-byte where meaningful. Do not replace the Windows production generator until parity is proven.
4. Implement Linux LDAP search and employee login with TLS validation, timeouts, direct group membership, AD-enabled-user filtering and role safety. Mock an LDAP server in CI, then verify against a permitted actual AD test account.
5. Implement Linux LibreOffice conversion, non-root output publishing, log/state persistence and an isolated temp directory. Test malformed HTML, missing assets, failed conversions, concurrent requests and cleanup.
6. Publish **development-only** Docker image/Compose example with a non-root process, read-only templates, persistent SQLite/config/state volumes, and a host-mounted writable output directory. **Do not place SMB or LDAP credentials in an image layer.** Prefer a host-managed CIFS mount to in-container mount privileges.
7. End-to-end test from the existing web UI through LDAP → selection → preview → HTML/TXT/RTF → host-mounted output. Validate resulting signature in **Classic Outlook** on a Windows workstation, independently of the Linux host.
8. Only after security/reproducibility review, publish the first separately labeled Linux release artifact. Do not claim feature parity for untested advanced/bulk/CSV workflows.

## Scope of this foundation PR

- Add this architecture audit with explicit KEEP / EXTRACT / ADAPTER decisions.
- Add **Ubuntu Node/backend compatibility CI** in the existing quality gate, with no change to Windows generator code.
- Link this roadmap from README as **under development, not supported**.

### Explicit non-goals

No Linux Dockerfile/image yet, no new LDAP package or dependencies, no change to Windows RTF selection, no new Windows release/tag, no weakening of LDAP/SMB/ACL/auth constraints, and no branch merge without review.

**Next code PR after this audit:** introduce pure Node renderer input/output contracts plus sanitized golden-output fixtures, while preserving the entire Windows v2.0.0 behavior by default.
