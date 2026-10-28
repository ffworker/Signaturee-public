# Employee data sources and supported workflows

Signaturee's goal is reliable **signature generation for IT**, not template design. A working code path is not automatically a supported end-to-end workflow. This page distinguishes the default web application from the older generator/API paths.

## Capability matrix

| Source and workflow | Current entry point | What happens | Release status |
| --- | --- | --- | --- |
| AD: single employee | `Generieren` web UI | Search AD, select assigned signatures, Preflight, Preview, local/network output | **Supported standard workflow**; validate against your AD |
| AD: selected employees | `Generieren` web UI | Up to **50** AD accounts in one targeted run | **Supported standard workflow**, with 50-person cap |
| AD: full OU/domain bulk | `GenerateSignatures.ps1 -MassGeneration` | Legacy generator queries enabled AD users using the configured search base/mapping | **Legacy/advanced**, not exposed as unlimited bulk in the current UI; must validate deployment/configuration |
| AD: employee self-service | `self-service.html`, LDAP login | Resolve *authenticated user's* AD record, assigned signatures, generate and download | **Supported standard workflow** when LDAP and AD lookup work |
| CSV/TXT: worklist | `Generieren` web UI | Read username/email identifier column, then **look up each account in AD** | **Supported AD selection input**, not a standalone data source |
| CSV: full employee records | `GenerateSignatures.ps1 -UseUserFile -UserFilePath ...` (and older import/generate routes) | Legacy generator reads records and `Domains` values from the file | **Code path exists**, but not an independently verified standard web workflow |
| Manually supplied employee record | `POST /api/generate/single` | Legacy endpoint builds a one-row CSV and invokes PowerShell; uses legacy `config/config.json` | **Legacy/advanced**, not offered by the current Generieren screen |

**Do not describe a CSV worklist as AD-free generation.** The modern `/api/run/preflight` workflow resolves supplied identifiers by live `Get-ADUser` and checks AD group assignments. Supplying arbitrary employee columns in a worklist CSV does not replace those values.

## Modern web worklist CSV

Example file:

```csv
sAMAccountName
a.example
b.example
```

The picker also recognizes header names such as `mail`, `email`, `userPrincipalName`, `username` and `user`. Without a recognized header, its first column is treated as identifiers. It does **not** import `givenName`, `department`, phone numbers or custom attributes from that CSV.

Once selected, each identifier must match **exactly one** AD account. Preflight refreshes attributes and checks the configured signature-group membership and templates. A modern targeted run is capped at **50 selected identifiers**.

## Full CSV import in the older generator

The PowerShell core has `-UseUserFile`/`-UserFilePath` and supports CSV (with separate JSON/YAML handling). The file-oriented logic normalizes employee attributes and can read an explicit `Domains` selection instead of relying on AD group membership. For this workflow, the generator also needs a compatible legacy configuration JSON (via `-ConfigFilePath` or its historical default), variable mappings and a selected output directory. The standard `.env` Quickstart **does not automatically create that legacy config file**.

The older `/api/users/import` endpoint stores an uploaded CSV for older generation routes. It is not the same as `Generieren`'s worklist picker. Do not use either import endpoint as a production-data-source switch without first verifying the complete configuration and output behavior.

These paths are **retained for compatibility** pending dedicated acceptance tests. This document does not claim that the current web UI offers a fully AD-free bulk/individual generation flow.

## Separate concerns

1. **Data source:** Where employee attributes come from (live AD in the standard web workflow; file records in the legacy PowerShell path).
2. **Assignment:** Which signature types a person is allowed to generate (AD security-group mapping in the standard web workflow; file `Domains` values in the older generator).
3. **Template:** A supplied HTML/TXT pair with placeholders.
4. **Output:** Local preview or the configured production directory, with the required filesystem/ACL rights.

LDAP is a **login provider** for self-service, not a replacement source for arbitrary CSV records.

## Acceptance tests needed before widening product claims

- AD targeted run: 1, 2 and 50 users; reject 51 safely; verify actual output.
- AD mass mode: test a dedicated OU with enabled/disabled users, multiple signature groups and a safe local output.
- Full CSV: test a small sample without AD connectivity, custom attribute mappings, signature `Domains` and valid output; verify no unexpected AD calls.
- Manual single: verify required input fields, a valid configuration source, and one user's output.
- LDAP self-service: verify user isolation, assigned/unassigned signatures and download contents.
- All modes: verify generated HTM/TXT, Microsoft Word/RTF behavior, encoding and cleanup after failures.

No production runs should be used as the first acceptance test. Treat all unverified legacy entry points as **advanced** until they have a testable setup and explicit failure handling.

[README](../README.md) · [API](api.md) · [Templates](templates.md)
