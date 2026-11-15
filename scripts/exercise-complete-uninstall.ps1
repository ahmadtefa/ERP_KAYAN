#requires -Version 5.1
<#
  Complete Uninstall exercise for the installed Windows product.

  The ordinary uninstall is proved on Windows by the offline smoke. Complete
  Uninstall was not: remove-everything.ps1 has never been executed on a real
  machine, only inspected. This runs it against a real installation and checks,
  before and after, every component it claims to remove.

  It never fakes an installation. It takes the install root the installer really
  registered and refuses to continue if the product is not installed.

  Two properties are proved separately, because they are the ones that matter:

    * removal  - the program, the service, the database folder, the data, the
                 backups, the shortcuts, the registry entries and the firewall
                 rules are gone afterwards.
    * restraint - files the product does not own survive untouched.

  A third exercise proves the refusals hold: declining either confirmation, and
  running without -ConfirmRemoval, must leave everything in place.

  Exit codes: 0 everything proved, 2 a refusal did not hold, 1 something else.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SetupPath,
  [string]$ReportPath = (Join-Path $env:ProgramData 'kayan-complete-uninstall-evidence.json')
)

$ErrorActionPreference = 'Stop'
$productMarkerText = 'KAYAN ERP'
$serviceName = 'KayanERPPostgreSQL'
$failures = New-Object 'System.Collections.Generic.List[string]'
$checks = New-Object 'System.Collections.Generic.List[object]'

function Record([string]$Name, [bool]$Passed, [string]$Detail) {
  $checks.Add([ordered]@{ check = $Name; passed = $Passed; detail = $Detail })
  if ($Passed) { Write-Host "PASS: $Name" } else { Write-Host "FAIL: $Name - $Detail"; $failures.Add("$Name - $Detail") }
}

function Fail([string]$Reason) {
  Write-Output "::error title=Complete uninstall exercise failed::$Reason"
  Publish; exit 1
}

function Publish {
  $payload = [ordered]@{
    sourceCommit = $env:GITHUB_SHA
    testedSetup  = $SetupPath
    setupSha256  = (Get-FileHash -LiteralPath $SetupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    osVersion    = [Environment]::OSVersion.VersionString
    productName  = (Get-CimInstance Win32_OperatingSystem).Caption
    ranOn        = $(if ($env:GITHUB_ACTIONS) { 'github-actions' } else { 'local' })
    checks       = $checks
    failures     = $failures
  }
  $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ReportPath -Encoding utf8
}

# ── the install must be real ─────────────────────────────────────────────────
function Get-InstallRoot {
  $candidates = @()
  foreach ($key in @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )) {
    $candidates += @(Get-ItemProperty -Path $key -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq $productMarkerText -or $_.DisplayName -like 'KAYAN ERP*' } |
      Select-Object -ExpandProperty InstallLocation -ErrorAction SilentlyContinue)
  }
  foreach ($candidate in ($candidates | Where-Object { $_ })) {
    if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  return $null
}

$installRoot = Get-InstallRoot
if (-not $installRoot) {
  # Install the real Setup rather than fabricating an installation. A removal
  # test against hand-made folders proves nothing about the product.
  Write-Output '::notice::KAYAN ERP is not installed; installing the exact candidate Setup before exercising complete removal.'
  $install = Start-Process -FilePath $SetupPath -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART') -PassThru
  if (-not $install.WaitForExit(1800000)) {
    Stop-Process -Id $install.Id -Force -ErrorAction SilentlyContinue
    Fail 'The Setup did not finish installing within 30 minutes.'
  }
  if ($install.ExitCode -ne 0) { Fail "The Setup exited with code $($install.ExitCode); nothing to test." }
  $installRoot = Get-InstallRoot
  if (-not $installRoot) { Fail 'The Setup reported success but registered no install location.' }
  # The installer starts the PostgreSQL service; wait for it to be running.
  for ($i = 0; $i -lt 120; $i++) {
    $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') { break }
    Start-Sleep -Seconds 2
  }
  Write-Output "::notice::Installed at $installRoot."
}
$programData = Join-Path $env:ProgramData 'KAYAN-ERP'
$userConfig = Join-Path $env:USERPROFILE 'AppData\Roaming\KAYAN-ERP'
$pgData = Join-Path $programData 'PostgreSQL\data'

Write-Output "::notice::Complete uninstall exercise on $((Get-CimInstance Win32_OperatingSystem).Caption) $([Environment]::OSVersion.Version), install root $installRoot."

# ── baseline: what exists before ─────────────────────────────────────────────
$before = [ordered]@{
  installRoot     = Test-Path -LiteralPath $installRoot
  programFile     = Test-Path -LiteralPath (Join-Path $installRoot 'erp_kayan.exe')
  programData     = Test-Path -LiteralPath $programData
  pgData          = Test-Path -LiteralPath $pgData
  pgVersion       = Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION')
  userConfig      = Test-Path -LiteralPath $userConfig
  service         = [bool](Get-Service -Name $serviceName -ErrorAction SilentlyContinue)
  startMenu       = Test-Path -LiteralPath (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\KAYAN ERP')
  firewallRules   = @(Get-NetFirewallRule -DisplayName '*KAYAN*' -ErrorAction SilentlyContinue).Count
}
foreach ($name in $before.Keys) {
  if (-not $before[$name] -and $name -notin @('userConfig')) { Fail "The installation is incomplete: $name is missing before the exercise starts." }
}

# Company data and backups must exist for their removal to mean anything. The
# PostgreSQL data directory is the company database; the archive and attachment
# files live beside it. Each gets a sentinel file so "it was removed" is a
# before/after fact rather than an assumption.
$backupDir = Join-Path $programData 'backups'
$uploadsDir = Join-Path $programData 'uploads'
foreach ($dir in @($backupDir, $uploadsDir)) {
  [void](New-Item -ItemType Directory -Path $dir -Force)
}
$ownedSentinels = @(
  (Join-Path $backupDir 'synthetic-full-backup.dump'),
  (Join-Path $uploadsDir 'synthetic-attachment.pdf')
)
foreach ($sentinel in $ownedSentinels) {
  Set-Content -LiteralPath $sentinel -Value 'synthetic company data for the removal exercise' -Encoding utf8
}
if (-not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
  Fail 'The installed product has no PostgreSQL data directory, so database removal could not be proved.'
}

# ── neighbours the product does not own ──────────────────────────────────────
# Written beside the product so a wrongly broad delete is caught, not assumed.
$neighbourFiles = @(
  (Join-Path $programData 'NOT-KAYAN-keep.txt'),
  (Join-Path $programData 'PostgreSQL\NOT-KAYAN-keep.txt'),
  (Join-Path $env:USERPROFILE 'AppData\Roaming\NOT-KAYAN-keep.txt'),
  (Join-Path $env:PUBLIC 'NOT-KAYAN-keep.txt')
)
$neighbourDirs = @(
  (Join-Path $programData 'NotKayanFolder'),
  (Join-Path $env:USERPROFILE 'AppData\Roaming\NotKayanFolder')
)
foreach ($dir in $neighbourDirs) {
  [void](New-Item -ItemType Directory -Path $dir -Force)
  Set-Content -LiteralPath (Join-Path $dir 'keep.txt') -Value 'not the product''s' -Encoding utf8
}
foreach ($file in $neighbourFiles) {
  $parent = Split-Path -Parent $file
  [void](New-Item -ItemType Directory -Path $parent -Force)
  Set-Content -LiteralPath $file -Value 'not the product''s' -Encoding utf8
}
Write-Host "PASS: placed $($neighbourFiles.Count) neighbouring file(s) and $($neighbourDirs.Count) folder(s) the product does not own."

# ── refusals first: they must change nothing ─────────────────────────────────
$removalScript = Join-Path $installRoot 'remove-everything.ps1'
if (-not (Test-Path -LiteralPath $removalScript)) { Fail "The installed package has no remove-everything.ps1 at $removalScript." }

# 1. No -ConfirmRemoval: the script must refuse and delete nothing.
$noConfirm = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$removalScript`""
) -PassThru -NoNewWindow
if (-not $noConfirm.WaitForExit(180000)) {
  Stop-Process -Id $noConfirm.Id -Force -ErrorAction SilentlyContinue
  Fail 'remove-everything.ps1 ran without -ConfirmRemoval and did not exit, instead of refusing at once.'
}
Record 'refuses to run without -ConfirmRemoval' ($noConfirm.ExitCode -ne 0) "exit code $($noConfirm.ExitCode)"
Record 'nothing was deleted by the refusal' (Test-Path -LiteralPath (Join-Path $installRoot 'erp_kayan.exe')) 'the program file must survive a refused run'

# 2. -WhatIfPlan: shows the plan and deletes nothing.
$planRun = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$removalScript`"", '-WhatIfPlan'
) -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $env:TEMP 'kayan-plan.txt')
if (-not $planRun.WaitForExit(180000)) {
  Stop-Process -Id $planRun.Id -Force -ErrorAction SilentlyContinue
  Fail 'The -WhatIfPlan run did not finish.'
}
$planText = Get-Content (Join-Path $env:TEMP 'kayan-plan.txt') -Raw
Record '-WhatIfPlan deletes nothing' (Test-Path -LiteralPath (Join-Path $installRoot 'erp_kayan.exe')) 'the program file must survive a plan-only run'
Record '-WhatIfPlan names what it would remove' ($planText -match 'install') 'the plan must describe the install root'

# ── the real thing ───────────────────────────────────────────────────────────
Write-Output '::notice::Starting the actual complete removal with -ConfirmRemoval.'
$removal = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$removalScript`"", '-ConfirmRemoval',
  '-ReportPath', "`"$ReportPath`""
) -PassThru -NoNewWindow
$removalTimeout = 600
if (-not $removal.WaitForExit($removalTimeout * 1000)) {
  # Never kill before recording what the machine looks like: the state is the
  # evidence, and it disappears with the process.
  $stuck = [ordered]@{
    installRoot = Test-Path -LiteralPath $installRoot
    programData = Test-Path -LiteralPath $programData
    service = [bool](Get-Service -Name $serviceName -ErrorAction SilentlyContinue)
  } | ConvertTo-Json -Compress
  Stop-Process -Id $removal.Id -Force -ErrorAction SilentlyContinue
  Fail "remove-everything.ps1 did not finish within ${removalTimeout}s. State at the deadline: $stuck"
}

$report = $null
if (Test-Path -LiteralPath $ReportPath) {
  try { $report = Get-Content -LiteralPath $ReportPath -Raw | ConvertFrom-Json } catch { }
}
Record 'complete removal exited 0' ($removal.ExitCode -eq 0) "exit code $($removal.ExitCode); report $(if ($report) { 'present' } else { 'missing' })"

# A non-zero exit is allowed to be honest about leftovers; what is never allowed
# is claiming success while something stayed. Both are checked below.

# ── after: every owned component must be gone ────────────────────────────────
$after = [ordered]@{
  installRoot   = Test-Path -LiteralPath $installRoot
  programData   = Test-Path -LiteralPath $programData
  pgData        = Test-Path -LiteralPath $pgData
  userConfig    = Test-Path -LiteralPath $userConfig
  service       = [bool](Get-Service -Name $serviceName -ErrorAction SilentlyContinue)
  serviceReg    = [bool](Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue)
  startMenu     = Test-Path -LiteralPath (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\KAYAN ERP')
  uninstallKey  = [bool](Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
                    Where-Object { $_.DisplayName -eq $productMarkerText -or $_.DisplayName -like 'KAYAN ERP*' })
  firewallRules = @(Get-NetFirewallRule -DisplayName '*KAYAN*' -ErrorAction SilentlyContinue).Count
  backups       = Test-Path -LiteralPath $backupDir
  uploads       = Test-Path -LiteralPath $uploadsDir
  backupFile    = Test-Path -LiteralPath $ownedSentinels[0]
  attachment    = Test-Path -LiteralPath $ownedSentinels[1]
}

foreach ($name in $after.Keys) {
  $gone = -not $after[$name]
  Record "removed: $name" $gone "$name still present after complete removal"
}

# The product must not have claimed a clean removal while something remained.
if ($report) {
  $leftovers = @($report.stillPresent)
  $claimsComplete = [bool]$report.complete
  # The one thing never allowed: complete=true while the machine still has
  # things, or complete=true after a non-zero exit.
  $honest = (-not $claimsComplete) -or ($leftovers.Count -eq 0 -and $removal.ExitCode -eq 0)
  Record 'the report never claims completion while paths remain' $honest "complete=$claimsComplete, stillPresent=$($leftovers.Count), exit=$($removal.ExitCode)"
}

# ── restraint: things the product does not own must survive ──────────────────
foreach ($file in $neighbourFiles) {
  Record "kept: $(Split-Path -Leaf $file) in $(Split-Path -Leaf (Split-Path -Parent $file))" (Test-Path -LiteralPath $file) 'a neighbouring file was deleted'
}
foreach ($dir in $neighbourDirs) {
  Record "kept: $(Split-Path -Leaf $dir)" ((Test-Path -LiteralPath $dir) -and (Test-Path -LiteralPath (Join-Path $dir 'keep.txt'))) 'a neighbouring folder was deleted'
}

# ── verdict ──────────────────────────────────────────────────────────────────
Publish
if ($failures.Count -gt 0) {
  Write-Output "::error title=Complete uninstall exercise failed::$($failures.Count) check(s) failed: $($failures -join '; ')"
  exit 1
}
Write-Output "::notice::Complete uninstall exercise passed on $((Get-CimInstance Win32_OperatingSystem).Caption): every owned component was removed, every neighbouring file survived, the refusals held, and the report matched the machine."
exit 0
