# Installs the built Setup on a disposable Windows runner and proves the
# installed copy itself: a real licence minted with an ephemeral key pair, the
# whole warehouse cycle, an application backup, and a restore of that backup
# into a clean database that is then exercised again.
#
# This is deliberately NOT the runtime-only smoke. The runtime smoke proves the
# installer installs, upgrades and repairs without a licence. This script proves
# the installed program refuses business work until it is licensed, accepts a
# correctly signed activation for this machine, refuses a key signed for another
# machine and a tampered one, and then performs every warehouse operation.
#
# The private key never leaves the runner: the Setup was built with the matching
# public key in the same job, the key directory is under RUNNER_TEMP, and only
# the JSON proof reports and the logs are uploaded.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SetupPath,
  [string]$ExpectedSourceCommit = "",
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'The installed-copy proof requires a fresh GitHub-hosted Windows VM.'
}
if (-not $env:KAYAN_GENERATOR_HOME) {
  throw 'KAYAN_GENERATOR_HOME (the ephemeral key directory used to sign this build) is required.'
}
$existingData = Join-Path $env:ProgramData 'KAYAN-ERP'
$existingInstall = Join-Path $env:ProgramFiles 'KAYAN ERP'
if ((Test-Path -LiteralPath $existingData) -or (Test-Path -LiteralPath $existingInstall) -or
    (Get-Service -Name 'KayanERPPostgreSQL' -ErrorAction SilentlyContinue)) {
  throw 'Refusing to run: an existing KAYAN installation, service or data directory was found.'
}
foreach ($port in @(5432, 3000, 3001, 3002, 3003, 3010, 3020, 3100)) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Refusing to run: port $port is already in use."
  }
}
if ($ExpectedSourceCommit -notmatch '^[0-9a-f]{40}$' -or $env:GITHUB_SHA -ne $ExpectedSourceCommit) {
  throw 'The expected source SHA must match this workflow run.'
}

if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
$installRoot = Join-Path $env:ProgramFiles 'KAYAN ERP'
$backend = Join-Path $installRoot 'backend'
$node = Join-Path $backend 'node\node.exe'
$clientPath = Join-Path $installRoot 'erp_kayan.exe'
$pgBin = Join-Path $backend 'postgres\bin'
$psql = Join-Path $pgBin 'psql.exe'
$pgRestore = Join-Path $pgBin 'pg_restore.exe'
$settings = Join-Path $env:ProgramData 'KAYAN-ERP\kayan.env'
$serviceName = 'KayanERPPostgreSQL'
$reportRoot = Join-Path $env:RUNNER_TEMP 'installed-e2e'
New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null

$adminUsername = 'ci-admin'
$adminPassword = 'CiInstalled-Admin-Password-7241'
$phase = 'start'
$clientProcess = $null
$apiPort = $null
$appBackupPath = $null

function Fail([string]$Text) {
  Write-Output ("::error title=Installed proof failed ($phase)::" + ($Text -replace "`r?`n", ' | '))
  throw $Text
}
function Say([string]$Text) {
  Write-Output ("::notice title=Installed proof phase::" + $Text)
  Write-Host $Text
}

function Get-KayanHealth([int]$Port, [int]$TimeoutSec = 3) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec $TimeoutSec
    return @{ Status = [int]$response.StatusCode; Body = $response.Content }
  } catch {
    $failure = $_.Exception
    if ($failure.Response) { return @{ Status = [int]$failure.Response.StatusCode; Body = '' } }
    return @{ Status = 0; Body = '' }
  }
}

function Find-KayanPort {
  foreach ($candidate in @(3000, 3001, 3002, 3003, 3010, 3020)) {
    $probe = Get-KayanHealth $candidate 2
    if ($probe.Status -eq 200) {
      $health = $probe.Body | ConvertFrom-Json
      if ($health.status -eq 'ok' -and $health.database -eq 'up') { return $candidate }
    }
  }
  return 0
}

function Stop-KayanProcesses {
  Get-Process -Name erp_kayan -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)) {
    if ($process.CommandLine -and $process.CommandLine -match '(?i)dist[\\/]+src[\\/]+main\.js') {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 3
}

try {
  # ── install ────────────────────────────────────────────────────────────────
  $phase = 'install'
  Say 'Installing the built Setup silently on a disposable runner.'
  $installLog = Join-Path $env:TEMP 'kayan-installed-e2e-setup.log'
  $install = Start-Process -FilePath $setup -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/LOG=' + $installLog)) -Wait -PassThru
  if ($install.ExitCode -ne 0) { Fail "Setup.exe exited with $($install.ExitCode). See $installLog" }
  Get-Process -Name erp_kayan -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  foreach ($relative in @('backend\node\node.exe', 'backend\dist\src\main.js', 'backend\scripts\prepare-database.mjs',
      'backend\postgres\bin\psql.exe', 'backend\postgres\bin\pg_restore.exe', 'erp_kayan.exe', 'runtime-manifest.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $installRoot $relative))) { Fail "The installed package is missing $relative." }
  }
  $manifest = Get-Content -LiteralPath (Join-Path $installRoot 'runtime-manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.sourceCommit -ne $env:GITHUB_SHA) {
    Fail "The installed payload was built from $($manifest.sourceCommit), not from $($env:GITHUB_SHA)."
  }
  Say ("Installed payload: version " + $manifest.productVersion + ", Node " + $manifest.nodeVersion + ", PostgreSQL " + $manifest.postgresqlVersion + ", commit " + $manifest.sourceCommit)
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $service -or $service.Status -ne 'Running') { Fail 'The bundled PostgreSQL service is not running after install.' }

  # ── the installed configuration ────────────────────────────────────────────
  $phase = 'configure'
  if (-not (Test-Path -LiteralPath $settings)) { Fail "The installer did not create $settings." }
  $envValues = @{}
  Get-Content -LiteralPath $settings | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)="?(.*?)"?\s*$') { $envValues[$matches[1]] = $matches[2].Trim('"') }
  }
  foreach ($entry in $envValues.GetEnumerator()) { Set-Item -Path ('Env:' + $entry.Key) -Value $entry.Value }
  $databaseUrl = $envValues['DATABASE_URL']
  $adminDatabaseUrl = $envValues['ADMIN_DATABASE_URL']
  if (-not $databaseUrl -or -not $adminDatabaseUrl) { Fail 'kayan.env does not carry the database URLs the program uses.' }

  Say 'Preparing the bundled database with the program''s own preparation script.'
  $prepOut = Join-Path $reportRoot 'prepare-database.log'
  $prepare = Start-Process -FilePath $node -ArgumentList @('scripts\prepare-database.mjs') -WorkingDirectory $backend -Wait -PassThru -NoNewWindow -RedirectStandardOutput $prepOut -RedirectStandardError "$prepOut.err"
  if ($prepare.ExitCode -ne 0) { Fail ("prepare-database.mjs failed. " + (Get-Content $prepOut -Raw) + (Get-Content "$prepOut.err" -Raw)) }

  $env:KAYAN_ADMIN_USERNAME = $adminUsername
  $env:KAYAN_ADMIN_PASSWORD = $adminPassword
  $seed = Start-Process -FilePath $node -ArgumentList @('scripts\prepare-database.mjs') -WorkingDirectory $backend -Wait -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $reportRoot 'seed.log') -RedirectStandardError (Join-Path $reportRoot 'seed.log.err')
  if ($seed.ExitCode -ne 0) { Fail 'The first administrator could not be created on the installed copy.' }
  Remove-Item Env:KAYAN_ADMIN_USERNAME, Env:KAYAN_ADMIN_PASSWORD -ErrorAction SilentlyContinue

  # ── start the installed program ────────────────────────────────────────────
  $phase = 'start'
  Say 'Starting the installed erp_kayan.exe and waiting for its own local server.'
  $clientProcess = Start-Process -FilePath $clientPath -WorkingDirectory $installRoot -PassThru
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if ($clientProcess.HasExited) { Fail "The installed client exited with code $($clientProcess.ExitCode) before its server became healthy." }
    $apiPort = Find-KayanPort
    if ($apiPort -gt 0) { break }
    Start-Sleep -Seconds 1
  }
  if (-not $apiPort) { Fail 'The installed program did not start a healthy local server within 120 seconds.' }
  $api = "http://127.0.0.1:$apiPort/api/v1"
  Say "The installed program's own server is healthy on port $apiPort."

  $backendNode = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
      $_.CommandLine -and $_.CommandLine -match '(?i)dist[\\/]+src[\\/]+main\.js'
    })
  if ($backendNode.Count -lt 1) { Fail 'The healthy server is not the bundled backend process.' }

  # ── licence + the warehouse cycle, through the installed program ───────────
  $phase = 'licence-and-warehouse'
  Say 'Proving the licence and the warehouse cycle against the installed program.'
  $proofScript = Join-Path $RepoRoot 'scripts\prove-installed-warehouse-and-licence.mjs'
  if (-not (Test-Path -LiteralPath $proofScript)) { Fail "The proof script is missing at $proofScript." }
  $proofReport = Join-Path $reportRoot 'installed-licence-warehouse-proof.json'
  $proofLog = Join-Path $reportRoot 'installed-licence-warehouse-proof.log'
  $env:KAYAN_API = $api
  $env:KAYAN_ADMIN_USERNAME = $adminUsername
  $env:KAYAN_ADMIN_PASSWORD = $adminPassword
  $env:KAYAN_GENERATOR = Join-Path $RepoRoot 'tools\license-generator\kayan-license.mjs'
  $env:KAYAN_PROOF_REPORT = $proofReport
  $proof = Start-Process -FilePath $node -ArgumentList @(('"' + $proofScript + '"')) -WorkingDirectory $RepoRoot -Wait -PassThru -NoNewWindow -RedirectStandardOutput $proofLog -RedirectStandardError "$proofLog.err"
  $proofText = (Get-Content -LiteralPath $proofLog -Raw -ErrorAction SilentlyContinue)
  foreach ($line in @(Get-Content -LiteralPath $proofLog -ErrorAction SilentlyContinue | Where-Object { $_ -match '^(FAIL|Proof aborted)' })) {
    Write-Output ("::warning title=Installed proof failure::" + ($line -replace '`r?`n', ' | '))
  }
  Write-Host ($proofText + (Get-Content -LiteralPath "$proofLog.err" -Raw -ErrorAction SilentlyContinue))
  if ($proof.ExitCode -ne 0) { Fail "The licence and warehouse proof failed with exit code $($proof.ExitCode)." }
  if (-not (Test-Path -LiteralPath $proofReport)) { Fail 'The licence and warehouse proof wrote no report.' }
  $proofSummary = Get-Content -LiteralPath $proofReport -Raw | ConvertFrom-Json
  Say ("Licence and warehouse proof: " + $proofSummary.pass + " passed, " + $proofSummary.fail + " failed.")

  # ── the licence survives a restart of the installed program ────────────────
  $phase = 'restart'
  Say 'Restarting the installed program and checking the licence is still the same one.'
  $before = Invoke-RestMethod -Uri "$api/license/status" -TimeoutSec 10
  Stop-KayanProcesses
  $clientProcess = Start-Process -FilePath $clientPath -WorkingDirectory $installRoot -PassThru
  $apiPort = 0
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if ($clientProcess.HasExited) { Fail "The installed client exited with code $($clientProcess.ExitCode) after the restart." }
    $apiPort = Find-KayanPort
    if ($apiPort -gt 0) { break }
    Start-Sleep -Seconds 1
  }
  if (-not $apiPort) { Fail 'The installed program did not come back after the restart.' }
  $api = "http://127.0.0.1:$apiPort/api/v1"
  $after = Invoke-RestMethod -Uri "$api/license/status" -TimeoutSec 10
  if ($after.state -ne 'ACTIVE') { Fail "The licence is not ACTIVE after a restart (state $($after.state))." }
  if ($before.licenceId -and $after.licenceId -and $before.licenceId -ne $after.licenceId) {
    Fail "The licence changed across a restart ($($before.licenceId) -> $($after.licenceId))."
  }
  Say ("The licence is still ACTIVE after a restart (state " + $after.state + ").")

  # ── the application's own backup ───────────────────────────────────────────
  $phase = 'backup'
  $backupDirectory = Join-Path $env:ProgramData 'KAYAN-ERP\backups'
  $appBackup = Get-ChildItem -LiteralPath $backupDirectory -Filter *.dump -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $appBackup) { Fail "The application wrote no backup into $backupDirectory." }
  $appBackupPath = $appBackup.FullName
  $backupHash = (Get-FileHash -LiteralPath $appBackupPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Say ("The application's own backup: " + $appBackup.Name + " (" + $appBackup.Length + " bytes, SHA256 " + $backupHash + ")")
  & $pgRestore --list $appBackupPath *> (Join-Path $reportRoot 'pg-restore-list.log')
  if ($LASTEXITCODE -ne 0) { Fail 'The application backup cannot be read by the installed pg_restore.' }

  # ── restore it into a clean database and exercise that copy ────────────────
  $phase = 'restore'
  Say 'Restoring the application backup into a clean database and re-exercising it.'
  Stop-KayanProcesses
  $restoreScript = Join-Path $RepoRoot 'scripts\prove-restored-copy.mjs'
  if (-not (Test-Path -LiteralPath $restoreScript)) { Fail "The restore proof is missing at $restoreScript." }
  $restoreReport = Join-Path $reportRoot 'restored-copy-proof.json'
  $restoreLog = Join-Path $reportRoot 'restored-copy-proof.log'
  $env:KAYAN_DUMP_PATH = $appBackupPath
  $env:KAYAN_PG_BIN = $pgBin
  $env:ADMIN_DATABASE_URL = $adminDatabaseUrl
  $env:DATABASE_URL = $databaseUrl
  $env:KAYAN_NODE = $node
  $env:KAYAN_API_MAIN = (Join-Path $backend 'dist\src\main.js')
  $env:KAYAN_BACKEND_DIR = $backend
  $env:KAYAN_RESTORE_DB = 'erp_kayan_restored'
  $env:KAYAN_CLIENT_EXE = $clientPath
  $env:KAYAN_SETTINGS_PATH = $settings
  $env:KAYAN_HEALTH_PORTS = '3000,3001,3002,3003,3010,3020'
  $env:KAYAN_RESTORED_API_PORT = '3001'
  $env:KAYAN_ADMIN_USERNAME = $adminUsername
  $env:KAYAN_ADMIN_PASSWORD = $adminPassword
  $env:KAYAN_RESTORE_REPORT = $restoreReport
  $restore = Start-Process -FilePath $node -ArgumentList @(('"' + $restoreScript + '"')) -WorkingDirectory $RepoRoot -Wait -PassThru -NoNewWindow -RedirectStandardOutput $restoreLog -RedirectStandardError "$restoreLog.err"
  Write-Host ((Get-Content -LiteralPath $restoreLog -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath "$restoreLog.err" -Raw -ErrorAction SilentlyContinue))
  if ($restore.ExitCode -ne 0) { Fail "The restored-copy proof failed with exit code $($restore.ExitCode)." }
  if (-not (Test-Path -LiteralPath $restoreReport)) { Fail 'The restored-copy proof wrote no report.' }
  $restoreSummary = Get-Content -LiteralPath $restoreReport -Raw | ConvertFrom-Json
  Say ("Restored-copy proof: " + $restoreSummary.pass + " passed, " + $restoreSummary.fail + " failed.")

  $summary = [ordered]@{
    sourceCommit      = $env:GITHUB_SHA
    installer         = [ordered]@{ path = $setup; sha256 = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = (Get-Item -LiteralPath $setup).Length }
    apiPort           = $apiPort
    licenceWarehouse  = [ordered]@{ pass = $proofSummary.pass; fail = $proofSummary.fail; report = 'installed-licence-warehouse-proof.json' }
    applicationBackup = [ordered]@{ name = $appBackup.Name; bytes = $appBackup.Length; sha256 = $backupHash }
    restoredCopy      = [ordered]@{ pass = $restoreSummary.pass; fail = $restoreSummary.fail; report = 'restored-copy-proof.json' }
    licenceAfterRestart = $after.state
    result            = 'installed-copy-proof-passed'
  }
  $summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $reportRoot 'installed-e2e.json') -Encoding utf8
  Say 'The installed copy passed: licence, warehouse cycle, application backup, restore into a clean database, and a restart.'
} catch {
  $message = $_.Exception.Message
  Write-Output ("::error title=Installed proof failed ($phase)::" + (($message -replace "`r?`n", ' | ') -replace '%', '%25'))
  if ($proofLog -and (Test-Path -LiteralPath $proofLog)) { Get-Content -LiteralPath $proofLog -Tail 60 | ForEach-Object { Write-Host $_ } }
  if ($restoreLog -and (Test-Path -LiteralPath $restoreLog)) { Get-Content -LiteralPath $restoreLog -Tail 60 | ForEach-Object { Write-Host $_ } }
  if ($installLog -and (Test-Path -LiteralPath $installLog)) {
    Get-Content -LiteralPath $installLog -Tail 40 | Where-Object { $_ -match '(?i)error|failed|Runtime error' } | ForEach-Object { Write-Host $_ }
  }
  [ordered]@{ sourceCommit = $env:GITHUB_SHA; phase = $phase; error = $message; result = 'installed-copy-proof-failed' } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $reportRoot 'installed-e2e.json') -Encoding utf8
  exit 1
} finally {
  if ($clientProcess -and -not $clientProcess.HasExited) { Stop-Process -Id $clientProcess.Id -Force -ErrorAction SilentlyContinue }
  Stop-KayanProcesses
  Say "Reports are in $reportRoot"
}
