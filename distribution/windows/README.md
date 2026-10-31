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
enforcement on. `build-installer.ps1` refuses
production when the public key is missing, invalid, or does not match the
approved fingerprint `9153-E15E-475B-A2E2-251A-7E40-D8EB-5855`. The staged
copy is checked again. Place the approved public key beside the build script,
or pass `-LicencePublicKeyPath`. Never give the builder a private key.

`-TestSignedBuild -LicencePublicKeyPath <test-public-key>` is a diagnostic
build; it refuses the production public key and creates a
`KAYAN-ERP-TEST-ONLY-Setup`. `-EvaluationBuild` creates a separate
`KAYAN-ERP-EVALUATION-ONLY-Setup`. **Both refuse installation** because the
runtime still shares customer paths and services; labelling is not isolation.
The manifest records `licenseBuildKind` and `licenseEnforcement`.

### Exercising the three delivered features on a licensed installation

`scripts\smoke-test-installed-windows.ps1` installs on a throwaway GitHub
runner and is deliberately non-installable for a licensed case: a product Setup
enforces its licence, an activation key names one computer's fingerprint, and
only the supplier's private key can sign one. CI therefore proves the licence
*wall* (business routes 403 while unlicensed, sign-in and activation reachable,
public key removal and restoration) and stops there; it never claims the three
features passed on an installed copy.

On the machine the licence names, run the checker against the installation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File distribution\windows\verify-licensed-install.ps1 `
  -ActivationKeyPath .\kayan-activation.key `
  -AdminUsername administrator -AdminPassword '<password>' -ConfirmTestCompany
```

It finds the running API of the installed program (never a development
server), activates this machine with the key if one is given - the same call
the licence screen makes - refuses nothing and bypasses nothing, and then runs
`backend\scripts\verify-installed-features.mjs` on the bundled Node runtime so
the PDFs are read back with the `pdf-lib` that ships in the installation. It
writes `%TEMP%\kayan-licensed-install-report.json` and exits 0 only when every
check passed; exit code 2 means "no licence, nothing proven", with this
machine's activation request code printed. It moves no key, resets nothing and
edits no company setting. The checker creates test documents (an item, a
quotation, a purchase, an issue, a stock count, a clerk user), so point it at a
test company.

Pull-request CI runs are test-signed; pushes default to product and manual runs
select the mode. Product builds fail closed rather than falling back to a test
key. CI no longer receives the production signing secret and does not run the
old installed smoke test. Branch prereleases and diagnostic uploads remain
blocked. A protected production publishing job is wired but cannot presently
obtain a candidate or trusted evidence. It requires independent inspection of
the exact package, isolated Windows installation/upgrade testing and protected
release approvals. The Inno preprocessor cannot prevent deliberate manual
compilation outside that trusted pipeline.

`scripts/verify-release-evidence.mjs` verifies an Ed25519
attestation from a separately approved authority, bound to the final file's
SHA-256, platform, commit, workflow run and run attempt, with a short expiry and explicit
inspection/installation/upgrade/signature claims. Its hard-coded authority
public-key file `distribution/release/approved-evidence-public.pem` is absent;
no authority has been approved. `scripts/check-release-environment.mjs` checks
GitHub's actual `windows-production` environment metadata for required
reviewers, self-review prohibition and protected deployment branches. Protect
`main`, release tags, workflow and authority-key changes separately; review
administrator-bypass settings independently. The production job rechecks the
metadata and signed evidence, requires a protected pre-existing tag for the
same commit, and refuses an existing release. A signed envelope may be provided
as a variable, but the fixed authority key and signature, not the variable or
artifact name, establish trust. Signed claims do not replace the actual tests.

`scripts/inspect-final-inno.mjs` is wired into build and publication and streams
entries without extracting files. It needs a trusted 7z with Inno support; its
listing/parser and actual installer handling have not been verified on Windows
or an actual installer. Marker scans cannot prove absence of nested, encrypted
or unknown secrets. Candidate upload remains blocked until independently reviewed
final inspection and a trustworthy attestation mechanism are available. An
isolated active-licence upgrade test and a trusted authority to deliver evidence
for the exact binary are also missing.

`scripts/prepare-isolated-windows-install-test.ps1` prepares, but does not
launch, a Windows Sandbox basic install/upgrade exercise. It maps two separate,
pre-inspected installer folders and the guest script read-only, disables guest
networking, and maps only a new dedicated results folder writable. The guest
runs PostgreSQL inside the disposable VM, installs the old and candidate EXEs,
and compares the installed public key and enforcement marker. Execution needs
independent approval and a Sandbox-capable Windows host. This untested script
cannot establish that an active synthetic old licence survives upgrade, cannot
inspect the final package, and its writable result is not trusted attestation.
Keep the old smoke/test installers blocked until full isolation and synthetic
active-licence tests are implemented and actually verified. The isolated
`licensing-upgrade-model.spec.ts` exercises active synthetic licence state,
rejected forgery and fake application data across a service restart; it uses
FakeDb and is not an installed Windows upgrade or evidence about real data.

The product installer refuses an upgrade before replacing files if the existing
licence public key differs or existing licence state has no key. Runtime setup
checks again and does not replace an existing key. Matching is deliberately
byte-exact and may conservatively refuse differently formatted equivalent keys;
changes require a separately reviewed and tested transition. A workflow success
does not prove old customer licences remain compatible.

Before any future key transition: inventory existing verifier fingerprints and
licence versions without changing customer state; verify protected backups;
design and review a time-bounded old/new verification policy accounting for
old-key compromise; test activation, renewal, seats, transfer, replay, clock
state, restart, backup/restore and upgrade on disposable installations using
synthetic old/new pairs; then stage rollout with support and rollback procedures.
Do not replace a customer verifier or retire the old one until those checks and
an explicit approval are complete. This is a plan, not an implemented rotation.

### Company databases and their names

`install-runtime.ps1` accepts a company database only when the connection points
at the bundled cluster (`erp_app` on `127.0.0.1:5432`) **and** the database is
one this product created: `erp_kayan`, or the databases "a new company" and the
safe reset create, `erp_kayan_<yyyyMMddHHmmss>`. Every step that names a
database - the ownership check, the KAYAN-table check, the company count, the
create-if-missing statement and the backup - takes the name from `DATABASE_URL`.
Before this, those four places were written with the literal `erp_kayan`, so the
first install after a reset whose settings named `erp_kayan_<stamp>` failed at
"verifying the company database" with a PostgreSQL-looking error, and the
program went on opening the previous company.

Repair (`repair-runtime.ps1`) keeps the settings it found: it refuses to finish
if the settings generation would go backwards or if the database name would
change, and - when the protected licence folder says this installation must
enforce - it fails unless the repaired server reports `enforcement: enforce`
with its verification key readable.

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

The build pipeline validates staged entry points and emits a runtime manifest.
The previous installed smoke test is currently disabled: it used customer paths
and a signing private key. A candidate build does not prove installation,
activation or upgrades work. Before any release, independently inspect the
actual installer, exercise the product and a separately isolated test runtime
on disposable Windows hosts, test old licences and upgrades without customer
data, and review uninstall retention. No automatic release is enabled.
