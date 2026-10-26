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

# The company page's answer has to reach the database, not just the screen.
# This machine had no KAYAN database, so the unattended default is "new"; the
# runtime setup has to say so in its own log.
foreach ($marker in @('KAYAN-COMPANY-MODE New', 'KAYAN-COMPANY-NEW-CLUSTER', 'KAYAN-COMPANY-NEW-DATABASE-EMPTY', 'KAYAN-UPGRADE-MIGRATIONS-OK')) {
  if (-not (Select-String -LiteralPath $runtimeLog -Pattern ([regex]::Escape($marker)) -Quiet)) {
    Fail ("The installer log does not record '$marker', so the new-company path cannot be told apart from an upgrade.")
  }
}
$modeLines = @(Select-String -LiteralPath $runtimeLog -Pattern 'KAYAN-COMPANY-MODE (\w+)' -AllMatches)
$newModeCount = @($modeLines | Where-Object { $_.Line -match 'KAYAN-COMPANY-MODE New' }).Count
$existingModeCount = @($modeLines | Where-Object { $_.Line -match 'KAYAN-COMPANY-MODE Existing' }).Count
if ($newModeCount -ne 1 -or $existingModeCount -ne 0) {
  Fail ("The first install did not take the new-company path exactly once (new=$newModeCount, existing=$existingModeCount).")
}
Write-Host "PASS: the first install recorded the new-company path (and nothing else)."

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

# Building stages runtime-manifest.json naming the commit the payload was
# built from. Without it, nothing on this machine says which code the Setup.exe
# carried, and a report that calls the installer "the tested build" would be
# guessing. It has to exist, and it has to name the commit under test.
$manifestPath = Join-Path $installRoot "runtime-manifest.json"
if (-not (Test-Path $manifestPath)) { Fail "The installed package has no runtime-manifest.json, so the build it came from cannot be identified." }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
Write-Host ("PASS: installed manifest: product {0}, version {1}, commit {2}, Node {3}, PostgreSQL {4}." -f $manifest.product, $manifest.productVersion, $manifest.sourceCommit, $manifest.nodeVersion, $manifest.postgresqlVersion)
# Whether this build enforces licences is a property of the build, decided when
# it was compiled, and it has to be recorded: a build that never decided is a
# build nobody can reason about afterwards.
if ($manifest.PSObject.Properties.Name -notcontains 'licenseEnforcement') {
  Fail 'The installed manifest does not record whether this build enforces licences.'
}
if (@('enforce','warn') -notcontains $manifest.licenseEnforcement) {
  Fail ("The installed manifest records an unknown licence mode: " + $manifest.licenseEnforcement)
}
Write-Host ("PASS: the build records licence mode '{0}'." -f $manifest.licenseEnforcement)
$commitUnderTest = (& git -C $PSScriptRoot rev-parse HEAD 2>$null | Select-Object -First 1)
if ($commitUnderTest -and $manifest.sourceCommit -ne $commitUnderTest) {
  Fail "The installed payload was built from $($manifest.sourceCommit), not from the commit under test ($commitUnderTest)."
}
if ($commitUnderTest) { Write-Host "PASS: the installed payload is the commit under test ($commitUnderTest)." }

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

# "A new company" is a state of the database, not a label on a page: no
# company, no user, no customer, no invoice - nothing but the schema the
# program expects and the bootstrap data it ships with.
$psqlForMode = Join-Path $installRoot 'backend\postgres\bin\psql.exe'
$env:PGPASSWORD = $preExistingDbPassword
try {
  $newCompanyCounts = @(& $psqlForMode -h 127.0.0.1 -p 5432 -U erp_app -d erp_kayan -t -A -c "SELECT (SELECT count(*) FROM companies) || '/' || (SELECT count(*) FROM users) || '/' || (SELECT count(*) FROM customers) || '/' || (SELECT count(*) FROM sales_invoices) || '/' || (SELECT count(*) FROM cash_vouchers)" 2>&1)
  $newCompanyExit = $LASTEXITCODE
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
if ($newCompanyExit -ne 0 -or (($newCompanyCounts -join '').Trim() -ne '0/0/0/0/0')) {
  Fail ("A new company is not an empty database: companies/users/customers/invoices/vouchers = " + ($newCompanyCounts -join ' ') + " (exit $newCompanyExit).")
}
Write-Host "PASS: a new company means an empty database - no company, user, customer, invoice or voucher row."

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

# The upgrade had to take the OTHER path: the company on this machine was
# kept, verified as this installation's own database, backed up before the
# new program's migrations ran, and then upgraded in place.
foreach ($marker in @('KAYAN-COMPANY-MODE Existing', 'KAYAN-COMPANY-EXISTING-VERIFIED', 'KAYAN-UPGRADE-BACKUP-OK', 'KAYAN-UPGRADE-MIGRATIONS-OK')) {
  if (-not (Select-String -LiteralPath $runtimeLog -Pattern ([regex]::Escape($marker)) -Quiet)) {
    Fail ("The upgrade log does not record '$marker', so the existing-company path cannot be told apart from a fresh install.")
  }
}
$upgradeNewModeCount = @(Select-String -LiteralPath $runtimeLog -Pattern 'KAYAN-COMPANY-MODE New').Count
$upgradeExistingModeCount = @(Select-String -LiteralPath $runtimeLog -Pattern 'KAYAN-COMPANY-MODE Existing').Count
if ($upgradeExistingModeCount -lt 1) {
  Fail ("The upgrade/reinstall did not record the existing-company path (new=$upgradeNewModeCount, existing=$upgradeExistingModeCount).")
}
Write-Host "PASS: the upgrade recorded the existing-company path."

# The backup is the promise behind "your data is kept": it has to exist, hold
# real objects, be readable by pg_restore, and contain the probe table that
# was written to this company minutes earlier.
$backupRoot = Join-Path $env:ProgramData 'KAYAN-ERP\backups'
$upgradeBackup = Get-ChildItem -Path $backupRoot -Recurse -Filter 'before-upgrade.dump' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $upgradeBackup) { Fail "The upgrade did not leave a before-upgrade.dump backup under $backupRoot." }
if ($upgradeBackup.Length -lt 4096) { Fail ("The before-upgrade backup is only $($upgradeBackup.Length) bytes.") }
$pgRestore = Join-Path $installRoot 'backend\postgres\bin\pg_restore.exe'
$backupToc = @(& $pgRestore --list $upgradeBackup.FullName 2>&1)
if ($LASTEXITCODE -ne 0 -or $backupToc.Count -lt 1) {
  Fail ("pg_restore cannot read the before-upgrade backup: " + ($backupToc -join ' '))
}
if (-not (($backupToc -join "`n") -match 'kayan_installer_upgrade_probe')) {
  Fail "The before-upgrade backup does not contain the company-data probe table, so it is not a backup of this database."
}
Write-Host ("PASS: the upgrade took a readable backup first ({0} bytes, probe table included): {1}" -f $upgradeBackup.Length, $upgradeBackup.FullName)

# (Choosing "a new company" over a computer that already holds one is tested
# at the end of this script: it now creates a new, empty database beside the
# old one instead of refusing, and the test proves both halves of that.)


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
  #
  # It has to be a LONG, ARABIC offer: a one-line sheet proves nothing about
  # what happens on page 2. Twelve dozen line items force the sheet over three
  # pages, so the repeating background, the logo, the Arabic face and the
  # "n / N" stamp are checked where they usually break - after the first page.
  # The Arabic is built from code points so this file stays ASCII and a Windows
  # PowerShell host reads it the same way whatever the file's encoding is.
  function From-CodePoints([int[]]$Points) { -join ($Points | ForEach-Object { [char]$_ }) }
  $arabicSubject = From-CodePoints @(0x0639,0x0631,0x0636,0x0020,0x0633,0x0639,0x0631,0x0020,0x062A,0x062C,0x0631,0x064A,0x0628,0x064A,0x0020,0x0645,0x062A,0x0639,0x062F,0x062F,0x0020,0x0627,0x0644,0x0635,0x0641,0x062D,0x0627,0x062A)
  $arabicLinePrefix = From-CodePoints @(0x0628,0x0646,0x062F,0x0020,0x0627,0x062E,0x062A,0x0628,0x0627,0x0631,0x0020,0x0631,0x0642,0x0645)
  $arabicFirstTable = From-CodePoints @(0x0642,0x0633,0x0645,0x0020,0x0623,0x0648,0x0644,0x0020,0x0645,0x062A,0x0639,0x062F,0x062F,0x0020,0x0627,0x0644,0x0635,0x0641,0x062D,0x0627,0x062A)
  $arabicSecondTable = From-CodePoints @(0x0642,0x0633,0x0645,0x0020,0x062B,0x0627,0x0646,0x064D,0x0020,0x0645,0x062A,0x0639,0x062F,0x062F,0x0020,0x0627,0x0644,0x0635,0x0641,0x062D,0x0627,0x062A)
  $firstTableLines = @()
  for ($lineNumber = 1; $lineNumber -le 72; $lineNumber++) {
    $firstTableLines += @{
      description = "$arabicLinePrefix $lineNumber"
      quantity = '1'
      unitPrice = '125'
      unit = 'piece'
    }
  }
  $secondTableLines = @()
  for ($lineNumber = 73; $lineNumber -le 96; $lineNumber++) {
    $secondTableLines += @{
      description = "$arabicLinePrefix $lineNumber"
      quantity = '2'
      unitPrice = '87.50'
      unit = 'piece'
    }
  }
  $quotationBody = @{
    quotationDate = (Get-Date -Format 'yyyy-MM-dd')
    customerId = $customer.id
    currency = 'EGP'
    subject = $arabicSubject
    tables = @(
      @{ title = $arabicFirstTable; lines = $firstTableLines },
      @{ title = $arabicSecondTable; lines = $secondTableLines }
    )
  } | ConvertTo-Json -Compress -Depth 8
  $quotation = Invoke-RestMethod -Method Post -Uri "$base/sales/quotations" -Headers $headers -ContentType 'application/json' -Body $quotationBody -TimeoutSec 30
  if (-not $quotation.id) { Fail 'Installed API did not create the smoke quotation.' }
  $pdfPath = Join-Path $env:TEMP 'kayan-installed-quotation.pdf'
  Invoke-WebRequest -UseBasicParsing -Uri "$base/sales/quotations/$($quotation.id)/pdf?lang=ar" -Headers $headers -OutFile $pdfPath -TimeoutSec 180
  $pdfBytes = [IO.File]::ReadAllBytes($pdfPath)
  if ($pdfBytes.Length -le 5 -or [Text.Encoding]::ASCII.GetString($pdfBytes, 0, 5) -ne '%PDF-') { Fail 'Installed quotation PDF download is not a real PDF file.' }
  Write-Output "::notice::Installed Windows quotation PDF: real %PDF- file of $($pdfBytes.Length) bytes rendered by the installed runtime."

  # Open the file the way a viewer would and check the sheet, not just the
  # header bytes: A4, a painted band, the logo, the bundled Arabic face — drawn,
  # not merely listed — the letters joined, and the right page number on every
  # page, and nothing that reaches for the network. The minimum page count is
  # the point: one sheet says nothing about the pages after it.
  $verifyScript = Join-Path $backend 'scripts\verify-quotation-pdf.mjs'
  if (-not (Test-Path $verifyScript)) { Fail "Installed runtime is missing the PDF verifier: $verifyScript" }
  $verifyOutput = & $node $verifyScript $pdfPath --min-pages 3 --max-pages 8 2>&1
  if ($LASTEXITCODE -ne 0) { Fail ('Installed quotation PDF failed the printed-design checks: ' + (($verifyOutput | Out-String).Trim())) }
  foreach ($line in $verifyOutput) { Write-Output $line }
  $jsonLine = @($verifyOutput | Where-Object { $_ -is [string] -and $_.TrimStart().StartsWith('{') }) | Select-Object -Last 1
  if (-not $jsonLine) { Fail 'Installed quotation PDF verifier printed no machine-readable summary.' }
  $verified = $jsonLine | ConvertFrom-Json
  if ($verified.pages -lt 3) { Fail "Installed quotation PDF has $($verified.pages) page(s); a 96-line offer has to run onto at least 3." }
  if (-not $verified.arabic.joined) { Fail 'Installed quotation PDF has no joined Arabic (the letters never take a contextual shape).' }
  $pdfHash = (Get-FileHash -LiteralPath $pdfPath -Algorithm SHA256).Hash
  Write-Output "::notice title=Installed PDF::pages=$($verified.pages) bytes=$($verified.bytes) sha256=$pdfHash arabicLetters=$($verified.arabic.mapped) joinedShapes=$($verified.arabic.joinedLetters) fonts=$($verified.arabic.fonts -join ';')"
  Write-Output "::notice::Installed Windows quotation PDF passed: %PDF- file of $($pdfBytes.Length) bytes over $($verified.pages) pages, design, drawn Arabic face, joined letters and page numbers verified on every page by the installed runtime."
  Write-Output "::notice::Windows installer smoke test passed: service, database preparation, client startup on port $apiPort, login, company JSON and full PostgreSQL backup/restore, and a $($verified.pages)-page designed Arabic quotation PDF all verified."
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

# ═══════════════════════════════════════════════════════════════════════════
# A NEW COMPANY ON A COMPUTER THAT ALREADY HOLDS ONE
#
# This is the defect a customer reported: choosing "a new company" still showed
# the previous company's data. The setup used to refuse in that case (and the
# refusal appeared at the end of Setup as a PostgreSQL error while the installed
# program happily opened the previous company). It now creates a database of its
# own beside the old one, after a verified backup, and the program is proven to
# be reading THAT database before it opens.
#
# Everything here is disposable CI data. The "previous company" is the database
# the safe-reset exercise just created.
# ═══════════════════════════════════════════════════════════════════════════

function Invoke-RuntimeScript([string]$Mode) {
  $out = Join-Path $env:TEMP ("kayan-runtime-" + $Mode + "-" + [Guid]::NewGuid().ToString('N') + ".log")
  $err = "$out.err"
  $runtimeScript = Join-Path $installRoot 'install-runtime.ps1'
  $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $runtimeScript + '"'), '-UserSettingsPath', ('"' + $settings + '"'), '-CompanyMode', $Mode) `
    -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
  $text = ((Get-Content -LiteralPath $out -Raw -ErrorAction SilentlyContinue) + " " + (Get-Content -LiteralPath $err -Raw -ErrorAction SilentlyContinue)).Trim()
  Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
  return @{ ExitCode = $process.ExitCode; Output = $text }
}

function Read-SettingsValues([string]$Path) {
  $values = @{}
  foreach ($line in @(Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue)) {
    if ($line -match '^\s*([A-Z_]+)="?(.*?)"?\s*$') { $values[$matches[1]] = $matches[2].Trim('"') }
  }
  return $values
}

function Wait-ForInstalledApi([System.Diagnostics.Process]$Client, [int]$Seconds) {
  for ($attempt = 0; $attempt -lt $Seconds; $attempt++) {
    if ($Client.HasExited) {
      Fail ("The installed client exited with code $($Client.ExitCode) before its server became healthy.")
    }
    foreach ($port in @(3000,3001,3002,3003,3010,3020)) {
      try {
        $candidate = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 2
        if ($candidate.status -eq 'ok' -and $candidate.database -eq 'up') { return @{ Port = $port; Health = $candidate } }
      } catch { }
    }
    Start-Sleep -Seconds 1
  }
  return $null
}

function Stop-KayanClient([System.Diagnostics.Process]$Client) {
  if (-not $Client -or $Client.HasExited) { return }
  $null = $Client.CloseMainWindow()
  try { Wait-Process -Id $Client.Id -Timeout 10 -ErrorAction SilentlyContinue } catch { }
  if (-not $Client.HasExited) { Stop-Process -Id $Client.Id -Force -ErrorAction SilentlyContinue }
}

Start-Service -Name $serviceName
(Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
& $pgReady -h 127.0.0.1 -p 5432 -U postgres *> $null
if ($LASTEXITCODE -ne 0) { Fail "PostgreSQL did not come back for the new-company exercise." }

$currentSettings = Read-SettingsValues $settings
$dbUrlBefore = $currentSettings['DATABASE_URL']
if ($dbUrlBefore -notmatch '/(erp_kayan_\d{14})\?schema=public') {
  Fail ("The new-company exercise expected the safe-reset database, but the settings name: " + $dbUrlBefore)
}
$previousDatabase = $matches[1]
if ($dbUrlBefore -match '^postgresql://erp_app:([a-fA-F0-9]+)@') {
  $previousPassword = $matches[1]
} else {
  Fail "Could not read the database password from the installed settings."
}

# Populate the company that the customer would be leaving behind.
$env:KAYAN_ADMIN_USERNAME = 'ci-previous-admin'
$env:KAYAN_ADMIN_PASSWORD = 'CiSmoke-Previous-Admin-7241'
$env:DATABASE_URL = $dbUrlBefore
$env:ADMIN_DATABASE_URL = $currentSettings['ADMIN_DATABASE_URL']
$seedPrevious = Start-Process -FilePath $node -ArgumentList @("scripts\prepare-database.mjs") -WorkingDirectory $backend -Wait -PassThru -NoNewWindow
Remove-Item Env:KAYAN_ADMIN_USERNAME,Env:KAYAN_ADMIN_PASSWORD,Env:DATABASE_URL,Env:ADMIN_DATABASE_URL -ErrorAction SilentlyContinue
if ($seedPrevious.ExitCode -ne 0) {
  Fail ("Could not prepare the previous company for the new-company exercise (exit $($seedPrevious.ExitCode)).")
}
$env:PGPASSWORD = $previousPassword
$previousCounts = @(& $psql -h 127.0.0.1 -p 5432 -U erp_app -d $previousDatabase -t -A -c "SELECT (SELECT count(*) FROM companies) || '/' || (SELECT count(*) FROM users)")
& $psql -h 127.0.0.1 -p 5432 -U erp_app -d $previousDatabase -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS kayan_previous_company_probe (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO kayan_previous_company_probe (id,value) VALUES (1,'previous-company') ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value;" *> $null
$probeExit = $LASTEXITCODE
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
if ($probeExit -ne 0) { Fail "Could not mark the previous company's database for the new-company exercise." }
if ((($previousCounts -join '').Trim()) -notmatch '^[1-9]\d*/[1-9]') {
  Fail ("The previous company database is not populated: " + ($previousCounts -join ' '))
}
Write-Host ("PASS: previous company prepared in {0} (companies/users = {1})." -f $previousDatabase, (($previousCounts -join '').Trim()))

$newCompanyRun = Invoke-RuntimeScript 'New'
if ($newCompanyRun.ExitCode -ne 0) {
  Fail ("Choosing 'a new company' over a computer that already holds one failed (exit $($newCompanyRun.ExitCode)). Output: " + $newCompanyRun.Output)
}
foreach ($marker in @('KAYAN-COMPANY-NEW-FRESH-DATABASE-REQUIRED', 'KAYAN-COMPANY-NEW-BACKUP-OK', 'KAYAN-COMPANY-NEW-DATABASE-CREATED', 'KAYAN-COMPANY-NEW-DATABASE-EMPTY', 'KAYAN-COMPANY-NEW-DATABASE-READY', 'KAYAN-RUNTIME-VERIFIED')) {
  if (-not (Select-String -LiteralPath $runtimeLog -Pattern ([regex]::Escape($marker)) -Quiet)) {
    Fail ("The new-company run did not record '$marker', so it cannot be told apart from an upgrade.")
  }
}
$afterNewCompany = Read-SettingsValues $settings
if ($afterNewCompany['DATABASE_URL'] -notmatch '/(erp_kayan_\d{14})\?schema=public') {
  Fail ("After choosing a new company the settings do not name a new database: " + $afterNewCompany['DATABASE_URL'])
}
$freshDatabase = $matches[1]
if ($freshDatabase -eq $previousDatabase) {
  Fail "Choosing a new company kept the previous company's database."
}
if ($afterNewCompany['DATABASE_URL'] -notmatch "^postgresql://erp_app:[a-fA-F0-9]+@127\.0\.0\.1:5432/$freshDatabase\?schema=public$") {
  Fail ("The new company database URL is not the one the newly created database has: " + $afterNewCompany['DATABASE_URL'])
}
Write-Host ("PASS: a new company means a new database ({0}); the previous one is {1}." -f $freshDatabase, $previousDatabase)

$env:PGPASSWORD = $previousPassword
try {
  $previousProbe = @(& $psql -h 127.0.0.1 -p 5432 -U erp_app -d $previousDatabase -t -A -c "SELECT value FROM kayan_previous_company_probe WHERE id=1")
  $previousProbeExit = $LASTEXITCODE
  $freshCounts = @(& $psql -h 127.0.0.1 -p 5432 -U erp_app -d $freshDatabase -t -A -c "SELECT (SELECT count(*) FROM companies) || '/' || (SELECT count(*) FROM users) || '/' || (SELECT count(*) FROM customers) || '/' || (SELECT count(*) FROM sales_invoices) || '/' || (SELECT count(*) FROM cash_vouchers)")
  $freshCountsExit = $LASTEXITCODE
  $freshProbe = @(& $psql -h 127.0.0.1 -p 5432 -U erp_app -d $freshDatabase -t -A -c "SELECT coalesce(to_regclass('public.kayan_previous_company_probe')::text,'')")
  $freshProbeExit = $LASTEXITCODE
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
if ($previousProbeExit -ne 0 -or (($previousProbe -join '').Trim() -ne 'previous-company')) {
  Fail ("Choosing a new company changed the previous company's database: " + ($previousProbe -join ' '))
}
if ($freshCountsExit -ne 0 -or (($freshCounts -join '').Trim() -ne '0/0/0/0/0')) {
  Fail ("The new company database is not empty: companies/users/customers/invoices/vouchers = " + ($freshCounts -join ' ') + " (exit $freshCountsExit).")
}
if ($freshProbeExit -ne 0 -or (($freshProbe -join '').Trim() -ne '')) {
  Fail "The new company database contains a table that belongs to the previous company."
}

$newCompanyBackup = Get-ChildItem -Path (Join-Path $env:ProgramData 'KAYAN-ERP\backups') -Recurse -Filter 'before-new-company.dump' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $newCompanyBackup) { Fail "Choosing a new company took no backup of the previous company." }
$pgRestoreForNewCompany = Join-Path $installRoot 'backend\postgres\bin\pg_restore.exe'
$newCompanyToc = @(& $pgRestoreForNewCompany --list $newCompanyBackup.FullName 2>&1)
if ($LASTEXITCODE -ne 0 -or -not (($newCompanyToc -join "`n") -match 'kayan_previous_company_probe')) {
  Fail "The backup taken before the new company does not contain the previous company's data."
}
Write-Host ("PASS: the previous company was kept and backed up ({0} bytes) while the new company started empty - no company, user, customer, invoice or voucher." -f $newCompanyBackup.Length)

# The program itself must be looking at the new database. An empty database is
# the state in which it has to wait at first-run setup; opening the previous
# company instead is exactly the reported defect.
foreach ($logCandidate in $firstRunLogPaths) {
  $firstRunLogOffsets[$logCandidate] = 0
  if (Test-Path $logCandidate) { $firstRunLogOffsets[$logCandidate] = (Get-Item $logCandidate).Length }
}
$newCompanyClient = Start-Process -FilePath (Join-Path $installRoot 'erp_kayan.exe') -WorkingDirectory $installRoot -PassThru
try {
  $sawAsking = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($newCompanyClient.HasExited) {
      Fail ("After choosing a new company the client exited with code $($newCompanyClient.ExitCode) instead of waiting at first-run setup.")
    }
    if ((Read-AppendedLog) -match 'asking who the first administrator is') { $sawAsking = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $sawAsking) {
    Fail "After choosing a new company the program did not wait at first-run setup: it is not looking at the empty database that was just created."
  }
  Write-Host "PASS: after choosing a new company the program waits at first-run setup instead of showing the previous company."
} finally {
  Stop-KayanClient $newCompanyClient
}

$env:KAYAN_ADMIN_USERNAME = 'ci-new-admin'
$env:KAYAN_ADMIN_PASSWORD = 'CiSmoke-New-Admin-7241'
$seedNew = Start-Process -FilePath $node -ArgumentList @("scripts\prepare-database.mjs") -WorkingDirectory $backend -Wait -PassThru -NoNewWindow
Remove-Item Env:KAYAN_ADMIN_USERNAME,Env:KAYAN_ADMIN_PASSWORD -ErrorAction SilentlyContinue
if ($seedNew.ExitCode -ne 0) { Fail "Could not create the new company's administrator (exit $($seedNew.ExitCode))." }

$newCompanyClient2 = Start-Process -FilePath (Join-Path $installRoot 'erp_kayan.exe') -WorkingDirectory $installRoot -PassThru
try {
  $newCompanyApi = Wait-ForInstalledApi $newCompanyClient2 90
  if (-not $newCompanyApi) { Fail "The new company's server did not become healthy within 90 seconds." }
  if ($newCompanyApi.Health.databaseName -ne $freshDatabase) {
    Fail ("The program is connected to database '$($newCompanyApi.Health.databaseName)' instead of the new company database '$freshDatabase'.")
  }
  $newBase = "http://127.0.0.1:$($newCompanyApi.Port)/api/v1"
  $loginNew = Invoke-RestMethod -Method Post -Uri "$newBase/auth/login" -ContentType 'application/json' -Body (@{ username = 'ci-new-admin'; password = 'CiSmoke-New-Admin-7241' } | ConvertTo-Json -Compress) -TimeoutSec 10
  if (-not $loginNew.accessToken) { Fail "The new company's API did not accept its administrator's login." }
  $newHeaders = @{ Authorization = "Bearer $($loginNew.accessToken)" }
  $newCustomers = Invoke-RestMethod -Uri "$newBase/parties/customers" -Headers $newHeaders -TimeoutSec 30
  $customerTotal = 0
  if ($null -ne $newCustomers.total) { $customerTotal = [int]$newCustomers.total }
  elseif ($null -ne $newCustomers.items) { $customerTotal = @($newCustomers.items).Count }
  if ($customerTotal -ne 0) { Fail ("The new company shows $customerTotal customer record(s) from the previous company.") }
  Write-Host ("PASS: the program is connected to the new company database '{0}' and shows no previous company data." -f $newCompanyApi.Health.databaseName)
} finally {
  Stop-KayanClient $newCompanyClient2
}

# ═══════════════════════════════════════════════════════════════════════════
# ACTIVATION
#
# A build that ships the operator's public key must refuse to work without a
# valid key. The CI build is an evaluation build (no key in the repository), so
# this installs a throwaway test key exactly where a product build carries one,
# then proves on the real installed program: no key blocks business use, a
# wrong key is refused, a key for another computer is refused, a valid key
# works, it survives a restart, and deleting it blocks again.
#
# Every key here is generated by the CI run itself and is worthless outside it.
# ═══════════════════════════════════════════════════════════════════════════

$licenceHome = Join-Path $env:TEMP 'kayan-ci-licence'
Remove-Item -LiteralPath $licenceHome -Recurse -Force -ErrorAction SilentlyContinue
$generator = (Resolve-Path (Join-Path $PSScriptRoot '..\tools\license-generator\kayan-license.mjs')).Path
& $node $generator init --home $licenceHome *> $null
if ($LASTEXITCODE -ne 0) { Fail "Could not create the throwaway test signing key for the activation tests." }
$testPublicKey = Join-Path $licenceHome 'public-key.pem'
if (-not (Test-Path $testPublicKey)) { Fail "The test signing key pair was not created." }
Copy-Item -LiteralPath $testPublicKey -Destination (Join-Path $installRoot 'public-key.pem') -Force

$enforceRun = Invoke-RuntimeScript 'Existing'
if ($enforceRun.ExitCode -ne 0) {
  Fail ("Installing the test licence key failed (exit $($enforceRun.ExitCode)). Output: " + $enforceRun.Output)
}
if (-not (Select-String -LiteralPath $runtimeLog -Pattern 'KAYAN-LICENCE-KEY-INSTALLED' -Quiet)) {
  Fail "The runtime setup did not record that the licence key was installed."
}
$enforcedSettings = Read-SettingsValues $settings
if ($enforcedSettings['LICENSE_ENFORCEMENT'] -ne 'enforce') {
  Fail ("The installer did not switch licence enforcement on: '" + $enforcedSettings['LICENSE_ENFORCEMENT'] + "'")
}
Write-Host "PASS: the installer switched licence enforcement on for a build that carries a key."

$licenceClient = Start-Process -FilePath (Join-Path $installRoot 'erp_kayan.exe') -WorkingDirectory $installRoot -PassThru
try {
  $licenceApi = Wait-ForInstalledApi $licenceClient 90
  if (-not $licenceApi) { Fail "The licensed build's server did not become healthy within 90 seconds." }
  if ($null -eq $licenceApi.Health.license) { Fail "The installed server does not report its licence mode on /health." }
  if ($licenceApi.Health.license.enforcement -ne 'enforce') {
    Fail ("The installed server is not enforcing licences (mode: " + $licenceApi.Health.license.enforcement + ").")
  }
  if ($licenceApi.Health.license.configured -ne $true) { Fail "The installed server says it has no licence verification key." }
  Write-Host "PASS: the installed server reports licence enforcement 'enforce' with a verification key installed."

  $base = "http://127.0.0.1:$($licenceApi.Port)/api/v1"
  $loginLicence = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body (@{ username = 'ci-new-admin'; password = 'CiSmoke-New-Admin-7241' } | ConvertTo-Json -Compress) -TimeoutSec 10
  if (-not $loginLicence.accessToken) { Fail "Signing in must keep working without a licence, and it did not." }
  $headers = @{ Authorization = "Bearer $($loginLicence.accessToken)" }
  Write-Host "PASS: signing in still works while the installation is unlicensed."

  $blockedStatus = 0
  $blockedBody = ''
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/parties/customers" -Headers $headers -TimeoutSec 15 | Out-Null
  } catch {
    $blockedStatus = [int]$_.Exception.Response.StatusCode
    $blockedBody = [string]$_.ErrorDetails.Message
  }
  if ($blockedStatus -ne 403) {
    Fail ("An unlicensed installation answered a business request instead of refusing it (HTTP $blockedStatus).")
  }
  if ($blockedBody -notmatch 'LICENSE_REQUIRED') {
    Fail ("The refusal did not say that a licence is required: " + $blockedBody)
  }
  Write-Host "PASS: without a licence every business request is refused with LICENSE_REQUIRED."

  $licenceStatus = Invoke-RestMethod -Uri "$base/license/status" -Headers $headers -TimeoutSec 15
  if ($licenceStatus.state -ne 'UNLICENSED' -or -not $licenceStatus.blocked) {
    Fail ("The licence screen state is wrong before activation: state=" + $licenceStatus.state + " blocked=" + $licenceStatus.blocked)
  }
  $machineId = $licenceStatus.machineId
  if (-not $machineId) { Fail "The installed program did not report a machine id." }

  $garbageStatus = 0
  try {
    Invoke-RestMethod -Method Post -Uri "$base/license/activate" -Headers $headers -ContentType 'application/json' -Body (@{ key = 'KYN1.this-is-not-a-licence-key' } | ConvertTo-Json) -TimeoutSec 15 | Out-Null
  } catch { $garbageStatus = [int]$_.Exception.Response.StatusCode }
  if ($garbageStatus -eq 0 -or $garbageStatus -eq 500) { Fail "A bogus key was not refused cleanly (HTTP $garbageStatus)." }
  Write-Host "PASS: a bogus key is refused."

  $created = @(& $node $generator licence create --ref 'CI activation test' --seats 5 --term 1y --home $licenceHome)
  if ($LASTEXITCODE -ne 0) { Fail "Could not register the test licence." }
  $licenceId = ($created | Select-String -Pattern 'licence\s*:\s*(lic_[A-Za-z0-9_-]+)').Matches[0].Groups[1].Value
  if (-not $licenceId) { Fail ("Could not read the test licence id from the generator output: " + ($created -join ' ')) }

  $wrongMachineKey = @(& $node $generator issue activation --licence $licenceId --machine 'KM-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' --home $licenceHome) | Where-Object { $_ -match '^KYN1\.' } | Select-Object -First 1
  if (-not $wrongMachineKey) { Fail "Could not issue a key for another machine." }
  $wrongMachineStatus = 0
  $wrongMachineBody = ''
  try {
    Invoke-RestMethod -Method Post -Uri "$base/license/activate" -Headers $headers -ContentType 'application/json' -Body (@{ key = $wrongMachineKey } | ConvertTo-Json) -TimeoutSec 15 | Out-Null
  } catch {
    $wrongMachineStatus = [int]$_.Exception.Response.StatusCode
    $wrongMachineBody = [string]$_.ErrorDetails.Message
  }
  if ($wrongMachineStatus -ne 403 -or $wrongMachineBody -notmatch 'LICENSE_KEY_WRONG_MACHINE') {
    Fail ("A key issued for another computer was not refused as such (HTTP $wrongMachineStatus): " + $wrongMachineBody)
  }
  Write-Host "PASS: a key issued for another computer is refused, so a licence cannot be copied between machines."

  $validKey = @(& $node $generator issue activation --licence $licenceId --machine $machineId --home $licenceHome) | Where-Object { $_ -match '^KYN1\.' } | Select-Object -First 1
  if (-not $validKey) { Fail "Could not issue a valid activation key for this machine." }
  $activated = Invoke-RestMethod -Method Post -Uri "$base/license/activate" -Headers $headers -ContentType 'application/json' -Body (@{ key = $validKey } | ConvertTo-Json) -TimeoutSec 20
  if ($activated.state -ne 'ACTIVE' -or $activated.blocked) {
    Fail ("A valid key did not activate the installation: state=" + $activated.state + " blocked=" + $activated.blocked)
  }
  $afterActivation = Invoke-WebRequest -UseBasicParsing -Uri "$base/parties/customers" -Headers $headers -TimeoutSec 30
  if ($afterActivation.StatusCode -ne 200) { Fail "Business requests are still refused after activation (HTTP $($afterActivation.StatusCode))." }
  Write-Host "PASS: a valid key activates the installation and business requests are answered again."

  Stop-KayanClient $licenceClient
  $licenceClient = Start-Process -FilePath (Join-Path $installRoot 'erp_kayan.exe') -WorkingDirectory $installRoot -PassThru
  $restartedApi = Wait-ForInstalledApi $licenceClient 90
  if (-not $restartedApi) { Fail "The licensed program's server did not come back after a restart." }
  $restartedBase = "http://127.0.0.1:$($restartedApi.Port)/api/v1"
  $loginAfterRestart = Invoke-RestMethod -Method Post -Uri "$restartedBase/auth/login" -ContentType 'application/json' -Body (@{ username = 'ci-new-admin'; password = 'CiSmoke-New-Admin-7241' } | ConvertTo-Json -Compress) -TimeoutSec 10
  $restartHeaders = @{ Authorization = "Bearer $($loginAfterRestart.accessToken)" }
  $statusAfterRestart = Invoke-RestMethod -Uri "$restartedBase/license/status" -Headers $restartHeaders -TimeoutSec 15
  if ($statusAfterRestart.state -ne 'ACTIVE' -or $statusAfterRestart.blocked) {
    Fail ("The licence did not survive a restart: state=" + $statusAfterRestart.state + " blocked=" + $statusAfterRestart.blocked)
  }
  $rulesAfterRestart = Invoke-WebRequest -UseBasicParsing -Uri "$restartedBase/parties/customers" -Headers $restartHeaders -TimeoutSec 30
  if ($rulesAfterRestart.StatusCode -ne 200) { Fail "Business requests are refused after restarting a licensed installation." }
  Write-Host "PASS: the licence survives closing and reopening the program."

  # Deleting the licence (a restored or corrupted database) must block again:
  # never 'no record' read as 'activated'.
  $env:PGPASSWORD = $previousPassword
  try {
    & $psql -h 127.0.0.1 -p 5432 -U erp_app -d $freshDatabase -v ON_ERROR_STOP=1 -c "DELETE FROM license_seat_usage; DELETE FROM license_keys; DELETE FROM license_events; DELETE FROM license_installations;" *> $null
    $deleteExit = $LASTEXITCODE
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
  if ($deleteExit -ne 0) { Fail "Could not remove the licence rows for the deletion test." }
  Start-Sleep -Seconds 4
  $blockedAgainStatus = 0
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$restartedBase/parties/customers" -Headers $restartHeaders -TimeoutSec 15 | Out-Null
  } catch { $blockedAgainStatus = [int]$_.Exception.Response.StatusCode }
  if ($blockedAgainStatus -ne 403) {
    Fail ("A deleted licence did not stop business requests (HTTP $blockedAgainStatus): a missing licence is never an activated one.")
  }
  $statusAfterDelete = Invoke-RestMethod -Uri "$restartedBase/license/status" -Headers $restartHeaders -TimeoutSec 15
  if ($statusAfterDelete.state -ne 'UNLICENSED') {
    Fail ("After removing the licence the state is still '" + $statusAfterDelete.state + "'.")
  }
  Write-Host "PASS: a deleted licence blocks business use again; absence is never read as activation."
} finally {
  Stop-KayanClient $licenceClient
}

Write-Output "::notice::Company and activation exercises passed: a new company got its own empty database while the previous company was backed up and kept; the program was proven to read the new database; and without a valid key every business request is refused, a wrong-machine key is refused, a valid key works, it survives a restart, and a deleted licence blocks again."
