@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo ============================================================
echo   KAYAN ERP  -  checking what is installed
echo ============================================================
echo.
echo   This changes nothing. It only reports.
echo.
echo --- Required programs -------------------------------------
echo.

set MISSING=0

call :check git     "Git"           "https://git-scm.com/download/win"
call :check node    "Node.js"       "https://nodejs.org"
call :check npm     "npm"           "https://nodejs.org"
call :check psql    "PostgreSQL"    "https://www.postgresql.org/download/windows/"
call :check flutter "Flutter"       "https://docs.flutter.dev/get-started/install/windows"

echo.
echo --- Project files -----------------------------------------
echo.

call :file "backend\package.json" "backend folder"
call :file "backend\.env"         "backend\.env (created by setup-windows)"
call :file "pubspec.yaml"         "Flutter project"

echo.
echo ============================================================
if %MISSING% EQU 0 (
  echo   Everything is in place. Run:  scripts\pull-and-run.bat
) else (
  echo   %MISSING% program^(s^) missing - install them, then close
  echo   EVERY VS Code window and open it again.
)
echo ============================================================
echo.
echo   If a program IS installed but shows as missing above:
echo     close every VS Code window, open it again, then re-run
echo     this script. A terminal only sees programs that existed
echo     when the terminal started.
echo.
pause
exit /b 0

REM -------------------------------------------------------------------

:check
where %~1 >nul 2>&1
if errorlevel 1 (
  echo   [ MISSING ]  %~2
  echo                install from: %~3
  set /a MISSING+=1
  exit /b 0
)
for /f "delims=" %%p in ('where %~1 2^>nul') do (
  echo   [   OK    ]  %~2
  echo                %%p
  exit /b 0
)
exit /b 0

:file
if exist "%~1" (
  echo   [   OK    ]  %~2
) else (
  echo   [ MISSING ]  %~2
)
exit /b 0
