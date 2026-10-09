KAYAN ERP - Windows 64-bit
===========================

Install KAYAN-ERP-Setup-<version>-x64.exe and choose whether to launch the
program. The package includes its Flutter client, local API runtime, Node.js,
PostgreSQL 17, and Microsoft Visual C++ x64 runtime. No development tools,
Docker, separate PostgreSQL installer, or browser are required.

The first launch applies the checked-in Prisma migrations and asks you to
create the first administrator. It does not insert a default account, reset a
database, or seed sample records.

Local PostgreSQL starts automatically with Windows. Start/Stop/Restart shortcuts
are available in the KAYAN ERP Start menu. The service listens only on the local
machine. If another application already uses port 5432, setup stops with an
error and does not replace that application.

Company data is kept outside Program Files:
  Database: %ProgramData%\KAYAN-ERP\PostgreSQL\data
  Database logs: %ProgramData%\KAYAN-ERP\logs
  Installer diagnostics: %ProgramData%\KAYAN-ERP\logs\installer.log
  User settings and secrets: %APPDATA%\KAYAN-ERP\kayan.env
  Company logos and backend logs: %APPDATA%\KAYAN-ERP\

An update may replace program files but leaves database data and user settings
in place. Uninstall unregisters/stops the PostgreSQL service and removes the
application files, but intentionally preserves the database, settings, backups,
and logs. Back up from the in-app Backup and Restore screen before moving or
replacing the computer. To permanently erase records, uninstall first, verify
your backup, and then manually remove the ProgramData database directory.

Only Windows x64 is supported. A Windows x64 installation test is required
before distributing this release; this installer was assembled on a Windows
build host using the repository packaging instructions.
