# KAYAN ERP Windows x64 installer

This directory contains the Windows packaging source. The release is a 64-bit Inno Setup installer assembled on Windows by `build-installer.ps1`.

## Supported architecture

- **Windows 10/11 x64**: intended supported target.
- **32-bit Windows**: not supported. The Flutter Windows client, official PostgreSQL 17 Windows binary distribution, and bundled Node runtime are staged as x64. The builder refuses a 32-bit OS; it does not make or label an x86 package.

The installer contains the Flutter Windows release client, a production Flutter Web build served by the API, NestJS output and production dependencies, Prisma CLI/client/migrations, official Node.js x64, PostgreSQL 17 x64, and the Microsoft Visual C++ x64 runtime. Vendor archives are checksum/signature checked by the build script. The Inno Setup compiler is a **build-host** requirement only. Print/export flows that open a separate document use the machine's registered browser.

## Build (Windows build host)

Requirements on the build machine only: Windows x64, Flutter stable SDK, Node.js/npm, Git, network access to the pinned vendor downloads, at least 5 GB free staging space, and Inno Setup 6. The customer does not install Flutter, Node, PostgreSQL, or Docker. A registered browser is used for print/export pages, not for the core program.

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

The Start menu provides start/stop/restart PostgreSQL shortcuts; Windows displays UAC for service control when required. Closing the ERP window stops its API child process. PostgreSQL remains running as a Windows service until explicitly stopped or uninstalled.

## Persistent data and uninstall

- PostgreSQL data: `%ProgramData%\KAYAN-ERP\PostgreSQL\data`
- PostgreSQL diagnostic logs: `%ProgramData%\KAYAN-ERP\logs\`
- Installer/bootstrap diagnostics: `%ProgramData%\KAYAN-ERP\logs\installer.log` (connection strings and password values are redacted).
- Per-user ACL-protected connection settings and signing keys: `%APPDATA%\KAYAN-ERP\kayan.env`
- App/backend logs: `%APPDATA%\KAYAN-ERP\logs\backend.log`
- Company logo uploads: `%APPDATA%\KAYAN-ERP\uploads`; the packaged API receives this path through `KAYAN_UPLOAD_DIR`, never inside the replaceable program folder.

Upgrading installs over the app files, stops/restarts the local service, and retains PostgreSQL data and per-user settings. Uninstall stops and unregisters the PostgreSQL service and removes program files, but **keeps** `%ProgramData%\KAYAN-ERP\PostgreSQL\data`, user settings, and logs. Before moving the database to another machine, use the in-app Backup and Restore feature or make a PostgreSQL physical backup while the service is stopped. To permanently erase company records after uninstall, first preserve any required backup, then manually delete `%ProgramData%\KAYAN-ERP\PostgreSQL\data`; this destructive step is deliberately not part of uninstall.

The first install needs enough disk for the bundled installer plus a PostgreSQL data directory. Avoid installing over an existing third-party PostgreSQL service on port 5432. The database service runs as the restricted Windows LocalService account, uses SCRAM password authentication and loopback-only TCP; credentials and JWT secrets are randomly generated into the installing user's ACL-protected settings file and are not embedded in the installer or logged.

## Verification boundary

The build pipeline validates artifact hashes, staged entry points, required dependencies, absence of development `.env`, and emits a runtime manifest. This repository's current execution environment is Linux and has no Windows, PowerShell, Inno Setup compiler, Wine, or Docker. Consequently, a real `.exe` installer compile, Windows service lifecycle, UAC behavior, shortcut validation, update-over-existing-data run, and uninstall retention test must be performed on a Windows x64 machine before distributing the installer. Build success alone is not proof of those behaviors.
