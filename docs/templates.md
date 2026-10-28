# Templates and variables

**Signaturee uses templates that you supply.** It does not contain a visual drag-and-drop editor and does not require one for generation. Bring working HTML/TXT source files from your design/marketing workflow and configure how employee fields replace their placeholders.

The active source directory is defined by `TEMPLATE_DIR` in the local `.env` (default `config/templates/`).

## Automatic discovery (standard configuration)

```dotenv
TEMPLATE_DIR=config/templates
SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true
```

Example:

```text
config/templates/
  HR_Template.htm
  HR_Template.txt
  HR-Dateien/
    logo.png
  Sales_Template.html
  Sales_Template.txt
```

Each **complete pair** appears as a signature in **Administration → Signaturen**. Template extensions are case-insensitive; `.html` is accepted as well as `.htm`. The optional matching `XY-Dateien/` directory is used for linked resources. The bundled example templates are **not** auto-discovered as production signatures.

| Source files | Signature key | Existing AD group CN |
| --- | --- | --- |
| `HR_Template.htm` + `HR_Template.txt` | `HR` | `Signature-HR` |
| `Sales_Template.html` + `Sales_Template.txt` | `Sales` | `Signature-Sales` |

Both HTML and TXT files **must** be present. An incomplete pair causes configuration validation to fail; it does not silently produce an HTML-only signature.

The catalog is derived from disk whenever the effective profile is requested. **An Admin-created signature becomes visible without restarting the backend.** After a manual file change, refresh the catalog/profile view. **Changes to `.env`**—including the group prefix—still require configuration activation/reload.

Signaturee does **not** create AD groups or edit user memberships. The default automatic mapping compares the group's **CN**; direct group membership is the reliable baseline.

## Add a signature through Admin

Under **Administration → Signaturen → + Signatur** (with automatic discovery enabled):

1. Enter a key (for example `HR`).
2. Upload one HTML file (`.htm`/`.html`), containing your layout and placeholders.
3. Upload one plain-text file (`.txt`), containing the equivalent unformatted content.
4. Select **Signatur anlegen**.

The API creates `HR_Template.htm` and `HR_Template.txt` without overwriting existing files or touching `.env`. A new pair appears in the catalog automatically, but assigning it to an employee requires the **existing** `Signature-HR` group (or your configured prefix). Uploading the pair alone does not prove that group exists.

Logo/image folders are not uploaded by this specific wizard. Preserve/add any matching `HR-Dateien/` folder separately in the template directory.

The group-prefix setting is intentionally placed behind **Erweiterte Gruppenzuordnung → Bearbeiten**, as changing it affects every convention-based signature.

## Explicit mapping for nonstandard groups/files

If the convention is unsuitable, set a manual mapping instead:

```dotenv
SIGNATUREE_SIGNATURES_AUTO_DISCOVER=false
SIGNATUREE_SIGNATURES_JSON={"HR":{"label":"HR","adGroups":["CN=Mail-HR,OU=Groups,DC=example,DC=local"],"templateHtml":"HR_Template.htm","templateTxt":"HR_Template.txt","resourceFolder":"HR-Dateien"}}
```

Manual full group DNs match the **complete DN**; short names match the CN. When automatic discovery is enabled, `SIGNATUREE_SIGNATURES_JSON` is ignored.

The Admin `+ Signatur` upload wizard is for **automatic-discovery mode**. Manual mappings are maintained in configuration; do not assume the upload wizard edits those mappings.

## Common placeholders

```text
$givenname
$sn
$mail
$department
$description
$telephonenumber
$mobile
$fax
$sAMAccountName
```

The effective mapping is configurable under **Administration → Variablen**. For example, a custom placeholder `$standort` can read AD `extensionAttribute10` without deleting built-in variables. `SIGNATUREE_VARIABLES_EXTRA_JSON` stores additive/overridden variable definitions in `.env`; the optional full `SIGNATUREE_VARIABLES_JSON` replaces the complete schema and is not part of normal Admin editing.

The generator uses the configured variables for substitution. It also contains historical fax/mobile table-row handling tailored to certain HTML structures: **test any new template in Preview before production**, particularly if it contains `Fax:` or mobile-number rows.

## Output formats and encoding

- **Source files:** HTML + TXT are required for the current generator. There is no automatic HTML-only-to-TXT authoring workflow.
- **Generated files:** HTM and TXT, with an attempted RTF conversion during non-preview output. RTF conversion uses Microsoft Word; without Word or after a conversion error the current generator writes an **empty RTF placeholder**.
- **Images:** Preserve relative resource paths and any associated `XY-Dateien/` directory.
- **Encoding:** The current PowerShell rendering path reads/writes templates using **Windows-1252**. Test the original file encoding, HTML charset, German umlauts and any non-Western characters with representative users.
- **Client scope:** This is a Classic-Outlook-compatible file workflow. A local HTM/TXT/RTF set is not a supported installation mechanism for new Outlook or Outlook on the web.

## Safe rollout checklist

1. Confirm the complete pair and resources appear under **Signaturen**.
2. Check an employee's **direct** signature-group membership.
3. Run **AD-Suche testen**, then **Generieren → Preflight → Vorschau** for a representative employee.
4. Check substituted variables, line breaks, links, image rendering, umlauts and the generated TXT.
5. Verify the local output and Word/RTF behavior.
6. Only then test the production UNC destination with the correct backend task/ACL identity.

[README](../README.md) · [Environment](environment.md) · [AD onboarding](ad-onboarding.md) · [Data sources](data-sources.md)
