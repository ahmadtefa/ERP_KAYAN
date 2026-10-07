@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo ============================================================
echo   KAYAN ERP  -  pull latest and run
echo ============================================================
echo.

REM ---------------------------------------------- 1. pull from GitHub
echo [1/5] Pulling the latest changes from GitHub...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo [WARNING] Pull failed. The usual cause is local edits that conflict
  echo     with the incoming changes.
  echo.
  echo     To keep your edits for later:
  echo         git stash
  echo         git pull
  echo         git stash pop
  echo.
  echo     To discard your local edits and match GitHub exactly:
  echo         git fetch origin
  echo         git reset --hard origin/main
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('git rev-parse --short HEAD') do echo       now at %%v
echo.

REM ---------------------------------------------- 2. is the database running?
echo [2/5] Checking the database...
call "%~dp0start-postgres.bat"
if errorlevel 2 goto :nopg
if errorlevel 1 goto :pgnostart
echo       database is running.
echo.

REM ---------------------------------------------- 3. is the API running?
echo [3/5] Checking the API server...
curl -s -o nul -w "" --max-time 3 http://localhost:3000/api/v1/health 2>nul
if errorlevel 1 (
  echo       API is not running - starting it in a new window...
  if not exist "backend\.env" (
    echo.
    echo [X] backend\.env is missing, so the API cannot start.
    echo     Run scripts\setup-windows.bat once, then try again.
    echo.
    pause
    exit /b 1
  )
  start "KAYAN ERP API" cmd /k call "%~dp0run-api.bat"
  echo       waiting for the API to come up...
  call :waitforapi
  if errorlevel 1 (
    echo.
    echo [WARNING] The API did not respond within a minute.
    echo     Look at the "KAYAN ERP API" window for the actual error.
    echo.
    pause
    exit /b 1
  )
  echo       API is up.
) else (
  echo       API is already running.
)
echo.

REM ---------------------------------------------- 3. packages
echo [4/5] Getting Flutter packages...
call flutter pub get
if errorlevel 1 (
  echo [X] flutter pub get failed. Is Flutter on PATH?
  pause
  exit /b 1
)
echo.

REM ---------------------------------------------- 4. run
echo [5/5] Starting the client in Chrome...
echo.
echo ------------------------------------------------------------
echo   Sign in with:   admin  /  Admin@12345
echo ------------------------------------------------------------
echo.
echo   A window called "KAYAN ERP API" is running the server.
echo   KEEP IT OPEN. Closing it stops the server and the client
echo   will stop working until you start it again.
echo.
call flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:3000/api/v1

echo.
echo Client stopped.
pause
exit /b 0

REM ---------------------------------------------------------------------
REM  Waits until the API answers, up to ~60 seconds. Runs as a subroutine
REM  so no label sits inside an if block, which batch handles unreliably.
REM ---------------------------------------------------------------------
:waitforapi
set /a WAITED=0
:waitloop
timeout /t 3 /nobreak >nul
curl -s -o nul --max-time 3 http://localhost:3000/api/v1/health 2>nul
if not errorlevel 1 exit /b 0
set /a WAITED+=3
if %WAITED% lss 60 goto waitloop
exit /b 1

REM ---------------------------------------------------------------------
REM  Database problems
REM ---------------------------------------------------------------------
:nopg
echo.
echo [X] PostgreSQL is not installed yet.
echo     Run this once, then try again:
echo         scripts\install-postgres-portable.bat
echo.
pause
exit /b 1

:pgnostart
echo.
echo [WARNING] PostgreSQL is installed but did not start.
echo     Look at this file for the reason:
echo         %LOCALAPPDATA%\kayan-tools\postgres.log
echo.
pause
exit /b 1
