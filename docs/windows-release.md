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

Only after these steps pass should a maintainer approve the PR, create a version tag (e.g. `v2.0.0`) for the verified commit, and manually publish its Windows ZIP and release notes. **This document does not create a tag, merge code, or deploy to a server.**

## Existing installations and rollback

**Do not** deploy the ZIP by blindly overwriting a running installation. Back up the original code, `.env`, `config/templates/` (including all logos), SQLite databases, logs and other state paths; stop Scheduled Tasks before any manual migration. Restore the tested previous version and its matching configuration if needed.

The `scripts/update-signaturee.ps1` helper is **Git-checkout-specific** (fast-forward pull); it cannot update a ZIP installation. Release-to-release upgrade/rollback automation is not yet implemented. For now, test ZIP versions side by side in fresh directories rather than altering a working installation.

The Windows and Linux editions are separate repositories: [Signaturee-public](https://github.com/ffworker/Signaturee-public) and [signaturee-linux](https://github.com/ffworker/signaturee-linux). Linux support is **not included** in this release and is not implied by this Windows documentation.

## Required repository protections for stable promotion

Configure these protections in GitHub repository settings (they are intentionally not changed by this PR):

- Protect `main`; require pull requests and at least one approving reviewer.
- Require the complete `quality-gate` workflow before merge, including both Linux compatibility and Windows quality-gate jobs.
- Require branches to be up to date before merging; disallow force-pushes and deletion of protected branches.
- Restrict tag creation for stable `v*` tags to release maintainers, and do not allow a workflow to create or overwrite a stable tag automatically.
- Use a protected environment with required reviewer approval for any future release-publishing workflow. A green build alone must never publish a stable release.
- Keep release-publishing credentials out of pull-request workflows; the current CI has `contents: read` and uploads test artifacts only.

The approval record should link the exact commit, checksum, clean-install/upgrade/rollback evidence, and the Classic Outlook manual checklist. New Outlook/Outlook on the web acceptance is a separate product integration and must not be inferred from Classic Outlook results.
