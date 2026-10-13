# النسخ الاحتياطي والاستعادة — Backup & Restore

Full-database backup (pg_dump Custom format) and restore for Kayan ERP.
The per-company JSON backup (`/api/v1/backup`) remains available for moving
one company's data between installations; this document is about the
disaster-recovery path: `POST /api/v1/backup/full/*`, permission `admin.backup`.

## What a backup is

* `pg_dump --format=custom --no-owner --no-privileges` of the whole database —
  all companies, users, accounts, entries, indexes and constraints.
* One file: `kayan-full-YYYY-MM-DD-HH-MM-SS.dump` (and
  `kayan-safety-…` for the automatic pre-restore copies), in
  `KAYAN_BACKUP_DIR` (default `backend/backups/`, created with normal
  permissions — never world-writable).
* Verified after writing: size > 0 and the `PGDMP` magic bytes are present
  before the API reports success.
* The filename carries the system name and timestamp. Nothing else — **no
  secrets, no connection strings — ever appears in the file name or in any
  report**. Connection details reach the tools only through process
  environment (`PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`), never argv.

## Where the PostgreSQL tools come from

`pg_dump`/`pg_restore` are looked up in this order:

1. `KAYAN_PG_DUMP` / `KAYAN_PG_RESTORE` environment variables;
2. **the program's own copy** — `backend\pg\` inside the installed folder
   (the Windows build script bundles it, see below);
3. the portable PostgreSQL toolchain
   (`%LOCALAPPDATA%\kayan-tools\pgsql\bin`, provisioned by
   `scripts\install-postgres-portable.bat`);
4. `PATH`;
5. platform install dirs (`C:\Program Files\PostgreSQL\*\bin`,
   Postgres.app / Homebrew on macOS, `/usr/lib/postgresql/*/bin`).

Newest candidates win: `pg_dump` from a newer PostgreSQL reads older servers;
the reverse is not true.

### The tools travel inside the Windows package

`scripts\build-desktop-windows.ps1` (step 5) copies `pg_dump.exe`,
`pg_restore.exe` and the DLLs they load into `KAYAN-ERP\backend\pg\`, from
the portable PostgreSQL this project provisions (same family as the database
it runs) or from an installed PostgreSQL, newest first. The build **fails** if
no tools are found or if the bundled copies cannot answer `--version` from
where they were placed — a package without working tools is not shippable.
`scripts\verify-package.ps1` re-checks the same things on any machine holding
a finished package. Nothing is installed, nothing existing is replaced, and
no PostgreSQL authentication setting is read or changed.

`GET /backup/full/capabilities` reports the chosen tool paths, the tool
version, the **server** version and a `warning` when `pg_dump` is older than
the server (backups would fail halfway). The UI shows that warning before a
backup is attempted. If nothing is found at all, capabilities returns
`{ available: false, reason: … }` and the UI shows the reason instead of dead
buttons.

## Restore pipeline (what actually happens)

1. **Explicit confirmation** — `confirm=true` (the UI makes the person type
   `RESTORE`). Without it the request is refused.
2. **File** — an uploaded `.dump` (≤ 2 GB) or a server-side file by name
   (name validated `^[A-Za-z0-9][A-Za-z0-9._-]*\.dump$` and resolved inside
   the backup folder only). The `PGDMP` magic is checked before anything else.
3. **Scratch restore** — the file is restored into a throwaway database
   (`kayan_restore_check_<ts>`). If it does not restore cleanly, the request
   fails here with *"the current data was not touched"* and the scratch DB is
   dropped.
4. **Safety backup** — a fresh `kayan-safety-…dump` of the CURRENT database.
   If it cannot be taken and verified, the restore stops.
5. **Maintenance mode** — a global interceptor starts refusing write requests
   (503 with a clear message) while reads keep working. Accounting operations
   cannot interleave with the restore.
6. **`pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges`**
   into the real database. A process crash here is survivable: step 4's
   backup exists and the maintenance flag stays on.
7. **Post-restore check** — Prisma reconnects; company/account/user counts
   are read back; journal entry totals are re-checked against the sum of
   their lines (± 0.0001). Only then is success reported.
8. **Audit** — `RESTORE` recorded with source name, safety backup name and
   the check result. No passwords, no DSNs.

## Failure handling / recovery plan

| Where it failed | What happens |
|---|---|
| Before step 5 | Nothing changed. Error message returned. |
| During step 6 (pg_restore error) | Automatic `pg_restore` from the safety backup (step 4). |
| Post-restore check fails (step 7) | Same automatic recovery from the safety backup. |
| Automatic recovery itself fails | **Maintenance stays ON** — writes remain blocked, status reports `maintenance: true` with an ATTENTION message telling the operator which file to restore manually. The system refuses to pretend it is consistent. |

Manual recovery, worst case: start the backend with writes still blocked (or
stop it), run `pg_restore --clean --if-exists --no-owner --no-privileges -d <db>
kayan-safety-….dump` with normal DB credentials, then restart.

## Roles and `pg_hba.conf`

* Global PostgreSQL roles are **not** in a `pg_dump` archive (`--no-owner
  --no-privileges`); the restore runs as the application role, which already
  owns the data. Role management is deliberately out of scope.
* The system **never** changes `pg_hba.conf` and never switches authentication
  to `trust`. No step of backup or restore touches PostgreSQL auth.

## API summary (`/api/v1/backup/full`, permission `admin.backup`)

| Route | Purpose |
|---|---|
| `GET /capabilities` | tools found? version, backup dir, maintenance state |
| `GET /status` | maintenance state during/after restores |
| `GET /` | list of `.dump` files (name, size, created, kind: full/safety) |
| `POST /` | create a full backup → `{ file, durationMs }` |
| `GET /:name/download` | download one file (query-token allowed for browser tabs) |
| `DELETE /:name` | remove one file (name is path-traversal-validated) |
| `POST /restore` | multipart `file` **or** `fileName`, `confirm=true` required |

## UI

«النسخ الاحتياطي والاستعادة» (Backup screen, first section):

* shows tool availability and the reason when unavailable;
* create / download / delete backups on the server;
* restore from a server file or an uploaded `.dump` — behind a warning dialog
  **and** a typed `RESTORE` confirmation;
* shows the result, the safety-backup name, or the exact failure.
