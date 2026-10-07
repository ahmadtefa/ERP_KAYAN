@echo off
REM ---------------------------------------------------------------------
REM  Makes sure the portable PostgreSQL server is running.
REM  Exit codes:  0 = running   2 = not installed   1 = failed to start
REM  Called by install-postgres-portable.bat and by pull-and-run.bat.
REM ---------------------------------------------------------------------
setlocal
set "TOOLS=%LOCALAPPDATA%\kayan-tools"
set "PGBIN=%TOOLS%\pgsql\bin"
set "PGDATA=%TOOLS%\pgdata"

if not exist "%PGBIN%\pg_ctl.exe" exit /b 2
if not exist "%PGDATA%\PG_VERSION" exit /b 2

"%PGBIN%\pg_ctl.exe" status -D "%PGDATA%" >nul 2>&1
if not errorlevel 1 exit /b 0

"%PGBIN%\pg_ctl.exe" start -D "%PGDATA%" -l "%TOOLS%\postgres.log" -w -t 60 >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0
