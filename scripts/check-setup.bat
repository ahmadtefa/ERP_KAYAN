@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo ============================================================
echo   KAYAN ERP  -  what is installed on this PC
echo ============================================================
echo.
echo   Changes nothing. Only reports.
echo.
echo --- Commands available right now --------------------------
echo.

set MISSING=0
call :check git     "Git"
call :check node    "Node.js"
call :check npm     "npm"
call :check psql    "PostgreSQL"
call :check flutter "Flutter"

echo.
echo --- Installed but NOT on PATH? ----------------------------
echo.
echo   Checking the usual install folders. If something shows up
echo   here but was reported missing above, the program is
echo   installed but Windows does not know where it is.
echo.

call :probe "C:\Program Files\nodejs\node.exe"                          "Node.js"
call :probe "C:\Program Files\nodejs\npm.cmd"                           "npm"
call :probe "C:\Program Files\PostgreSQL"                               "PostgreSQL folder"
call :probe "C:\Program Files\Git\cmd\git.exe"                          "Git"
call :probe "C:\flutter\bin\flutter.bat"                                "Flutter"
call :probe "C:\src\flutter\bin\flutter.bat"                            "Flutter (src)"
call :probe "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe"        "VS Code"

echo.
echo --- Project files -----------------------------------------
echo.
call :file "backend\package.json" "backend folder"
call :file "backend\.env"         "backend\.env (created by setup-windows)"
call :file "pubspec.yaml"         "Flutter project"

echo.
echo ============================================================
echo   Missing required programs: %MISSING%
echo ============================================================
echo.
echo   Next step depends on what you saw above:
echo.
echo     * If Node.js appears under "Installed but NOT on PATH",
echo       close EVERY VS Code window and open VS Code again.
echo.
echo     * If Node.js does not appear anywhere, it is not
echo       installed. Install it, then restart the computer.
echo.
pause
exit /b 0

REM -------------------------------------------------------------------

:check
where %~1 >nul 2>&1
if errorlevel 1 (
  echo   [ MISSING ]  %~2
  set /a MISSING+=1
  exit /b 0
)
for /f "delims=" %%p in ('where %~1 2^>nul') do (
  echo   [   OK    ]  %~2
  echo                %%p
  exit /b 0
)
exit /b 0

:probe
if exist "%~1" (
  echo   [ FOUND   ]  %~2
  echo                %~1
) else (
  echo   [ not here]  %~2
)
exit /b 0

:file
if exist "%~1" (
  echo   [   OK    ]  %~2
) else (
  echo   [ MISSING ]  %~2
)
exit /b 0
