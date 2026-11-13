# النسخ الاحتياطي والاستعادة — Backup & Restore

**حالة هذا المستند عند PR #70: الاستعادة الكاملة والنسخ الكامل غير متاحين.**
الأرشيف المعروض هنا `pg_dump` لقاعدة البيانات فقط؛ لا يشمل ملفات المستخدم
الخارجية أو ملف حالة الترخيص أو ضمان تطابق الإعدادات، وليس نسخة تعافٍ كاملة.
لا تستخدمه لاستعادة بيانات إنتاج أو لإثبات القدرة على استرجاع الجهاز. احتفظ بكل
النسخ السابقة وتواصل مع الدعم عند تعطل الجهاز. التفاصيل والموانع في
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
