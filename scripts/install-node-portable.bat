@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

set "NODEVER=24.21.0"
set "TOOLS=%LOCALAPPDATA%\kayan-tools"
set "NODEDIR=%TOOLS%\node"
set "ZIPURL=https://nodejs.org/dist/v%NODEVER%/node-v%NODEVER%-win-x64.zip"
set "ZIPFILE=%TEMP%\kayan-node-%NODEVER%.zip"
set "EXTRACTED=%TOOLS%\node-v%NODEVER%-win-x64"

echo ============================================================
echo   KAYAN ERP  -  installing Node.js without the installer
echo ============================================================
echo.
echo   The normal Windows installer failed with exit code 1603
echo   on this PC. This method copies Node.js into a folder you
echo   own instead. It needs no administrator rights.
echo.
echo   It changes only one Windows setting: it adds that folder
echo   to YOUR user PATH so plain "node" and "npm" work.
echo.
echo   Target folder:
echo       %NODEDIR%
echo.
pause
echo.

if exist "%NODEDIR%\node.exe" goto :alreadyinstalled

echo [1/4] Downloading Node.js %NODEVER% - about 36 MB, please wait
echo.

if not exist "%TOOLS%" mkdir "%TOOLS%"
if exist "%ZIPFILE%" del /f /q "%ZIPFILE%"

where curl.exe >nul 2>&1
if not errorlevel 1 curl.exe -L --fail --output "%ZIPFILE%" "%ZIPURL%"

if not exist "%ZIPFILE%" powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%ZIPURL%' -OutFile '%ZIPFILE%' -UseBasicParsing } catch { Write-Host $_.Exception.Message }"

if not exist "%ZIPFILE%" goto :nodownload
for %%A in ("%ZIPFILE%") do echo       downloaded %%~zA bytes
echo.

echo [2/4] Extracting...
echo.
if exist "%EXTRACTED%" rmdir /s /q "%EXTRACTED%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -LiteralPath '%ZIPFILE%' -DestinationPath '%TOOLS%' -Force } catch { Write-Host $_.Exception.Message }"

if not exist "%EXTRACTED%\node.exe" goto :noextract
if exist "%NODEDIR%" rmdir /s /q "%NODEDIR%"
move "%EXTRACTED%" "%NODEDIR%" >nul 2>&1
if not exist "%NODEDIR%\node.exe" goto :noextract
echo       Node.js files are in place.
echo.

echo [3/4] Adding Node.js to your user PATH...
echo.
if not exist "%TOOLS%\PATH-backup.txt" powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=[Environment]::GetEnvironmentVariable('Path','User'); Set-Content -LiteralPath '%TOOLS%\PATH-backup.txt' -Value $p -Encoding UTF8"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$d='%NODEDIR%'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if ([string]::IsNullOrEmpty($p)) { $n=$d } elseif ($p -notlike '*'+$d+'*') { $n=$p+';'+$d } else { $n=$p }; [Environment]::SetEnvironmentVariable('Path',$n,'User'); Write-Host '       user PATH is now set'"

set "PATH=%NODEDIR%;%PATH%"
echo.

echo [4/4] Checking the result...
echo.
for /f "usebackq delims=" %%v in (`node --version`) do echo       node  %%v
for /f "usebackq delims=" %%v in (`npm --version`) do echo       npm   %%v
echo.
echo ============================================================
echo   DONE
echo ============================================================
echo.
echo   Node.js lives here:
echo       %NODEDIR%
echo.
echo   Now do this, in order:
echo       1. close EVERY VS Code window, completely
echo       2. open VS Code again
echo       3. in the terminal run:   node --version
echo       4. then run:              scripts\setup-windows.bat
echo.
echo   No computer restart is needed.
echo.
pause
exit /b 0

:alreadyinstalled
echo   Already installed here:
echo       %NODEDIR%
echo.
"%NODEDIR%\node.exe" --version
echo.
echo   If plain "node" still does not work, the PATH entry is
echo   missing. Delete this folder and run this script again:
echo       %NODEDIR%
echo.
pause
exit /b 0

:nodownload
echo.
echo   [X] The download did not work.
echo.
echo   Do it by hand instead:
echo     1. open this address in your browser
echo            %ZIPURL%
echo     2. it saves a .zip file
echo     3. move that file into this folder
echo            %TEMP%
echo     4. run this script again
echo.
pause
exit /b 1

:noextract
echo.
echo   [X] Extracting did not work.
echo.
echo   Do it by hand instead:
echo     1. the downloaded file is here
echo            %ZIPFILE%
echo     2. right-click it in File Explorer, choose Extract All
echo     3. extract it into this folder
echo            %TOOLS%
echo     4. run this script again
echo.
pause
exit /b 1
