# Compatibility and cleanup audit

> Baseline: `main` at `1ed87f1` (PR #18 merged, 2026-10-28). This is a **source-based inventory**, not proof of every deployed integration. The maintainer has reported successful functional testing of the running application. The isolated legacy/compatibility scenarios below have **not** been independently reproduced for this audit.

## Scope and release boundary

Signaturee is an IT-admin tool for generating and deploying signatures from supplied HTML/TXT templates. The standard web path uses live AD employee lookup and AD signature-group assignment. This audit deliberately **does not redesign the UI or change executable behavior**. It identifies what to preserve and what still needs verification before any deletion or consolidation.

Do not confuse (a) employee attributes, (b) signature assignment, (c) login/roles and (d) Windows task/SMB authorization. They have separate sources and security boundaries.

## KEEP — current product paths

| Component | Evidence in repository | Decision |
| --- | --- | --- |
| Targeted AD selection, Preflight, Preview, Generate | `frontend/generate-v2.js`, `backend/server.js` (`buildV2RunPlan`, `handleV2RunPreflight`, `handleV2RunPreview`, `handleV2RunGenerate`) | **KEEP.** Current web workflow, 50 distinct identifiers per run. |
| HTML/TXT discovery and conventional `Signature-XY` mapping | `backend/signature-discovery.js`, `backend/server.js` (`getV2Profile`) | **KEEP.** Do not conflate a discovered template with verified AD membership. |
| Admin-only new-signature pair upload | `backend/signature-create.js`, `backend/server.js` (`/api/v2/signatures/create`) | **KEEP.** It creates a pair, not its corresponding AD group or resource directory. |
| Central `.env` and activation/reload mechanics | `scripts/load-env.js`, `backend/admin-env-editor.js`, `scripts/reload-config.ps1` | **KEEP.** Preserve backup, validation, task ownership and activation safeguards. |
| LDAP self-service and own-signature restriction | `backend/ldap-roles.js`, `backend/server.js` (`/api/self/*`) | **KEEP.** Login roles are separate from signature groups. |
| Generated per-run CSV/JSON passed to PowerShell | `backend/server.js` (`handleV2RunGenerate`) | **KEEP.** This is an **internal transport format after live AD resolution**, not an offline CSV-data-source feature. |
| Windows Scheduled Tasks, SMB probes, guarded backend restart | `scripts/*task*.ps1`, `scripts/runner-lifecycle.ps1`, `backend/server.js` | **KEEP.** These have runtime/ACL implications and require separate regression testing before refactoring. |

## VERIFY — retained compatibility paths; no removal approval

| Path | What the source shows | Required acceptance check |
| --- | --- | --- |
| Full-record offline CSV/JSON/YAML generation | `GenerateSignatures.ps1 -UseUserFile -UserFilePath` skips the AD module, but still loads a compatible configuration JSON and variable mappings. | In a **disconnected AD test**, supply two synthetic employees and explicit `Domains`, generate to a disposable local directory, inspect output/exit status and confirm no AD calls. |
| Legacy CSV import API | `POST /api/users/import` saves imported CSV; `/api/generate` is a separate invocation. The modern worklist picker is not this API. | Verify import → config → generator → output in one isolated run. Determine whether `/api/users/import-single` has a distinct supported contract before deprecation. |
| Manual single employee API | `POST /api/generate/single` reads the legacy `config/config.json`, validates mandatory fields, creates a temporary CSV and runs the generator. | Confirm default `.env` install behavior vs. documented legacy configuration; verify valid input and failure cleanup. |
| AD-wide mass mode | `GenerateSignatures.ps1 -MassGeneration` requires an AD search base and security-group mappings; it is not unlimited bulk in the current web UI. | Run against a **dedicated test OU**, include enabled/disabled users, confirm groups, count and safe local output. Never make production OU the first test. |
| Preview/RTF/encoding | PowerShell uses Microsoft Word COM for real RTF, falls back to a placeholder if unavailable; rendering uses a Windows code page. | Test actual Outlook-compatible HTM/TXT/RTF, resource paths, umlauts and non-Western text with production-like templates. |
| Authorization, temporary material and artifacts | `backend/server.js` separates `/api/run/*`, `/api/self/*` and older `/api/generate*` endpoints. Current generation creates files in `config/.runs`. | Role matrix (Admin/IT/Self-Service), user isolation, rejection of unassigned signatures, sensitive temporary-file cleanup after success and failure, share/NTFS identity. |

**Do not promote a retained code path to a product guarantee solely because its entry point exists.** See [data sources](data-sources.md) and [API reference](api.md).

## CLEAN UP — low-risk and separately reviewable

- **Now, documentation-only:** fix README Quickstart anchors broken by PR #18; remove leftover `Signaturee v2` wording from prose headings and SECURITY deployment description. Preserve semantic version `2.0.0` and file/API names containing `v2` — these are technical identifiers, not product naming.
- **Later, after targeted tests:** review legacy references in PowerShell comments/help and any unused config examples before modifying them; distinguish actual compatibility requirements from dead code.
- **Later, after browser testing:** investigate layered CSS files and older routes for duplication. Do **not** remove a stylesheet, endpoint, database format, or helper on name alone.

## REMOVE — explicit limit

- The abandoned visual Template Studio/product-direction document was already removed in PR #18. Keep it out of release claims.
- **No runtime files or routes are approved for removal by this audit.** Record actual call sites, backward-compatibility requirements, rollback strategy and passing regression tests before a removal PR.

## Approval / next PR gate

1. Review this KEEP / CLEAN UP / REMOVE / VERIFY classification.
2. Confirm which compatibility cases must remain supported, especially offline file-data generation and the old APIs.
3. Run the relevant acceptance cases in a disposable environment, with representative templates and without touching productive SMB output.
4. Only then propose focused behavior changes or deletions in **separate, test-backed PRs**; preserve a reversible deployment path.

**Result of this PR:** clearer decisions and corrected documentation, **no changes to JavaScript, PowerShell, runtime configuration, dependencies or tests**. CI confirms existing regression tests, not the independent legacy acceptance cases above.


## Follow-up inventory — 2026-10-29 (after PR #21)

This is a repository reference audit of the current tracked tree, not telemetry of manually invoked commands on installed hosts. **No tests were classified as abandoned solely because their names are old.**

| Category | Evidence / entry point | Decision |
| --- | --- | --- |
| All 15 `backend/tests/*.test.js` files | Each appears in `package.json` `test:backend`; the Windows workflow calls that script | **KEEP** — all are run by CI |
| Four `tests/*.Tests.ps1` suites | Windows CI runs `Invoke-Pester -Path tests -CI` (and local quality gate runs the same test directory) | **KEEP** — all four remain discoverable |
| `tests/Get-CsvUserDomains.Tests.ps1`, `tests/Get-UserDomains.Tests.ps1`, `tests/SafeUsername.Tests.ps1` | They exercise `Functions/UserDomainHelpers.ps1`, whose functions are invoked by `GenerateSignatures.ps1` | **KEEP** — CSV/AD group and filename safety coverage |
| `tests/RunnerLifecycle.Tests.ps1` | Exercises `scripts/runner-lifecycle.ps1` and checks live task-script syntax | **KEEP** — protects Windows deployment |
| `Templatefiles/` and `Templatefiles_test/` sample pairs | Generator still selects these directories in legacy/test modes; modern `config/templates` remains independent | **KEEP** pending real compatibility deprecation |
| `config/variables.json` and `config/presets/*` examples | Database-mode fallback and preset import/mirroring still exist | **KEEP** until database-mode compatibility is retired |
| `frontend/runtime-config.example.js` | Optional configuration example for the separately loaded `runtime-config.js` (which is intentionally local) | **KEEP** — manual configuration asset, not a dead module |
| `frontend/*css`, `frontend/theme.js`, `frontend/ui-polish.css` | HTML entry points still include these files | **KEEP** — visual overlap is not evidence of non-use |
| `scripts/clean.js` | `package.json` `clean`/`clean:all` invoke it | **KEEP**, but review deletion targets before running on a populated installation |
| `scripts/export-profile-env.js` | Standalone one-off exporter for v1/v2 migration into a new `.env`; no reference from package scripts, workflow, current docs, backend, web entry points, generator or runner scripts | **REMOVE candidate in the follow-up PR** — it is not part of the installed application. Its historical implementation remains recoverable from Git. Users explicitly invoking this undocumented migration CLI externally would lose the command after updating. |

**Boundaries:** This audit does not remove legacy `/api/generate*` routes, offline file import, `-MassGeneration`, SQLite database-mode support, sample template folders or UI styles. Their consumers may be external or installed outside this repo. Audit call sites and run independent acceptance tests before deprecating them.

**Review requirement for the follow-up PR:** confirm the old migration-export CLI is no longer needed. A green CI means the tracked test suite passes; it cannot prove nobody calls a standalone utility manually.
