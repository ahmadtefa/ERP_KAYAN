# Dedicated PostgreSQL service manager for KAYAN ERP on Windows.
#
# Creates and manages an isolated PostgreSQL cluster and Windows service
# (`KAYAN_PostgreSQL`) on port 5433 so KAYAN ERP does not collide with any
# developer or third-party PostgreSQL installation on port 5432.
#
# Usage (Administrator PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts\manage-kayan-db.ps1 -Action install
#   powershell -ExecutionPolicy Bypass -File scripts\manage-kayan-db.ps1 -Action status
#   powershell -ExecutionPolicy Bypass -File scripts\manage-kayan-db.ps1 -Action start
#   powershell -ExecutionPolicy Bypass -File scripts\manage-kayan-db.ps1 -Action stop

[CmdletBinding()]
param(
  [ValidateSet("install", "start", "stop", "restart", "status", "uninstall")]
  [string]$Action = "status",
  [string]$ServiceName = "KAYAN_PostgreSQL",
  [int]$Port = 5433,
  [string]$DataDir = "",
  [string]$PgBinDir = "",
  [string]$Password = ""
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Find-PgBinDir([string]$Explicit) {
  $candidates = @()
  if ($Explicit) { $candidates += $Explicit }
  if ($env:KAYAN_PG_BIN_DIR) { $candidates += $env:KAYAN_PG_BIN_DIR }

  $programDataPg = Join-Path $env:ProgramData "KAYAN-ERP\pgsql"
  $candidates += (Join-Path $programDataPg "bin")
  $candidates += $programDataPg

  $scriptParent = Split-Path -Parent $PSScriptRoot
  $candidates += (Join-Path $scriptParent "pg\bin")
  $candidates += (Join-Path $scriptParent "pg")
  $candidates += (Join-Path $scriptParent "backend\pg\bin")
  $candidates += (Join-Path $scriptParent "backend\pg")

  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $base) { continue }
    $pgRoot = Join-Path $base "PostgreSQL"
    if (Test-Path $pgRoot) {
      Get-ChildItem $pgRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { $candidates += (Join-Path $_.FullName "bin") }
    }
  }

  foreach ($dir in $candidates) {
    if ($dir -and
        (Test-Path (Join-Path $dir "pg_ctl.exe")) -and
        (Test-Path (Join-Path $dir "initdb.exe")) -and
        (Test-Path (Join-Path $dir "postgres.exe"))) {
      return (Resolve-Path $dir).Path
    }
  }

  $onPath = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
  if ($onPath) { return (Split-Path -Parent $onPath.Source) }
  return $null
}

function Get-DefaultDataDir {
  $base = Join-Path $env:ProgramData "KAYAN-ERP"
  return (Join-Path $base "pgdata")
}

function Get-KayanEnvPath {
  $base = Join-Path $env:ProgramData "KAYAN-ERP"
  return (Join-Path $base "kayan.env")
}

function New-RandomSecret([int]$ByteCount = 32) {
  $bytes = New-Object byte[] $ByteCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

function Set-PostgresConfOption([string]$Content, [string]$Key, [string]$ValueLiteral) {
  $pattern = "(?m)^[#\s]*$([regex]::Escape($Key))\s*=.*$"
  $line = "$Key = $ValueLiteral"
  if ($Content -match $pattern) {
    return ([regex]::Replace($Content, $pattern, $line))
  }
  return ($Content.TrimEnd() + "`r`n" + $line + "`r`n")
}

function Grant-PostgresClusterPermissions([string]$PgRootDir, [string]$ClusterDir) {
  if ($PgRootDir -and (Test-Path $PgRootDir)) {
    & icacls.exe $PgRootDir /grant "*S-1-5-20:(OI)(CI)(RX)" "*S-1-5-18:(OI)(CI)(F)" "*S-1-5-32-544:(OI)(CI)(F)" /T /C | Out-Null
  }
  if ($ClusterDir -and (Test-Path $ClusterDir)) {
    & icacls.exe $ClusterDir /grant "*S-1-5-20:(OI)(CI)(F)" "*S-1-5-18:(OI)(CI)(F)" "*S-1-5-32-544:(OI)(CI)(F)" /T /C | Out-Null
  }
}

function Get-ExistingDatabasePassword([string]$EnvFile) {
  if (-not (Test-Path $EnvFile)) { return $null }
  foreach ($line in (Get-Content -Path $EnvFile -ErrorAction SilentlyContinue)) {
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith("#") -or -not $trimmed.StartsWith("DATABASE_URL=")) { continue }
    $url = $trimmed.Substring("DATABASE_URL=".Length).Trim()
    if ($url -match "^postgresql://[^:]+:([^@]+)@") {
      return [System.Uri]::UnescapeDataString($Matches[1])
    }
  }
  return $null
}

$targetDataDir = if ($DataDir) { $DataDir } else { Get-DefaultDataDir }

switch ($Action) {
  "status" {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) {
      Write-Output "SERVICE_STATUS=NOT_INSTALLED"
      exit 3
    }
    Write-Output ("SERVICE_NAME=" + $svc.Name)
    Write-Output ("SERVICE_STATUS=" + $svc.Status)
    Write-Output ("DATA_DIR=" + $targetDataDir)
    exit 0
  }

  "start" {
    Start-Service -Name $ServiceName
    Write-Output "SERVICE_STATUS=Running"
    exit 0
  }

  "stop" {
    Stop-Service -Name $ServiceName -Force
    Write-Output "SERVICE_STATUS=Stopped"
    exit 0
  }

  "restart" {
    Restart-Service -Name $ServiceName -Force
    Write-Output "SERVICE_STATUS=Running"
    exit 0
  }

  "uninstall" {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
      if ($svc.Status -ne "Stopped") {
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
      }
      & sc.exe delete $ServiceName | Out-Null
    }
    Write-Output "SERVICE_STATUS=UNINSTALLED"
    exit 0
  }

  "install" {
    $bin = Find-PgBinDir $PgBinDir
    if (-not $bin) {
      throw "PostgreSQL binaries (initdb.exe / pg_ctl.exe / postgres.exe) were not found."
    }

    $initdb = Join-Path $bin "initdb.exe"
    $pgCtl = Join-Path $bin "pg_ctl.exe"
    $psql = Join-Path $bin "psql.exe"
    $pgRoot = Split-Path -Parent $bin
    $shareCandidates = @(
      (Join-Path $pgRoot "share"),
      (Join-Path $bin "share")
    )
    $shareDir = $shareCandidates | Where-Object { Test-Path (Join-Path $_ "postgres.bki") } | Select-Object -First 1
    if (-not $shareDir) {
      throw "PostgreSQL share directory (postgres.bki) was not found near $bin."
    }

    $parentDir = Split-Path -Parent $targetDataDir
    if (-not (Test-Path $parentDir)) {
      New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }

    $pgVersionFile = Join-Path $targetDataDir "PG_VERSION"
    if (-not (Test-Path $pgVersionFile)) {
      New-Item -ItemType Directory -Force -Path $targetDataDir | Out-Null
      Grant-PostgresClusterPermissions -PgRootDir $pgRoot -ClusterDir $targetDataDir
      & $initdb -D $targetDataDir -U postgres -A trust -E UTF8 --locale=C -L $shareDir
      if ($LASTEXITCODE -ne 0) {
        throw "initdb failed with exit code $LASTEXITCODE"
      }
    }

    $confFile = Join-Path $targetDataDir "postgresql.conf"
    if (Test-Path $confFile) {
      $conf = [System.IO.File]::ReadAllText($confFile, $utf8NoBom)
      $conf = Set-PostgresConfOption -Content $conf -Key "port" -ValueLiteral "$Port"
      $conf = Set-PostgresConfOption -Content $conf -Key "listen_addresses" -ValueLiteral "'localhost'"
      $conf = Set-PostgresConfOption -Content $conf -Key "logging_collector" -ValueLiteral "on"
      $conf = Set-PostgresConfOption -Content $conf -Key "log_directory" -ValueLiteral "'log'"
      $conf = Set-PostgresConfOption -Content $conf -Key "log_filename" -ValueLiteral "'postgresql.log'"
      # Always write postgresql.conf as UTF-8 WITHOUT BOM. PowerShell 5.1's
      # Set-Content -Encoding UTF8 prepends 0xEF 0xBB 0xBF, which PostgreSQL
      # rejects as a syntax error at line 1 during service startup.
      [System.IO.File]::WriteAllText($confFile, $conf, $utf8NoBom)
    }

    $logDir = Join-Path $targetDataDir "log"
    if (-not (Test-Path $logDir)) {
      New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    }

    # Grant NT AUTHORITY\NetworkService (S-1-5-20) and LocalSystem (S-1-5-18)
    # access to both the PostgreSQL runtime and the pgdata directory AFTER
    # initdb (which resets ACLs on pgdata to the current user only).
    Grant-PostgresClusterPermissions -PgRootDir $pgRoot -ClusterDir $targetDataDir

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) {
      & $pgCtl register -N $ServiceName -D $targetDataDir -o "-p $Port" -S auto
      if ($LASTEXITCODE -ne 0) {
        $pgExe = Join-Path $bin "postgres.exe"
        $binPath = "`"$pgExe`" -D `"$targetDataDir`" -p $Port"
        New-Service -Name $ServiceName -BinaryPathName $binPath -DisplayName "KAYAN ERP PostgreSQL ($Port)" -StartupType Automatic | Out-Null
      }
    }

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) {
      throw "Service $ServiceName was not registered."
    }

    if ($svc.Status -ne "Running") {
      try {
        Start-Service -Name $ServiceName -ErrorAction Stop
      } catch {
        Write-Host "Default service account failed to start $ServiceName ($($_.Exception.Message)); configuring LocalSystem account..."
        & sc.exe config $ServiceName obj= "LocalSystem" | Out-Null
        Grant-PostgresClusterPermissions -PgRootDir $pgRoot -ClusterDir $targetDataDir
        Start-Service -Name $ServiceName -ErrorAction Stop
      }
    }

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
      $check = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
      if ($check.TcpTestSucceeded) {
        $ready = $true
        break
      }
      Start-Sleep -Seconds 1
    }
    if (-not $ready) {
      $pgLog = Join-Path $targetDataDir "log\postgresql.log"
      $pgLogTail = if (Test-Path $pgLog) { (Get-Content $pgLog -Tail 40) -join "`n" } else { "No postgresql.log found" }
      throw "Service $ServiceName started, but port $Port did not accept connections within 30 seconds.`n$pgLogTail"
    }

    $envFile = Get-KayanEnvPath
    $existingPw = Get-ExistingDatabasePassword -EnvFile $envFile
    $appPassword = if ($Password) {
      $Password
    } elseif ($existingPw) {
      $existingPw
    } else {
      New-RandomSecret 24
    }

    if (Test-Path $psql) {
      $escapedPw = $appPassword.Replace("'", "''")
      $roleExists = (& $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'erp_app';") 2>$null
      if ($LASTEXITCODE -ne 0) {
        throw "psql failed to query roles on 127.0.0.1:$Port"
      }
      if (($roleExists | Out-String).Trim() -ne "1") {
        & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE erp_app WITH LOGIN CREATEDB PASSWORD '$escapedPw';" | Out-Null
        if ($LASTEXITCODE -ne 0) {
          throw "psql failed to create erp_app role on 127.0.0.1:$Port"
        }
      } else {
        # Never automatically alter an existing erp_app role's password or
        # overwrite existing database credentials.
        Write-Host "Role erp_app already exists; preserving existing role password."
      }

      $exists = (& $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'erp_kayan';") 2>$null
      if (($exists | Out-String).Trim() -ne "1") {
        & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE erp_kayan OWNER erp_app;" | Out-Null
        if ($LASTEXITCODE -ne 0) {
          throw "psql failed to create database erp_kayan on 127.0.0.1:$Port"
        }
      }
    }

    # Preserve existing database credentials and JWT secrets across upgrades,
    # while ensuring required production keys (JWT_ACCESS_SECRET,
    # JWT_REFRESH_SECRET, ADMIN_DATABASE_URL, CORS_ORIGINS) exist and stripping
    # any legacy UTF-8 BOM.
    $existingMap = @{}
    if ((Test-Path $envFile) -and (-not $Password)) {
      $rawExisting = [System.IO.File]::ReadAllText($envFile, $utf8NoBom).TrimStart([char]0xFEFF)
      foreach ($line in ($rawExisting -split "\r?\n")) {
        $trimmed = $line.Trim().TrimStart([char]0xFEFF)
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $idx = $trimmed.IndexOf("=")
        if ($idx -le 0) { continue }
        $k = $trimmed.Substring(0, $idx).Trim()
        $v = $trimmed.Substring($idx + 1).Trim().Trim('"')
        if ($v) { $existingMap[$k] = $v }
      }
    }

    $encodedPw = [System.Uri]::EscapeDataString($appPassword)
    $dbUrlValue = if ($existingMap.ContainsKey("DATABASE_URL")) {
      $existingMap["DATABASE_URL"]
    } else {
      "postgresql://erp_app:$encodedPw@127.0.0.1:$Port/erp_kayan?schema=public"
    }
    $adminDbUrlValue = if ($existingMap.ContainsKey("ADMIN_DATABASE_URL")) {
      $existingMap["ADMIN_DATABASE_URL"]
    } else {
      "postgresql://postgres@127.0.0.1:$Port/postgres"
    }
    $jwtAccessSecret = if ($existingMap.ContainsKey("JWT_ACCESS_SECRET")) {
      $existingMap["JWT_ACCESS_SECRET"]
    } elseif ($existingMap.ContainsKey("JWT_SECRET")) {
      $existingMap["JWT_SECRET"]
    } else {
      New-RandomSecret 32
    }
    $jwtRefreshSecret = if ($existingMap.ContainsKey("JWT_REFRESH_SECRET")) {
      $existingMap["JWT_REFRESH_SECRET"]
    } else {
      New-RandomSecret 32
    }
    $corsOrigins = if ($existingMap.ContainsKey("CORS_ORIGINS")) {
      $existingMap["CORS_ORIGINS"]
    } elseif ($existingMap.ContainsKey("CORS_ORIGIN")) {
      $existingMap["CORS_ORIGIN"]
    } else {
      "http://localhost:3000,http://127.0.0.1:3000,lan"
    }

    $envContent = @(
      "# Managed by KAYAN ERP service installer",
      "HOST=0.0.0.0",
      "PORT=3000",
      "NODE_ENV=production",
      "DATABASE_URL=$dbUrlValue",
      "ADMIN_DATABASE_URL=$adminDbUrlValue",
      "JWT_ACCESS_SECRET=$jwtAccessSecret",
      "JWT_SECRET=$jwtAccessSecret",
      "JWT_REFRESH_SECRET=$jwtRefreshSecret",
      "JWT_ACCESS_TTL=900",
      "JWT_REFRESH_TTL=1209600",
      "CORS_ORIGINS=$corsOrigins"
    ) -join "`r`n"
    [System.IO.File]::WriteAllText($envFile, ($envContent + "`r`n"), $utf8NoBom)

    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $sid = ([System.Security.Principal.NTAccount]$currentUser).Translate([System.Security.Principal.SecurityIdentifier]).Value
    & icacls.exe $envFile /inheritance:r /grant:r "*$($sid):(R)" "*S-1-5-32-545:(R)" "*S-1-5-11:(R)" "*S-1-5-18:(F)" "*S-1-5-32-544:(F)" | Out-Null

    Write-Output "SERVICE_STATUS=Running"
    Write-Output "PORT=$Port"
    Write-Output "ENV_FILE=$envFile"
    return
  }
}
