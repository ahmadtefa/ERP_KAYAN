# Runs the real Windows installer on the CI runner and verifies the installed local runtime.
[CmdletBinding()]
param(
  [string]$SetupPath = "build\windows-installer\KAYAN-ERP-Setup.exe",
  # The folder holding the key pair this Setup was built with, when the run
  # generated a throwaway one. Activation keys are issued with it, so the test
  # exercises the very key the build trusts instead of one dropped beside it.
  [string]$LicenceHome = '',
  # Fails the run unless the installed build really enforces licences. Without
  # it, an evaluation build could pass the activation exercise, which would
  # say nothing about the product.
  [switch]$RequireLicenceEnforcement
)

$ErrorActionPreference = "Stop"
# $setup is resolved below, after Fail() exists: a bad path here used to end the
# script with nothing but an exit code, before any handler could report it.
$setup = $null
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
  # What the repair tool itself decided, and the markers it could write. A
  # repair that failed to record anything is diagnosed from what it left
  # behind, not guessed at.
  $repairToolLog = Join-Path $env:ProgramData "KAYAN-ERP\logs\repairtool.log"
  if (Test-Path $repairToolLog) {
    $sections += "--- $repairToolLog ---"
    $sections += Get-Content $repairToolLog -Tail 25 -ErrorAction SilentlyContinue
  }
  $repairResultLog = Join-Path $env:ProgramData "KAYAN-ERP\logs\repair-result.txt"
  if (Test-Path $repairResultLog) {
    $sections += "--- $repairResultLog ---"
    $sections += Get-Content $repairResultLog -Tail 15 -ErrorAction SilentlyContinue
  } else {
    $sections += "--- $repairResultLog ---"
    $sections += "(not found: the repair tool wrote no markers of its own)"
  }
  $logsDirectory = Join-Path $env:ProgramData "KAYAN-ERP\logs"
  if (Test-Path $logsDirectory) {
    $sections += "--- listing of $logsDirectory ---"
    $sections += @(Get-ChildItem -LiteralPath $logsDirectory -ErrorAction SilentlyContinue |
      ForEach-Object { "{0} {1} bytes {2:u}" -f $_.Name, $_.Length, $_.LastWriteTime })
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

# The Setup to test. Checked here, where a failure is a reported annotation
# rather than a silent exit before the handler was defined.
if (-not (Test-Path -LiteralPath $SetupPath)) {
  Fail ("The Setup this test should install was not found: " + $SetupPath + " (working directory " + (Get-Location).Path + ")")
}
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
Write-Host ("PASS: found the Setup to install: " + $setup)

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

# The status a request really got. 0 means it never got one.
function Get-HttpAnswer([string]$Uri, [hashtable]$Headers) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -Headers $Headers -TimeoutSec 20
    return @{ Status = [int]$response.StatusCode; Body = "" }
  } catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    return @{ Status = $status; Body = [string]$_.ErrorDetails.Message }
  }
}

# Wait until health answers, for a server this script started itself.
function Wait-ForHealth([int]$Port, [int]$Seconds = 90) {
  for ($attempt = 0; $attempt -lt $Seconds; $attempt++) {
    try {
      $candidate = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 3
      if ($candidate.status) { return $candidate }
    } catch { }
    Start-Sleep -Seconds 1
  }
  return $null
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
# The repair records its result twice, because installer.log is also used as
# the redirect target of the program's own server - a handle that does not
# share write access, so an append to it from another process can fail while
# the server is up. The tool therefore keeps a second, private marker file and
# exits non-zero if it could not write either. Success must be findable in at
# least one of them; a marker nobody can read is not evidence.
$repairResultFile = Join-Path $env:ProgramData 'KAYAN-ERP\logs\repair-result.txt'
$repairRecorded = @(
  @($runtimeLog, $repairResultFile) | Where-Object {
    (Test-Path -LiteralPath $_) -and (Select-String -LiteralPath $_ -Pattern 'KAYAN-REPAIR-OK' -Quiet)
  }
)
if ($repairRecorded.Count -eq 0) {
  $checked = ($runtimeLog + ' and ' + $repairResultFile)
  Fail ("The bundled repair tool did not record KAYAN-REPAIR-OK. Checked $checked. The repair tool's exit code was 0, so it believed the repair succeeded: see the repairtool.log and repair-result.txt sections below for what it wrote.")
}
Write-Host ("PASS: the repair recorded KAYAN-REPAIR-OK in " + ($repairRecorded -join ', ') + ".")
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

  # Whether this installed copy enforces licences. Everything about activation
  # below is only meaningful on a build that carries a verification key; a run
  # on an evaluation build must skip it and say so rather than report a licence
  # exercise it never performed.
  $licenceEnforced = ($null -ne $health.license -and $health.license.enforcement -eq 'enforce')

  # ── A LICENCE FOR THE FUNCTIONAL RUN ───────────────────────────────────
  # On a build that enforces licences - a product build - every business
  # request is refused until the installation holds one, including the backup,
  # quotation and customer tests below. So the licence is exercised here,
  # starting from the unlicensed state the installer left behind:
  #
  #   no licence -> a business route answers 403 LICENSE_REQUIRED
  #   valid key  -> it answers again
  #
  # The ACTIVATION section at the end returns to the unlicensed state and walks
  # the whole matrix (bogus key, wrong machine, restart, state file,
  # environment, direct API).
  $licenceDirectory = Join-Path $env:ProgramData 'KAYAN-ERP\license'
  $licenceKeyFile = Join-Path $licenceDirectory 'public-key.pem'
  $enforcementMarker = Join-Path $licenceDirectory 'enforcement.required'
  $licenceStateFile = Join-Path $licenceDirectory 'license-state.json'
  $generator = (Resolve-Path (Join-Path $PSScriptRoot '..\tools\license-generator\kayan-license.mjs')).Path

  if ($RequireLicenceEnforcement) {
    if ($manifest.licenseEnforcement -ne 'enforce') {
      Fail ("This Setup is an evaluation build (manifest licence mode '" + $manifest.licenseEnforcement + "'), so it cannot prove that activation is mandatory. Build it with a licence public key.")
    }
    if (-not (Test-Path -LiteralPath $licenceKeyFile) -or -not (Test-Path -LiteralPath $enforcementMarker)) {
      Fail ("The installed package does not carry the licence key and the enforcement marker a product build installs (" + $licenceDirectory + ").")
    }
    Write-Host "PASS: this is a product build: the licence key and the enforcement marker were installed."
  }

  # Whether this run can issue keys. Issuing needs the private half of the key
  # the build was signed with.
  $licenceIssuable = $false
  if (-not $LicenceHome) {
    if (-not $licenceEnforced) {
      # An evaluation build has no key: generate a throwaway one and install it
      # the way a build carrying a key does, so the rest of the exercise runs.
      $LicenceHome = Join-Path $env:TEMP 'kayan-ci-licence'
      Remove-Item -LiteralPath $LicenceHome -Recurse -Force -ErrorAction SilentlyContinue
      & $node $generator init --home $LicenceHome *> $null
      if ($LASTEXITCODE -ne 0) { Fail "Could not create the throwaway test signing key for the licence tests." }
      Copy-Item -LiteralPath (Join-Path $LicenceHome 'public-key.pem') -Destination (Join-Path $installRoot 'public-key.pem') -Force
      $licenceInstallRun = Invoke-RuntimeScript 'Existing'
      if ($licenceInstallRun.ExitCode -ne 0) {
        Fail ("Installing the test licence key failed (exit " + $licenceInstallRun.ExitCode + "). Output: " + $licenceInstallRun.Output)
      }
      if (-not (Select-String -LiteralPath $runtimeLog -Pattern 'KAYAN-LICENCE-KEY-INSTALLED' -Quiet)) {
        Fail "The runtime setup did not record that the licence key was installed."
      }
      $licenceIssuable = $true
      Write-Output "::notice::This run generated its own throwaway licence key and installed it, because no build key was supplied."
    }
  } else {
    $buildKey = Join-Path $LicenceHome 'public-key.pem'
    if (-not (Test-Path -LiteralPath $buildKey)) { Fail ("The licence home given to this test has no public-key.pem: " + $buildKey) }
    if (Test-Path -LiteralPath $licenceKeyFile) {
      $installedKeyHash = (Get-FileHash -LiteralPath $licenceKeyFile -Algorithm SHA256).Hash
      $buildKeyHash = (Get-FileHash -LiteralPath $buildKey -Algorithm SHA256).Hash
      if ($installedKeyHash -ne $buildKeyHash) {
        Fail "The installed licence key is not the key this Setup was built with, so the activation test would not be about this build."
      }
    }
    $licenceIssuable = $true
    Write-Host "PASS: the installed licence key is the key this Setup was built with."
  }

  if ($licenceEnforced -and -not $licenceIssuable) {
    Fail ("This Setup enforces licences, and this test does not hold the key pair the build was signed with, so it cannot licence the installation and every company feature would be refused. Run this test with -LicenceHome pointing at that key pair, or test a Setup built with a test key, as the Windows Installer workflow does.")
  }

  # The server must already be enforcing, before anybody has activated it.
  if ($licenceEnforced) {
    if ($health.license.configured -ne $true) { Fail "The installed server says it has no licence verification key." }
    Write-Host "PASS: the installed server enforces licences and holds a verification key - before any activation."

    $unlicensedAnswer = Get-HttpAnswer "$base/parties/customers" $headers
    if ($unlicensedAnswer.Status -ne 403 -or $unlicensedAnswer.Body -notmatch 'LICENSE_REQUIRED') {
      Fail ("An unlicensed installation answered a business request instead of refusing it (HTTP " + $unlicensedAnswer.Status + "): " + $unlicensedAnswer.Body)
    }
    Write-Host "PASS: without a licence every business request is refused with LICENSE_REQUIRED."

    $licenceStatus = Invoke-RestMethod -Uri "$base/license/status" -Headers $headers -TimeoutSec 15
    if ($licenceStatus.state -ne 'UNLICENSED' -or -not $licenceStatus.blocked) {
      Fail ("The licence state is wrong before activation: state=" + $licenceStatus.state + " blocked=" + $licenceStatus.blocked)
    }
    $machineId = $licenceStatus.machineId
    if (-not $machineId) { Fail "The installed program did not report a machine id." }

    $ciLicence = @(& $node $generator licence create --ref 'CI installed-build licence' --seats 5 --term 1y --home $LicenceHome)
    if ($LASTEXITCODE -ne 0) { Fail "Could not register the test licence." }
    $ciLicenceId = ($ciLicence | Select-String -Pattern 'licence\s*:\s*(lic_[A-Za-z0-9_-]+)').Matches[0].Groups[1].Value
    if (-not $ciLicenceId) { Fail ("Could not read the test licence id from the generator output: " + ($ciLicence -join ' ')) }
    $functionalKey = @(& $node $generator issue activation --licence $ciLicenceId --machine $machineId --home $LicenceHome) | Where-Object { $_ -match '^KYN1\.' } | Select-Object -First 1
    if (-not $functionalKey) { Fail "Could not issue a valid activation key for this machine." }
    $activatedForFunctional = Invoke-RestMethod -Method Post -Uri "$base/license/activate" -Headers $headers -ContentType 'application/json' -Body (@{ key = $functionalKey } | ConvertTo-Json) -TimeoutSec 20
    if ($activatedForFunctional.state -ne 'ACTIVE' -or $activatedForFunctional.blocked) {
      Fail ("A valid key did not activate the installation: state=" + $activatedForFunctional.state + " blocked=" + $activatedForFunctional.blocked)
    }
    $allowedAgain = Get-HttpAnswer "$base/parties/customers" $headers
    if ($allowedAgain.Status -ne 200) { Fail ("Business requests are still refused after activation (HTTP " + $allowedAgain.Status + ").") }
    Write-Host "PASS: a valid key activates the installation and business requests are answered again."
  } else {
    Write-Output "::warning title=Activation not proven::This Setup does not enforce licences (mode: $($health.license.enforcement)), so the licence-first proof and the activation matrix were skipped. A Setup built with a licence public key is required to prove that activation is mandatory."
  }

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

# The new company's first administrator is created by the same production
# script the desktop shell uses, so it needs the connection the program now
# uses - read from the settings Setup has just written, not from a URL this
# script remembers. (The seeding for the previous company deliberately removed
# these from the environment; without this, the script would seed the wrong
# database, or none.)
$newCompanySettings = Read-SettingsValues $settings
if (-not $newCompanySettings['DATABASE_URL'] -or $newCompanySettings['DATABASE_URL'] -notmatch [regex]::Escape($freshDatabase)) {
  Fail ("The installed settings do not point at the new company database: " + $newCompanySettings['DATABASE_URL'])
}
$env:DATABASE_URL = $newCompanySettings['DATABASE_URL']
$env:ADMIN_DATABASE_URL = $newCompanySettings['ADMIN_DATABASE_URL']
$env:KAYAN_ADMIN_USERNAME = 'ci-new-admin'
$env:KAYAN_ADMIN_PASSWORD = 'CiSmoke-New-Admin-7241'
$seedNew = Start-Process -FilePath $node -ArgumentList @("scripts\prepare-database.mjs") -WorkingDirectory $backend -Wait -PassThru -NoNewWindow
Remove-Item Env:KAYAN_ADMIN_USERNAME,Env:KAYAN_ADMIN_PASSWORD,Env:DATABASE_URL,Env:ADMIN_DATABASE_URL -ErrorAction SilentlyContinue
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

  # The licence lives with the company database, so a brand-new company starts
  # without one. That is the product's real behaviour on this screen, and it is
  # exactly the rule the activation policy asks for: no valid key, no business
  # work - even for a company the owner just created. Prove it, then apply the
  # same key to this database (the key is spent once per database, not once per
  # computer) and go on.
  $newCompanyAnswer = Get-HttpAnswer "$newBase/parties/customers" $newHeaders
  if ($RequireLicenceEnforcement -and $newCompanyAnswer.Status -ne 403) {
    Fail ("The new company's database answered a business request without a licence (HTTP " + $newCompanyAnswer.Status + ").")
  }
  if ($newCompanyAnswer.Status -eq 403) {
    if ($newCompanyAnswer.Body -notmatch 'LICENSE_REQUIRED') {
      Fail ("The new company's database refused a business request for a reason other than the missing licence: " + $newCompanyAnswer.Body)
    }
    $newCompanyLicenceStatus = Invoke-RestMethod -Uri "$newBase/license/status" -Headers $newHeaders -TimeoutSec 15
    if ($newCompanyLicenceStatus.machineId -ne $machineId) {
      Fail ("The new company's database reports another machine id (" + $newCompanyLicenceStatus.machineId + " instead of " + $machineId + ").")
    }
    $activatedOnNewCompany = Invoke-RestMethod -Method Post -Uri "$newBase/license/activate" -Headers $newHeaders -ContentType 'application/json' -Body (@{ key = $functionalKey } | ConvertTo-Json) -TimeoutSec 20
    if ($activatedOnNewCompany.state -ne 'ACTIVE' -or $activatedOnNewCompany.blocked) {
      Fail ("The installation's own key did not activate the new company's database: state=" + $activatedOnNewCompany.state + " blocked=" + $activatedOnNewCompany.blocked)
    }
    Write-Host "PASS: a new company starts without a licence - business is refused until the key is applied to it."
  } else {
    Write-Host "NOTE: this build does not enforce licences, so the new company's database cannot refuse business requests."
  }

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
# ACTIVATION, ON A PRODUCT BUILD, STARTING FROM NO LICENCE
#
# The functional run above had to activate the installation before it could do
# anything - that is the first proof. This section returns to the unlicensed
# state the way a restored or replaced database would leave it, and walks the
# whole matrix on the real installed program:
#
#   * no licence              -> business routes refused with LICENSE_REQUIRED
#   * a bogus key             -> refused, and not with a server error
#   * a key for another PC    -> refused as a key for another computer
#   * a valid key             -> works, and business routes answer again
#   * restart of the program  -> still enforced, licence still there
#   * state file deleted      -> no licence appears; enforcement stays on
#   * state file corrupted    -> set aside, never read as a licence
#   * environment variables   -> enforcement, machine id, state folder and key
#                                cannot be changed by whoever starts the server
#   * a direct API call       -> refused exactly like the program's own calls
#   * /health and /license    -> still answer, as designed
#
# Every key here is generated by this run and is worthless outside it.
# ═══════════════════════════════════════════════════════════════════════════

if ($licenceEnforced) {
Write-Host '--- activation: back to an installation with no licence ---'

# The rows are the licence. Removing them is what a restored backup from
# before the purchase looks like, and it must never read as "activated".
$env:PGPASSWORD = $previousPassword
try {
  & $psql -h 127.0.0.1 -p 5432 -U erp_app -d $freshDatabase -v ON_ERROR_STOP=1 -c "DELETE FROM license_seat_usage; DELETE FROM license_keys; DELETE FROM license_events; DELETE FROM license_installations;" *> $null
  $deleteExit = $LASTEXITCODE
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
if ($deleteExit -ne 0) { Fail "Could not remove the licence rows for the activation exercise." }

# Deleting the state file is the cheapest thing somebody would try: it is a
# file in a folder they can see. It must not produce a licence, and it must not
# switch enforcement off. Do it before the server starts again.
if (Test-Path -LiteralPath $licenceStateFile) { Remove-Item -LiteralPath $licenceStateFile -Force -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath $licenceStateFile) { Fail "Could not remove the licence state file for the deletion test: $licenceStateFile" }

$licenceClient = Start-Process -FilePath (Join-Path $installRoot 'erp_kayan.exe') -WorkingDirectory $installRoot -PassThru
try {
  $licenceApi = Wait-ForInstalledApi $licenceClient 90
  if (-not $licenceApi) { Fail "The unlicensed build's server did not become healthy within 90 seconds." }
  $licenceBase = "http://127.0.0.1:$($licenceApi.Port)/api/v1"

  if ($null -eq $licenceApi.Health.license) { Fail "The installed server does not report its licence mode on /health." }
  if ($licenceApi.Health.license.enforcement -ne 'enforce') {
    Fail ("The installed server is not enforcing licences after the state file was deleted (mode: " + $licenceApi.Health.license.enforcement + ").")
  }
  if ($licenceApi.Health.license.configured -ne $true) { Fail "The installed server says it has no licence verification key." }
  Write-Host "PASS: deleting the licence state file does not switch enforcement off (mode: enforce, key: installed)."

  $loginLicence = Invoke-RestMethod -Method Post -Uri "$licenceBase/auth/login" -ContentType 'application/json' -Body (@{ username = 'ci-new-admin'; password = 'CiSmoke-New-Admin-7241' } | ConvertTo-Json -Compress) -TimeoutSec 10
  if (-not $loginLicence.accessToken) { Fail "Signing in must keep working without a licence, and it did not." }
  $headers = @{ Authorization = "Bearer $($loginLicence.accessToken)" }
  Write-Host "PASS: signing in still works while the installation is unlicensed."

  $unlicensed = Get-HttpAnswer "$licenceBase/parties/customers" $headers
  if ($unlicensed.Status -ne 403) {
    Fail ("An unlicensed installation answered a business request instead of refusing it (HTTP " + $unlicensed.Status + ").")
  }
  if ($unlicensed.Body -notmatch 'LICENSE_REQUIRED') {
    Fail ("The refusal did not say that a licence is required: " + $unlicensed.Body)
  }
  Write-Host "PASS: with no licence in the database and no state file, every business request is still refused with LICENSE_REQUIRED."

  $licenceStatus = Invoke-RestMethod -Uri "$licenceBase/license/status" -Headers $headers -TimeoutSec 15
  if ($licenceStatus.state -ne 'UNLICENSED' -or -not $licenceStatus.blocked) {
    Fail ("The licence screen state is wrong before activation: state=" + $licenceStatus.state + " blocked=" + $licenceStatus.blocked)
  }
  if (-not $licenceStatus.machineId) { Fail "The installed program did not report a machine id." }
  if ($machineId -and $licenceStatus.machineId -ne $machineId) {
    Fail ("The machine id changed when the state file was deleted (" + $machineId + " -> " + $licenceStatus.machineId + "); the machine is what a key is bound to.")
  }
  # /license stays reachable while blocked: that is where the key is entered.
  Write-Host "PASS: /license answers while blocked, so the key can still be entered."

  $garbageStatus = 0
  try {
    Invoke-RestMethod -Method Post -Uri "$licenceBase/license/activate" -Headers $headers -ContentType 'application/json' -Body (@{ key = 'KYN1.this-is-not-a-licence-key' } | ConvertTo-Json) -TimeoutSec 15 | Out-Null
  } catch { $garbageStatus = [int]$_.Exception.Response.StatusCode }
  if ($garbageStatus -ne 400 -and $garbageStatus -ne 403) {
    Fail ("A bogus key was not refused cleanly (HTTP " + $garbageStatus + ").")
  }
  Write-Host "PASS: a bogus key is refused."

  # A second licence, so this matrix never depends on a key already spent in a
  # database the program is no longer looking at.
  $matrixLicence = @(& $node $generator licence create --ref 'CI activation matrix' --seats 5 --term 1y --home $LicenceHome)
  if ($LASTEXITCODE -ne 0) { Fail "Could not register the test licence for the activation matrix." }
  $matrixLicenceId = ($matrixLicence | Select-String -Pattern 'licence\s*:\s*(lic_[A-Za-z0-9_-]+)').Matches[0].Groups[1].Value
  if (-not $matrixLicenceId) { Fail ("Could not read the test licence id from the generator output: " + ($matrixLicence -join ' ')) }

  $wrongMachineKey = @(& $node $generator issue activation --licence $matrixLicenceId --machine 'KM-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' --home $LicenceHome) | Where-Object { $_ -match '^KYN1\.' } | Select-Object -First 1
  if (-not $wrongMachineKey) { Fail "Could not issue a key for another machine." }
  $wrongMachineStatus = 0
  $wrongMachineBody = ''
  try {
    Invoke-RestMethod -Method Post -Uri "$licenceBase/license/activate" -Headers $headers -ContentType 'application/json' -Body (@{ key = $wrongMachineKey } | ConvertTo-Json) -TimeoutSec 15 | Out-Null
  } catch {
    $wrongMachineStatus = [int]$_.Exception.Response.StatusCode
    $wrongMachineBody = [string]$_.ErrorDetails.Message
  }
  if ($wrongMachineStatus -ne 403 -or $wrongMachineBody -notmatch 'LICENSE_KEY_WRONG_MACHINE') {
    Fail ("A key issued for another computer was not refused as such (HTTP " + $wrongMachineStatus + "): " + $wrongMachineBody)
  }
  Write-Host "PASS: a key issued for another computer is refused, so a licence cannot be copied between machines."

  $validKey = @(& $node $generator issue activation --licence $matrixLicenceId --machine $licenceStatus.machineId --home $LicenceHome) | Where-Object { $_ -match '^KYN1\.' } | Select-Object -First 1
  if (-not $validKey) { Fail "Could not issue a valid activation key for this machine." }
  $activated = Invoke-RestMethod -Method Post -Uri "$licenceBase/license/activate" -Headers $headers -ContentType 'application/json' -Body (@{ key = $validKey } | ConvertTo-Json) -TimeoutSec 20
  if ($activated.state -ne 'ACTIVE' -or $activated.blocked) {
    Fail ("A valid key did not activate the installation: state=" + $activated.state + " blocked=" + $activated.blocked)
  }
  $afterActivation = Get-HttpAnswer "$licenceBase/parties/customers" $headers
  if ($afterActivation.Status -ne 200) { Fail ("Business requests are still refused after activation (HTTP " + $afterActivation.Status + ").") }
  Write-Host "PASS: a valid key activates the installation and business requests are answered again."

  $licensedHealth = Invoke-WebRequest -UseBasicParsing -Uri "$licenceBase/health" -TimeoutSec 15
  if ($licensedHealth.StatusCode -ne 200) { Fail "/health did not answer while the installation is licensed." }

  # ── restart ─────────────────────────────────────────────────────────────
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
  $rulesAfterRestart = Get-HttpAnswer "$restartedBase/parties/customers" $restartHeaders
  if ($rulesAfterRestart.Status -ne 200) { Fail ("Business requests are refused after restarting a licensed installation (HTTP " + $rulesAfterRestart.Status + ").") }
  Write-Host "PASS: the licence survives closing and reopening the program, and enforcement is still on."

  # ── corrupt state file, still licensed ──────────────────────────────────
  # A file the person can write must not be able to *grant* anything, and
  # replacing it with nonsense must not lock a paying customer out either: it
  # is set aside and the licence stays where it is, in the database.
  if (Test-Path -LiteralPath $licenceStateFile) {
    Set-Content -LiteralPath $licenceStateFile -Value 'not a state file - deliberately corrupted by the smoke test' -Encoding ASCII
  } else {
    Fail "The licence state file was not recreated after the restart: $licenceStateFile"
  }
  Stop-KayanClient $licenceClient
  $licenceClient = Start-Process -FilePath (Join-Path $installRoot 'erp_kayan.exe') -WorkingDirectory $installRoot -PassThru
  $corruptApi = Wait-ForInstalledApi $licenceClient 90
  if (-not $corruptApi) { Fail "The program did not come back after its licence state file was corrupted." }
  $corruptBase = "http://127.0.0.1:$($corruptApi.Port)/api/v1"
  if ($null -eq $corruptApi.Health.license -or $corruptApi.Health.license.enforcement -ne 'enforce') {
    Fail "Corrupting the licence state file switched licence enforcement off."
  }
  $loginCorrupt = Invoke-RestMethod -Method Post -Uri "$corruptBase/auth/login" -ContentType 'application/json' -Body (@{ username = 'ci-new-admin'; password = 'CiSmoke-New-Admin-7241' } | ConvertTo-Json -Compress) -TimeoutSec 10
  $corruptHeaders = @{ Authorization = "Bearer $($loginCorrupt.accessToken)" }
  $statusCorrupt = Invoke-RestMethod -Uri "$corruptBase/license/status" -Headers $corruptHeaders -TimeoutSec 15
  # Read now, while this server is still answering: the hostile-environment
  # block below compares its own answer with this one.
  $realMachineId = $statusCorrupt.machineId
  if ($statusCorrupt.state -ne 'ACTIVE') {
    Fail ("A corrupted state file changed the licence state to '" + $statusCorrupt.state + "'; the licence is in the database, not in that file.")
  }
  if ((Get-HttpAnswer "$corruptBase/parties/customers" $corruptHeaders).Status -ne 200) {
    Fail "A corrupted licence state file locked a licensed installation out of business routes."
  }
  Write-Host "PASS: corrupting the licence state file neither grants a licence nor removes one, and enforcement stays on."

  # ── the licence is deleted: absence is never activation ────────────────
  $env:PGPASSWORD = $previousPassword
  try {
    & $psql -h 127.0.0.1 -p 5432 -U erp_app -d $freshDatabase -v ON_ERROR_STOP=1 -c "DELETE FROM license_seat_usage; DELETE FROM license_keys; DELETE FROM license_events; DELETE FROM license_installations;" *> $null
    $deleteAgainExit = $LASTEXITCODE
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
  if ($deleteAgainExit -ne 0) { Fail "Could not remove the licence rows for the deletion test." }
  Start-Sleep -Seconds 4
  $blockedAgain = Get-HttpAnswer "$corruptBase/parties/customers" $corruptHeaders
  if ($blockedAgain.Status -ne 403) {
    Fail ("A deleted licence did not stop business requests (HTTP " + $blockedAgain.Status + "): a missing licence is never an activated one.")
  }
  $statusAfterDelete = Invoke-RestMethod -Uri "$corruptBase/license/status" -Headers $corruptHeaders -TimeoutSec 15
  if ($statusAfterDelete.state -ne 'UNLICENSED') {
    Fail ("After removing the licence the state is still '" + $statusAfterDelete.state + "'.")
  }
  Write-Host "PASS: a deleted licence blocks business use again; absence is never read as activation."
} finally {
  Stop-KayanClient $licenceClient
}

# ═══════════════════════════════════════════════════════════════════════════
# THE SERVER STARTED BY HAND, WITH HOSTILE ENVIRONMENT
#
# Everything above went through the program. This starts the installed backend
# directly - no window, no shell - with the environment variables somebody
# would set to get round the licence, and calls the API the way any tool could:
#
#   LICENSE_ENFORCEMENT=warn        -> must stay enforced
#   LICENSE_MACHINE_ID=KM-ZZZZ...   -> must not become the machine id
#   LICENSE_STATE_DIR=<temp folder> -> must not move the state
#   LICENSE_PUBLIC_KEY / _FILE      -> a key of their own must not be trusted
#
# The installation is unlicensed when this runs (the previous block removed the
# licence), so any hole here shows up as a business request that succeeds.
# ═══════════════════════════════════════════════════════════════════════════

Write-Host '--- activation: the server started by hand with hostile environment ---'
$hijackStateDir = Join-Path $env:TEMP ('kayan-hijack-state-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$attackerHome = Join-Path $env:TEMP ('kayan-attacker-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $hijackStateDir | Out-Null
& $node $generator init --home $attackerHome *> $null
if ($LASTEXITCODE -ne 0) { Fail "Could not create the attacker's throwaway key pair." }
$attackerLicence = @(& $node $generator licence create --ref 'CI attacker key' --seats 1 --term 1y --home $attackerHome)
if ($LASTEXITCODE -ne 0) { Fail "Could not register the attacker's licence." }
$attackerLicenceId = ($attackerLicence | Select-String -Pattern 'licence\s*:\s*(lic_[A-Za-z0-9_-]+)').Matches[0].Groups[1].Value
if (-not $realMachineId) { Fail "The installed program did not report a machine id for the hostile-environment test." }
$attackerKey = @(& $node $generator issue activation --licence $attackerLicenceId --machine $realMachineId --home $attackerHome) | Where-Object { $_ -match '^KYN1\.' } | Select-Object -First 1
if (-not $attackerKey) { Fail "Could not issue the attacker's activation key." }

$directPort = 3080
$directOut = Join-Path $env:TEMP 'kayan-direct-api-out.log'
$directErr = Join-Path $env:TEMP 'kayan-direct-api-err.log'
$direct = $null
# The environment the program itself gives its server, read from the installed
# settings: without DATABASE_URL and the signing secrets a production server
# cannot start at all, and a hand-started one that could would not be the
# thing under test.
$directSettings = Read-SettingsValues $settings
$savedEnvironment = @{}
$environmentNames = @($directSettings.Keys) + @(
  'PORT','HOST','NODE_ENV','NO_COLOR','KAYAN_BACKUP_DIR','KAYAN_UPLOAD_DIR',
  'LICENSE_ENFORCEMENT','LICENSE_MACHINE_ID','LICENSE_STATE_DIR',
  'LICENSE_PUBLIC_KEY','LICENSE_PUBLIC_KEY_FILE'
)
foreach ($name in $environmentNames) {
  if (-not $savedEnvironment.ContainsKey($name)) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
}
try {
  foreach ($entry in $directSettings.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
  $env:PORT = [string]$directPort
  $env:HOST = '127.0.0.1'
  $env:NODE_ENV = 'production'
  $env:NO_COLOR = '1'
  $env:KAYAN_BACKUP_DIR = Join-Path $env:ProgramData 'KAYAN-ERP\backups'
  $env:KAYAN_UPLOAD_DIR = Join-Path $env:ProgramData 'KAYAN-ERP\uploads'
  $env:LICENSE_ENFORCEMENT = 'warn'
  $env:LICENSE_MACHINE_ID = 'KM-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ'
  $env:LICENSE_STATE_DIR = $hijackStateDir
  $env:LICENSE_PUBLIC_KEY = (Get-Content -LiteralPath (Join-Path $attackerHome 'public-key.pem') -Raw)
  $env:LICENSE_PUBLIC_KEY_FILE = (Join-Path $attackerHome 'public-key.pem')
  $direct = Start-Process -FilePath $node -ArgumentList @('dist\src\main.js') -WorkingDirectory (Join-Path $installRoot 'backend') -PassThru -NoNewWindow -RedirectStandardOutput $directOut -RedirectStandardError $directErr
  $directHealth = Wait-ForHealth $directPort 120
  if (-not $directHealth) {
    $tail = ((Get-Content -LiteralPath $directOut -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $directErr -Raw -ErrorAction SilentlyContinue))
    Fail ("The installed backend did not answer when started by hand: " + $tail)
  }
  if ($null -eq $directHealth.license) { Fail "The backend started by hand does not report a licence mode." }
  if ($directHealth.license.enforcement -ne 'enforce') {
    Fail ("LICENSE_ENFORCEMENT=warn lowered enforcement on the installed backend (mode: " + $directHealth.license.enforcement + ").")
  }
  if ($directHealth.license.configured -ne $true) { Fail "The backend started by hand reports no licence verification key." }
  Write-Host "PASS: LICENSE_ENFORCEMENT=warn cannot lower enforcement on an installed copy."

  $directBase = "http://127.0.0.1:$directPort/api/v1"
  $directLogin = Invoke-RestMethod -Method Post -Uri "$directBase/auth/login" -ContentType 'application/json' -Body (@{ username = 'ci-new-admin'; password = 'CiSmoke-New-Admin-7241' } | ConvertTo-Json -Compress) -TimeoutSec 10
  if (-not $directLogin.accessToken) { Fail "The backend started by hand refused the administrator's login." }
  $directHeaders = @{ Authorization = "Bearer $($directLogin.accessToken)" }

  $directStatus = Invoke-RestMethod -Uri "$directBase/license/status" -Headers $directHeaders -TimeoutSec 15
  if ($directStatus.machineId -eq 'KM-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ') {
    Fail "LICENSE_MACHINE_ID replaced the machine id of an installed copy."
  }
  if ($realMachineId -and $directStatus.machineId -ne $realMachineId) {
    Fail ("The backend started by hand reports another machine id (" + $directStatus.machineId + " instead of " + $realMachineId + ").")
  }
  Write-Host "PASS: LICENSE_MACHINE_ID cannot replace the machine id of an installed copy."

  if (Test-Path -LiteralPath (Join-Path $hijackStateDir 'license-state.json')) {
    Fail "LICENSE_STATE_DIR moved the licence state into a folder the person who started the server can write."
  }
  if (-not (Test-Path -LiteralPath $licenceStateFile)) {
    Fail "The backend started by hand did not use the installation's own licence state file."
  }
  Write-Host "PASS: LICENSE_STATE_DIR cannot move the licence state of an installed copy."

  $directBusiness = Get-HttpAnswer "$directBase/parties/customers" $directHeaders
  if ($directBusiness.Status -ne 403) {
    Fail ("A direct API call on an unlicensed installation was answered (HTTP " + $directBusiness.Status + ").")
  }
  if ($directBusiness.Body -notmatch 'LICENSE_REQUIRED') {
    Fail ("The direct refusal did not say a licence is required: " + $directBusiness.Body)
  }
  Write-Host "PASS: a business route called directly on the API is refused with 403 LICENSE_REQUIRED."

  $attackerStatus = 0
  $attackerBody = ''
  try {
    Invoke-RestMethod -Method Post -Uri "$directBase/license/activate" -Headers $directHeaders -ContentType 'application/json' -Body (@{ key = $attackerKey } | ConvertTo-Json) -TimeoutSec 20 | Out-Null
  } catch {
    $attackerStatus = [int]$_.Exception.Response.StatusCode
    $attackerBody = [string]$_.ErrorDetails.Message
  }
  if ($attackerStatus -ne 403 -or $attackerBody -notmatch 'LICENSE_KEY_BAD_SIGNATURE') {
    Fail ("LICENSE_PUBLIC_KEY/_FILE replaced the key of an installed copy: a key signed by another key was not refused as a bad signature (HTTP " + $attackerStatus + "): " + $attackerBody)
  }
  Write-Host "PASS: LICENSE_PUBLIC_KEY and LICENSE_PUBLIC_KEY_FILE cannot replace the key an installed copy trusts."

  # The routes that are meant to work while blocked still do.
  $healthWhileBlocked = Invoke-WebRequest -UseBasicParsing -Uri "$directBase/health" -TimeoutSec 15
  if ($healthWhileBlocked.StatusCode -ne 200) { Fail "/health does not answer while the installation is blocked." }
  $licenceWhileBlocked = Invoke-WebRequest -UseBasicParsing -Uri "$directBase/license/status" -Headers $directHeaders -TimeoutSec 15
  if ($licenceWhileBlocked.StatusCode -ne 200) { Fail "/license/status does not answer while the installation is blocked." }
  Write-Host "PASS: /health and /license still answer while the installation is blocked, so it can be put right."
} finally {
  if ($direct -and -not $direct.HasExited) {
    Stop-Process -Id $direct.Id -Force -ErrorAction SilentlyContinue
    try { $direct.WaitForExit(10000) | Out-Null } catch { }
  }
  # Put this process's own environment back: the block above borrowed it to
  # start a second server and nothing after it may inherit those values.
  foreach ($name in $savedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
  }
  Remove-Item -LiteralPath $hijackStateDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $attackerHome -Recurse -Force -ErrorAction SilentlyContinue
}

}

if ($licenceEnforced) {
  Write-Output "::notice::Company and activation exercises passed: a new company got its own empty database while the previous company was backed up and kept; the program was proven to read the new database; and on a build that enforces licences, an unlicensed installation refuses business use, a bogus key and a wrong-machine key are refused, a valid key works, it survives a restart, deleting or corrupting the licence state file changes nothing, environment variables cannot lower enforcement or move the state, and the API called directly refuses exactly as the program does."
} else {
  Write-Output "::warning title=Activation not proven::The company exercises passed, but this Setup does not enforce licences, so nothing about activation was proven by this run."
}
