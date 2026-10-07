# Templates

Signaturee uses Outlook-compatible HTML/TXT templates from `Templatefiles/`.

## Add a signature

In **Administration → Signaturen**:

1. create a signature key and label
2. map one or more AD groups
3. configure HTML/TXT filenames
4. configure the optional resource folder
5. save the profile
6. run Preflight with a test user

## Common placeholders

Typical defaults:

```text
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
```

The authoritative list is **Administration → Variablen**.

## Files

Example:

```text
Templatefiles/
├─ ACME_Template.htm
├─ ACME_Template.txt
└─ ACME-Dateien/
   └─ logo.png
```

Keep image/resource references relative to the matching resource folder.

## Encoding

Outlook/Word templates are safest with Windows-1252 when using the current PowerShell generator.

If umlauts or symbols are corrupted, re-save the affected `.htm` / `.txt` file as Windows-1252 and test again.

## Test safely

Use **Server-Vorschau** first. Productive generation should only be used after Preflight is green.
