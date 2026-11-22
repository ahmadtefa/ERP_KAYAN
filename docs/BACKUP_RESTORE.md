# النسخ الاحتياطي والاستعادة — Backup & Restore

**حالة هذا المستند: النسخة الكاملة للنظام متاحة، والاستعادة محكومة ببوابة فحص.**

صارت للبرنامج ثلاث نسخ احتياطية منفصلة، والشاشة تفصل بينها: ملف JSON لشركة
واحدة، وأرشيف قاعدة البيانات (`.dump`) لقاعدة البيانات وحدها، والنسخة الكاملة
للنظام (`.kayanbackup`) التي تحمل قاعدة البيانات والملفات المرفوعة والإعدادات
وحالة الترخيص وبيانًا بكل بصمة SHA-256. أزرار الاستعادة الكاملة لا تظهر إلا
عندما تنجح كل ضمانات الجهاز (الأدوات، مجلد النسخ، قاعدة تجربة، لا استعادة
معلّقة)؛ وحين تفشل تُعرض الأسباب نصًّا بدل زر ميت. التفاصيل الكاملة في الفصل
الأخير من هذا المستند، والموانع القديمة في
[`release/BACKUP-RESTORE-LICENCE-2026-11-05.md`](release/BACKUP-RESTORE-LICENCE-2026-11-05.md).

## What a database archive is

* `pg_dump --format=custom --no-owner --no-privileges` snapshots the database;
  it is **not** a complete installation backup and does not include all
  external files or the protected licence state.
* `POST /api/v1/backup/full/database-archive` explicitly creates this partial
  archive. Names include a timestamp and a unique suffix; historical names may
  contain `full`, which means whole database, not whole installation.
* The service checks the header, table of contents and archive contents and
  flushes the file before publishing. This does not prove a full restore or
  guarantee power-loss durability of every filesystem/directory entry.
* The default Windows server directory is `%ProgramData%\KAYAN-ERP\backups`
  unless configured otherwise; capabilities reports the actual server directory.
  Backups contain sensitive data; restrict access and do not publish them.
* PostgreSQL credentials are supplied to child tools via environment, not
  intentionally placed in the command line. Do not share environment files.

## PostgreSQL tools

The service searches the configured `KAYAN_PG_DUMP`/`KAYAN_PG_RESTORE`, then
bundled paths including `backend/postgres/bin` and older locations, followed by
PATH and platform locations. Capabilities reports what was found and warns if
`pg_dump` is older than the server. The legacy desktop build scripts are not an
approved release pipeline; a self-contained offline Windows installer has not
been built and validated for this HEAD.

## Restore status and recovery

The HTTP `POST /api/v1/backup/full/restore` is deliberately blocked before
upload parsing. The UI hides its restore actions when `fullRestoreSupported`
is false or unavailable. `POST /api/v1/backup/full` rejects complete backup;
no DB-only dump should be treated as Full Backup.

The retained internal database-only engine has a scratch rehearsal and a
safety dump, but it is not a supported production recovery path. Maintenance
is process-local, does not drain already running requests, and **does not
survive a restart**. There is no proven atomic recovery of database, external
files and licence. If an interruption is suspected, preserve the existing
files, archives, licence state and database; do not run manual destructive
restore commands or delete/reinstall data to recover. Seek an approved,
isolated recovery procedure. The company JSON import/restore is a separate,
partial and potentially destructive operation; it is not Full Restore.

## Roles and `pg_hba.conf`

* Global PostgreSQL roles are **not** in a `pg_dump` archive (`--no-owner
  --no-privileges`); the restore runs as the application role, which already
  owns the data. Role management is deliberately out of scope.
* The backup/archive path does not intentionally change `pg_hba.conf`. Windows
  provisioning separately configures PostgreSQL authentication; do not infer
  the configuration of an existing installation from this document.

## API summary (`/api/v1/backup/full`, `admin.backup` and super administrator)

| Route | Current behaviour |
|---|---|
| `GET /capabilities` | Reports tool availability, maintenance and `fullBackupSupported:false`, `fullRestoreSupported:false` |
| `GET /status` | Local in-process maintenance status, not crash recovery evidence |
| `GET /` | Lists database archives with `fullBackup:false` and no external files/licence |
| `POST /` | Rejects full backup as incomplete |
| `POST /database-archive` | Creates an explicitly database-only archive |
| `POST /:name/verify` | Reads archive contents; not a complete restore rehearsal |
| `GET /:name/download` | Downloads an archive; treat its contents as sensitive |
| `DELETE /:name` | Deletion is protected until a verified complete replacement exists |
| `POST /restore` | Blocked before upload parsing |

Scheduled DB-only attempts are recorded as failed/incomplete rather than a
successful full backup; retention does not delete older archives. The separate
company JSON backup can be downloaded and inspected, but it is not a complete
machine backup and its restore must not be treated as safe full recovery.

---

# النسخة الكاملة للنظام واستعادتها — Complete system backup and restore

There are three backups in KAYAN ERP. They are not interchangeable, and the
screens keep them apart:

| Backup | File | Scope | Restores |
|---|---|---|---|
| **Company JSON** (`/api/v1/backup`) | `.json` | one company's books | that company only, inside one transaction |
| **Database archive** (`/api/v1/backup/full`) | `.dump` | the whole PostgreSQL database | the database; no files, no licence record |
| **Complete system** (`/api/v1/backup/complete`) | `.kayanbackup` | database + uploaded files + settings + licence *state* + manifest | the whole installation, with a safety copy, a rehearsal and a rollback |

## ماذا تحتوي النسخة الكاملة؟ / What is inside a complete backup

One TAR archive, readable by any archiver, with these fixed paths:

```
manifest.json                 what this is, which version wrote it, counts, every SHA-256
checksums.sha256              "sha256  path" lines, in the format `sha256sum -c` reads
database/database.dump        the whole database (pg_dump Custom format)
files/uploads/…               the uploaded files the database refers to
settings/settings.json        settings a restore needs — deliberately no secrets
licence/licence-state.json    the licence's STATE only: status, expiry, machine fingerprint
RESTORE-INSTRUCTIONS.txt      how to recover by hand, in Arabic and English
```

* **No secrets.** The database password, JWT secrets, and anything that looks
  like a key, signature, token or password is excluded by construction. The
  licence file is parsed and reduced to a few facts; every key whose name
  matches `key|secret|token|signature|private|password|credential` is dropped
  and its *name* is recorded under `withheld` so a reader knows something was
  withheld rather than absent.
* **Nothing is restored from `licence/`.** A licence belongs to a machine.
  The restore records the live file's SHA-256 before the operation and proves
  it is unchanged afterwards; it never writes over it.
* **Every byte has a hash.** `manifest.json` promises the SHA-256 of the dump,
  the settings, the licence state, the instructions and every uploaded file.
  The checksum list is cross-checked against the manifest, so tampering with
  either one is caught.
* **The archive is written to a `.partial` name and renamed only when it is
  complete**, then read back and verified before anyone is told it worked.

## بوابة الأمان — the safety gate

A restore is refused unless the machine passes every check. The answer is not
an environment switch that can force the feature on; the switch can only turn
it **off**:

| Check | Why it exists |
|---|---|
| `operator-switch` | `KAYAN_FULL_RESTORE_ENABLED=0/false/off` is a kill switch for an administrator |
| `no-restore-running` | one restore at a time (also enforced by a PostgreSQL advisory lock) |
| `no-interrupted-restore` | an unfinished journal must be resolved first |
| `postgresql-tools` | `pg_dump` **and** `pg_restore` must be found |
| `tool-version` | the tools must not be older than the server |
| `backup-folder` | the folder really accepts a file (not just "looks writable") |
| `uploads-folder` | the files folder can be written |
| `scratch-database` | the account may open a scratch database — without it, no rehearsal, no restore |
| `database` | the database answers |

`GET /api/v1/backup/complete/capabilities` returns
`fullRestoreSupported`, `fullRestoreReasons[]` and every check with its detail.
The screen shows the reasons when the button is off, so a disabled button is
never a mystery. The guard (`CompleteRestoreUnavailableGuard`) sits in front of
the route, so a 2 GB upload is refused **before** it is read.

## خطوات الاستعادة الآمنة — the restore pipeline

1. **Gate** — every check above must pass.
2. **Typed confirmation** — `confirm=true` *and* `confirmPhrase=RESTORE`.
3. **Verification** — TAR structure, manifest, checksum list, SHA-256 of every
   entry, `PGDMP` magic, `pg_restore --list` (objects > 0), and a migration
   count that is not newer than this installation.
4. **Unpack** — into a staging folder, hashing every byte as it lands.
5. **Rehearsal** — the dump is restored into `kayan_restore_check_<ts>` and the
   table count is checked. A damaged or foreign archive fails here, with the
   live database untouched.
6. **Safety backup** — a complete `.kayanbackup` of the *current* installation
   (database **and** files). If it cannot be written, the restore stops.
7. **Journal** — `restore-journal.json` is written to disk before each
   destructive step: `db-replacing → db-restored → files-replacing →
   files-swapped → verified`.
8. **Database** — writes are blocked (maintenance mode), the schema is
   replaced, and `pg_restore` runs.
9. **Data checks** — the counts must equal the manifest's own counts; the
   journal must balance; stock balances must point at real items and branches;
   permissions must exist for the users; an active super administrator must
   remain (the access repair promotes the archive's administrator if needed).
10. **Files** — the current uploads folder is moved aside (not deleted) and the
    archive's files are put in its place.
11. **Licence** — proved untouched by comparing its SHA-256.
12. **Close** — the journal is cleared, maintenance ends, the restore is
    audited, and the person is told the safety backup's name.

## الفشل وانقطاع الكهرباء — failure and power loss

| Where it failed | What happens |
|---|---|
| Before step 6 | Nothing changed; the journal is cleared and the error is returned. |
| Steps 8–10 | The safety backup is restored automatically (database **and** files); the message says so and names the safety file. |
| Automatic recovery fails | Maintenance stays **on**, the journal records `failed`, and the status tells the operator exactly which file to restore. The program does not pretend to be healthy. |
| Power cut | The journal survives. On the next start the program enters maintenance mode and says which step was reached; `POST /backup/complete/recovery/resume` puts the safety backup back, files included. |

## واجهة Flutter — the screen

The backup screen has two numbered sections:

1. **نسخ واستعادة بيانات الشركة (JSON)** — take a company backup, download it,
   choose a file, preview what it contains, restore it after a confirmation.
2. **نسخ واستعادة النظام (DUMP / استعادة كاملة)** — warning first (a database
   restore affects **every company**), then: create a complete system backup,
   create a database archive, check an archive, download it, restore from a
   server file or an upload, and follow the running step while the restore
   works. The restore buttons are disabled — with the reasons shown — while the
   gate refuses, and an interrupted restore shows a "resume recovery" panel.

## الاختبارات — how this is proved

* `npm test` — unit tests for the archive format, the manifest and checksums,
  licence redaction, the journal, the gate and the guard.
* `npm run verify:system-backup -- --pgbin /usr/lib/postgresql/17/bin` — a real
  PostgreSQL run (own cluster, real migrations, seeded fixture) covering:
  complete backup, verification, a tampered archive refused, restore, files
  restored, licence untouched, a restore killed mid-replacement rolled back
  with no data lost, a simulated power cut recovered from the journal, two
  restores at once refused, and the company JSON path kept separate.
* CI runs that harness on **PostgreSQL 17** (job `backup-restore-17`) and the
  HTTP scenario (`scripts/scenario-system-backup.mjs`) against the running API.
* No production data is used: the harness creates its own database and its own
  backup folder, and the HTTP scenario runs against the disposable CI database.
