# Signaturee

[![Windows quality gate](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/ffworker/Signaturee-public/actions/workflows/quality-gate.yml) · [MIT License](LICENSE)

**Email signature generation and deployment for IT administrators.** Use employee data, existing HTML/TXT templates and configurable signature assignments to generate consistent signatures without setting them up one mailbox at a time.

Signaturee is a self-hosted Windows application: a web frontend, a Node.js API and a PowerShell generator. It is **not a signature designer**. Bring your own templates; Signaturee handles user lookups, variable mapping, selection, validation and output.

## What you can do

| Workflow | Current availability |
| --- | --- |
| **Individual AD signatures** | **Web UI:** search an employee, choose assigned signatures, run Preflight, preview and generate |
| **Targeted multi-user runs** | **Web UI:** select or paste up to **50 AD users per run**, choose signatures and output |
| **AD bulk generation** | **PowerShell core:** has a separate `-MassGeneration` mode; not yet exposed as an unlimited, verified end-to-end web workflow |
| **LDAP self-service** | **Web UI:** employees sign in with AD credentials and generate/download their *own* assigned signatures |
| **CSV as a list of employees to look up** | **Web UI:** CSV/TXT worklist imports *identifiers*, then retrieves employee attributes from AD |
| **CSV as the complete data source, without AD** | **Legacy PowerShell/file-import path exists**; not yet a verified, first-class workflow in the current web UI |
| **Manually specified employee attributes without AD** | **Legacy `/api/generate/single` path exists**, with separate configuration requirements; not yet part of the current web generator |

**Read this distinction before choosing Signaturee:** The standard web generator currently **requires Active Directory** for user resolution and signature assignment. Uploading a CSV to its worklist does **not** substitute CSV columns for AD attributes. See [Data sources and workflow limits](docs/data-sources.md).

## Requirements

- Windows Server or a supported Windows workstation; Windows PowerShell **5.1**.
- **Node.js 22.13+**, Git and the RSAT **ActiveDirectory** PowerShell module for AD workflows.
- Network/DNS access to the domain controller, plus suitable AD read rights.
- For productive SMB output: an existing UNC destination and share/NTFS permissions for the **Windows account running the backend**.
- Microsoft Word is used for RTF conversion. Without it (or if conversion fails), the current generator writes an **RTF placeholder**, not a usable rich-text signature. Validate this before relying on RTF in production.

For RSAT installation commands and an initial machine check, see [Windows prerequisites](docs/prepare-machine-dependencies.md).

## Quickstart — standard AD deployment

Run PowerShell **as Administrator** on the intended Signaturee host:

```powershell
git clone https://github.com/ffworker/Signaturee-public.git C:\Signaturee
cd C:\Signaturee
npm ci --omit=dev

Copy-Item .env.example .env
New-Item -ItemType Directory -Force .\config\templates | Out-Null
notepad .env
```

Edit your **local, Git-ignored** `.env`. At minimum, set:

- `AD_SERVER`: your domain controller's hostname/FQDN.
- `OU_SEARCH_BASE`: an existing distinguished name, e.g. `DC=example,DC=local`.
- `AUTH_LDAP_DOMAIN`: your AD domain (for employee self-service); set `AUTH_LDAP_ENABLED=false` if you are not configuring LDAP yet.
- `NETWORK_DEPLOYMENT_PATH`: the UNC path for production, when needed.
- `CORS_ORIGINS`: the precise allowed web origin(s); use HTTPS behind a reverse proxy for remote users.

Keep the normal template-based mapping enabled:

```dotenv
SIGNATUREE_CONFIG_MODE=env
TEMPLATE_DIR=config/templates
SIGNATUREE_SIGNATURES_AUTO_DISCOVER=true
```

Add at least one **complete** template pair to `config/templates/`, for example `HR_Template.htm` and `HR_Template.txt`, or use one of your existing pairs. The corresponding AD group `Signature-HR` must already exist and contain the intended employee(s). Signaturee does **not** create AD groups.

Validate the local configuration **before starting**:

```powershell
node .\backend\server.js --check
```

This validates configuration and available template files. It **does not test live AD access, LDAP passwords, Microsoft Word or SMB rights**.

Create the first **local Admin account** (the password is entered securely; do not put it into `.env`):

```powershell
$pw = Read-Host "Signaturee Admin password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) |
        node .\scripts\manage-auth-users.js add --username admin --role admin --password-stdin
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
```

Install and start the two Scheduled Tasks:

```powershell
.\scripts\install-backend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
.\scripts\install-frontend-task.ps1 -RepoRoot C:\Signaturee -EnvFile C:\Signaturee\.env -StartNow
```

Open **http://127.0.0.1:3000/login.html** on the host and select **Lokales Signaturee-Konto** to sign in as Admin. Configure [HTTPS/reverse proxy](docs/reverse-proxy.md) before using the service from other computers.

## First successful signature — check each layer

1. **Administration → Signaturen:** verify the expected HTML/TXT pairs appear in the catalog. **+ Signatur** can upload a new pair in automatic-discovery mode.
2. **Administration → Benutzer & Zugriff:** use **AD-Suche testen**; separately run **LDAP-Login testen** when using employee self-service.
3. **Administration → Ausgabe:** test your local output folder. Before SMB production, test the UNC path and backend task's ACL access.
4. **Generieren:** search for an employee with *direct membership* in the matching signature group; select the desired signature and the **local** target.
5. Run **Preflight → Vorschau → Generieren**. Inspect the output and employee attributes before attempting the network target.

A successful template catalog does **not** imply that AD queries, group membership, SMB or Word-based RTF output work.

## Templates, attributes and assignments

Signaturee consumes **existing** HTML and TXT signature templates; it does not provide a drag-and-drop editor. In the default convention:

```text
config/templates/
  HR_Template.htm
  HR_Template.txt
  HR-Dateien/       # optional image/resource folder
```

A full pair creates the signature key `HR`, which is associated with the existing AD security-group **CN** `Signature-HR`. `.html` can replace `.htm`. Files are discovered from the configured template directory when the effective profile is read; **the new + Signatur upload does not require a backend restart** just to appear in the catalog. Changes to `.env` do require reload/activation.

Use **Administration → Variablen** to map placeholders (e.g. `$givenname`, `$sn`, `$mail` or a custom `$standort`) to AD attributes such as `extensionAttribute10`. Built-in mappings remain available when adding extra variables.

Different group names or filenames? The default group prefix can be changed under **Signaturen → Erweiterte Gruppenzuordnung → Bearbeiten**. Alternatively, turn off discovery and configure an explicit mapping with `SIGNATUREE_SIGNATURES_JSON` in `.env`.

[Template rules and examples](docs/templates.md) · [AD onboarding](docs/ad-onboarding.md) · [Full configuration reference](docs/environment.md)

## Roles and identities

Three things are intentionally separate:

- **Local Admin / IT accounts:** Admin changes configuration and access; IT can search and generate signatures. Admin privileges are not granted through LDAP.
- **Employee LDAP login:** employees authenticate with their own AD credentials to access **Self-Service**. Optional LDAP role rules can elevate an eligible employee to IT; **these rules do not assign signature types**.
- **Signature assignment:** comes from AD group membership (e.g. `Signature-HR`), independently of login role. Direct group membership is the safest baseline; nested groups are not consistently expanded.
- **SMB authorization:** comes from the backend Scheduled Task's Windows principal, **not** from employee LDAP credentials or optional AD query credentials. A SYSTEM task normally reaches a domain file share as `DOMAIN\COMPUTER$`.

No Domain Administrator identity is needed for ordinary AD lookup. See [permissions](docs/network-share-permissions.md) and [security](SECURITY.md).

## Operations

The application runs as **two Scheduled Tasks**, not as Windows Services: `Signaturee-Backend-Runner` (default port 3001) and `Signaturee-Frontend-Runner` (default port 3000).

Reload a changed `.env`, using elevated PowerShell:

```powershell
cd C:\Signaturee
.\scripts\reload-config.ps1
```

Update the installed code and restart its runners:

```powershell
cd C:\Signaturee
.\scripts\update-signaturee.ps1
```

The update script uses a fast-forward Git pull and locked npm dependencies, and preserves ignored local configuration and templates. **It does not implement automatic rollback.** Back up before upgrades. Do not run `npm start` simultaneously with Scheduled Tasks on the same ports.

Configuration may be saved through the **local Admin** UI. Only approved business keys are editable; ports, login policy, secrets and task identities remain file-managed. After saving, activate the new `.env` via the Admin UI or reload script.

## Important limits and security

- **Current web generator:** up to 50 selected users per targeted Preflight/Generate run; worklist CSV identifies AD accounts but is **not an offline-data import**.
- **Classic Outlook:** generated file sets consist of HTM, TXT and an attempted RTF conversion. A valid RTF depends on Microsoft Word. Local Classic-Outlook files are **not** a deployment mechanism for new Outlook/Outlook on the web.
- **Encoding:** the PowerShell rendering path reads/writes template data with **Windows-1252**. Test umlauts, Unicode characters and existing HTML encoding with your real templates before production.
- **Templates and logs:** templates are administrator-controlled; generation logs can contain substituted employee information. Restrict access to logs, databases, `.env`, output shares and the template directory.
- **Network access:** keep `AUTH_REQUIRED=true`, protect the backend port, use HTTPS for non-local users, and grant least privilege to the task's SMB destination.
- **Backup:** preserve `.env`, `config/templates/` with all resources, `config/signaturee_auth.db`, `config/signaturee.db` and custom output/state paths. The API settings backup is **not a complete installation backup**.

## Troubleshooting at a glance

| Symptom | Start with |
| --- | --- |
| No signatures in Admin | Verify complete HTML/TXT pairs, `TEMPLATE_DIR` and `SIGNATUREE_SIGNATURES_AUTO_DISCOVER`; reload the effective catalog |
| Signature visible but not assigned | Verify direct AD `memberOf`, actual group CN and configured group prefix |
| No AD search results | Run **AD-Suche testen**; check `AD_SERVER`, search-base DN, RSAT and backend task identity |
| LDAP login fails | Run **LDAP-Login testen**, check the AD domain and optional container; do not confuse LDAP with AD querying |
| Network output fails (`EPERM`) | Check UNC name, share/NTFS permissions and task principal; see the SMB troubleshooting guide |
| Empty/invalid RTF output | Check Microsoft Word availability and generator logs |
| Config saved but not active | Use **Gespeicherte .env aktivieren** or `.\scripts\reload-config.ps1` |

## Documentation

- [Windows host preparation](docs/prepare-machine-dependencies.md)
- [Template and variable reference](docs/templates.md)
- [Data sources and workflow limits](docs/data-sources.md)
- [Compatibility audit and cleanup decisions](docs/compatibility-audit.md)
- [Environment/configuration](docs/environment.md)
- [Active Directory onboarding](docs/ad-onboarding.md)
- [SMB permissions](docs/network-share-permissions.md) · [Reverse proxy](docs/reverse-proxy.md)
- [API reference](docs/api.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

For verification, use `npm run test:backend` and the Windows `npm run quality-gate` (includes Pester). CI is a regression gate; it is **not** an endorsement of an untested customer AD/SMB/Outlook setup.

Licensed under [MIT](LICENSE).
