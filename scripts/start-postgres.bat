@echo off
REM ---------------------------------------------------------------------
REM  Makes sure a PostgreSQL server is listening on 127.0.0.1:5432.
REM
REM  Two situations are both fine and both return 0:
REM    (1) the portable server was started by this script, or
REM    (2) another PostgreSQL - for example a Windows service that was
REM       installed the normal way - is already listening on 5432.
REM  In case (2) the API simply connects to that one.
REM
REM  Pass "strict" as the first argument when the caller needs to tell
REM  the two apart, as the installer does.
REM
REM  Exit codes:
REM     0 = a server is listening on 5432
REM     1 = there is a server here but it would not start
REM     2 = not installed
REM     3 = port 5432 is held by something that is not our server
REM         (returned only in strict mode)
REM ---------------------------------------------------------------------
setlocal
set "STRICT=0"
if /i "%~1"=="strict" set "STRICT=1"

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
if errorlevel 1 exit /b 1

if "%STRICT%"=="1" exit /b 3
exit /b 0
