<#
    KAYAN ERP - Safe reset (start fresh). OPTIONAL, MANUAL, SEPARATE.

    This tool is NOT part of installing, updating or repairing, and nothing
    in the product runs it automatically. Setup never calls it, Repair never
    calls it, and the program never calls it. A person runs it on purpose
    from the Start menu when they want this machine to behave like a brand
    new installation: create a company and a general manager from scratch.

    What it does, in order, stopping at the first failure:

      1. Explains itself and requires the word RESET to be typed.
      2. Checks the bundled files, the PostgreSQL service, disk space
         and the current database (without changing anything).
      3. Takes an independent pg_dump backup OUTSIDE the program folder
         (under %ProgramData%\KAYAN-ERP\backups, which Setup never
         replaces) and proves the archive is readable with
         pg_restore --list.
      4. Creates a NEW, separate database. The old database is never
         emptied, never overwritten and never dropped - not here, not
         on success, not on failure.
      5. Applies every migration to the new database and verifies it
         answers as an empty, ready schema.
      6. Only then points the settings (kayan.env) at the new database,
         keeping a timestamped copy of the previous settings next to it.
      7. Starts the real API briefly and requires /api/v1/health to
         answer with needsSetup=true. If anything fails after the
         switch, the previous settings are restored automatically, so
         the program keeps using the old, intact database.

    Deleting the old database afterwards is a separate, explicit
    decision for the owner of the machine; this tool never does it.

    Exit codes: 0 = reset completed and verified; 2 = cancelled or
    refused before any change; 1 = failed (previous settings restored
    if they had been switched; old database and backup untouched).
#>
[CmdletBinding()]
param(
  [string]$UserSettingsPath = (Join-Path $env:APPDATA 'KAYAN-ERP\kayan.env'),
  [string]$ProgramDataRoot = (Join-Path $env:ProgramData 'KAYAN-ERP'),
  [string]$ConfirmText = '',
  [switch]$AllowEmptyDatabase,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$bootstrapLog = Join-Path $ProgramDataRoot 'logs\installer.log'
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
$switchedFiles = @()   # settings files already rewritten, for rollback

function Protect-Secret([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return '' }
  $protected = [regex]::Replace($Text, '(?i)postgres(?:ql)?://[^\s"'']+', '[DATABASE URL REDACTED]')
  $protected = [regex]::Replace($protected, '(?i)(password\s*[=:]\s*)[^\s;]+', '$1[REDACTED]')
  $protected = [regex]::Replace($protected, "(?i)(password\s+')[^']+(')", '$1[REDACTED]$2')
  return $protected
}

function Write-ResetMarker([string]$Message) {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bootstrapLog) | Out-Null
    Add-Content -LiteralPath $bootstrapLog -Value ("{0:u} {1}" -f (Get-Date), (Protect-Secret $Message)) -Encoding UTF8
  } catch { }
}

function Show-ResetMessage([string]$Text, [bool]$IsError) {
  Write-Output $Text
  if (-not $Quiet -and [Environment]::UserInteractive) {
    try {
      Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
      $image = if ($IsError) { [System.Windows.MessageBoxImage]::Error } else { [System.Windows.MessageBoxImage]::Information }
      [System.Windows.MessageBox]::Show($Text, 'KAYAN ERP Reset', [System.Windows.MessageBoxButton]::OK, $image) | Out-Null
    } catch { }
  }
}

# Reads kayan.env the tolerant way every KAYAN tool reads it.
function Read-KayanSettings([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $clean = $line -replace '^\uFEFF', ''
    if ($clean -match '^\s*([A-Z_]+)="?([^"]*)"?\s*$') {
      $values[$matches[1]] = $matches[2].Trim('"')
    }
  }
  return $values
}

# The connection facts this tool needs from a PostgreSQL URL. The
# password is returned for pg tools only and is never printed.
function Parse-DatabaseUrl([string]$Url) {
  $uri = [Uri]$Url
  $port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
  $userInfo = $uri.UserInfo
  $user = $userInfo
  $password = ''
  $colon = $userInfo.IndexOf(':')
  if ($colon -ge 0) {
    $user = $userInfo.Substring(0, $colon)
    $password = [Uri]::UnescapeDataString($userInfo.Substring($colon + 1))
  }
  return @{
    Host = $uri.Host
    Port = $port
    User = [Uri]::UnescapeDataString($user)
    Password = $password
    Database = $uri.AbsolutePath.TrimStart('/')
  }
}

# One scalar query through the bundled psql. Throws with the tool's own
# (redacted) output when PostgreSQL refuses.
function Invoke-PsqlScalar([string]$PsqlExe, $Connection, [string]$Database, [string]$Sql) {
  $previous = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $Connection.Password
    $output = @(& $PsqlExe -h $Connection.Host -p $Connection.Port -U $Connection.User -d $Database -v ON_ERROR_STOP=1 -t -A -c $Sql 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw ("PostgreSQL refused a read-only check on database '" + $Database + "': " + (Protect-Secret ($output -join ' ')))
    }
    return (($output -join '').Trim())
  } finally {
    if ($null -eq $previous) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previous }
  }
}

function Restore-PreviousSettings {
  foreach ($entry in $switchedFiles) {
    try {
      Copy-Item -LiteralPath $entry.Backup -Destination $entry.Path -Force
      Write-ResetMarker ("KAYAN-RESET-ROLLBACK restored " + $entry.Path)
    } catch {
      Write-ResetMarker ("KAYAN-RESET-ROLLBACK-FAILED " + $entry.Path + ': ' + $_.Exception.Message)
    }
  }
}

try {
  # Elevate first (service control and the machine settings need it),
  # carrying the INVOKING user's settings path through, exactly like
  # repair-runtime.ps1 does.
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $argList = @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', ('"' + $PSCommandPath + '"'),
      '-UserSettingsPath', ('"' + $UserSettingsPath + '"'),
      '-ProgramDataRoot', ('"' + $ProgramDataRoot + '"')
    )
    if ($ConfirmText) { $argList += @('-ConfirmText', $ConfirmText) }
    if ($AllowEmptyDatabase) { $argList += '-AllowEmptyDatabase' }
    if ($Quiet) { $argList += '-Quiet' }
    $child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList $argList
    exit $child.ExitCode
  }

  Write-ResetMarker 'KAYAN-RESET-START'

  # ---- Locate the bundled pieces. Missing pieces mean the
  # installation itself is broken; that is Repair's job, not Reset's.
  $backendDir = Join-Path $PSScriptRoot 'backend'
  $nodeExe = Join-Path $backendDir 'node\node.exe'
  $prepareScript = Join-Path $backendDir 'scripts\prepare-database.mjs'
  $mainJs = Join-Path $backendDir 'dist\src\main.js'
  $pgBin = Join-Path $backendDir 'postgres\bin'
  $psqlExe = Join-Path $pgBin 'psql.exe'
  $pgDumpExe = Join-Path $pgBin 'pg_dump.exe'
  $pgRestoreExe = Join-Path $pgBin 'pg_restore.exe'
  $pgReadyExe = Join-Path $pgBin 'pg_isready.exe'
  foreach ($required in @($nodeExe, $prepareScript, $mainJs, $psqlExe, $pgDumpExe, $pgRestoreExe)) {
    if (-not (Test-Path -LiteralPath $required)) {
      throw "Part of this installation is missing: $required. Run Repair KAYAN ERP first; the reset changed nothing."
    }
  }

  # ---- Effective settings: the machine file the installer maintains,
  # else the user copy the shell uses.
  $machineSettings = Join-Path $ProgramDataRoot 'kayan.env'
  $settingsFile = if (Test-Path -LiteralPath $machineSettings) { $machineSettings } elseif (Test-Path -LiteralPath $UserSettingsPath) { $UserSettingsPath } else { $null }
  if (-not $settingsFile) {
    Show-ResetMessage 'KAYAN ERP settings (kayan.env) were not found, so there is nothing to reset. Run the KAYAN ERP installer first.' $true
    exit 2
  }
  $values = Read-KayanSettings $settingsFile
  if (-not $values['DATABASE_URL'] -or -not $values['ADMIN_DATABASE_URL']) {
    throw 'The settings do not carry both DATABASE_URL and ADMIN_DATABASE_URL, so a safe reset cannot be prepared. Nothing was changed; run Repair first.'
  }
  $app = Parse-DatabaseUrl $values['DATABASE_URL']
  $admin = Parse-DatabaseUrl $values['ADMIN_DATABASE_URL']
  if (@('127.0.0.1', 'localhost', '::1') -notcontains $app.Host) {
    Show-ResetMessage ("The configured database is not the bundled local one (" + $app.Host + "). Safe reset only manages the local bundled PostgreSQL; a network database is its administrator's job. Nothing was changed.") $true
    exit 2
  }

  $newDatabase = 'erp_kayan_' + $timestamp
  $backupDir = Join-Path $ProgramDataRoot ('backups\reset-' + $timestamp)
  $backupFile = Join-Path $backupDir 'before-reset.dump'

  # ---- The warning and the explicit, typed confirmation.
  Write-Output ''
  Write-Output '=== KAYAN ERP - SAFE RESET (start fresh) ==='
  Write-Output ''
  Write-Output ("Current database : " + $app.Database + " (kept untouched, always)")
  Write-Output ("New database     : " + $newDatabase + " (created empty)")
  Write-Output ("Backup first     : " + $backupFile)
  Write-Output ''
  Write-Output 'After a verified backup and a verified new database, the program'
  Write-Output 'will be pointed at the NEW empty database, and opening KAYAN ERP'
  Write-Output 'will ask for a new company and a new general manager.'
  Write-Output 'The current company, users and data stay in the old database and'
  Write-Output 'in the backup. Nothing is deleted by this tool - ever.'
  Write-Output ''
  $confirmation = $ConfirmText
  if (-not $confirmation) {
    if (-not [Environment]::UserInteractive) {
      Write-ResetMarker 'KAYAN-RESET-CANCELLED no confirmation in a non-interactive session'
      Show-ResetMessage 'Reset needs a person to type RESET. Nothing was changed.' $true
      exit 2
    }
    $confirmation = Read-Host 'Type RESET to continue (anything else cancels)'
  }
  if ($confirmation.Trim() -cne 'RESET') {
    Write-ResetMarker 'KAYAN-RESET-CANCELLED before any change'
    Show-ResetMessage 'Reset cancelled. Nothing was changed: settings, database and company data are exactly as they were.' $false
    exit 2
  }

  # ---- Pre-checks that change nothing.
  $serviceName = 'KayanERPPostgreSQL'
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $service) {
    throw 'The bundled PostgreSQL service is not installed. Run Repair KAYAN ERP first; the reset changed nothing.'
  }
  if ($service.Status -ne 'Running') {
    Start-Service -Name $serviceName
    (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
  }
  if (Test-Path -LiteralPath $pgReadyExe) {
    & $pgReadyExe -h $app.Host -p $app.Port -U $admin.User *> $null
    if ($LASTEXITCODE -ne 0) {
      throw ("PostgreSQL is not accepting connections on " + $app.Host + ":" + $app.Port + ". Run Repair first; the reset changed nothing.")
    }
  }

  # Inspect the CURRENT database (read-only). An unanswerable question
  # aborts the reset: guessing here is how data gets hurt.
  $counts = Invoke-PsqlScalar $psqlExe $admin $app.Database "SELECT (SELECT count(*) FROM companies) || '/' || (SELECT count(*) FROM users)"
  $parts = $counts.Split('/')
  $companies = [int]$parts[0]
  $users = [int]$parts[1]
  if ($companies -eq 0 -and $users -eq 0 -and -not $AllowEmptyDatabase) {
    Write-ResetMarker 'KAYAN-RESET-REFUSED current database is already empty'
    Show-ResetMessage 'The current database is already empty - this installation is already fresh. Open KAYAN ERP and complete the first-run setup. Nothing was changed, and no extra database was created.' $false
    exit 2
  }
  $databaseBytes = [int64](Invoke-PsqlScalar $psqlExe $admin 'postgres' ("SELECT pg_database_size('" + $app.Database.Replace("'", "''") + "')"))
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $driveRoot = [System.IO.Path]::GetPathRoot($backupDir)
  $free = (New-Object System.IO.DriveInfo($driveRoot)).AvailableFreeSpace
  $needed = [Math]::Max(1GB, 2 * $databaseBytes)
  if ($free -lt $needed) {
    throw ("Not enough free disk space for a safe backup on $driveRoot (free $free bytes, want at least $needed). Free space and retry; the reset changed nothing.")
  }

  # ---- From here, changes begin. Close the program first so nothing
  # holds the old settings or writes during the switch.
  Get-Process -Name 'erp_kayan' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  # ---- The backup, verified before anything else moves.
  # Start-Process with redirected files: pg_dump writes its progress to
  # stderr even when it succeeds, and this script must judge it by its
  # exit code, not by stream plumbing.
  $dumpLog = Join-Path $env:TEMP ('kayan-reset-dump-' + $timestamp + '.log')
  $previousPassword = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $admin.Password
    $dump = Start-Process -FilePath $pgDumpExe -ArgumentList @('-h', $app.Host, '-p', [string]$app.Port, '-U', $admin.User, '-d', $app.Database, '-Fc', '-f', ('"' + $backupFile + '"')) -Wait -PassThru -NoNewWindow -RedirectStandardError $dumpLog
    if ($dump.ExitCode -ne 0) {
      $dumpTail = (Get-Content -LiteralPath $dumpLog -Raw -ErrorAction SilentlyContinue)
      throw ("The safety backup (pg_dump) failed, so the reset stops here. The current database and settings were not changed. pg_dump said: " + (Protect-Secret ([string]$dumpTail).Trim()))
    }
  } finally {
    if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previousPassword }
    Remove-Item -LiteralPath $dumpLog -Force -ErrorAction SilentlyContinue
  }
  $backupInfo = Get-Item -LiteralPath $backupFile -ErrorAction Stop
  if ($backupInfo.Length -le 0) {
    throw 'The safety backup file is empty, so the reset stops here. Nothing else was changed.'
  }
  $listing = @(& $pgRestoreExe --list $backupFile 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw 'The safety backup could not be read back by pg_restore, so the reset stops here. Nothing else was changed.'
  }
  $entries = @($listing | Where-Object { $_ -match '^\d+;' }).Count
  if ($entries -le 0) {
    throw 'The safety backup lists no objects, so the reset stops here. Nothing else was changed.'
  }
  Write-ResetMarker ("KAYAN-RESET-BACKUP-OK " + $backupFile + " (" + $backupInfo.Length + " bytes, " + $entries + " objects)")

  # ---- The new, separate database. The old one is not touched.
  $exists = Invoke-PsqlScalar $psqlExe $admin 'postgres' ("SELECT count(*) FROM pg_database WHERE datname = '" + $newDatabase + "'")
  if ([int]$exists -gt 0) {
    throw ("A database named $newDatabase already exists (two resets in the same second?). Nothing was switched; retry in a moment.")
  }
  [void](Invoke-PsqlScalar $psqlExe $admin 'postgres' ('CREATE DATABASE "' + $newDatabase + '" OWNER "' + $app.User.Replace('"', '""') + '"'))

  # ---- Migrate the new database with the product's own preparation,
  # and require it to report the database as empty-and-ready-to-ask.
  $newUrl = [regex]::Replace($values['DATABASE_URL'], '(postgres(?:ql)?://[^/]+/)[^?]+', ('$1' + $newDatabase))
  $prepOut = Join-Path $env:TEMP ('kayan-reset-prep-out-' + $timestamp + '.log')
  $prepErr = Join-Path $env:TEMP ('kayan-reset-prep-err-' + $timestamp + '.log')
  $savedDatabaseUrl = $env:DATABASE_URL
  $savedAdminUrl = $env:ADMIN_DATABASE_URL
  try {
    $env:DATABASE_URL = $newUrl
    $env:ADMIN_DATABASE_URL = $values['ADMIN_DATABASE_URL']
    $prep = Start-Process -FilePath $nodeExe -ArgumentList @('scripts\prepare-database.mjs') -WorkingDirectory $backendDir -Wait -PassThru -NoNewWindow -RedirectStandardOutput $prepOut -RedirectStandardError $prepErr
    $prepText = ((Get-Content -LiteralPath $prepOut -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $prepErr -Raw -ErrorAction SilentlyContinue))
    if ($prep.ExitCode -ne 0 -or $prepText -notmatch 'KAYAN-DB-STATE=empty') {
      throw ("Preparing the new database did not finish as an empty, migrated database (exit " + $prep.ExitCode + "): " + (Protect-Secret $prepText.Trim()) + " The settings still point at the old database; the unused new database was left for inspection, not dropped.")
    }
  } finally {
    if ($null -eq $savedDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue } else { $env:DATABASE_URL = $savedDatabaseUrl }
    if ($null -eq $savedAdminUrl) { Remove-Item Env:ADMIN_DATABASE_URL -ErrorAction SilentlyContinue } else { $env:ADMIN_DATABASE_URL = $savedAdminUrl }
    Remove-Item -LiteralPath $prepOut, $prepErr -Force -ErrorAction SilentlyContinue
  }
  # Ask the new database directly, as the application user, before
  # trusting it with the switch.
  $newUsers = [int](Invoke-PsqlScalar $psqlExe $app $newDatabase 'SELECT count(*) FROM users')
  $newTables = [int](Invoke-PsqlScalar $psqlExe $app $newDatabase "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
  if ($newUsers -ne 0 -or $newTables -lt 10) {
    throw "The new database did not verify as an empty migrated schema (users=$newUsers, tables=$newTables). Settings still point at the old database."
  }
  Write-ResetMarker ("KAYAN-RESET-NEW-DATABASE-READY " + $newDatabase)

  # ---- The switch, last and reversible: back up each settings file
  # next to itself, then change only the database name inside
  # DATABASE_URL. Passwords, secrets and every other line stay as-is.
  # De-duplicated: if both paths ever name the same file, switching it
  # twice would back up the already-switched content as its own
  # "previous" copy and defeat the rollback.
  $settingsPaths = @($machineSettings, $UserSettingsPath) | Select-Object -Unique
  # Every copy that is switched carries a generation stamp that only grows, so
  # a per-user copy this tool could not reach (another Windows account) is
  # recognisably older than the machine copy - and the program then reads the
  # machine copy instead of the database it used before the reset.
  $highestGeneration = 0
  foreach ($path in $settingsPaths) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    foreach ($existingLine in @(Get-Content -LiteralPath $path -ErrorAction SilentlyContinue)) {
      if ($existingLine -match '^\s*KAYAN_SETTINGS_GENERATION="?(\d+)"?\s*$') {
        if ([int64]$matches[1] -gt $highestGeneration) { $highestGeneration = [int64]$matches[1] }
      }
    }
  }
  $generationStamp = [string]([Math]::Max([DateTimeOffset]::UtcNow.ToUnixTimeSeconds(), $highestGeneration + 1))
  foreach ($path in $settingsPaths) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $backupCopy = $path + '.before-reset-' + $timestamp + '.bak'
    Copy-Item -LiteralPath $path -Destination $backupCopy -Force
    $lines = Get-Content -LiteralPath $path
    $sawGeneration = $false
    $rewritten = foreach ($line in $lines) {
      if ($line -match '^\s*DATABASE_URL=') {
        [regex]::Replace($line, '(postgres(?:ql)?://[^/]+/)[^?"'']+', ('$1' + $newDatabase))
      } elseif ($line -match '^\s*KAYAN_SETTINGS_GENERATION=') {
        $sawGeneration = $true
        ('KAYAN_SETTINGS_GENERATION="' + $generationStamp + '"')
      } else { $line }
    }
    if (-not $sawGeneration) { $rewritten = @($rewritten) + ('KAYAN_SETTINGS_GENERATION="' + $generationStamp + '"') }
    # UTF-8 without a BOM: the shell's own parser reads this file line
    # by line, and a BOM would ride into the first line's key.
    [System.IO.File]::WriteAllLines($path, [string[]]$rewritten, (New-Object System.Text.UTF8Encoding($false)))
    $switchedFiles += @{ Path = $path; Backup = $backupCopy }
  }
  if ($switchedFiles.Count -eq 0) {
    throw 'No settings file could be switched. The new database exists but the program still uses the old one.'
  }
  Write-ResetMarker ("KAYAN-RESET-SWITCHED to " + $newDatabase + " (previous settings kept as .before-reset-" + $timestamp + ".bak)")

  # ---- Prove the switched installation: start the real API with the
  # NEW settings and require needsSetup=true. Any failure rolls the
  # settings back to the old database automatically.
  $probePort = $null
  foreach ($candidate in @(3000, 3001, 3002, 3003, 3010, 3020)) {
    $listener = $null
    try {
      $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $candidate)
      $listener.Start()
      $probePort = $candidate
      break
    } catch { } finally { if ($listener) { $listener.Stop() } }
  }
  if (-not $probePort) { throw 'No free local port was available to verify the reset.' }

  $probeOut = Join-Path $env:TEMP ('kayan-reset-api-out-' + $timestamp + '.log')
  $probeErr = Join-Path $env:TEMP ('kayan-reset-api-err-' + $timestamp + '.log')
  $probe = $null
  $health = $null
  try {
    $freshSettingsPath = $UserSettingsPath
    if (Test-Path -LiteralPath $machineSettings) { $freshSettingsPath = $machineSettings }
    $freshValues = Read-KayanSettings $freshSettingsPath
    foreach ($entry in $freshValues.GetEnumerator()) {
      Set-Item -Path ("Env:" + $entry.Key) -Value $entry.Value
    }
    $env:PORT = [string]$probePort
    $env:HOST = '127.0.0.1'
    $env:NODE_ENV = 'production'
    $env:NO_COLOR = '1'
    $env:KAYAN_BACKUP_DIR = Join-Path $ProgramDataRoot 'backups'
    $env:KAYAN_UPLOAD_DIR = Join-Path $ProgramDataRoot 'uploads'
    $probe = Start-Process -FilePath $nodeExe -ArgumentList @('dist\src\main.js') -WorkingDirectory $backendDir -PassThru -NoNewWindow -RedirectStandardOutput $probeOut -RedirectStandardError $probeErr
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
      if ($probe.HasExited) { break }
      try {
        $candidate = Invoke-RestMethod -Uri "http://127.0.0.1:$probePort/api/v1/health" -TimeoutSec 3
        if ($candidate.status) { $health = $candidate; break }
      } catch { }
      Start-Sleep -Milliseconds 700
    }
  } finally {
    if ($probe -and -not $probe.HasExited) {
      Stop-Process -Id $probe.Id -Force -ErrorAction SilentlyContinue
      try { $probe.WaitForExit(10000) | Out-Null } catch { }
    }
  }
  if (-not $health -or $health.needsSetup -ne $true) {
    $details = ((Get-Content -LiteralPath $probeOut -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $probeErr -Raw -ErrorAction SilentlyContinue)).Trim()
    throw ("The reset could not be verified: the server did not answer as a fresh installation (needsSetup expected). Previous settings are being restored. Server output: " + (Protect-Secret $details))
  }
  Remove-Item -LiteralPath $probeOut, $probeErr -Force -ErrorAction SilentlyContinue

  # ---- A small paper trail next to the backup (no secrets in it).
  $summary = @(
    'KAYAN ERP safe reset - completed and verified',
    ("When (local)     : " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')),
    ("Previous database: " + $app.Database + ' (kept, untouched)'),
    ("New database     : " + $newDatabase + ' (empty; the program now uses this one)'),
    ("Backup of previous database: " + $backupFile + " (" + $backupInfo.Length + " bytes, " + $entries + " objects, verified readable)"),
    'Previous settings: kept next to kayan.env as .before-reset-*.bak - restoring that file points the program back at the previous database.',
    'The previous database was NOT deleted. Deleting it is a separate decision for the owner of this machine.'
  )
  Set-Content -LiteralPath (Join-Path $backupDir 'reset-summary.txt') -Value $summary -Encoding UTF8
  Write-ResetMarker ("KAYAN-RESET-OK new=" + $newDatabase + " old=" + $app.Database + " backup=" + $backupFile)

  Show-ResetMessage ("Reset completed and verified.`n`nOpen KAYAN ERP to create the new company and the general manager account.`n`nYour previous data is safe:`n- old database kept: " + $app.Database + "`n- backup: " + $backupFile) $false
  exit 0
} catch {
  $reason = Protect-Secret $_.Exception.Message
  if ($switchedFiles.Count -gt 0) {
    Restore-PreviousSettings
    $reason += ' The previous settings were restored, so the program still uses the previous database.'
  }
  Write-ResetMarker ("KAYAN-RESET-FAILED " + $reason)
  Show-ResetMessage ("KAYAN ERP reset did not complete. Your existing company data was not deleted.`n`n" + $reason + "`n`nDiagnostics: " + $bootstrapLog) $true
  exit 1
}
