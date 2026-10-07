@echo off
chcp 65001 >nul
cd /d "%~dp0\.."

where flutter >nul 2>&1
if errorlevel 1 (
  echo [X] Flutter was not found on PATH.
  echo.
  echo     Install Flutter from:  https://docs.flutter.dev/get-started/install/windows
  echo     Then run:  flutter doctor
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo   KAYAN ERP - client (Chrome)
echo ============================================================
echo.
echo   Make sure start-backend.bat is already running in another
echo   window, otherwise sign-in will fail.
echo.
echo   The client always opens at this address:
echo       http://localhost:8080
echo.
echo ------------------------------------------------------------
echo.

call flutter pub get
call flutter run -d chrome --web-port=8080 --dart-define=API_BASE_URL=http://localhost:3000/api/v1
pause
