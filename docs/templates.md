# Templates — Signaturee v2

The active source directory is **`config/templates/`**, configured by `TEMPLATE_DIR=config/templates` in the project-root `.env`. It contains the HTML/TXT source files and their image/resource folders.

## Automatic discovery (recommended)

~~~dotenv
TEMPLATE_DIR=config/templates
SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true
~~~

Example layout:

~~~text
config/templates/
├── AD_Template.htm
├── AD_Template.txt
├── AD-Dateien/
│   └── logo.png
├── FF_Template.htm
├── FF_Template.txt
├── FF-Dateien/
│   └── logo.png
├── LS_Template.htm
└── LS_Template.txt
~~~

Each **complete pair** is shown as an available signature in Administration → **Signaturen**. `.html` is also accepted, and extensions are case-insensitive. Optional matching `XY-Dateien/` folders become resource directories. The bundled `example_template.*` pair is deliberately ignored.

| Templates | Signature | AD security group |
| --- | --- | --- |
| `AD_Template.htm` + `AD_Template.txt` | AD | `Signature-AD` |
| `FF_Template.htm` + `FF_Template.txt` | FF | `Signature-FF` |
| `LS_Template.htm` + `LS_Template.txt` | LS | `Signature-LS` |

A corresponding **existing** AD security group grants an employee access to the associated signature. Signaturee **does not create or edit AD groups**. The default automatic rule matches the group's CN. Direct group membership is the supported baseline; do not assume nested membership is expanded.

To use `Signatur-XY` groups instead, set `SIGNATUREE_AUTO_GROUP_PREFIX=Signatur-`.

**Both HTML and TXT are required.** An incomplete pair causes configuration validation to fail rather than silently hiding it. After adding or renaming a template, run `.\scripts\reload-config.ps1` and refresh Admin.

## Manual mapping (optional)

If your template filenames/groups do not follow the convention, disable discovery and define an explicit one-line JSON mapping in `.env`:

~~~dotenv
SIGNATUREE_SIGNATURES_AUTO_DISCOVER=false
SIGNATUREE_SIGNATURES_JSON={"AD":{"label":"AD","adGroups":["CN=Signature-AD,OU=Groups,DC=example,DC=local"],"templateHtml":"AD_Template.htm","templateTxt":"AD_Template.txt","resourceFolder":"AD-Dateien"}}
~~~

In manual mode, full group DNs match exactly and short group names match the CN. With discovery enabled, `SIGNATUREE_SIGNATURES_JSON` is ignored.

## Variables, image assets and encoding

Common built-in placeholders include:

~~~text
$givenname
$sn
$mail
$domain
$department
$description
$telephonenumber
$mobile
$fax
$sAMAccountName
~~~

The effective variable catalog is shown under **Administration → Variablen**. The advanced `SIGNATUREE_VARIABLES_JSON` override is generally unnecessary.

Keep relative resource/image links aligned with the matching `XY-Dateien/` folder. Preserve the entire folder when copying templates. If special characters render incorrectly in Outlook, verify the HTML charset and template file encoding on a copy, then test using server preview before production.

## Test sequence

Confirm all types in **Administration → Signaturen**, test AD search, select a test employee with a direct `Signature-XY` membership, run Preflight and Server-Vorschau, then perform a controlled production generation once SMB permissions have been verified.

[README](../README.md) · [Environment](environment.md)
