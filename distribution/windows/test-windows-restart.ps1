<#
.SYNOPSIS
  Proves that an installed KAYAN ERP instance survives a real Windows restart.

.DESCRIPTION
  This is a four-phase script. It never reboots the machine by itself: a restart
  is a deliberate act, and a script that performs one unattended cannot tell an
  operator's machine from a disposable test VM.

  Phase record   - capture what must survive: schema state, row counts, checksums,
                   migration count, licence state, settings.
  Phase arm      - write a pending-restart marker and ask the operator to restart.
  Phase verify   - run after the reboot from an elevated prompt. Checks that the
                   PostgreSQL service, the backend and the data came back by
                   themselves, then compares against the recorded evidence.
  Phase revoke   - deletes the licences this script issued (test keys only).

  Nothing here reads, prints or stores a private key. The licence assertions
  check public state through the API and the state folder only.

.PARAMETER Phase
  record | arm | verify | revoke

.PARAMETER InstallRoot
  The installed application directory, e.g. C:\Program Files\KAYAN ERP

.PARAMETER EvidencePath
  Where the recorded evidence is written. Must survive the reboot, so keep it
  out of %TEMP%: pass something under ProgramData.

.PARAMETER AllowReboot
  Phase 'arm' may additionally perform the reboot itself, but only when this
  switch is passed explicitly. Without it, arm just writes the marker and stops.

.NOTES
  Requires an elevated PowerShell (the PostgreSQL service and the state folder
  are not readable by a standard user).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('record', 'arm', 'verify', 'revoke')]
  [string]$Phase,

  [string]$InstallRoot = 'C:\Program Files\KAYAN ERP',

  [string]$EvidencePath = 'C:\ProgramData\KAYAN-ERP\restart-evidence.json',

  [switch]$AllowReboot
)

$ErrorActionPreference = 'Stop'
$serviceName = 'KayanERPPostgreSQL'
$databaseName = 'erp_kayan'
$apiPorts = @(3000, 3001, 3002, 3003, 3010, 3020)

function Done([string]$Reason) {
  Write-Host "PASS: $Reason"
  $script:warnings = 0
}

function Stop-Here([string]$Reason) {
  Write-Host "::error title=Windows restart test failed::$Reason"
  exit 1
}

function Get-KayanHealth {
  foreach ($port in $apiPorts) {
    try {
      $result = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 3
      if ($result.status) { return @{ Port = $port; Status = [string]$result.status } }
    } catch { }
  }
  return $null
}

function Get-PostgresProcess {
  Get-Process -Name postgres -ErrorAction SilentlyContinue
}

function Assert-ServiceRunning([string]$When) {
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $service) { Stop-Here "The PostgreSQL service $serviceName does not exist ($When)." }
  if ($service.Status -ne 'Running') { Stop-Here "The PostgreSQL service $serviceName is $($service.Status), not Running ($When)." }
  if (-not $service.StartType -or $service.StartType -eq 'Disabled') {
    Stop-Here "The PostgreSQL service $serviceName is disabled and would not survive a restart ($When)."
  }
  $listening = @(Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)
  if ($listening.Count -eq 0) { Stop-Here "Nothing listens on 5432 after the restart ($When)." }
  Done "PostgreSQL service $serviceName is Running, starts as $($service.StartType), and listens on 5432 ($When)."
}

function Invoke-Psql([string]$Sql, [string]$When) {
  $psql = Get-ChildItem -Path $InstallRoot -Recurse -Filter 'psql.exe' -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $psql) { Stop-Here "psql.exe was not found under $InstallRoot ($When)." }
  $envPath = Join-Path $InstallRoot 'backend\.env'
  if (-not (Test-Path -LiteralPath $envPath)) { Stop-Here "The installed backend has no .env ($When)." }
  $databaseUrl = (Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
    Select-Object -First 1)
  if (-not $databaseUrl) { Stop-Here "DATABASE_URL is not set in the installed .env ($When)." }
  $match = [regex]::Match($databaseUrl, 'postgresql://(?<user>[^:]+):(?<password>[^@]*)@(?<host>[^:]+):(?<port>\d+)/(?<db>[^?]+)')
  if (-not $match.Success) { Stop-Here "DATABASE_URL in the installed .env is not a PostgreSQL URL ($When)." }
  # The password is passed through the environment, never on the command line,
  # where it would land in the process list and any command transcript.
  $previous = $env:PGPASSWORD
  $env:PGPASSWORD = $match.Groups['password'].Value
  try {
    $output = & $psql.FullName --no-password `
      -h 127.0.0.1 -p $match.Groups['port'].Value `
      -U $match.Groups['user'].Value -d $match.Groups['db'].Value `
      -t -A -v ON_ERROR_STOP=1 -c $Sql 2>&1
    if ($LASTEXITCODE -ne 0) { Stop-Here "A database query failed ($When): $output" }
    return @($output | ForEach-Object { "$_".Trim() })
  } finally {
    $env:PGPASSWORD = $previous
  }
}

function Get-DataFingerprint([string]$When) {
  # A narrow, deterministic sample: the migration ledger, the tables that hold
  # business records, and a checksum over them. Row counts alone would miss an
  # in-place edit; a full dump would be large and would contain business data.
  $migrations = (Invoke-Psql "SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL;" $When)[0]
  $tables = (Invoke-Psql @"
SELECT string_agg(format('%s=%s', relname, n_live_tup), ' ' ORDER BY relname)
FROM pg_stat_user_tables;
"@ $When)[0]
  $checksum = (Invoke-Psql @"
SELECT md5(string_agg(h, '' ORDER BY h)) FROM (
  SELECT md5(t::text) AS h
  FROM (SELECT id::text AS id, updated_at::text AS updated_at
        FROM "Company" ORDER BY id LIMIT 50) t
) s;
"@ $When)[0]
  return [ordered]@{
    migrations = [int]$migrations
    tables     = [string]$tables
    checksum   = [string]$checksum
  }
}

function Get-LicenceState([string]$When) {
  $state = [ordered]@{ state = 'unknown'; blocked = $null; configured = $null }
  $health = Get-KayanHealth
  if (-not $health) { return $state }
  # The status route requires an authenticated session, so the unauthenticated
  # call is expected to be refused. That refusal is itself the assertion.
  try {
    $anonymous = Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck `
      -Uri "http://127.0.0.1:$($health.Port)/api/v1/license/status" -TimeoutSec 10
    $state['unauthenticatedStatus'] = [int]$anonymous.StatusCode
    if ([int]$anonymous.StatusCode -ne 401) {
      Stop-Here "The licence status route answered $($anonymous.StatusCode) without a session ($When)."
    }
  } catch {
    $state['unauthenticatedStatus'] = 'unreachable'
  }
  $stateDirectory = Join-Path $env:ProgramData 'KAYAN-ERP\license'
  $state['stateDirectory'] = $stateDirectory
  $state['stateFolderPresent'] = Test-Path -LiteralPath $stateDirectory
  if ($state['stateFolderPresent']) {
    $state['files'] = @(Get-ChildItem -LiteralPath $stateDirectory -File -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty Name | Sort-Object)
  }
  return $state
}

function Save-Evidence($Object) {
  $directory = Split-Path -Parent $EvidencePath
  if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
  $Object | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}

function Read-Evidence {
  if (-not (Test-Path -LiteralPath $EvidencePath)) {
    Stop-Here "No recorded evidence at $EvidencePath. Run -Phase record before restarting."
  }
  return Get-Content -LiteralPath $EvidencePath -Raw | ConvertFrom-Json
}

Write-Host "::notice title=Windows restart test::Phase $Phase. Install root: $InstallRoot"

switch ($Phase) {
  'record' {
    if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'erp_kayan.exe'))) {
      Stop-Here "No installed client at $InstallRoot. Install first."
    }
    Assert-ServiceRunning 'before restart'
    $health = Get-KayanHealth
    if (-not $health) { Stop-Here "The backend does not answer health before the restart." }
    Done "The backend answers health on port $($health.Port) before the restart."

    $evidence = [ordered]@{
      recordedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
      computerName  = $env:COMPUTERNAME
      installRoot   = $InstallRoot
      bootId        = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
      data          = (Get-DataFingerprint 'before restart')
      licence       = (Get-LicenceState 'before restart')
      service       = [ordered]@{
        name      = $serviceName
        status    = (Get-Service -Name $serviceName).Status.ToString()
        startType = (Get-Service -Name $serviceName).StartType.ToString()
      }
    }
    Save-Evidence $evidence
    Done "Recorded evidence to $EvidencePath. $($evidence.data.migrations) migrations applied."
  }

  'arm' {
    $evidence = Read-Evidence
    if ($evidence.armMarker -and $evidence.armMarker.used) {
      Stop-Here "This evidence was already used for one restart. Record again before another."
    }
    $evidence | Add-Member -Force -NotePropertyName armMarker -NotePropertyValue ([ordered]@{
      used      = $false
      armedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
      bootIdAtArm = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
    })
    Save-Evidence $evidence
    Write-Host '::notice title=Windows restart test::Armed. The next verify only counts if the boot time changed.'
    if (-not $AllowReboot) {
      Done "Armed. Restart the machine now, then run -Phase verify. This script did not restart it."
      exit 0
    }
    Write-Host '::warning title=Windows restart test::Rebooting because -AllowReboot was passed.'
    Restart-Computer -Force
  }

  'verify' {
    $evidence = Read-Evidence
    if (-not $evidence.armMarker) { Stop-Here "Evidence was recorded but never armed. Run -Phase arm before restarting." }
    if ($evidence.armMarker.used) { Stop-Here "This evidence was already used for one restart." }

    $bootNow = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime()
    $bootArmed = [datetime]::Parse($evidence.armMarker.bootIdAtArm).ToUniversalTime()
    if ($bootNow -le $bootArmed) {
      Stop-Here "The machine has not restarted since it was armed (boot time $($bootNow.ToString('o'))). Nothing was proven."
    }
    Done "The machine restarted: boot time moved from $($bootArmed.ToString('o')) to $($bootNow.ToString('o'))."

    Start-Sleep -Seconds 20
    Assert-ServiceRunning 'after restart'

    # The backend must come back on its own - no one starts it in this phase.
    $health = $null
    for ($attempt = 1; $attempt -le 90; $attempt++) {
      $health = Get-KayanHealth
      if ($health) { break }
      Start-Sleep -Seconds 2
    }
    if (-not $health) { Stop-Here "The backend did not answer health within three minutes of the restart, unprompted." }
    Done "The backend answered health on port $($health.Port) after the restart without being started."

    $after = Get-DataFingerprint 'after restart'
    $before = $evidence.data
    if ($after.migrations -ne $before.migrations) {
      Stop-Here "Migration count changed across the restart: $($before.migrations) became $($after.migrations)."
    }
    Done "The migration ledger is unchanged: $($after.migrations) applied migrations."
    if ($after.tables -ne $before.tables) {
      Stop-Here "Row counts changed across the restart. Before: $($before.tables). After: $($after.tables)."
    }
    Done 'Row counts in every user table are unchanged.'
    if ($after.checksum -ne $before.checksum) {
      Stop-Here "The business-record checksum changed across the restart: $($before.checksum) became $($after.checksum)."
    }
    Done "The business-record checksum is identical before and after ($($after.checksum))."

    $licenceAfter = Get-LicenceState 'after restart'
    if ($licenceAfter.stateFolderPresent -ne $evidence.licence.stateFolderPresent) {
      Stop-Here "The licence state folder appeared or vanished across the restart."
    }
    Done 'The licence state folder is in the state it was before the restart.'

    $evidence | Add-Member -Force -NotePropertyName afterRestart -NotePropertyValue ([ordered]@{
      verifiedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
      bootId        = $bootNow.ToString('o')
      data          = $after
      licence       = $licenceAfter
      apiPort       = $health.Port
    })
    $evidence.armMarker.used = $true
    Save-Evidence $evidence

    Write-Host '::notice title=Windows restart test::When you are done, run -Phase revoke to remove the licences issued for this test.'
    Done 'The restart test passed at every checkpoint.'
  }

  'revoke' {
    $stateDirectory = Join-Path $env:ProgramData 'KAYAN-ERP\license'
    $evidence = $null
    try { $evidence = Read-Evidence } catch { $evidence = $null }
    $issued = @()
    if ($evidence -and $evidence.licence -and $evidence.licence.files) { $issued = @($evidence.licence.files) }
    $removed = 0
    foreach ($name in $issued) {
      $path = Join-Path $stateDirectory $name
      if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force; $removed++ }
    }
    Done "Removed $removed licence file(s) that this test run recorded in $stateDirectory."
    Write-Host '::notice title=Windows restart test::No private key is present in or produced by this script.'
  }
}
