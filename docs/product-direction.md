# Signaturee product direction — formats, templates and delivery targets

Status: **Architectural decision, not a claim that every feature is implemented.**

## Product contract

Signaturee is a signature **generation platform**, not merely an AD → classic Outlook file-copy script. It needs independent layers:

1. **Identity and data sources:** AD/LDAP first; optional future CSV/manual/import and identity-provider adapters. A variable is a named field with validation, placeholders and an ordered fallback list; standard mappings are never lost when adding custom attributes.
2. **Template catalog:** Stable signature IDs, optional human-readable labels, HTML source and resource assets. Current production convention: `XY_Template.htm` + `XY_Template.txt`, optionally `XY-Dateien/`. This convention is a ready-to-use preset, *not* the long-term data model.
3. **Assignment rules:** AD security-group membership is the current default. Explicit group DN/CN mappings already exist for exceptions. A future policy layer should support customer-defined assignments (multiple groups, exclusions, defaults, manual grants, and conflict resolution) without depending on filename conventions.
4. **Rendering:** Resolve variables once for a person, then produce an immutable validated rendering model. HTML is the preferred primary layout; plain text and other formats are optional, tested transformations or authored variants.
5. **Delivery adapters:** Download/copy HTML, a classic-Outlook file set, eventual cloud/new-Outlook workflows and possibly API integrations. One signature may have multiple delivery targets, with independent capabilities.

## Formats — deliberate compatibility rules

| Target/workflow | Template inputs | Produced artifacts | Current status |
| --- | --- | --- | --- |
| Classic Outlook on Windows | HTML **and** TXT | HTM, TXT, generated RTF and resources | **Implemented**, maintain as stable behavior |
| Preview / on-screen HTML | HTML (future independent template) | rendered HTML | Preview of current pair exists; HTML-only registration not yet implemented |
| Generic download / copy-paste | HTML optionally authored TXT | HTML and plain text / clipboard | Proposed adapter; validate in target mail clients |
| New Outlook / Outlook on the web | Rich HTML + assets | Account-native/cloud-managed signature via supported integration or manual paste | Not implemented; local classic-Outlook files are not an installation method |
| Plain-text-only destination | authored TXT or verified extraction from HTML | TXT | Proposed, not yet independent |

**Why HTML-only is not an unconditional replacement today:** HTML tables, images, legal disclaimers, conditional segments and line breaks do not convert reliably into readable plain text without explicit rules and a visual comparison. The future wizard should offer:
- **Upload HTML + TXT** (recommended for Outlook; implemented now).
- **Upload HTML only** (future): generate a **draft** TXT with structural parsing, line breaks and placeholder preservation, show side-by-side preview and allow correction before publishing. Never silently create a fake TXT or promise equivalent RTF rendering.
- **HTML for web/export only** (future): target supports it without requiring fake TXT/RTF.

RTF should remain a derived output, not a required input. The existing Windows generator currently converts produced HTML to RTF for productive classic-Outlook runs; that conversion still needs regression tests for Outlook/Word behavior and a graceful fallback strategy.

## Professional admin creation flow

`+ Signatur` must actually create a signature, not an inert card. In automatic mode:
- Show template-pair upload, technical key, resolved AD group preview and short examples of supported placeholders.
- Validate safely and reject duplicates **without overwriting** existing files.
- Persist source assets in the existing `TEMPLATE_DIR`, then refresh the live catalog. **No parallel SQLite business configuration and no arbitrary .env rewrite.**
- Verify the real AD security group exists and has appropriate members before production deployment (future diagnostics; current wizard clearly warns).
- Support resource folders, logos, existing-template updates with revision history, and preview before activating a change (future workflow).

Group-prefix editing belongs under **Erweiterte Gruppenzuordnung → Bearbeiten** because changing it may affect every signature and user.

## Product-quality gates before external distribution

- **Customer separation:** no hard-coded LOGSERV conventions, test with a second example domain and independent templates/groups. Provide installation profiles and backup/restore.
- **Authoring safety:** HTML/CSS sanitization and previews; limit dangerous markup, script, remote fetches, and resource path traversal. Protect editing/upload behind authenticated Admin.
- **Encoding:** current PowerShell generator is Windows-1252 oriented. Specify a deliberate UTF-8 support/migration plan with fixtures covering German umlauts and Outlook HTML/TXT output.
- **Assignment tests:** direct and nested membership semantics, multiple-group conflicts, missing group diagnostics, no unintended access.
- **Outlook compatibility:** test Classic Outlook variants, Word HTML/RTF round-trip, new Outlook separately. No claim that local `.htm/.rtf/.txt` installs new Outlook signatures.
- **Delivery safety:** previews always nonproductive; production target and ACL preflight; no silent overwrite; audit who generated what for which target.
- **Usability:** wizard, editable variable schema, helpful inline validation, keyboard navigation, responsive and legible themes. Keep infrequent dangerous configuration under Advanced.

## Delivery sequence

1. **Current small release:** working + Signatur wizard for HTML/TXT conventional pairs; editable group prefix hidden behind explicit action; tests and docs. Maintain backward compatibility.
2. **Template authoring:** optional HTML-only draft generation, human-reviewed TXT preview, resource/logo uploads and UTF-8/encoding strategy.
3. **Delivery profiles:** formal `outlook-classic`, `html-download`, `plain-text` targets with capability-based requirements.
4. **Identity/policy flexibility:** generic assignment policies and configurable non-AD data sources.
5. **External release gates:** security review, multi-environment integration tests, documented recovery/upgrade contract and an opinionated setup wizard.

This is an architecture roadmap, not an implementation-complete feature matrix.
