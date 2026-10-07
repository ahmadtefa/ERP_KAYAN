@echo off
chcp 65001 >nul
cd /d "%~dp0\..\backend"

if not exist ".env" (
  echo [X] backend\.env is missing.
  echo     Run scripts\setup-windows.bat first.
  pause
  exit /b 1
)

echo ============================================================
echo   KAYAN ERP - API server
echo ============================================================
echo.
echo   Address:  http://localhost:3000/api/v1
echo   Health:   http://localhost:3000/api/v1/health
echo.
echo   Leave this window OPEN while you use the system.
echo   Press Ctrl+C to stop the server.
echo.
echo ------------------------------------------------------------
echo.

call npm run start:dev
pause
