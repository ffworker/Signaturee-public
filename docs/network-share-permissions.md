# Network Share Permissions

Signaturee can write productive signatures to a Windows SMB/UNC path such as:

```text
\\fileserver\Signatures\Users
```

The identity that runs the Signaturee backend must have access to that path.

## Backend running as Windows SYSTEM

The default Windows Scheduled Task can run as:

```text
NT AUTHORITY\SYSTEM
```

When `SYSTEM` accesses a remote domain SMB server, it normally authenticates using the **computer account of the Signaturee server**:

```text
DOMAIN\SIGNATUREE-SERVER$
```

Example:

```text
CONTOSO\SIG01$
```

The trailing `$` is part of the computer-account name.

**Important:** Grant the **Signaturee VM's domain computer account**, not `NT AUTHORITY\SYSTEM` on the **remote file server** (which is that file server's own local SYSTEM identity). If you are setting up a new Windows Server 2025 VM, follow the [VM preparation guide's SMB step](prepare-windows-server-2025.md#8a-allow-the-new-vms-computer-account-on-the-smb-file-server).

## Required permissions

Windows applies both:

1. SMB share permissions
2. NTFS permissions

The effective permission is the most restrictive combination.

Signaturee must be able to:
- enumerate the configured target,
- create user directories,
- create/replace signature files,
- delete/replace generated files,
- set ACLs on generated user directories.

Because productive generation changes ACLs, simple write/modify permission may not be sufficient.

### Recommended scope

Grant the execution identity sufficient rights **only on the dedicated Signaturee output tree**, not on unrelated file-server data.

For a dedicated target such as:

```text
D:\Shares\Signatures\Users
```

a practical configuration is:
- SMB share: allow the Signaturee execution identity sufficient control to write and manage permissions,
- NTFS: Full Control on the dedicated Signaturee target directory, inherited by child folders/files.

If the existing share has broad share permissions and access is controlled through NTFS, keep the organization's existing share-permission model and grant the required NTFS rights only on the Signaturee subtree.

## Adding the computer account

Apply this to **both** the share ACL (**Sharing → Advanced Sharing → Permissions**) and the backing folder's NTFS ACL (**Security → Edit/Advanced**). A grant on one layer is insufficient when the other remains restrictive. Choose the actual Signaturee VM account, **not the broad `Domain Computers` group**.


In the Windows ACL dialog:

1. Open **Security → Edit → Add**.
2. Open **Object Types**.
3. Enable **Computers**.
4. Select the AD domain as the location.
5. Enter the Signaturee server computer name, for example `SIG01`.
6. Resolve the name.

Windows should resolve it to an identity similar to:

```text
CONTOSO\SIG01$
```

You can confirm the computer account from a machine with the AD PowerShell module:

```powershell
Get-ADComputer SIG01
```

## Dedicated service account alternative

Instead of running the backend as `SYSTEM`, a deployment can run the backend Scheduled Task using a dedicated domain service account or gMSA.

Examples:

```text
CONTOSO\svc_signaturee
CONTOSO\gmsa_signaturee$
```

Grant that identity only the rights required by the Signaturee output tree.

A dedicated service identity can be easier to audit across multiple Signaturee servers, while `SYSTEM` + computer account avoids storing a normal service-account password.

## DNS name instead of IP

Prefer a server name/FQDN for SMB access:

```text
\\fileserver.contoso.local\Signatures\Users
```

rather than:

```text
\\192.0.2.10\Signatures\Users
```

Name-based SMB access works better with normal domain authentication/Kerberos and keeps the UNC name stable when hardware changes.

## Verify from Signaturee

Set `NETWORK_DEPLOYMENT_PATH` in the **project-root `.env`**, run `.\scripts\reload-config.ps1`, and then open:

**Administration → Ausgabe → Netzwerkpfad testen**

The check runs as the **actual backend execution identity** and verifies access, temporary directory/file creation, and Windows ACL modification on that temporary directory. The probe removes the temporary directory afterward. Production generation still needs correct permissions for every target user directory.

An `EPERM` at the `stat` or `mkdir` stage typically means the backend identity cannot access the share/path; a separate AD-query credential in `.env` **does not** change this identity. Check the SMB share ACL, NTFS ACL, domain trust/DNS and the exact task principal. The test will never grant permissions automatically.
