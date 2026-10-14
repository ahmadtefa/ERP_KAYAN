# Installer post-install database step.
#
# Runs elevated during KAYAN-Setup.exe installation so the PostgreSQL runtime,
# database cluster, Windows service, and kayan.env live under ProgramData and
# survive app upgrades or uninstall.

[CmdletBinding()]
param(
  [string]$AppDir = "",
  [int]$Port = 5433
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AppDir)) {
  $AppDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$programDataRoot = Join-Path $env:ProgramData "KAYAN-ERP"
$pgRuntimeRoot = Join-Path $programDataRoot "pgsql"
$dataRoot = Join-Path $programDataRoot "pgdata"
$logFile = Join-Path $programDataRoot "installer-db-setup.log"
$errLogFile = Join-Path $programDataRoot "installer-db-setup-error.log"
$bundledPgRoot = Join-Path $AppDir "backend\pg"
$manageScript = Join-Path $AppDir "backend\scripts\manage-kayan-db.ps1"

New-Item -ItemType Directory -Force -Path $programDataRoot | Out-Null

function Write-InstallLog([string]$Message) {
  $line = ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Test-PgRuntime([string]$Root) {
  $required = @(
    "bin\initdb.exe",
    "bin\pg_ctl.exe",
    "bin\postgres.exe",
    "bin\psql.exe",
    "bin\pg_dump.exe",
    "bin\pg_restore.exe",
    "share\postgres.bki",
    "share\timezone",
    "share\timezonesets",
    "lib\plpgsql.dll"
  )
  foreach ($rel in $required) {
    if (-not (Test-Path (Join-Path $Root $rel))) {
      return $false
    }
  }
  return $true
}

Write-InstallLog "Starting KAYAN PostgreSQL runtime installation from $AppDir"

if (-not (Test-PgRuntime $pgRuntimeRoot)) {
  if (-not (Test-PgRuntime $bundledPgRoot)) {
    throw "Bundled PostgreSQL runtime is incomplete at $bundledPgRoot. Check $logFile."
  }
  Write-InstallLog "Copying bundled PostgreSQL runtime (bin, share, lib) to $pgRuntimeRoot"
  New-Item -ItemType Directory -Force -Path $pgRuntimeRoot | Out-Null
  foreach ($sub in @("bin", "share", "lib")) {
    $src = Join-Path $bundledPgRoot $sub
    $dst = Join-Path $pgRuntimeRoot $sub
    if (Test-Path $dst) {
      Remove-Item -Path $dst -Recurse -Force
    }
    Copy-Item -Path $src -Destination $dst -Recurse -Force
  }
}

if (-not (Test-PgRuntime $pgRuntimeRoot)) {
  throw "Installed PostgreSQL runtime under $pgRuntimeRoot is incomplete. Check $logFile."
}

# Ensure Windows service accounts (NetworkService S-1-5-20 and LocalSystem S-1-5-18)
# can read and execute the PostgreSQL runtime under ProgramData.
& icacls.exe $pgRuntimeRoot /grant "*S-1-5-20:(OI)(CI)(RX)" "*S-1-5-18:(OI)(CI)(F)" "*S-1-5-32-544:(OI)(CI)(F)" /T /C | Out-Null

if (-not (Test-Path $manageScript)) {
  throw "Database service script was not found at $manageScript."
}

if (Test-Path $errLogFile) {
  Remove-Item $errLogFile -Force -ErrorAction SilentlyContinue
}

Write-InstallLog "Provisioning KAYAN_PostgreSQL service and database on port $Port"
try {
  # Invoke manage-kayan-db.ps1 directly in-process so paths with spaces
  # (such as C:\Program Files\KAYAN ERP) are passed without Start-Process
  # argument-splitting issues.
  & $manageScript -Action install -Port $Port -DataDir $dataRoot -PgBinDir (Join-Path $pgRuntimeRoot "bin") 2>&1 |
    ForEach-Object { Write-InstallLog "$_" }
} catch {
  $errText = $_.Exception.ToString()
  Set-Content -Path $errLogFile -Value $errText -Encoding UTF8
  $pgLogFile = Join-Path $dataRoot "log\postgresql.log"
  $pgLogTail = if (Test-Path $pgLogFile) { (Get-Content $pgLogFile -Tail 40) -join "`n" } else { "" }
  Write-InstallLog ("ERROR: " + $errText)
  if ($pgLogTail) {
    Write-InstallLog ("PG_LOG:`n" + $pgLogTail)
  }
  throw "KAYAN database setup failed. Logs: $logFile`nERROR:`n$errText`nPG_LOG:`n$pgLogTail"
}

$service = Get-Service -Name "KAYAN_PostgreSQL" -ErrorAction SilentlyContinue
if (-not $service -or $service.Status -ne "Running") {
  throw "KAYAN_PostgreSQL service is not running after setup. Check $logFile."
}

$serviceConfig = Get-CimInstance Win32_Service -Filter "Name='KAYAN_PostgreSQL'" -ErrorAction SilentlyContinue
if (-not $serviceConfig -or $serviceConfig.PathName -notlike "*$pgRuntimeRoot*") {
  throw "KAYAN_PostgreSQL service path does not use the persistent ProgramData runtime: $($serviceConfig.PathName)"
}

$portReady = $false
for ($i = 0; $i -lt 30; $i++) {
  $check = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
  if ($check.TcpTestSucceeded) {
    $portReady = $true
    break
  }
  Start-Sleep -Seconds 1
}
if (-not $portReady) {
  throw "KAYAN_PostgreSQL service started, but port $Port did not accept TCP connections. Check $logFile."
}

$envFile = Join-Path $programDataRoot "kayan.env"
if (-not (Test-Path $envFile)) {
  throw "Database configuration file was not created at $envFile. Check $logFile."
}

Write-InstallLog "KAYAN_PostgreSQL is installed, running on port $Port, and configured at $envFile"
