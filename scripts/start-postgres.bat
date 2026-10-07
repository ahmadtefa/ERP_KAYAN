@echo off
REM ---------------------------------------------------------------------
REM  Makes sure the portable PostgreSQL server is running.
REM  Exit codes:
REM     0 = running   1 = failed to start   2 = not installed
REM     3 = port 5432 is taken by another program
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
if not errorlevel 1 exit /b 0

netstat -ano | findstr /r /c:":5432 .*LISTENING" >nul 2>&1
if not errorlevel 1 exit /b 3

exit /b 1
