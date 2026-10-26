# KAYAN ERP Windows x64 installer

This directory contains the Windows packaging source. The release is a 64-bit Inno Setup installer assembled on Windows by `build-installer.ps1`.

## Supported architecture

- **Windows 10/11 x64**: intended supported target.
- **32-bit Windows**: not supported. The Flutter Windows client, official PostgreSQL 17 Windows binary distribution, and bundled Node runtime are staged as x64. The builder refuses a 32-bit OS; it does not make or label an x86 package.

The installer contains the Flutter Windows release client, a production Flutter Web build served by the API, NestJS output and production dependencies, Prisma CLI/client/migrations, official Node.js x64, PostgreSQL 17 x64, and the Microsoft Visual C++ x64 runtime. Vendor archives are checksum/signature checked by the build script. The Inno Setup compiler is a **build-host** requirement only. Print/export flows that open a separate document use the machine's registered browser.

## Build (Windows build host)

Requirements on the build machine only: Windows x64, Flutter stable SDK, Node.js/npm, Git, network access to the pinned vendor downloads, at least 5 GB free staging space, and Inno Setup 6.3 or newer (the script uses the `x64compatible` architecture identifiers added in 6.3). The customer does not install Flutter, Node, PostgreSQL, or Docker. A registered browser is used for print/export pages, not for the core program.

From the repository root, run PowerShell without interactive package prompts:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File distribution\windows\build-installer.ps1
```

The script writes the staging tree under `build\windows-installer-stage\KAYAN-ERP\` and the installer under `build\windows-installer\KAYAN-ERP-Setup-<pubspec version>-x64.exe`. It does not touch the working tree's existing `docker-compose.yml`, backend-gate, or `.env` changes. It refuses to use a runtime download whose integrity verification fails.

The installer itself (not the build) requires elevation because it registers a PostgreSQL Windows service. Its post-install checkbox offers to launch KAYAN ERP.

## First install and runtime

1. Install the x64 package. Setup verifies/installs the included Visual C++ runtime and initializes a private PostgreSQL 17 cluster if this is a new machine.
2. The database service `KayanERPPostgreSQL` starts automatically with Windows and binds only to loopback on port 5432. Port 5432 already held by another service is a hard, readable install error; the installer never replaces that service.
3. On first app start, the existing backend preparation path applies checked-in Prisma migrations and asks the first user to choose the initial administrator credentials. It does not seed a default user or reset an existing database.
4. The Flutter client starts the bundled Nest API with the bundled Node runtime, waits for `/api/v1/health`, and renders the interface. The API is bound to loopback and serves the included web build from the same origin as well.

### The company page: a new company never reuses the old database

Setup asks one question: a new company, or the one already on this computer.

- **A new company** creates a database of its own (`erp_kayan_<timestamp>`) with
  the current schema and nothing in it. If this computer already holds a
  company, Setup first takes a `pg_dump` backup of it, verifies that
  `pg_restore --list` can read the file back, and leaves the old database
  exactly as it is. It never empties, renames or reuses it, so the previous
  company can always be recovered.
- **An existing company** verifies that the database on disk really is this
  installation's own (owner, role, tables), backs it up, and upgrades it in
  place.

Every write of `kayan.env` carries `KAYAN_SETTINGS_GENERATION`, which only
grows. Two copies exist (the protected one in `%ProgramData%` and the per-user
one), and the program reads the newer one, so a profile that could not be
updated can never point the program at the previous company. The last thing
Setup does is prove the program can reach the database its settings name
(`KAYAN-RUNTIME-VERIFIED`); it reports success only after that.

### Licence enforcement and evaluation builds

A product Setup carries the operator's `public-key.pem` and switches licence
enforcement on. `build-installer.ps1` **refuses** to build a customer installer
without a key; `-EvaluationBuild` builds one explicitly for development and CI,
and that fact is written into `runtime-manifest.json` (`licenseEnforcement`).
An installed copy whose protected licence folder holds a key or the
`enforcement.required` marker always enforces, whatever the user's environment
says. To produce a real release, place the operator's `public-key.pem` beside
`build-installer.ps1` and run it without `-EvaluationBuild`.

### Two Windows rules the runtime setup has to respect

**PostgreSQL refuses administrative permissions.** The server aborts with
"Execution of PostgreSQL by a user with administrative permissions is not
permitted." before it does anything, and that includes the bootstrap backend
`initdb` starts. The installer itself is elevated, so `install-runtime.ps1`
starts `initdb` through `UnelevatedProcess.cs`, which duplicates the process
token and marks the Administrators and Power Users groups "deny only" - the
same thing Windows does for a normal, non-elevated administrator session. The
server itself runs as the restricted `NT AUTHORITY\LocalService` account,
which is not an administrator. `scripts/smoke-test-installed-windows.ps1`
asserts that the service does not run as an administrator.

**The cluster is created in its final directory.** PostgreSQL gives the files
it creates the permissions of the directory they are created in. A cluster
that is built somewhere else and moved afterwards keeps the permissions of
the place it came from, and the service account then cannot write the WAL
files of its own database. The data directory is therefore created (empty)
first, with the service account and inheritance already in place, and
`initdb` writes straight into it. On an upgrade the whole tree gets the
inheritance of its directory re-applied, so an older cluster keeps working.

The Start menu provides `Repair KAYAN ERP` plus start/stop/restart PostgreSQL shortcuts (and `{app}\repair-kayan.bat` / `{app}\repair-runtime.ps1` inside the installation directory); Windows displays UAC for service control or repair when required. If an earlier installation left `%ProgramData%\KAYAN-ERP\kayan.env` with a broken or empty DACL, both the installer and the bundled repair tool recover ownership and file permissions in place without deleting or overwriting the existing credentials or company database. Closing the ERP window stops its API child process. PostgreSQL remains running as a Windows service until explicitly stopped or uninstalled.

## Persistent data and uninstall

- PostgreSQL data: `%ProgramData%\KAYAN-ERP\PostgreSQL\data`
- PostgreSQL diagnostic logs: `%ProgramData%\KAYAN-ERP\logs\`
- Installer/bootstrap diagnostics: `%ProgramData%\KAYAN-ERP\logs\installer.log` (connection strings and password values are redacted). The last line of that log names the step that failed, and the installer shows that same step to the customer.
- Per-user ACL-protected connection settings and signing keys: `%APPDATA%\KAYAN-ERP\kayan.env`
- App/backend logs: `%APPDATA%\KAYAN-ERP\logs\backend.log`
- Company logo uploads: `%APPDATA%\KAYAN-ERP\uploads`; the packaged API receives this path through `KAYAN_UPLOAD_DIR`, never inside the replaceable program folder.

Upgrading installs over the app files, stops/restarts the local service, and retains PostgreSQL data and per-user settings. Uninstall stops and unregisters the PostgreSQL service and removes program files, but **keeps** `%ProgramData%\KAYAN-ERP\PostgreSQL\data`, user settings, and logs. Before moving the database to another machine, use the in-app Backup and Restore feature or make a PostgreSQL physical backup while the service is stopped. To permanently erase company records after uninstall, first preserve any required backup, then manually delete `%ProgramData%\KAYAN-ERP\PostgreSQL\data`; this destructive step is deliberately not part of uninstall.

The first install needs enough disk for the bundled installer plus a PostgreSQL data directory. Avoid installing over an existing third-party PostgreSQL service on port 5432. The database service runs as the restricted Windows LocalService account, uses SCRAM password authentication and loopback-only TCP; credentials and JWT secrets are randomly generated into the installing user's ACL-protected settings file and are not embedded in the installer or logged.

## Verification boundary

The build pipeline validates artifact hashes, staged entry points, required dependencies, absence of development `.env`, and emits a runtime manifest. The **Windows Installer** workflow goes further: on a real `windows-latest` machine it compiles the `.exe`, installs it silently, and then verifies the installed product with `scripts/smoke-test-installed-windows.ps1` - installer exit code, the `KayanERPPostgreSQL` service exists and runs as a non-administrator account, `pg_isready` on `127.0.0.1:5432`, the cluster really was initialized in `%ProgramData%\KAYAN-ERP\PostgreSQL\data`, the production database preparation, a disposable CI administrator, and a second upgrade/reinstall that must preserve a disposable company-data row. It then launches the installed `erp_kayan.exe`, verifies `/api/v1/health` reports `status=ok` and `database=up`, and logs in against the installed database. A build that only compiles is never treated as proof.

The same run also proves the reported defects are gone: choosing "a new company" over a computer that already holds one produces a new empty database while the previous company and its backup stay intact, the installed program is proven to be connected to that new database, and - with a throwaway CI signing key installed into the package - an unlicensed installation refuses every business request, a key for another machine is refused, a valid key activates it, the licence survives a restart, and deleting it blocks again.

The automated second install exercises the upgrade/reinstall path and proves a disposable database row survives. It does not replace a carefully supervised update of a real customer's installation, which should still be tested before a wide rollout. Uninstall retention (service removed, database kept) is not yet automated and should also be confirmed before broad distribution.
