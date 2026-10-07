@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo ============================================================
echo   KAYAN ERP  -  Windows Setup
echo ============================================================
echo.
echo  This script prepares the backend:
echo    1. checks that Node.js and PostgreSQL are installed
echo    2. creates the database and its user
echo    3. writes backend\.env with fresh random secrets
echo    4. installs packages, creates tables, loads starter data
echo.
echo  It does NOT touch the client. Run start-client.bat afterwards.
echo.
pause
echo.

REM ---------------------------------------------- 1. prerequisites
where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js was not found.
  echo.
  echo     Install the LTS version from:  https://nodejs.org
  echo     Then close this window and run this script again.
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo [OK] Node.js %%v

REM  Find psql. It is normally on PATH, but a PostgreSQL that was
REM  installed as a Windows service often is not, so look in the
REM  usual install folders before giving up.
set "PSQLDIR=onpath"
where psql >nul 2>&1
if not errorlevel 1 goto :psqlfound

set "PSQLDIR="
for /f "delims=" %%d in ('dir /b /ad /o-n "C:\Program Files\PostgreSQL" 2^>nul') do if not defined PSQLDIR if exist "C:\Program Files\PostgreSQL\%%d\bin\psql.exe" set "PSQLDIR=C:\Program Files\PostgreSQL\%%d\bin"
for /f "delims=" %%d in ('dir /b /ad /o-n "C:\Program Files (x86)\PostgreSQL" 2^>nul') do if not defined PSQLDIR if exist "C:\Program Files (x86)\PostgreSQL\%%d\bin\psql.exe" set "PSQLDIR=C:\Program Files (x86)\PostgreSQL\%%d\bin"
if not defined PSQLDIR if exist "%LOCALAPPDATA%\kayan-tools\pgsql\bin\psql.exe" set "PSQLDIR=%LOCALAPPDATA%\kayan-tools\pgsql\bin"

if not defined PSQLDIR goto :nopsql
set "PATH=%PSQLDIR%;%PATH%"

:psqlfound
for /f "delims=" %%v in ('psql --version') do echo [OK] %%v
echo      using psql from: %PSQLDIR%
goto :psqldone

:nopsql
echo [X] PostgreSQL was not found.
echo.
echo     Check whether it is installed as a Windows service:
echo       Get-Service *postgres*
echo.
echo     If a service is listed, it is installed and you do not need
echo     to install anything - the client is just not on your PATH.
echo     Tell whoever is helping you and they will point the scripts
echo     at the right folder.
echo.
echo     If no service is listed, install PostgreSQL from:
echo       https://www.postgresql.org/download/windows/
echo     During setup, remember the password you choose for the
echo     'postgres' superuser - you will need it in a moment.
echo.
pause
exit /b 1

:psqldone

echo.
echo ------------------------------------------------------------
echo  Database setup
echo ------------------------------------------------------------
echo  Enter the password of the PostgreSQL 'postgres' superuser.
echo  (Input is hidden while you type.)
echo.
echo  Note: if your password contains the characters  amp  pipe  or  caret
echo  the automated connection may fail. If that happens, use the manual
echo  steps in RUN_LOCALLY.md instead.

for /f "delims=" %%i in ('powershell -NoProfile -Command "$p=Read-Host -AsSecureString 'postgres password'; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)"') do set "PGPASSWORD=%%i"

echo.
echo  Testing the connection...
psql -U postgres -h 127.0.0.1 -c "SELECT 1;" >nul 2>&1
if errorlevel 1 (
  echo [X] Could not connect to PostgreSQL with that password.
  echo     Check that the PostgreSQL service is running:
  echo       services.msc  ^>  postgresql-x64-17
  echo.
  pause
  exit /b 1
)
echo [OK] Connected

REM ---------------------------------------------- 2. strong random values
for /f "delims=" %%i in ('powershell -NoProfile -Command "-join ((48..57)+(65..90)+(97..122) ^| Get-Random -Count 28 ^| %%{[char]$_})"') do set APPPASS=%%i
for /f "delims=" %%i in ('powershell -NoProfile -Command "-join ((48..57)+(65..90)+(97..122) ^| Get-Random -Count 56 ^| %%{[char]$_})"') do set JWT1=%%i
for /f "delims=" %%i in ('powershell -NoProfile -Command "-join ((48..57)+(65..90)+(97..122) ^| Get-Random -Count 56 ^| %%{[char]$_})"') do set JWT2=%%i

echo.
echo  Creating role and database...
psql -U postgres -h 127.0.0.1 -v ON_ERROR_STOP=0 -c "DROP DATABASE IF EXISTS erp_kayan;" >nul 2>&1
psql -U postgres -h 127.0.0.1 -v ON_ERROR_STOP=0 -c "DROP ROLE IF EXISTS erp_app;" >nul 2>&1
psql -U postgres -h 127.0.0.1 -c "CREATE ROLE erp_app WITH LOGIN PASSWORD '!APPPASS!';" >nul 2>&1
if errorlevel 1 (
  echo [X] Could not create the role.
  pause
  exit /b 1
)
psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE erp_kayan OWNER erp_app;" >nul 2>&1
if errorlevel 1 (
  echo [X] Could not create the database.
  pause
  exit /b 1
)
psql -U postgres -h 127.0.0.1 -c "ALTER ROLE erp_app CREATEDB;" >nul 2>&1
echo [OK] Database 'erp_kayan' created

set PGPASSWORD=

REM ---------------------------------------------- 3. write .env
echo.
echo  Writing backend\.env ...
> "backend\.env" echo # Generated by setup-windows.bat - DO NOT COMMIT
>> "backend\.env" echo DATABASE_URL="postgresql://erp_app:!APPPASS!@127.0.0.1:5432/erp_kayan?schema=public"
>> "backend\.env" echo PORT=3000
>> "backend\.env" echo NODE_ENV=development
>> "backend\.env" echo JWT_ACCESS_SECRET="!JWT1!"
>> "backend\.env" echo JWT_REFRESH_SECRET="!JWT2!"
>> "backend\.env" echo JWT_ACCESS_TTL=900
>> "backend\.env" echo JWT_REFRESH_TTL=604800
>> "backend\.env" echo CORS_ORIGINS="http://localhost:8081,http://localhost:5173,http://localhost:3000"
echo [OK] backend\.env written

REM ---------------------------------------------- 4. packages, schema, data
echo.
echo  Installing packages (this takes a few minutes)...
cd backend
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [X] npm install failed.
  cd ..
  pause
  exit /b 1
)

echo.
echo  Generating the database client...
call npx prisma generate
if errorlevel 1 ( cd .. & pause & exit /b 1 )

echo.
echo  Creating the tables...
call npx prisma migrate deploy
if errorlevel 1 ( cd .. & pause & exit /b 1 )

echo.
echo  Loading starter data (company, admin user, chart of accounts)...
call npx ts-node prisma/seed.ts
if errorlevel 1 ( cd .. & pause & exit /b 1 )

cd ..

echo.
echo ============================================================
echo   Setup complete
echo ============================================================
echo.
echo   Sign-in details for the desktop/mobile client:
echo       username:  admin
echo       password:  Admin@12345
echo.
echo   Change this password before using the system for real work.
echo.
echo   Next steps:
echo     1. run start-backend.bat   (leave that window open)
echo     2. run start-client.bat    (in another window)
echo.
pause
