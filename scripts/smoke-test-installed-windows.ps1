# Runs the real Windows installer on the CI runner and verifies the installed local runtime.
[CmdletBinding()]
param([string]$SetupPath = "build\windows-installer\KAYAN-ERP-Setup.exe")

$ErrorActionPreference = "Stop"
$setup = (Resolve-Path $SetupPath).Path
$installLog = Join-Path $env:TEMP "kayan-setup-smoke.log"
$serviceName = "KayanERPPostgreSQL"
$installRoot = Join-Path $env:ProgramFiles "KAYAN ERP"
$backend = Join-Path $installRoot "backend"
$node = Join-Path $backend "node\node.exe"
$settings = Join-Path $env:ProgramData "KAYAN-ERP\kayan.env"

function Read-Details {
  # Ordered most relevant first: the runtime setup log is the root-cause log,
  # and GitHub annotations cut the message after 4000 characters.
  $sections = @()
  $resultFile = Join-Path $env:ProgramData "KAYAN-ERP\logs\installer-result.txt"
  $runtimeLog = Join-Path $env:ProgramData "KAYAN-ERP\logs\installer.log"
  if (Test-Path $resultFile) {
    $sections += "--- runtime result ---"
    $sections += Get-Content $resultFile -Tail 5 -ErrorAction SilentlyContinue
  } else {
    $sections += "--- runtime result ---"
    $sections += "(not found: install-runtime.ps1 did not leave a result marker)"
  }
  if (Test-Path $runtimeLog) {
    $sections += "--- $runtimeLog ---"
    $sections += Get-Content $runtimeLog -Tail 40 -ErrorAction SilentlyContinue
  }
  $pgLog = Join-Path $env:ProgramData "KAYAN-ERP\logs\postgresql.log"
  if (Test-Path $pgLog) {
    $sections += "--- $pgLog ---"
    $sections += Get-Content $pgLog -Tail 15 -ErrorAction SilentlyContinue
  }
  $initLogs = @(Get-ChildItem (Join-Path $env:ProgramData "KAYAN-ERP\logs") -Filter "initdb-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  foreach ($initLog in $initLogs) {
    $sections += "--- $($initLog.FullName) ---"
    $sections += Get-Content $initLog.FullName -Tail 25 -ErrorAction SilentlyContinue
  }
  $backendLog = Join-Path $env:ProgramData "KAYAN-ERP\logs\backend.log"
  if (Test-Path $backendLog) {
    $sections += "--- $backendLog ---"
    $sections += Get-Content $backendLog -Tail 15 -ErrorAction SilentlyContinue
  }
  if (Test-Path $installLog) {
    $sections += "--- setup log tail ---"
    $sections += Get-Content $installLog -Tail 20 -ErrorAction SilentlyContinue
  }
  return ($sections -join [Environment]::NewLine)
}

# Publishes a failure where a person (and the CI annotations API) can see it:
# the step summary page, and a GitHub error annotation. The installer log is
# redacted the same way the runtime scripts redact it.
function Publish-Failure([string]$Reason) {
  $redacted = [regex]::Replace($Reason, '(?i)postgres(?:ql)?://[^\s"'']+', '[DATABASE URL REDACTED]')
  $redacted = [regex]::Replace($redacted, '(?i)(password\s*[=:]\s*)[^\s;]+', '$1[REDACTED]')
  $annotation = ($redacted -replace '\r?\n', ' | ')
  if ($annotation.Length -gt 4000) { $annotation = $annotation.Substring(0, 4000) }
  # ::error:: turns this line into a check annotation, readable without the
  # full job log (which is only available to signed-in users).
  Write-Output "::error::Windows installer smoke test failed: $annotation"
  if ($env:GITHUB_STEP_SUMMARY) {
    try {
      $summary = "## Windows installer smoke test failed`n`````n$redacted`n````"
      if ($summary.Length -gt 60000) { $summary = $summary.Substring(0, 60000) }
      Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $summary -Encoding UTF8
    } catch { }
  }
  Write-Output $redacted
}

function Fail([string]$Reason) {
  Publish-Failure ($Reason + [Environment]::NewLine + (Read-Details))
  exit 1
}

# Nothing may die silently: every unhandled error becomes a real, annotated
# failure with the same diagnostics as Fail().
trap {
  Fail ("Unhandled error in the smoke test: " + $_.Exception.Message + [Environment]::NewLine + ($_ | Out-String))
}

function New-SmokeHexSecret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
    return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  } finally { $rng.Dispose() }
}

# Simulate the real-machine regression where an earlier interrupted installer
# left C:\ProgramData\KAYAN-ERP\kayan.env with 0 ACEs (empty DACL) and no
# PostgreSQL cluster or Windows service yet. Setup must recover the DACL in
# place and preserve the existing credentials without deleting or overwriting
# the file.
$preExistingDbPassword = New-SmokeHexSecret
$preExistingAccessSecret = New-SmokeHexSecret
$preExistingRefreshSecret = New-SmokeHexSecret
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settings) | Out-Null
$preExistingLines = @(
  '# KAYAN ERP machine-local runtime configuration; do not share this file.',
  ('ADMIN_DATABASE_URL="postgresql://postgres:' + $preExistingDbPassword + '@127.0.0.1:5432/postgres?schema=public"'),
  ('DATABASE_URL="postgresql://erp_app:' + $preExistingDbPassword + '@127.0.0.1:5432/erp_kayan?schema=public"'),
  ('JWT_ACCESS_SECRET="' + $preExistingAccessSecret + '"'),
  'JWT_ACCESS_TTL="900"',
  ('JWT_REFRESH_SECRET="' + $preExistingRefreshSecret + '"'),
  'JWT_REFRESH_TTL="1209600"'
)
Set-Content -LiteralPath $settings -Value $preExistingLines -Encoding ASCII
$emptyAcl = New-Object System.Security.AccessControl.FileSecurity
$emptyAcl.SetAccessRuleProtection($true, $false)
[System.IO.File]::SetAccessControl($settings, $emptyAcl)
$lockedAsExpected = $false
try {
  [void][System.IO.File]::ReadAllText($settings)
} catch {
  $lockedAsExpected = $true
}
if (-not $lockedAsExpected) {
  Fail "Could not reproduce the 0-ACE locked kayan.env precondition before running Setup.exe."
}
Write-Host "PASS: created pre-existing 0-ACE kayan.env to exercise broken-DACL recovery."

$install = Start-Process -FilePath $setup -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", ("/LOG=" + $installLog)) -Wait -PassThru
if ($install.ExitCode -ne 0) {
  Fail ("KAYAN-ERP-Setup.exe failed with exit code $($install.ExitCode).")
}

# The installer may launch the client through its post-install [Run] entry.
Get-Process -Name erp_kayan -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service) { Fail ("The bundled PostgreSQL service '$serviceName' was not installed (installer exit code: " + $install.ExitCode + ").") }
if ($service.Status -ne "Running") { Fail "The bundled PostgreSQL service is not running (state: $($service.Status))." }

# PostgreSQL refuses to run with administrative permissions, so the bundled
# service must not run as an administrator. This is the one thing that made
# the installer fail on a fresh machine, and it has to stay that way.
$serviceInfo = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
$serviceAccount = if ($serviceInfo) { $serviceInfo.StartName } else { "" }
if ($serviceAccount) {
  try {
    $accountSid = (New-Object Security.Principal.NTAccount($serviceAccount)).Translate([Security.Principal.SecurityIdentifier]).Value
    $administratorsSid = (New-Object Security.Principal.NTAccount('BUILTIN\Administrators')).Translate([Security.Principal.SecurityIdentifier]).Value
    if ($accountSid -eq $administratorsSid) {
      Fail "The bundled PostgreSQL service runs as the Administrators group. PostgreSQL refuses to run with administrative permissions, so this account cannot work."
    }
    Write-Host "PASS: the bundled PostgreSQL service runs as '$serviceAccount' (not an administrator)."
  } catch {
    Write-Host "NOTE: could not check the service account ('$serviceAccount')."
  }
}

# The cluster has to live in its final directory: the service account has to
# be able to write the files of the cluster it serves.
$dataDirectory = Join-Path $env:ProgramData "KAYAN-ERP\PostgreSQL\data"
if (-not (Test-Path (Join-Path $dataDirectory "PG_VERSION"))) {
  Fail "The bundled PostgreSQL cluster was not initialized in $dataDirectory."
}
$runtimeLog = Join-Path $env:ProgramData "KAYAN-ERP\logs\installer.log"
if (-not (Test-Path $runtimeLog) -or -not (Select-String -LiteralPath $runtimeLog -Pattern 'KAYAN-RUNTIME-BOOTSTRAP-RESTRICTED' -Quiet)) {
  Fail "The elevated installer did not initialize PostgreSQL with the restricted-token bootstrap."
}
Write-Host "PASS: initdb ran with PostgreSQL's required restricted token."

foreach ($relative in @(
  "backend\postgres\bin\initdb.exe",
  "backend\postgres\bin\pg_ctl.exe",
  "backend\postgres\bin\pg_isready.exe",
  "backend\postgres\bin\pg_dump.exe",
  "backend\postgres\bin\pg_restore.exe",
  "backend\node\node.exe",
  "backend\dist\src\main.js",
  "backend\scripts\prepare-database.mjs",
  "backend\scripts\database-state.mjs",
  "prerequisites\vc_redist.x64.exe",
  "install-runtime.ps1",
  "repair-runtime.ps1",
  "reset-kayan.ps1",
  "repair-kayan.bat",
  "RepairTool.exe",
  "database-control.ps1",
  "erp_kayan.exe"
)) {
  $path = Join-Path $installRoot $relative
  if (-not (Test-Path $path)) { Fail "Installed package is missing $relative" }
}
if (-not (Test-Path $settings)) { Fail "The installer did not create $settings" }

$pgReady = Join-Path $installRoot "backend\postgres\bin\pg_isready.exe"
& $pgReady -h 127.0.0.1 -p 5432 -U postgres *> $null
if ($LASTEXITCODE -ne 0) { Fail "Bundled PostgreSQL does not accept connections on 127.0.0.1:5432." }
Write-Host "PASS: bundled PostgreSQL service is running and accepting connections."

$envValues = @{}
Get-Content $settings | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)="?(.*?)"?\s*$') { $envValues[$matches[1]] = $matches[2].Trim('"') }
}
if ($envValues['DATABASE_URL'] -ne ('postgresql://erp_app:' + $preExistingDbPassword + '@127.0.0.1:5432/erp_kayan?schema=public')) {
  Fail "The installer did not preserve the credentials from the pre-existing 0-ACE kayan.env file."
}
Write-Host "PASS: installer recovered the 0-ACE kayan.env DACL and preserved its existing credentials."
foreach ($entry in $envValues.GetEnumerator()) { Set-Item -Path ("Env:" + $entry.Key) -Value $entry.Value }

# Run the exact production database preparation used by the desktop shell.
$prepOut = Join-Path $env:TEMP "kayan-installer-prep-stdout.log"
$prepErr = Join-Path $env:TEMP "kayan-installer-prep-stderr.log"
$prepare = Start-Process -FilePath $node -ArgumentList @("scripts\prepare-database.mjs") -WorkingDirectory $backend -Wait -PassThru -NoNewWindow -RedirectStandardOutput $prepOut -RedirectStandardError $prepErr
if ($prepare.ExitCode -ne 0) {
  Fail (("Production database preparation failed with exit code $($prepare.ExitCode)." + [Environment]::NewLine + (Get-Content $prepOut -Raw) + [Environment]::NewLine + (Get-Content $prepErr -Raw)))
}

# FIRST-RUN REGRESSION GUARD. A real customer's first launch happens
# against exactly this state: schema migrated, database empty, nobody
# seeded. The desktop shell must stop at "create the company and the
# first administrator" - process alive, the shell log saying it is
# asking who the first administrator is, and NO API answering yet (the
# server is deliberately not started before setup). A shipped build
# instead opened the whole program with no server behind it ("cannot
# reach the server") and the setup screen was unreachable; seeding an
# administrator before this launch - as this script used to do - hid
# exactly that failure, so this launch now happens first, unseeded.
$firstRunLogPaths = @(
  (Join-Path $env:APPDATA "KAYAN-ERP\logs\backend.log"),
  (Join-Path $env:ProgramData "KAYAN-ERP\logs\backend.log")
)
$firstRunLogOffsets = @{}
foreach ($logCandidate in $firstRunLogPaths) {
  $firstRunLogOffsets[$logCandidate] = 0
  if (Test-Path $logCandidate) { $firstRunLogOffsets[$logCandidate] = (Get-Item $logCandidate).Length }
}
function Read-AppendedLog {
  foreach ($logCandidate in $firstRunLogPaths) {
    if (-not (Test-Path $logCandidate)) { continue }
    $stream = [System.IO.File]::Open($logCandidate, 'Open', 'Read', 'ReadWrite')
    try {
      $stream.Seek([int64]$firstRunLogOffsets[$logCandidate], [System.IO.SeekOrigin]::Begin) | Out-Null
      $reader = New-Object System.IO.StreamReader($stream)
      return $reader.ReadToEnd()
    } finally { $stream.Dispose() }
  }
  return ""
}
$firstRunClient = Start-Process -FilePath (Join-Path $installRoot "erp_kayan.exe") -WorkingDirectory $installRoot -PassThru
try {
  $sawAsking = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($firstRunClient.HasExited) {
      Fail ("First run on an empty database: the installed client exited with code $($firstRunClient.ExitCode) instead of waiting at first-run setup.")
    }
    $appended = Read-AppendedLog
    if ($appended -match 'asking who the first administrator is') { $sawAsking = $true; break }
    if ($appended -match 'the server exited with code') {
      Fail "First run on an empty database started (and lost) a server instead of stopping at first-run setup."
    }
    Start-Sleep -Seconds 1
  }
  if (-not $sawAsking) {
    Fail "First run on an empty database never reached the 'asking who the first administrator is' state within 60 seconds."
  }
  # No KAYAN API may answer before setup completes: an answering API
  # here means the program skipped setup against an empty database.
  foreach ($port in @(3000,3001,3002,3003,3010,3020)) {
    try {
      $candidate = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 2
      if ($candidate.status) {
        Fail "First run on an empty database: an API already answers on port $port before first-run setup completed."
      }
    } catch { }
  }
  Write-Host "PASS: first launch on an empty database waits at first-run setup (no server started, no restart loop)."
} finally {
  if ($firstRunClient -and -not $firstRunClient.HasExited) {
    $null = $firstRunClient.CloseMainWindow()
    try { Wait-Process -Id $firstRunClient.Id -Timeout 10 -ErrorAction SilentlyContinue } catch { }
    if (-not $firstRunClient.HasExited) { Stop-Process -Id $firstRunClient.Id -Force -ErrorAction SilentlyContinue }
  }
}

# Seed only a disposable CI administrator so the desktop shell is allowed to start its API.
$env:KAYAN_ADMIN_USERNAME = "ci-admin"
$env:KAYAN_ADMIN_PASSWORD = "CiSmoke-Admin-Password-7241"
$seed = Start-Process -FilePath $node -ArgumentList @("scripts\prepare-database.mjs") -WorkingDirectory $backend -Wait -PassThru -NoNewWindow
if ($seed.ExitCode -ne 0) { Fail "CI administrator setup failed with exit code $($seed.ExitCode)." }
Remove-Item Env:KAYAN_ADMIN_USERNAME,Env:KAYAN_ADMIN_PASSWORD -ErrorAction SilentlyContinue

# Put a disposable record in the freshly installed company database, run the
# installer again as an upgrade/reinstall, and prove that the record remains.
# This is synthetic CI data only; no customer database is ever reset.
$databasePassword = $null
if ($envValues['DATABASE_URL'] -match '^postgresql://erp_app:([a-fA-F0-9]+)@127\.0\.0\.1:5432/erp_kayan\?schema=public$') {
  $databasePassword = $matches[1]
} else {
  Fail "The installed DATABASE_URL does not match the bundled local database format."
}
$psql = Join-Path $installRoot "backend\postgres\bin\psql.exe"
$env:PGPASSWORD = $databasePassword
$sentinelSql = "CREATE TABLE IF NOT EXISTS kayan_installer_upgrade_probe (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO kayan_installer_upgrade_probe (id,value) VALUES (1,'preserved') ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value;"
& $psql -h 127.0.0.1 -p 5432 -U erp_app -d erp_kayan -v ON_ERROR_STOP=1 -c $sentinelSql *> $null
if ($LASTEXITCODE -ne 0) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; Fail "Could not create the disposable company-data preservation probe." }
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

$upgradeLog = Join-Path $env:TEMP "kayan-setup-upgrade-smoke.log"
$upgrade = Start-Process -FilePath $setup -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", ("/LOG=" + $upgradeLog)) -Wait -PassThru
if ($upgrade.ExitCode -ne 0) { Fail "The KAYAN upgrade/reinstall exited with code $($upgrade.ExitCode)." }
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service -or $service.Status -ne "Running") { Fail "The PostgreSQL service did not restart after the upgrade/reinstall." }
& $pgReady -h 127.0.0.1 -p 5432 -U postgres *> $null
if ($LASTEXITCODE -ne 0) { Fail "PostgreSQL did not accept connections after the upgrade/reinstall." }
$env:PGPASSWORD = $databasePassword
$sentinelResult = @(& $psql -h 127.0.0.1 -p 5432 -U erp_app -d erp_kayan -t -A -c "SELECT value FROM kayan_installer_upgrade_probe WHERE id=1" 2>&1)
$sentinelExit = $LASTEXITCODE
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
if ($sentinelExit -ne 0 -or (($sentinelResult -join '').Trim() -ne 'preserved')) {
  Fail ("The disposable company-data preservation probe did not survive the upgrade/reinstall. PostgreSQL output: " + ($sentinelResult -join ' '))
}
Write-Host "PASS: the upgrade/reinstall retained the existing company-data probe."

# Exercise the bundled RepairTool.exe against a stopped service and a
# re-corrupted 0-ACE kayan.env file. The tool must (a) report the problems it
# detected, (b) attempt the repair, and (c) confirm afterwards that no problems
# remain -- while company data and credentials are preserved.
Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
[System.IO.File]::SetAccessControl($settings, $emptyAcl)
$repairTool = Join-Path $installRoot "RepairTool.exe"
if (-not (Test-Path $repairTool)) { Fail "The installed package is missing RepairTool.exe." }
$diagnoseBeforeLog = Join-Path $env:TEMP "kayan-repairtool-before.log"
$diagnoseBefore = Start-Process -FilePath $repairTool -ArgumentList @("--diagnose") -WorkingDirectory $installRoot -Wait -PassThru -RedirectStandardOutput $diagnoseBeforeLog -RedirectStandardError "$diagnoseBeforeLog.err"
if ($diagnoseBefore.ExitCode -eq 0) {
  $beforeText = (Get-Content -LiteralPath $diagnoseBeforeLog -Raw -ErrorAction SilentlyContinue)
  Fail "RepairTool.exe --diagnose reported a healthy installation while the PostgreSQL service was stopped. Output: $beforeText"
}
Write-Host "PASS: RepairTool.exe detected the stopped PostgreSQL service before repair (diagnose exit code $($diagnoseBefore.ExitCode))."

$repair = Start-Process -FilePath $repairTool -ArgumentList @("--repair", "--quiet") -WorkingDirectory $installRoot -Wait -PassThru
if ($repair.ExitCode -ne 0) {
  Fail "The bundled RepairTool.exe failed with exit code $($repair.ExitCode). See $runtimeLog and $env:ProgramData\KAYAN-ERP\logs\repairtool.log"
}
$diagnoseAfter = Start-Process -FilePath $repairTool -ArgumentList @("--diagnose") -WorkingDirectory $installRoot -Wait -PassThru
if ($diagnoseAfter.ExitCode -ne 0) {
  Fail "RepairTool.exe --diagnose still reports problems after a successful repair (exit code $($diagnoseAfter.ExitCode)). See $env:ProgramData\KAYAN-ERP\logs\repairtool.log"
}
Write-Host "PASS: RepairTool.exe confirmed a healthy installation after the repair."
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service -or $service.Status -ne "Running") {
  Fail "The bundled repair tool did not restart the PostgreSQL service."
}
if (-not (Select-String -LiteralPath $runtimeLog -Pattern 'KAYAN-REPAIR-OK' -Quiet)) {
  Fail "The bundled repair tool did not record KAYAN-REPAIR-OK in installer.log."
}
$env:PGPASSWORD = $databasePassword
$repairProbe = @(& $psql -h 127.0.0.1 -p 5432 -U erp_app -d erp_kayan -t -A -c "SELECT value FROM kayan_installer_upgrade_probe WHERE id=1" 2>&1)
$repairProbeExit = $LASTEXITCODE
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
if ($repairProbeExit -ne 0 -or (($repairProbe -join '').Trim() -ne 'preserved')) {
  Fail ("The company-data probe did not survive the bundled repair tool run. PostgreSQL output: " + ($repairProbe -join ' '))
}
Write-Host "PASS: bundled RepairTool.exe recovered the 0-ACE kayan.env and stopped PostgreSQL service while preserving company data."

# The important test: start the actual installed Flutter executable by itself.
$clientPath = Join-Path $installRoot "erp_kayan.exe"
$client = Start-Process -FilePath $clientPath -WorkingDirectory $installRoot -PassThru
try {
  $health = $null
  $apiPort = $null
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if ($client.HasExited) {
      Fail ("The installed KAYAN client exited with code $($client.ExitCode) before its local server became healthy.")
    }
    foreach ($port in @(3000,3001,3002,3003,3010,3020)) {
      try {
        $candidate = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 2
        if ($candidate.status -eq "ok" -and $candidate.database -eq "up") {
          $health = $candidate
          $apiPort = $port
          break
        }
      } catch { }
    }
    if ($health) { break }
    Start-Sleep -Seconds 1
  }
  if (-not $health -or -not $apiPort) { Fail "The installed KAYAN client did not start a healthy local API within 90 seconds." }
  Write-Host "PASS: launching installed erp_kayan.exe started a healthy local API on port $apiPort."

  $loginPayload = @{ username = "ci-admin"; password = "CiSmoke-Admin-Password-7241" } | ConvertTo-Json -Compress
  try {
    $login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$apiPort/api/v1/auth/login" -ContentType "application/json" -Body $loginPayload -TimeoutSec 10
  } catch {
    Fail ("Installed API login request failed: " + $_.Exception.Message)
  }
  if (-not $login.accessToken) { Fail "Installed API login did not return an access token." }
  Write-Host "PASS: installed API accepted a login against the bundled database."
  # Exercise backups against this installed runtime, not a separately started
  # development server. Only synthetic CI records are created/restored here.
  $base = "http://127.0.0.1:$apiPort/api/v1"
  $headers = @{ Authorization = "Bearer $($login.accessToken)" }
  $originalName = 'Installed backup sentinel'
  $customerBody = @{ code = 'WIN-BACKUP-PROBE'; nameEn = $originalName; nameAr = 'Windows backup probe' } | ConvertTo-Json -Compress
  $customer = Invoke-RestMethod -Method Post -Uri "$base/parties/customers" -Headers $headers -ContentType 'application/json' -Body $customerBody -TimeoutSec 30
  if (-not $customer.id) { Fail 'Installed API did not create the backup sentinel customer.' }
  $customerUri = "$base/parties/customers/$($customer.id)"
  $changedBody = @{ nameEn = 'Changed after backup' } | ConvertTo-Json -Compress

  $jsonPath = Join-Path $env:TEMP 'kayan-installed-company-backup.json'
  Invoke-WebRequest -UseBasicParsing -Uri "$base/backup/download" -Headers $headers -OutFile $jsonPath -TimeoutSec 60
  $snapshot = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json
  if ($snapshot.format -ne 'kayan-backup' -or -not $snapshot.tables.customer) { Fail 'Installed company backup is not a populated KAYAN JSON backup.' }
  $null = Invoke-RestMethod -Method Patch -Uri $customerUri -Headers $headers -ContentType 'application/json' -Body $changedBody -TimeoutSec 30
  $changed = Invoke-RestMethod -Uri $customerUri -Headers $headers -TimeoutSec 30
  if ($changed.nameEn -ne 'Changed after backup') { Fail 'JSON restore test did not actually mutate the sentinel.' }

  # Windows PowerShell 5.1 has no Invoke-RestMethod -Form. Use the framework
  # multipart client; never put the access token on a child command line.
  Add-Type -AssemblyName System.Net.Http
  $http = New-Object System.Net.Http.HttpClient
  $http.Timeout = [TimeSpan]::FromMinutes(5)
  $multipart = New-Object System.Net.Http.MultipartFormDataContent
  try {
    $http.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $login.accessToken)
    $part = New-Object System.Net.Http.ByteArrayContent -ArgumentList (,([IO.File]::ReadAllBytes($jsonPath)))
    $part.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/json')
    $multipart.Add($part, 'file', 'company-backup.json')
    $response = $http.PostAsync("$base/backup/restore?replace=true", $multipart).GetAwaiter().GetResult()
    $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { Fail ("Installed JSON restore failed: HTTP " + [int]$response.StatusCode + ' ' + $text) }
    $jsonRestored = $text | ConvertFrom-Json
    if (-not $jsonRestored.companyId -or $jsonRestored.total -le 0) { Fail 'Installed JSON restore did not report restored company data.' }
    $response.Dispose()
  } finally {
    $multipart.Dispose()
    $http.Dispose()
  }
  $login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $loginPayload -TimeoutSec 30
  if (-not $login.accessToken) { Fail 'Login failed after installed JSON restore.' }
  $headers = @{ Authorization = "Bearer $($login.accessToken)" }
  $restoredCustomer = Invoke-RestMethod -Uri $customerUri -Headers $headers -TimeoutSec 30
  if ($restoredCustomer.nameEn -ne $originalName) { Fail 'Installed JSON restore did not roll back the sentinel mutation.' }
  Write-Output '::notice::Installed Windows company JSON backup/restore passed: snapshot, mutation, restore, re-login and original sentinel verified.'

  $full = Invoke-RestMethod -Method Post -Uri "$base/backup/full" -Headers $headers -TimeoutSec 180
  if (-not $full.file.name -or $full.file.sizeBytes -le 0) { Fail 'Installed runtime did not produce a real PostgreSQL backup archive.' }
  $verified = Invoke-RestMethod -Method Post -Uri "$base/backup/full/$($full.file.name)/verify" -Headers $headers -TimeoutSec 180
  if ($verified.entries -le 0) { Fail 'Bundled pg_restore did not verify any archive objects.' }
  $dumpPath = Join-Path $env:TEMP 'kayan-installed-full-backup.dump'
  Invoke-WebRequest -UseBasicParsing -Uri "$base/backup/full/$($full.file.name)/download" -Headers $headers -OutFile $dumpPath -TimeoutSec 60
  $dumpBytes = [IO.File]::ReadAllBytes($dumpPath)
  if ($dumpBytes.Length -le 5 -or [Text.Encoding]::ASCII.GetString($dumpBytes, 0, 5) -ne 'PGDMP') { Fail 'Installed full backup download is not a real PostgreSQL custom archive.' }
  $null = Invoke-RestMethod -Method Patch -Uri $customerUri -Headers $headers -ContentType 'application/json' -Body $changedBody -TimeoutSec 30
  $changed = Invoke-RestMethod -Uri $customerUri -Headers $headers -TimeoutSec 30
  if ($changed.nameEn -ne 'Changed after backup') { Fail 'Full restore test did not actually mutate the sentinel.' }
  $restoreBody = @{ confirm = $true; fileName = $full.file.name } | ConvertTo-Json -Compress
  $fullRestored = Invoke-RestMethod -Method Post -Uri "$base/backup/full/restore" -Headers $headers -ContentType 'application/json' -Body $restoreBody -TimeoutSec 300
  if (-not $fullRestored.restored -or -not $fullRestored.checked -or -not $fullRestored.safetyBackup) { Fail 'Installed full restore did not complete with checked data and a safety backup.' }
  $login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $loginPayload -TimeoutSec 30
  if (-not $login.accessToken) { Fail 'Login failed after installed PostgreSQL restore.' }
  $headers = @{ Authorization = "Bearer $($login.accessToken)" }
  $restoredCustomer = Invoke-RestMethod -Uri $customerUri -Headers $headers -TimeoutSec 30
  if ($restoredCustomer.nameEn -ne $originalName) { Fail 'Installed PostgreSQL restore did not roll back the sentinel mutation.' }
  Write-Output '::notice::Installed Windows PostgreSQL backup/restore passed: real archive, mutation, checked restore, safety copy, re-login and original sentinel verified.'

  # Give the company a real logo first. The quotation's page design carries it
  # on every page, and a printed sheet without the logo is exactly the failure
  # this smoke test exists to catch.
  $logoPath = Join-Path $env:TEMP 'kayan-smoke-logo.png'
  [IO.File]::WriteAllBytes($logoPath, [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABC0lEQVR4nO2asQ3CMBBFATFDWANqFqCBIViDFtZgCCoWoIY1YAoKN5Z9JLHvzM9J/3W2nOievxzbUubd/jzzzAJdgBYKoKEAGgqgoQCaZd712lzHP79+Hu2KqcF9AhRAQwE0FEAj7APmfLa7uNk97oYvbyuQlB53Wmm0EhBLzwfoNZqsgcHqK0b+4h9roIj37dQ/YHW4xE37BEonVRmC+8+osUDddGpCYAJoKIDGWKBuZ9Xsx0wgo3Q6lcchJiAxflL1p9FWh7lQWc8WO/X7QEDU8HQjC9hWnMBFjIYCaNwLTO5Sn9zZB3GfAAXQUAANBdBQAA0F0AhnIfj/G0W4T4ACaCiAhgJo3At8AQ4oMlkSCP3LAAAAAElFTkSuQmCC'))
  $logoBoundary = [Guid]::NewGuid().ToString()
  $logoPrefix = "--$logoBoundary`r`nContent-Disposition: form-data; name=`"file`"; filename=`"kayan-smoke-logo.png`"`r`nContent-Type: image/png`r`n`r`n"
  $logoSuffix = "`r`n--$logoBoundary--`r`n"
  $latin1 = [Text.Encoding]::GetEncoding('ISO-8859-1')
  # Built through a stream: in Windows PowerShell `byte[] + byte[]` produces an
  # Object[], which Invoke-RestMethod would send as something that is not the
  # file the server is expecting.
  $logoStream = New-Object IO.MemoryStream
  $prefixBytes = $latin1.GetBytes($logoPrefix)
  $logoStream.Write($prefixBytes, 0, $prefixBytes.Length)
  $logoFileBytes = [IO.File]::ReadAllBytes($logoPath)
  $logoStream.Write($logoFileBytes, 0, $logoFileBytes.Length)
  $suffixBytes = $latin1.GetBytes($logoSuffix)
  $logoStream.Write($suffixBytes, 0, $suffixBytes.Length)
  $logoBody = $logoStream.ToArray()
  $logoStream.Dispose()
  $logoUpload = Invoke-RestMethod -Method Post -Uri "$base/company/logo" -Headers $headers -ContentType "multipart/form-data; boundary=$logoBoundary" -Body $logoBody -TimeoutSec 60
  if (-not $logoUpload.hasLogo) { Fail 'Installed API did not accept a company logo, so the printed design cannot be verified.' }

  # A real quotation PDF from the installed runtime — the same route the
  # «Download PDF» button calls, rendered by the bundled server through the
  # system browser. A 200 without %PDF- bytes is a failure, not a pass, and a
  # PDF without the design on every page is not a pass either.
  $quotationBody = @{
    quotationDate = (Get-Date -Format 'yyyy-MM-dd')
    customerId = $customer.id
    currency = 'EGP'
    subject = 'Windows smoke quotation'
    tables = @(@{
      title = 'Smoke table'
      lines = @(@{ description = 'Smoke line item'; quantity = '2'; unitPrice = '150'; unit = 'piece' })
    })
  } | ConvertTo-Json -Compress -Depth 6
  $quotation = Invoke-RestMethod -Method Post -Uri "$base/sales/quotations" -Headers $headers -ContentType 'application/json' -Body $quotationBody -TimeoutSec 30
  if (-not $quotation.id) { Fail 'Installed API did not create the smoke quotation.' }
  $pdfPath = Join-Path $env:TEMP 'kayan-installed-quotation.pdf'
  Invoke-WebRequest -UseBasicParsing -Uri "$base/sales/quotations/$($quotation.id)/pdf?lang=ar" -Headers $headers -OutFile $pdfPath -TimeoutSec 180
  $pdfBytes = [IO.File]::ReadAllBytes($pdfPath)
  if ($pdfBytes.Length -le 5 -or [Text.Encoding]::ASCII.GetString($pdfBytes, 0, 5) -ne '%PDF-') { Fail 'Installed quotation PDF download is not a real PDF file.' }
  Write-Output "::notice::Installed Windows quotation PDF: real %PDF- file of $($pdfBytes.Length) bytes rendered by the installed runtime."

  # Open the file the way a viewer would and check the sheet, not just the
  # header bytes: A4, a painted band, the logo, the bundled Arabic face and the
  # right page number on every page, and nothing that reaches for the network.
  $verifyScript = Join-Path $backend 'scripts\verify-quotation-pdf.mjs'
  if (-not (Test-Path $verifyScript)) { Fail "Installed runtime is missing the PDF verifier: $verifyScript" }
  $verifyOutput = & $node $verifyScript $pdfPath --max-pages 2 2>&1
  if ($LASTEXITCODE -ne 0) { Fail ('Installed quotation PDF failed the printed-design checks: ' + (($verifyOutput | Out-String).Trim())) }
  foreach ($line in $verifyOutput) { Write-Output $line }
  Write-Output "::notice::Installed Windows quotation PDF passed: %PDF- file of $($pdfBytes.Length) bytes, design and page numbers verified on every page by the installed runtime."
  Write-Output "::notice::Windows installer smoke test passed: service, database preparation, client startup on port $apiPort, login, company JSON and full PostgreSQL backup/restore, and a designed quotation PDF all verified."
} finally {
  if ($client -and -not $client.HasExited) {
    $null = $client.CloseMainWindow()
    try { Wait-Process -Id $client.Id -Timeout 10 -ErrorAction SilentlyContinue } catch { }
    if (-not $client.HasExited) { Stop-Process -Id $client.Id -Force -ErrorAction SilentlyContinue }
  }
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
}

# SAFE-RESET EXERCISE. Everything above ran the ordinary paths -
# fresh install, upgrade/reinstall, Repair - and the settings must
# STILL point at the original erp_kayan database: none of those paths
# may ever reset or switch databases. Then the reset tool is proven
# both ways: a wrong confirmation changes nothing at all, and the
# real thing backs up first, creates a NEW database, keeps the old
# one (sentinel included), and the next launch waits at first-run
# setup again. All data here is disposable CI data.
Start-Service -Name $serviceName
(Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
& $pgReady -h 127.0.0.1 -p 5432 -U postgres *> $null
if ($LASTEXITCODE -ne 0) { Fail "PostgreSQL did not come back for the safe-reset exercise." }

$resetSettings = Get-Content $settings
$resetDbLine = @($resetSettings | Where-Object { $_ -match '^\s*DATABASE_URL=' })[0]
if ($resetDbLine -notmatch '/erp_kayan\?schema=public') {
  Fail "Install/upgrade/repair changed which database the settings point at (expected the original erp_kayan): $resetDbLine"
}
Write-Host "PASS: fresh install, upgrade and repair all left the original database in place (no automatic reset anywhere)."

$resetTool = Join-Path $installRoot "reset-kayan.ps1"
if (-not (Test-Path $resetTool)) { Fail "The installed package is missing reset-kayan.ps1." }
# NOTE the quotes around the script path: it lives under
# "C:\Program Files\KAYAN ERP", Start-Process does not quote
# ArgumentList items for you, and an unquoted path makes
# powershell.exe look for C:\Program and die with -196608.
function Invoke-SafeReset([string]$Word) {
  $out = Join-Path $env:TEMP ("kayan-reset-smoke-out-" + [Guid]::NewGuid().ToString('N') + ".log")
  $err = Join-Path $env:TEMP ("kayan-reset-smoke-err-" + [Guid]::NewGuid().ToString('N') + ".log")
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $resetTool + '"'), '-ConfirmText', $Word, '-Quiet') -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
  $text = ((Get-Content -LiteralPath $out -Raw -ErrorAction SilentlyContinue) + " " + (Get-Content -LiteralPath $err -Raw -ErrorAction SilentlyContinue)).Trim()
  Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
  return @{ ExitCode = $process.ExitCode; Output = $text }
}
$settingsHashBefore = (Get-FileHash $settings -Algorithm SHA256).Hash
$resetCancelled = Invoke-SafeReset 'NOPE'
if ($resetCancelled.ExitCode -ne 2) {
  Fail "Safe reset with a wrong confirmation word exited $($resetCancelled.ExitCode), expected 2 (cancelled). Output: $($resetCancelled.Output)"
}
if ((Get-FileHash $settings -Algorithm SHA256).Hash -ne $settingsHashBefore) {
  Fail "Safe reset with a wrong confirmation word still changed kayan.env."
}
Write-Host "PASS: safe reset cancelled by a wrong confirmation word changed nothing."

$resetRun = Invoke-SafeReset 'RESET'
if ($resetRun.ExitCode -ne 0) {
  Fail "Safe reset failed with exit code $($resetRun.ExitCode). Output: $($resetRun.Output) See $runtimeLog (KAYAN-RESET-* markers)."
}
$resetSettings = Get-Content $settings
$resetDbLine = @($resetSettings | Where-Object { $_ -match '^\s*DATABASE_URL=' })[0]
if ($resetDbLine -notmatch '/(erp_kayan_\d{14})\?schema=public') {
  Fail "After safe reset the settings do not point at a fresh timestamped database: $resetDbLine"
}
$newDatabase = $matches[1]
$settingsBackups = @(Get-ChildItem (Join-Path $env:ProgramData "KAYAN-ERP") -Filter "kayan.env.before-reset-*.bak" -ErrorAction SilentlyContinue)
if ($settingsBackups.Count -lt 1) { Fail "Safe reset did not keep the previous settings next to kayan.env." }
$resetBackups = @(Get-ChildItem (Join-Path $env:ProgramData "KAYAN-ERP\backups") -Filter "before-reset.dump" -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
if ($resetBackups.Count -lt 1) { Fail "Safe reset produced no pre-reset backup under ProgramData\KAYAN-ERP\backups." }
$resetDump = $resetBackups[0].FullName
$resetDumpBytes = [IO.File]::ReadAllBytes($resetDump)
if ($resetDumpBytes.Length -le 5 -or [Text.Encoding]::ASCII.GetString($resetDumpBytes, 0, 5) -ne 'PGDMP') {
  Fail "The pre-reset backup is not a real PostgreSQL custom archive: $resetDump"
}
$pgRestore = Join-Path $installRoot "backend\postgres\bin\pg_restore.exe"
& $pgRestore --list $resetDump *> $null
if ($LASTEXITCODE -ne 0) { Fail "pg_restore cannot read the pre-reset backup: $resetDump" }
if (-not (Select-String -LiteralPath $runtimeLog -Pattern 'KAYAN-RESET-OK' -Quiet)) {
  Fail "Safe reset did not record KAYAN-RESET-OK in installer.log."
}
# Redaction, checked against the real secret this run created: the
# database password must appear in NO marker the reset wrote.
if (Select-String -LiteralPath $runtimeLog -Pattern ([regex]::Escape($databasePassword)) -Quiet) {
  Fail "A log written during install/repair/reset contains the database password."
}
$env:PGPASSWORD = $databasePassword
$oldSentinel = @(& $psql -h 127.0.0.1 -p 5432 -U erp_app -d erp_kayan -t -A -c "SELECT value FROM kayan_installer_upgrade_probe WHERE id=1" 2>&1)
$oldSentinelExit = $LASTEXITCODE
$newUsers = @(& $psql -h 127.0.0.1 -p 5432 -U erp_app -d $newDatabase -t -A -c "SELECT count(*) FROM users" 2>&1)
$newUsersExit = $LASTEXITCODE
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
if ($oldSentinelExit -ne 0 -or (($oldSentinel -join '').Trim() -ne 'preserved')) {
  Fail "Safe reset harmed the OLD database: the sentinel in erp_kayan is gone."
}
if ($newUsersExit -ne 0 -or (($newUsers -join '').Trim() -ne '0')) {
  Fail "The reset's new database $newDatabase is not empty."
}
Write-Host "PASS: safe reset backed up first, created $newDatabase empty, and left erp_kayan (sentinel included) untouched."

# After a reset, the next launch must wait at first-run setup again -
# the same assertion as the first-run guard, now post-reset.
foreach ($logCandidate in $firstRunLogPaths) {
  $firstRunLogOffsets[$logCandidate] = 0
  if (Test-Path $logCandidate) { $firstRunLogOffsets[$logCandidate] = (Get-Item $logCandidate).Length }
}
$postResetClient = Start-Process -FilePath (Join-Path $installRoot "erp_kayan.exe") -WorkingDirectory $installRoot -PassThru
try {
  $sawAsking = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($postResetClient.HasExited) {
      Fail ("After safe reset, the client exited with code $($postResetClient.ExitCode) instead of waiting at first-run setup.")
    }
    if ((Read-AppendedLog) -match 'asking who the first administrator is') { $sawAsking = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $sawAsking) { Fail "After safe reset, the next launch never reached first-run setup." }
  Write-Host "PASS: after safe reset, launching KAYAN ERP waits at first-run setup for the new company and general manager."
} finally {
  if ($postResetClient -and -not $postResetClient.HasExited) {
    $null = $postResetClient.CloseMainWindow()
    try { Wait-Process -Id $postResetClient.Id -Timeout 10 -ErrorAction SilentlyContinue } catch { }
    if (-not $postResetClient.HasExited) { Stop-Process -Id $postResetClient.Id -Force -ErrorAction SilentlyContinue }
  }
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
}
Write-Output "::notice::Safe-reset exercise passed: cancel changed nothing; reset backed up (PGDMP, pg_restore-readable), switched to a fresh empty database, preserved the old database and its sentinel, kept previous settings, redacted logs, and the next launch waits at first-run setup."
