# Windows release — ZIP packaging and clean-install checklist

For step-by-step setup of a **fresh Windows Server 2025 VM**, see [Prepare your VM (Windows Server 2025)](prepare-windows-server-2025.md). This page focuses on packaging, release validation, existing-installation safety and rollback.

Signaturee for Windows is a Node.js frontend/backend plus a Windows PowerShell 5.1 signature generator. The web backend defaults to headless **LibreOffice** for RTF conversion. It does not require Microsoft Word. This page describes the **portable source ZIP**; it is not a single-file EXE or MSI and does not bundle the prerequisites.

## Status and scope

- The original Windows installation has been verified manually with multiple signatures, both local and network output, and Classic Outlook HTML signature rendering.
- The GitHub Windows quality gate covers code, backend tests and Pester, but **cannot verify a customer's AD, credentials, share ACLs, logos or Outlook display**.
- A successful CI ZIP is a **release candidate artifact**, not a production endorsement or a GitHub Release. Publish a tagged stable release only after a second, clean-install acceptance check.
- The existing Word-COM converter is available only as an explicitly selected **legacy** option in the web backend. Do not configure Word-COM as a silent fallback to LibreOffice.

## How the Windows ZIP is produced

On a **clean committed checkout** with Git and Windows PowerShell 5.1:

~~~powershell
cd C:\path\to\Signaturee-public
.\scripts\package-windows.ps1
~~~

This creates `dist\signaturee-win-v<version>.zip`, where `<version>` comes from `package.json`. You can also use `-OutputDirectory` or `-Ref` for a specific committed revision. The build archives only the selected committed revision: it warns if the working tree has local changes because **those changes are excluded**. It will not overwrite an existing ZIP. It checks that the release ZIP contains the essential application files and no obvious runtime secrets.

The ZIP is built via **git archive** from tracked files. By design, it does **not** include: `.env`, private config, live AD data, customer templates/logos under `config/templates/`, user databases, generated signatures, logs, `node_modules`, the LibreOffice executable, or Node.js. Do **not** commit sensitive files to Git; ZIP filtering is a defense in depth, not a substitute for repository security review. A tagged ZIP can be reproduced from the exact commit with the same builder.

The packager additionally rejects common recursive runtime/private basenames and extensions (including `.env`, SQLite sidecars, key/certificate material, and known employee-output paths), while allowing reviewed `*.example` fixtures. This is a safety net, not proof that employee data is absent: review the changed-file list and archive contents before every release.

The GitHub Windows CI builds the ZIP from the exact tested revision (the push commit on `main`, or the pull-request head), builds it twice, compares SHA-256 digests, expands the candidate for required-file/private-path checks, and uploads the ZIP plus checksum/revision evidence as short-lived **Actions artifacts**. No GitHub Release is created automatically. The ZIP's contents are not digitally signed. The reproducibility check is necessary evidence, not a stable-release approval.

## Clean installation on an unused Windows test host

Requirements: Windows PowerShell 5.1, Node.js **22.13+**, the Windows RSAT **ActiveDirectory** module, a system-wide LibreOffice installation, and network/DNS access to a test AD/SMB environment. The target host **does not need Git** for a ZIP install.

1. Download the Windows CI ZIP; extract its single `signaturee-win-v<version>` directory to a **new and empty** installation path, e.g. `C:\Signaturee`. Do not extract directly over an existing installation.
2. In the extracted directory, run `npm ci --omit=dev`. Copy `.env.example` to `.env` **once**, and create `config\templates\`. Fill in only the test environment's AD, LDAP, origins and local/network paths. Never ship production credentials or customer templates with the ZIP.
3. Add a known valid HTML/TXT template pair and image folder to `config\templates\`. Confirm the matching **existing AD group** and an assigned test user.
4. In `.env`, keep the default LibreOffice engine (or specify `SIGNATUREE_RTF_ENGINE=libreoffice`) and set `SIGNATUREE_LIBREOFFICE_PATH=C:\Program Files\LibreOffice\program\soffice.com` if PATH lookup is uncertain. Confirm `& 'C:\Program Files\LibreOffice\program\soffice.com' --version`.
5. Run `node .\backend\server.js --check`. Set up the local Admin account and the backend/frontend Scheduled Tasks using the commands in [Windows host preparation](prepare-machine-dependencies.md). Verify the actual backend identity and API/UI reachability.
6. In the UI: confirm template discovery and assigned groups, test AD search separately from LDAP login, use **Preflight**, generate **one local** signature and inspect `.htm`, `.txt`, `.rtf` and `-Dateien` resources. Check conversion logs and make sure no Word-COM activation is attempted.
7. Open the generated files in **Classic Outlook** on a test workstation. Check logo, links, fonts, spacing, tables and German characters in an HTML email; if Rich Text is part of the supported use case, test RTF separately (RTF image fidelity may differ).
8. Generate **multiple test signatures**, then check a **test network share** with the Scheduled Task identity's real SMB and NTFS permissions. Confirm all expected output files and log success, including repeated runs.
9. Test that the task can restart and load `.env` reliably, and verify existing outputs are not replaced with corrupt placeholders on a failed RTF conversion. Document the observed outcome before approving a stable release.

Only after these steps pass should a maintainer approve the PR and create a **new** version tag for the verified commit. Never reuse the already published `v2.0.0` tag. Follow the explicit promotion procedure below; these instructions do not create a tag or publish anything by themselves.

## Existing installations and rollback

**Do not** deploy the ZIP by blindly overwriting a running installation. Back up the original code, `.env`, `config/templates/` (including all logos), SQLite databases, logs and other state paths; stop Scheduled Tasks before any manual migration. Restore the tested previous version and its matching configuration if needed.

The `scripts/update-signaturee.ps1` helper is **Git-checkout-specific** (fast-forward pull); it cannot update a ZIP installation. Release-to-release upgrade/rollback automation is not yet implemented. For now, test ZIP versions side by side in fresh directories rather than altering a working installation.

The Windows and Linux editions are separate repositories: [Signaturee-public](https://github.com/ffworker/Signaturee-public) and [signaturee-linux](https://github.com/ffworker/signaturee-linux). Linux support is **not included** in this release and is not implied by this Windows documentation.

## Required repository protections for stable promotion

Settings applied and read back during this mission:

- `main` requires PRs, both named quality-gate jobs and an up-to-date branch. Admins are included; force-pushes/deletion are disabled, linear history and resolved conversations are required.
- The solo-maintainer PR approval count is zero. Independent review is recorded in the PR; this is **not** a mandatory second-human-review rule.
- An active `refs/tags/v*` ruleset blocks tag updates/deletion with no bypass actors. New tag creation still follows repository write access, not a separate restricted-creator rule.
- The `windows-release` environment requires approval by `ffworker` and allows protected branches only. Self-review is allowed because this is a solo-maintainer project. Never approve this environment automatically.
- PR quality jobs have `contents: read`; only the environment-gated publisher has release-write permission. Settings are external state: verify them again before a release.

## Explicit stable promotion (manual only)

1. Merge the reviewed version/changelog change to `main`; `package.json` must contain the new exact `N.N.N` version. Wait for the **push** quality-gate on that exact merged revision, including reproducible ZIP, backend, frontend, Pester and package-safety checks. PR artifacts alone are not eligible.
2. Qualify that exact ZIP on a clean Windows host. Record clean-install, side-by-side upgrade and rollback, AD/LDAP self-service, least-privilege SMB and Classic Outlook results in a reviewed evidence URL. Record limitations and untested cases explicitly. Review changed files and archive contents for private data.
3. Create a new immutable `vN.N.N` tag on the qualified full commit. The publisher supports lightweight and single annotated tags; it never creates or moves tags.
4. From **main**, manually dispatch `publish-windows-release` with the tag, full revision, reviewed HTTPS changelog URL and manual evidence URL. Check those exact inputs and approve the `windows-release` environment explicitly.
5. The workflow verifies the tag/version/ancestry, requires a successful main-push quality run, downloads that run's existing artifacts, verifies checksums and metadata, and publishes ZIP, SHA256SUMS and build metadata. An existing release causes refusal, not replacement. Expired seven-day CI artifacts require renewed qualification; never silently rebuild a different artifact for promotion.
6. Read back the release and download its assets to verify checksum and revision. Publication has not been exercised by this website mission because no new stable version was qualified. Publisher staging is regression-tested with synthetic fixtures, not presented as real release evidence.

The approval record should link the exact commit, checksum, clean-install/upgrade/rollback evidence, and the Classic Outlook manual checklist. New Outlook/Outlook on the web acceptance is a separate product integration and must not be inferred from Classic Outlook results.
