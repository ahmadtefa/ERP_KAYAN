#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Provisions a PostgreSQL database and user for ERP_KAYAN.
  Safe to run multiple times — skips steps already done.
.DESCRIPTION
  - Creates the PostgreSQL role (user) if it does not exist.
  - Creates the database if it does not exist.
  - Grants all privileges on the database to the role.
  - Does NOT drop or recreate anything already present.
  - Reads configuration from parameters or .env file.
.PARAMETER PgBinPath
  Path to PostgreSQL bin directory, e.g. 'C:\Program Files\PostgreSQL\18\bin'.
  If omitted, script searches common install locations.
.PARAMETER DbUser
  Database user/role name. Default: kayan
.PARAMETER DbPassword
  Database user password. If omitted, reads from KAYAN_DB_PASSWORD env var.
.PARAMETER DbName
  Database name. Default: kayan_erp
.PARAMETER PgSuperUser
  PostgreSQL superuser to connect with. Default: postgres
.NOTES
  Must be run as Administrator.
  The PostgreSQL service must already be running before calling this script.
#>

[CmdletBinding()]
param(
    [string]$PgBinPath   = '',
    [string]$DbUser      = 'kayan',
    [string]$DbPassword  = '',
    [string]$DbName      = 'kayan_erp',
    [string]$PgSuperUser = 'postgres'
)

$ErrorActionPreference = 'Stop'

# ── Locate psql ──────────────────────────────────────────────────────────────
if ($PgBinPath -and (Test-Path (Join-Path $PgBinPath 'psql.exe'))) {
    $psql = Join-Path $PgBinPath 'psql.exe'
} else {
    $candidates = @(
        'C:\Program Files\PostgreSQL\18\bin\psql.exe',
        'C:\Program Files\PostgreSQL\17\bin\psql.exe',
        'C:\Program Files\PostgreSQL\16\bin\psql.exe',
        'C:\Program Files\PostgreSQL\15\bin\psql.exe'
    )
    $psql = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $psql) {
        # Last resort: PATH
        $psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
        if ($psqlCommand) { $psql = $psqlCommand.Source }
    }
}

if (-not $psql) {
    Write-Error "psql.exe not found. Pass -PgBinPath or ensure PostgreSQL bin is in PATH."
    exit 1
}
Write-Host "[INFO] Using psql: $psql" -ForegroundColor Cyan

# ── Resolve password ──────────────────────────────────────────────────────────
if (-not $DbPassword) {
    $DbPassword = $env:KAYAN_DB_PASSWORD
}
if (-not $DbPassword) {
    # Try reading from backend/.env
    $envFile = Join-Path $PSScriptRoot '..\backend\.env'
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
        if ($line -match ':\/\/[^:]+:([^@]+)@') { $DbPassword = $Matches[1] }
    }
}
if (-not $DbPassword) {
    $secure = Read-Host "Enter password for DB user '$DbUser'" -AsSecureString
    $DbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

# ── Helper: run psql as superuser ─────────────────────────────────────────────
function Invoke-Psql {
    param([string]$Sql)
    $env:PGPASSWORD = $env:KAYAN_PG_SUPERPASSWORD   # may be empty → will prompt
    & $psql -U $PgSuperUser -d postgres -c $Sql 2>&1
}

# ── 1. Create role if not exists ──────────────────────────────────────────────
Write-Host "[INFO] Ensuring role '$DbUser' exists..." -ForegroundColor Cyan
$checkRole = Invoke-Psql "SELECT 1 FROM pg_roles WHERE rolname='$DbUser';"
if ($checkRole -match '1 row') {
    Write-Host "[OK] Role '$DbUser' already exists." -ForegroundColor Green
} else {
    Invoke-Psql "CREATE ROLE `"$DbUser`" WITH LOGIN PASSWORD '$DbPassword';" | Out-Null
    Write-Host "[OK] Role '$DbUser' created." -ForegroundColor Green
}

# ── 2. Create database if not exists ─────────────────────────────────────────
Write-Host "[INFO] Ensuring database '$DbName' exists..." -ForegroundColor Cyan
$checkDb = Invoke-Psql "SELECT 1 FROM pg_database WHERE datname='$DbName';"
if ($checkDb -match '1 row') {
    Write-Host "[OK] Database '$DbName' already exists." -ForegroundColor Green
} else {
    Invoke-Psql "CREATE DATABASE `"$DbName`" OWNER `"$DbUser`";" | Out-Null
    Write-Host "[OK] Database '$DbName' created." -ForegroundColor Green
}

# ── 3. Grant privileges ───────────────────────────────────────────────────────
Write-Host "[INFO] Granting privileges on '$DbName' to '$DbUser'..." -ForegroundColor Cyan
Invoke-Psql "GRANT ALL PRIVILEGES ON DATABASE `"$DbName`" TO `"$DbUser`";" | Out-Null
Write-Host "[OK] Privileges granted." -ForegroundColor Green

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Provisioning complete ===" -ForegroundColor Green
Write-Host "  Database : $DbName"
Write-Host "  User     : $DbUser"
Write-Host ""
Write-Host "Example DATABASE_URL:"
Write-Host "  postgresql://${DbUser}:<password>@127.0.0.1:5432/${DbName}"
