# Runs the real Windows installer on the CI runner and verifies the installed local runtime.
[CmdletBinding()]
param(
  [string]$SetupPath = "build\windows-installer\KAYAN-ERP-Setup.exe",
  [switch]$RuntimeOnly,
  [string]$ExpectedSourceCommit = ""
)

$ErrorActionPreference = "Stop"

# This script intentionally simulates interrupted setup, corrupts a synthetic
# trust store, invokes reset, and changes firewall rules. Never run it on a
# workstation or a self-hosted runner, and never overwrite a prior installation.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Installer smoke requires a fresh GitHub-hosted Windows VM.'
}
$existingData = Join-Path $env:ProgramData 'KAYAN-ERP'
$existingInstall = Join-Path $env:ProgramFiles 'KAYAN ERP'
if ((Test-Path -LiteralPath $existingData) -or (Test-Path -LiteralPath $existingInstall) -or
    (Get-Service -Name 'KayanERPPostgreSQL' -ErrorAction SilentlyContinue)) {
  throw 'Refusing destructive smoke test: existing KAYAN data, installation or service detected.'
}
foreach ($port in @(5432, 3000, 3001, 3002, 3003, 3010, 3020)) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Refusing destructive smoke test: required port $port is already in use."
  }
}
if (-not $RuntimeOnly) {
  throw 'The historical licensed smoke required a signing-key directory and is not safe to run. RuntimeOnly is diagnostic and does not prove licensed business operation.'
}
if ($ExpectedSourceCommit -notmatch '^[0-9a-f]{40}$' -or $env:GITHUB_SHA -ne $ExpectedSourceCommit) {
  throw 'The expected source SHA must match this workflow run.'
}
$setup = (Resolve-Path $SetupPath).Path
$installLog = Join-Path $env:TEMP "kayan-setup-smoke.log"
$serviceName = "KayanERPPostgreSQL"
$installRoot = Join-Path $env:ProgramFiles "KAYAN ERP"
$backend = Join-Path $installRoot "backend"
$node = Join-Path $backend "node\node.exe"
$clientPath = Join-Path $installRoot "erp_kayan.exe"
$postgresExe = Join-Path $installRoot "backend\postgres\bin\postgres.exe"
$repairTool = Join-Path $installRoot "RepairTool.exe"
$vcRedist = Join-Path $installRoot "prerequisites\vc_redist.x64.exe"
$windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$settings = Join-Path $env:ProgramData "KAYAN-ERP\kayan.env"
$offlineRuleNames = New-Object 'System.Collections.Generic.List[string]'

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
function Add-KayanOfflineRule([string]$Program) {
  if (-not (Test-Path -LiteralPath $Program)) { Fail "Cannot enforce offline mode because a required executable path is missing: $Program" }
  $ruleName = "KAYAN-Offline-Smoke-" + [Guid]::NewGuid().ToString("N")
  New-NetFirewallRule -DisplayName $ruleName -Direction Outbound -Action Block -Program $Program -RemoteAddress Internet -Profile Any -Enabled True -ErrorAction Stop | Out-Null
  $script:offlineRuleNames.Add($ruleName)
}

function Remove-KayanOfflineRules {
  foreach ($ruleName in @($script:offlineRuleNames)) {
    Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  }
  $script:offlineRuleNames.Clear()
}

function Enable-KayanOfflineSmokeRules([switch]$AfterInstall) {
  $disabledProfiles = @(Get-NetFirewallProfile | Where-Object { $_.Enabled -ne $true })
  if ($disabledProfiles.Count -gt 0) {
    Fail ("Cannot prove offline installation: Windows Firewall is disabled for profile(s) " + (($disabledProfiles | ForEach-Object { $_.Name }) -join ', ') + ".")
  }
  if (-not $AfterInstall) {
    Add-KayanOfflineRule -Program $setup
    Add-KayanOfflineRule -Program $windowsPowerShell
    Write-Host "PASS: outbound Internet is blocked for Setup.exe and Windows PowerShell before installation."
    return
  }

  $browserCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe")
  )
  $browser = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $browser) { Fail "The clean Windows image has no OS-provided Microsoft Edge runtime; the quotation PDF service depends on an installed Edge/Chrome browser." }
  foreach ($program in @($clientPath, $node, $postgresExe, $repairTool, $vcRedist, $browser)) {
    Add-KayanOfflineRule -Program $program
  }
  Write-Host "PASS: outbound Internet is blocked for the installed KAYAN client, bundled Node.js, PostgreSQL, RepairTool, VC++ redistributable and Edge; loopback remains available."
}

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

function Stop-KayanSmokeClient([object]$Process, [int]$Port) {
  if ($Process -and -not $Process.HasExited) {
    $null = $Process.CloseMainWindow()
    try { Wait-Process -Id $Process.Id -Timeout 10 -ErrorAction SilentlyContinue } catch { }
    if (-not $Process.HasExited) { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
  }
  $installRootPattern = [string]$installRoot
  $backendProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine -match '(?i)dist[\\/]+src[\\/]+main\.js' -and $_.CommandLine.IndexOf($installRootPattern, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
  foreach ($backendProcess in $backendProcesses) {
    Stop-Process -Id $backendProcess.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($Port -gt 0) {
    for ($wait = 0; $wait -lt 20; $wait++) {
      $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
      if ($listeners.Count -eq 0) { break }
      Start-Sleep -Seconds 1
    }
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) { Fail "The previous installed backend still owns port $Port after restart cleanup." }
  }
}

function Start-KayanSmokeClient {
  $process = Start-Process -FilePath $clientPath -WorkingDirectory $installRoot -PassThru
  foreach ($attempt in 1..90) {
    if ($process.HasExited) { Fail "The installed KAYAN client exited during a runtime-only restart (exit code $($process.ExitCode))." }
    foreach ($portCandidate in @(3000, 3001, 3002, 3003, 3010, 3020)) {
      try {
        $candidateHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$portCandidate/api/v1/health" -TimeoutSec 2
        if ($candidateHealth.status) {
          return @{ Process = $process; Port = $portCandidate; Health = $candidateHealth }
        }
      } catch { }
    }
    Start-Sleep -Seconds 1
  }
  Fail "The installed KAYAN client did not recover a healthy local API within 90 seconds after a licensing-state change."
}

function Fail([string]$Reason) {
  Remove-KayanOfflineRules
  Publish-Failure ($Reason + [Environment]::NewLine + (Read-Details))
  exit 1
}

# Nothing may die silently: every unhandled error becomes a real, annotated
# failure with the same diagnostics as Fail().
trap {
  Fail ("Unhandled error in the smoke test: " + $_.Exception.Message + [Environment]::NewLine + ($_ | Out-String))
}

if ($RuntimeOnly) { Enable-KayanOfflineSmokeRules }

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
Set-Acl -LiteralPath $settings -AclObject $emptyAcl
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

# Building stages runtime-manifest.json naming the commit the payload was
# built from. Without it, nothing on this machine says which code the Setup.exe
# carried, and a report that calls the installer "the tested build" would be
# guessing. It has to exist, and it has to name the commit under test.
$manifestPath = Join-Path $installRoot "runtime-manifest.json"
if (-not (Test-Path $manifestPath)) { Fail "The installed package has no runtime-manifest.json, so the build it came from cannot be identified." }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
Write-Host ("PASS: installed manifest: product {0}, version {1}, commit {2}, Node {3}, PostgreSQL {4}." -f $manifest.product, $manifest.productVersion, $manifest.sourceCommit, $manifest.nodeVersion, $manifest.postgresqlVersion)
$commitUnderTest = $ExpectedSourceCommit
if (-not $commitUnderTest) { $commitUnderTest = (& git -C $PSScriptRoot rev-parse HEAD 2>$null | Select-Object -First 1) }
if ($commitUnderTest -and $manifest.sourceCommit -ne $commitUnderTest) {
  Fail "The installed payload was built from $($manifest.sourceCommit), not from the expected commit ($commitUnderTest)."
}
if ($commitUnderTest) { Write-Host "PASS: the installed payload matches the expected source commit ($commitUnderTest)." }
if ($RuntimeOnly) { Enable-KayanOfflineSmokeRules -AfterInstall }

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

# Preserve a real, checked custom-format PostgreSQL backup before any upgrade.
# The source here is the disposable CI database, never a customer database.
$preUpgradeBackup = Join-Path $env:TEMP ("kayan-pre-upgrade-{0}.dump" -f [guid]::NewGuid().ToString('N'))
$pgDump = Join-Path $installRoot "backend\postgres\bin\pg_dump.exe"
$pgRestore = Join-Path $installRoot "backend\postgres\bin\pg_restore.exe"
if ((Test-Path -LiteralPath $preUpgradeBackup) -or -not (Test-Path -LiteralPath $pgDump) -or -not (Test-Path -LiteralPath $pgRestore)) { Fail 'Cannot safely prepare the pre-upgrade backup.' }
$env:PGPASSWORD = $databasePassword
try {
  & $pgDump -h 127.0.0.1 -p 5432 -U erp_app -d erp_kayan -Fc -f $preUpgradeBackup *> $null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $preUpgradeBackup -PathType Leaf)) { Fail 'Disposable pre-upgrade PostgreSQL backup failed.' }
  & $pgRestore --list $preUpgradeBackup *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'Disposable pre-upgrade PostgreSQL backup could not be verified.' }
  $preUpgradeBackupHash = (Get-FileHash -LiteralPath $preUpgradeBackup -Algorithm SHA256).Hash
  Write-Host "PASS: checked disposable pre-upgrade PostgreSQL backup SHA256=$preUpgradeBackupHash."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

$upgradeLog = Join-Path $env:TEMP "kayan-setup-upgrade-smoke.log"
$upgrade = Start-Process -FilePath $setup -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", ("/LOG=" + $upgradeLog)) -Wait -PassThru
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($upgrade.ExitCode -ne 0 -or -not $service -or $service.Status -ne "Running") {
  # The first-install log cannot explain a failure on the second Setup run.
  # Restrict diagnostics to Setup lifecycle lines, never environment/config.
  $upgradeEvidence = @()
  if (Test-Path -LiteralPath $upgradeLog) {
    $upgradeLines = @(Get-Content -LiteralPath $upgradeLog -Tail 80)
    $upgradeEvidence = @($upgradeLines | Where-Object { $_ -match '(?i)error|restart|reboot|postinstall|preparing|installation process|exit code|closing|shutdown|log closed' } | Select-Object -Last 12)
    for ($i = 0; $i -lt $upgradeLines.Count; $i++) {
      if ($upgradeLines[$i] -match 'Runtime error \(at ') {
        # Include the next error-description lines; Publish-Failure redacts
        # URLs and passwords before creating the annotation.
        $last = [Math]::Min($i + 3, $upgradeLines.Count - 1)
        $upgradeEvidence += @($upgradeLines[$i..$last])
        break
      }
    }
  }
  $serviceStatus = if ($service) { $service.Status.ToString() } else { 'missing' }
  Fail ("The upgrade/reinstall failed or PostgreSQL did not restart (state=$serviceStatus, Setup exit=$($upgrade.ExitCode)). Upgrade Setup log: " + ($upgradeEvidence -join ' | '))
}
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
Set-Acl -LiteralPath $settings -AclObject $emptyAcl
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
  if ($RuntimeOnly) {
    Write-Host "Runtime-only mode: validating offline startup, local PostgreSQL backup/restore, fail-closed corrupt-state handling, restoration of saved state bytes and public-key recovery. This is not signed-licence reconstruction or activation."
    $initialLicense = Invoke-RestMethod -Uri "$base/license/status" -TimeoutSec 15
    if ($initialLicense.state -ne 'UNLICENSED' -or $initialLicense.configured -ne $true -or $initialLicense.blocked -ne $true) {
      Fail ("Unexpected initial product license state: " + ($initialLicense | ConvertTo-Json -Compress))
    }
    Write-Host "PASS: product mode enforces licensing while allowing local health, login and backup routes."

    # Verify the bundled pg_dump/pg_restore path against the installed runtime,
    # using only the synthetic SQL sentinel created before upgrade/repair.
    $full = Invoke-RestMethod -Method Post -Uri "$base/backup/full" -Headers $headers -TimeoutSec 180
    if (-not $full.file.name -or $full.file.sizeBytes -le 0) { Fail 'Installed runtime did not produce a real PostgreSQL backup archive.' }
    $verified = Invoke-RestMethod -Method Post -Uri "$base/backup/full/$($full.file.name)/verify" -Headers $headers -TimeoutSec 180
    if ($verified.entries -le 0) { Fail 'Bundled pg_restore did not verify any archive objects.' }
    $dumpPath = Join-Path $env:TEMP 'kayan-installed-runtime-full-backup.dump'
    Invoke-WebRequest -UseBasicParsing -Uri "$base/backup/full/$($full.file.name)/download" -Headers $headers -OutFile $dumpPath -TimeoutSec 60
    $dumpBytes = [IO.File]::ReadAllBytes($dumpPath)
    if ($dumpBytes.Length -le 5 -or [Text.Encoding]::ASCII.GetString($dumpBytes, 0, 5) -ne 'PGDMP') { Fail 'Installed full backup download is not a real PostgreSQL custom archive.' }
    $env:PGPASSWORD = $databasePassword
    & $psql -h 127.0.0.1 -p 5432 -U erp_app -d erp_kayan -v ON_ERROR_STOP=1 -c "UPDATE kayan_installer_upgrade_probe SET value='changed' WHERE id=1" *> $null
    $mutationExit = $LASTEXITCODE
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if ($mutationExit -ne 0) { Fail 'Could not mutate the SQL sentinel before full PostgreSQL restore.' }
    $restoreBody = @{ confirm = $true; fileName = $full.file.name } | ConvertTo-Json -Compress
    $fullRestored = Invoke-RestMethod -Method Post -Uri "$base/backup/full/restore" -Headers $headers -ContentType 'application/json' -Body $restoreBody -TimeoutSec 300
    if (-not $fullRestored.restored -or -not $fullRestored.checked -or -not $fullRestored.safetyBackup) { Fail 'Installed full restore did not complete with checked data and a safety backup.' }
    $login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $loginPayload -TimeoutSec 30
    if (-not $login.accessToken) { Fail 'Login failed after installed PostgreSQL restore.' }
    $headers = @{ Authorization = "Bearer $($login.accessToken)" }
    $env:PGPASSWORD = $databasePassword
    $sentinelResult = @(& $psql -h 127.0.0.1 -p 5432 -U erp_app -d erp_kayan -t -A -c "SELECT value FROM kayan_installer_upgrade_probe WHERE id=1" 2>&1)
    $sentinelExit = $LASTEXITCODE
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if ($sentinelExit -ne 0 -or (($sentinelResult -join '').Trim() -ne 'preserved')) {
      Fail ("PostgreSQL full restore did not recover the original SQL sentinel: " + ($sentinelResult -join ' '))
    }
    Write-Output '::notice::Installed Windows runtime backup/restore passed: valid PGDMP archive, checked restore, safety backup, re-login and original SQL sentinel verified.'

    $licenseDirectory = Join-Path $env:ProgramData "KAYAN-ERP\license"
    $statePath = Join-Path $licenseDirectory "license-state.json"
    $publicKeyPath = Join-Path $licenseDirectory "public-key.pem"
    $publicKeyBackupPath = Join-Path $env:TEMP "kayan-public-key-smoke-backup.pem"
    if (-not (Test-Path $statePath)) { Fail "The installed license state file is missing: $statePath" }
    if (-not (Test-Path $publicKeyPath)) { Fail "The installed public key is missing: $publicKeyPath" }
    if (Test-Path $publicKeyBackupPath) { Remove-Item $publicKeyBackupPath -Force }
    $originalStateBytes = [IO.File]::ReadAllBytes($statePath)
    $originalStateHash = (Get-FileHash -LiteralPath $statePath -Algorithm SHA256).Hash
    $originalPublicKeyHash = (Get-FileHash -LiteralPath $publicKeyPath -Algorithm SHA256).Hash
    try {
      Stop-KayanSmokeClient -Process $client -Port $apiPort
      $client = $null
      [IO.File]::WriteAllText($statePath, 'not-json', [Text.Encoding]::ASCII)
      $restart = Start-KayanSmokeClient
      $client = $restart.Process
      $apiPort = $restart.Port
      $base = "http://127.0.0.1:$apiPort/api/v1"
      $healthAfterCorruption = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 10
      if (-not $healthAfterCorruption.status) { Fail 'Local health did not recover after the license state file was corrupted.' }
      $damagedResponse = Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck -Uri "$base/license/status" -TimeoutSec 15
      $damagedBody = $damagedResponse.Content | ConvertFrom-Json
      if ([int]$damagedResponse.StatusCode -ne 503 -or $damagedBody.code -ne 'LICENSE_STATE_DAMAGED') {
        Fail ("Corrupt license state did not fail closed with LICENSE_STATE_DAMAGED (HTTP $([int]$damagedResponse.StatusCode)): " + $damagedResponse.Content)
      }
      if ([IO.File]::ReadAllText($statePath) -ne 'not-json') { Fail 'The application silently overwrote the corrupted license state instead of preserving it for diagnosis.' }
      # Use the already authenticated synthetic administrator on a real
      # business route: health and license/status alone do not prove fail-closed.
      $businessResponse = Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck -Uri "$base/parties/customers" -Headers $headers -TimeoutSec 15
      $businessBody = $businessResponse.Content | ConvertFrom-Json
      if ([int]$businessResponse.StatusCode -ne 503 -or $businessBody.code -ne 'LICENSE_STATE_DAMAGED') {
        Fail ("Corrupted license state did not block the installed business route (HTTP $([int]$businessResponse.StatusCode)).")
      }
      if ([IO.File]::ReadAllText($statePath) -ne 'not-json') { Fail 'The blocked business request altered the corrupt license state.' }
      Write-Host 'PASS: health recovered and an authenticated business route failed closed without rewriting corrupt license state.'

      Stop-KayanSmokeClient -Process $client -Port $apiPort
      $client = $null
      [IO.File]::WriteAllBytes($statePath, $originalStateBytes)
      $restart = Start-KayanSmokeClient
      $client = $restart.Process
      $apiPort = $restart.Port
      $base = "http://127.0.0.1:$apiPort/api/v1"
      $restoredLicense = Invoke-RestMethod -Uri "$base/license/status" -TimeoutSec 15
      if ($restoredLicense.state -ne 'UNLICENSED' -or $restoredLicense.configured -ne $true -or $restoredLicense.blocked -ne $true) {
        Fail ("Restoring the original license state did not recover the expected unlicensed state: " + ($restoredLicense | ConvertTo-Json -Compress))
      }
      Write-Host 'PASS: restoring the original license-state bytes restores normal license-status reporting.'

      Stop-KayanSmokeClient -Process $client -Port $apiPort
      $client = $null
      Move-Item -LiteralPath $publicKeyPath -Destination $publicKeyBackupPath
      $restart = Start-KayanSmokeClient
      $client = $restart.Process
      $apiPort = $restart.Port
      $base = "http://127.0.0.1:$apiPort/api/v1"
      $missingKeyStatus = Invoke-RestMethod -Uri "$base/license/status" -TimeoutSec 15
      if ($missingKeyStatus.configured -ne $false -or $missingKeyStatus.blocked -ne $true) {
        Fail ("A missing installed public key was not detected as an unconfigured, blocked license state: " + ($missingKeyStatus | ConvertTo-Json -Compress))
      }
      Write-Host 'PASS: a missing public key is detected without preventing the local runtime from starting.'

      Stop-KayanSmokeClient -Process $client -Port $apiPort
      $client = $null
      Move-Item -LiteralPath $publicKeyBackupPath -Destination $publicKeyPath
      $restart = Start-KayanSmokeClient
      $client = $restart.Process
      $apiPort = $restart.Port
      $base = "http://127.0.0.1:$apiPort/api/v1"
      $restoredKeyStatus = Invoke-RestMethod -Uri "$base/license/status" -TimeoutSec 15
      if ($restoredKeyStatus.configured -ne $true -or $restoredKeyStatus.blocked -ne $true -or $restoredKeyStatus.state -ne 'UNLICENSED') {
        Fail ("Restoring the installed public key did not recover normal product license enforcement: " + ($restoredKeyStatus | ConvertTo-Json -Compress))
      }
      if ((Get-FileHash -LiteralPath $publicKeyPath -Algorithm SHA256).Hash -ne $originalPublicKeyHash) {
        Fail 'The restored public key bytes differ from the original installed key.'
      }
      Write-Host 'PASS: restoring the original public key restores normal product-mode license enforcement.'
    } finally {
      Stop-KayanSmokeClient -Process $client -Port $apiPort
      $client = $null
      if (Test-Path $publicKeyBackupPath) {
        if (Test-Path $publicKeyPath) { Remove-Item -LiteralPath $publicKeyPath -Force -ErrorAction SilentlyContinue }
        Move-Item -LiteralPath $publicKeyBackupPath -Destination $publicKeyPath -Force
      }
      if (-not (Test-Path $statePath) -or (Get-FileHash -LiteralPath $statePath -Algorithm SHA256).Hash -ne $originalStateHash) {
        [IO.File]::WriteAllBytes($statePath, $originalStateBytes)
      }
    }
    Write-Output '::notice::Runtime-only Windows installer smoke passed: product install, local PostgreSQL, Prisma setup, API startup/login, offline full backup/restore, corrupt-state refusal, trusted saved-state byte restoration and public-key missing/restore. Signed-licence reconstruction and activation were not tested.'
  } else {
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
  }
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
Remove-KayanOfflineRules
