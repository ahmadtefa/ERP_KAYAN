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

set MISSING=0

echo --- Required programs -------------------------------------
echo.

call :check "git"     "Git"          "https://git-scm.com/download/win"
call :check "node"    "Node.js"      "https://nodejs.org"
call :check "npm"     "npm (comes with Node.js)" "https://nodejs.org"
call :check "psql"    "PostgreSQL"   "https://www.postgresql.org/download/windows/"
call :check "flutter" "Flutter"      "https://docs.flutter.dev/get-started/install/windows"

echo.
echo --- Project files -----------------------------------------
echo.

call :file "backend\package.json"        "backend folder"
call :file "backend\.env"                "backend\.env (created by setup)"
call :file "pubspec.yaml"                "Flutter project"

echo.
echo ============================================================
if !MISSING! EQU 0 (
  echo   Everything is in place. Run:  scripts\pull-and-run.bat
) else (
  echo   !MISSING! item^(s^) missing - see the notes above.
)
echo ============================================================
echo.
echo   Helpful extra checks:
echo     where node        (shows the full path if it IS installed)
echo     where psql
echo.
echo   If a program IS installed but reported missing here, then
echo   close every VS Code window and open it again - a terminal
echo   only sees programs that existed when it started.
echo.
pause
exit /b 0

REM -------------------------------------------------------------------

:check
where %~1 >nul 2>&1
if errorlevel 1 (
  echo   [ missing ]  %~2
  echo                install from: %~3
  set /a MISSING+=1
) else (
  for /f "delims=" %%p in ('where %~1 2^>nul') do (
    echo   [    ok   ]  %~2  =^>  %%p
    goto :checked
  )
  :checked
)
exit /b 0

:file
if exist "%~1" (
  echo   [    ok   ]  %~2
) else (
  echo   [ missing ]  %~2
)
exit /b 0
