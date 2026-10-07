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

call :probe "%LOCALAPPDATA%\kayan-tools\node\node.exe"                  "Node.js (portable)"
call :probe "%LOCALAPPDATA%\kayan-tools\pgsql\bin\psql.exe"             "PostgreSQL (portable)"
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
echo     * If a program appears under "Installed but NOT on PATH",
echo       close EVERY VS Code window and open VS Code again.
echo.
echo     * If a program appears in neither place, it is not
echo       installed. Use the commands below, then RESTART the PC.
echo.
echo ============================================================
echo   Copy-paste install commands
echo ============================================================
echo.
echo   Node.js  (also installs npm):
echo.
echo       winget install OpenJS.NodeJS.LTS
echo.
echo   PostgreSQL:
echo.
echo       winget install PostgreSQL.PostgreSQL.17
echo.
echo   If winget is unavailable, download the installers from:
echo       https://nodejs.org
echo       https://www.postgresql.org/download/windows/
echo.
echo   When installing PostgreSQL you are asked to choose a
echo   password for the "postgres" user. WRITE IT DOWN - the
echo   setup script asks for it later.
echo.
echo   After installing, RESTART the computer, then run:
echo       scripts\setup-windows.bat
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
