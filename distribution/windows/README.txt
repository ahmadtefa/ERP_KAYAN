KAYAN ERP - Windows 64-bit
===========================

Install KAYAN-ERP-Setup-<version>-x64.exe and choose whether to launch the
program. The package includes its Flutter client, local API runtime, Node.js,
PostgreSQL 17, and Microsoft Visual C++ x64 runtime. No development tools,
Docker, separate PostgreSQL installer, or browser are required.

The first launch applies the checked-in Prisma migrations and asks you to
create the first administrator. It does not insert a default account, reset a
database, or seed sample records.

Local PostgreSQL starts automatically with Windows. The Start menu includes
Repair KAYAN ERP (RepairTool.exe): it inspects the local installation, shows
what it found, and changes nothing until you confirm. It repairs the bundled
runtime, file permissions, the PostgreSQL service and pending database
migrations without deleting company data or changing database credentials.
The same checks can be scripted with "RepairTool.exe --diagnose" and
"RepairTool.exe --repair --quiet" (exit code 0 means no problems remain).
repair-kayan.bat in the installation folder performs the underlying repair
directly. Start/Stop/Restart PostgreSQL shortcuts are also in the Start menu.
The service listens only on the local machine. If another application already
uses port 5432, setup stops with an error and does not replace that
application.

If the setup cannot finish, the installer says which step failed and where the
full, redacted diagnostics are written:
  %ProgramData%\KAYAN-ERP\logs\installer.log
Your company data is never deleted to make an installation succeed.

Company data is kept outside Program Files:
  Database: %ProgramData%\KAYAN-ERP\PostgreSQL\data
  Database logs: %ProgramData%\KAYAN-ERP\logs
  Installer diagnostics: %ProgramData%\KAYAN-ERP\logs\installer.log
  Repair tool log: %ProgramData%\KAYAN-ERP\logs\repairtool.log
  User settings and secrets: %APPDATA%\KAYAN-ERP\kayan.env
  Company logos and backend logs: %APPDATA%\KAYAN-ERP\

An update may replace program files but leaves database data and user settings
in place. Uninstall unregisters/stops the PostgreSQL service and removes the
application files, but intentionally preserves the database, settings, backups,
and logs. Back up from the in-app Backup and Restore screen before moving or
replacing the computer. To permanently erase records, uninstall first, verify
your backup, and then manually remove the ProgramData database directory.

Only Windows x64 is supported. This installer was built and smoke-tested on a
Windows x64 CI machine, including a fresh install, database startup, local API
health, login, and an upgrade/reinstall that retained a database record. The
automated upgrade check uses disposable CI data; test an update over a real
company installation carefully before a wide rollout. Uninstall retention is
also not part of the automated smoke test.
