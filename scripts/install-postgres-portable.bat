@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

set "PGVER=17.7"
set "TOOLS=%LOCALAPPDATA%\kayan-tools"
set "PGBIN=%TOOLS%\pgsql\bin"
set "PGDATA=%TOOLS%\pgdata"
set "ZIPURL=https://get.enterprisedb.com/postgresql/postgresql-%PGVER%-1-windows-x64-binaries.zip"
set "ZIPFILE=%TEMP%\kayan-postgresql-%PGVER%.zip"

echo ============================================================
echo   KAYAN ERP  -  installing PostgreSQL without the installer
echo ============================================================
echo.
echo   The normal PostgreSQL installer needs administrator rights.
echo   This method copies the official PostgreSQL binaries into a
echo   folder you own instead, then creates and starts the database.
echo   It needs no administrator rights.
echo.
echo   Database folder:
echo       %PGDATA%
echo.
echo   The download is about 330 MB and can take several minutes.
echo   Nothing will look like it is happening - that is normal.
echo.
pause
echo.

if exist "%PGBIN%\psql.exe" goto :hasbin

echo [1/5] Downloading PostgreSQL %PGVER%
echo.
if not exist "%TOOLS%" mkdir "%TOOLS%"

set "ZIPOK=0"
if exist "%ZIPFILE%" for %%A in ("%ZIPFILE%") do if %%~zA GTR 300000000 set "ZIPOK=1"
if "%ZIPOK%"=="1" goto :havezip

if exist "%ZIPFILE%" del /f /q "%ZIPFILE%"
where curl.exe >nul 2>&1
if not errorlevel 1 curl.exe -L --fail --output "%ZIPFILE%" "%ZIPURL%"
if not exist "%ZIPFILE%" powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%ZIPURL%' -OutFile '%ZIPFILE%' -UseBasicParsing } catch { }"
if not exist "%ZIPFILE%" goto :nodownload
for %%A in ("%ZIPFILE%") do echo       downloaded %%~zA bytes
goto :extract

:havezip
echo       already downloaded earlier - keeping it, no new download

:extract
echo.
echo [2/5] Extracting - this is the slow part, be patient
echo.
if exist "%TOOLS%\pgsql" rmdir /s /q "%TOOLS%\pgsql"
where tar.exe >nul 2>&1
if not errorlevel 1 tar.exe -xf "%ZIPFILE%" -C "%TOOLS%"
if not exist "%PGBIN%\psql.exe" powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -LiteralPath '%ZIPFILE%' -DestinationPath '%TOOLS%' -Force } catch { }"
if not exist "%PGBIN%\psql.exe" goto :noextract
echo       extracted.
echo.

:hasbin
echo [3/5] Adding PostgreSQL to your user PATH
echo.
if not exist "%TOOLS%\PATH-backup.txt" powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=[Environment]::GetEnvironmentVariable('Path','User'); Set-Content -LiteralPath '%TOOLS%\PATH-backup.txt' -Value $p -Encoding UTF8"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d='%PGBIN%'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if ([string]::IsNullOrEmpty($p)) { $n=$d } elseif ($p -notlike '*'+$d+'*') { $n=$p.TrimEnd(';')+';'+$d } else { $n=$p }; [Environment]::SetEnvironmentVariable('Path',$n,'User'); Write-Host '       user PATH is now set'"
echo.

echo [4/5] Creating the database folder
echo.
if exist "%PGDATA%\PG_VERSION" goto :havepgdata
if exist "%PGDATA%" rmdir /s /q "%PGDATA%"
"%PGBIN%\initdb.exe" -D "%PGDATA%" -U postgres -A trust -E UTF8 --locale=C >nul 2>&1
if not exist "%PGDATA%\PG_VERSION" goto :noinitdb
echo       created.
goto :pgdatadone

:havepgdata
echo       already exists, keeping it

:pgdatadone
echo.

echo [5/5] Starting the database server
echo.
call "%~dp0start-postgres.bat"
if errorlevel 3 goto :portbusy
if errorlevel 1 goto :nostart
"%PGBIN%\psql.exe" -U postgres -h 127.0.0.1 -t -A -c "select version();" 2>nul
echo.

echo ============================================================
echo   DONE - PostgreSQL is installed and running
echo ============================================================
echo.
echo   Now do this, in order:
echo       1. close EVERY VS Code window, completely
echo       2. open VS Code again
echo       3. in the terminal run:   psql --version
echo       4. then run:              scripts\setup-windows.bat
echo.
echo   When setup-windows.bat asks for the password of the
echo   "postgres" user, just type:   postgres
echo   This database only accepts connections from this PC, so
echo   that password is not protecting anything.
echo.
echo   After a reboot, start the database again with:
echo       scripts\start-postgres.bat
echo   pull-and-run.bat does that for you automatically.
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
echo     2. save the .zip file into this folder
echo            %TEMP%
echo     3. run this script again
echo.
pause
exit /b 1

:noextract
echo.
echo   [X] Extracting did not work. The file is still here:
echo       %ZIPFILE%
echo.
echo   Do it by hand instead:
echo     1. right-click that file in File Explorer
echo     2. choose Extract All
echo     3. extract it into this folder
echo            %TOOLS%
echo     4. run this script again
echo.
pause
exit /b 1

:noinitdb
echo.
echo   [X] Could not create the database folder.
echo.
echo   The most likely reason is a missing Microsoft Visual C++
echo   runtime. Install it from this address, then try again:
echo       https://aka.ms/vs/17/release/vc_redist.x64.exe
echo.
pause
exit /b 1

:nostart
echo.
echo   [X] PostgreSQL is installed but did not start.
echo.
echo   Here are the last lines of its log file, which say why:
echo   --------------------------------------------------------
powershell -NoProfile -Command "if (Test-Path '%TOOLS%\postgres.log') { Get-Content '%TOOLS%\postgres.log' -Tail 25 } else { Write-Host 'the log file was never created' }"
echo   --------------------------------------------------------
echo.
echo   The full log is here:
echo       %TOOLS%\postgres.log
echo.
echo   Send that text to whoever is helping you and they will
echo   tell you the next step.
echo.
pause
exit /b 1

:portbusy
echo.
echo   [X] PostgreSQL is installed, but port 5432 is already taken
echo       by another program on this PC.
echo.
echo   What is holding the port:
echo   --------------------------------------------------------
netstat -ano | findstr /r /c:":5432 .*LISTENING"
echo   --------------------------------------------------------
echo.
echo   To see which program that is, run:
echo       Get-Process -Id ^(Get-NetTCPConnection -LocalPort 5432^).OwningProcess
echo.
echo   If an older PostgreSQL service is running, stop it from:
echo       services.msc
echo.
pause
exit /b 1
