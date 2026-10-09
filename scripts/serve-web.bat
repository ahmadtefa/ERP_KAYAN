@echo off
chcp 65001 >nul
cd /d "%~dp0\.."

echo ============================================================
echo   KAYAN ERP  -  one address for the whole program
echo ============================================================
echo.
echo   This builds the client once and lets the server deliver it,
echo   so the program opens at ONE address:
echo.
echo       http://localhost:3000
echo.
echo   The build takes a few minutes. You only need to run this
echo   again after the client's code changes.
echo.
echo ------------------------------------------------------------
echo.

where flutter >nul 2>&1
if errorlevel 1 (
  echo [X] Flutter was not found on PATH.
  echo     Install it from https://docs.flutter.dev/get-started/install/windows
  echo.
  pause
  exit /b 1
)

REM ---------------------------------------------- 1. build the client
echo [1/3] Building the client...
call flutter pub get
if errorlevel 1 (
  echo [X] flutter pub get failed.
  pause
  exit /b 1
)
call flutter build web --release --dart-define=API_BASE_URL=/api/v1
if errorlevel 1 (
  echo.
  echo [X] The build failed. The text above says why.
  echo.
  pause
  exit /b 1
)
echo.
echo       built into  build\web
echo.

REM ---------------------------------------------- 2. restart the server
echo [2/3] Restarting the server...
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do (
  if not "%%p"=="0" (
    taskkill /f /pid %%p >nul 2>&1
    set FOUND=1
  )
)
if "%FOUND%"=="0" (
  echo       no server was running.
) else (
  echo       stopped the previous server.
)

if not exist "backend\.env" (
  echo.
  echo [X] backend\.env is missing, so the server cannot start.
  echo     Run scripts\setup-windows.bat once, then try again.
  echo.
  pause
  exit /b 1
)
start "KAYAN ERP API" cmd /k call "%~dp0run-api.bat"
echo       waiting for the server to come up...
call :waitforapi
if errorlevel 1 (
  echo.
  echo [WARNING] The server did not answer within a minute.
  echo     Look at the "KAYAN ERP API" window for the reason.
  echo.
  pause
  exit /b 1
)
echo       server is up, and it is serving the client.
echo.

REM ---------------------------------------------- 3. open it
echo [3/3] Opening the program...
start "" http://localhost:3000
echo.
echo ------------------------------------------------------------
echo   Sign in with:   admin  /  Admin@12345
echo ------------------------------------------------------------
echo.
echo   The address is  http://localhost:3000  -  bookmark it.
echo   The window called "KAYAN ERP API" must stay open: closing
echo   it stops both the server and the program.
echo.
pause
exit /b 0

REM ---------------------------------------------------------------------
REM  Waits until the API answers, up to ~60 seconds.
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
