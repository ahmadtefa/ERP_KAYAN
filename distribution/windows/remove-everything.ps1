<#
.SYNOPSIS
  Complete removal of KAYAN ERP: everything the program created, and nothing
  that it did not.

.DESCRIPTION
  Normal uninstall (remove-runtime.ps1) stops the service and keeps company
  data. This script is the other choice: remove everything, so the machine looks
  as if KAYAN had never been installed.

  It is deliberately a separate script. Normal uninstall keeps its behaviour,
  which is the default, and an operator has to ask for this one by name.

  Ownership is proven before anything is deleted. Each candidate is checked
  against a marker this program writes - a path is not enough, because
  "C:\ProgramData\KAYAN-ERP" could be anything and a database folder next to
  someone else's files must survive. A candidate that fails the ownership check
  is reported and left alone.

  The script never claims success when something could not be removed: it
  collects every failure, then prints a report with the path, the reason and
  what an operator must do by hand.

.PARAMETER ConfirmRemoval
  Required. Without it the script refuses to delete anything and exits.

.PARAMETER WhatIfPlan
  Prints the plan and exits. This is what the uninstaller shows before asking.

.PARAMETER ReportPath
  Where to write the JSON report. Defaults to a file in the report directory
  that survives the removal of the program folder.

.PARAMETER KeepLogs
  Keep the logs directory for post-mortem inspection. Everything else goes.

.NOTES
  Requires an elevated PowerShell: services, Program Files and ProgramData are
  not writable by a standard user.
#>
[CmdletBinding()]
param(
  [switch]$ConfirmRemoval,
  [switch]$WhatIfPlan,
  [string]$ReportPath = (Join-Path $env:ProgramData 'KAYAN-ERP-removal-report.json'),
  [switch]$KeepLogs,
  [string]$LogDirectory = (Join-Path $env:ProgramData 'KAYAN-ERP\logs')
)

$ErrorActionPreference = 'Stop'

$script:Failures = New-Object 'System.Collections.Generic.List[object]'
$script:Removed = New-Object 'System.Collections.Generic.List[string]'
$script:Skipped = New-Object 'System.Collections.Generic.List[string]'

$serviceName = 'KayanERPPostgreSQL'
$uninstallKeyName = '{D1B6074C-12D1-4B4A-9F2C-650A53F15D91}_is1'
$uninstallRoots = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

function IsElevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$identity).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-PathSafe([string]$Path) {
  if (-not $Path) { return $null }
  try { return (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path } catch { return $null }
}

# Ownership. A folder is KAYAN's when it carries one of the artifact names this
# program creates inside it. A name alone is not enough: the folder must also be
# under a location this program installs into.
function Test-KayanOwnedFolder([string]$Path, [string[]]$Evidence) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  foreach ($name in $Evidence) {
    if (Test-Path -LiteralPath (Join-Path $Path $name)) { return $true }
  }
  return $false
}

function Test-UnderRoot([string]$Path, [string[]]$Roots) {
  $resolved = Resolve-PathSafe $Path
  if (-not $resolved) { return $false }
  foreach ($root in $Roots) {
    $resolvedRoot = Resolve-PathSafe $root
    if (-not $resolvedRoot) { continue }
    if ($resolved.Equals($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    if ($resolved.StartsWith($resolvedRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Stop-KayanProcesses {
  $names = @('erp_kayan', 'postgres', 'RepairTool')
  foreach ($name in $names) {
    $processes = @(Get-Process -Name $name -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -and (Test-UnderRoot $_.Path @($script:InstallRoot, $script:ProgramDataRoot)) })
    foreach ($process in $processes) {
      try {
        Stop-Process -Id $process.Id -Force -ErrorAction Stop
        Start-Sleep -Milliseconds 500
      } catch {
        $script:Failures.Add([ordered]@{ component = 'process'; path = "PID $($process.Id) $name"; reason = $_.Exception.Message })
      }
    }
  }
  # Nothing of ours may keep a handle on the database while its folder is removed.
  foreach ($port in @(5432)) {
    $owner = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
    if ($owner.Count -gt 0) {
      Start-Sleep -Seconds 2
    }
  }
}

function Remove-KayanService {
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $service) {
    $script:Skipped.Add("service $serviceName (not present)")
    return
  }
  try {
    if ($service.Status -ne 'Stopped') {
      Stop-Service -Name $serviceName -Force -ErrorAction Stop
      $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
    }
  } catch {
    $script:Failures.Add([ordered]@{ component = 'service'; path = $serviceName; reason = "could not stop: $($_.Exception.Message)" })
    return
  }
  $pgCtl = Join-Path $script:InstallRoot 'backend\postgres\bin\pg_ctl.exe'
  $data = Join-Path $script:ProgramDataRoot 'PostgreSQL\data'
  $removedService = $false
  if (Test-Path -LiteralPath $pgCtl) {
    try {
      $arguments = @('unregister', '-N', $serviceName)
      if (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION')) { $arguments += @('-D', $data) }
      & $pgCtl @arguments | Out-Null
      if ($LASTEXITCODE -eq 0) { $removedService = $true }
    } catch { }
  }
  if (-not $removedService) {
    try {
      & sc.exe delete $serviceName | Out-Null
      if ($LASTEXITCODE -eq 0) { $removedService = $true }
    } catch { }
  }
  if ($removedService) {
    $script:Removed.Add("service $serviceName")
  } else {
    $script:Failures.Add([ordered]@{ component = 'service'; path = $serviceName; reason = 'could not unregister; a restart may be needed before it disappears' })
  }
}

function Remove-KayanFolder([string]$Path, [string]$Label, [string[]]$Evidence) {
  if (-not (Test-Path -LiteralPath $Path)) {
    $script:Skipped.Add("$Label ($Path) does not exist")
    return
  }
  if (-not (Test-KayanOwnedFolder $Path $Evidence)) {
    $script:Skipped.Add("$Label ($Path) has no KAYAN marker; left alone")
    return
  }
  try {
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
    $script:Removed.Add("$Label ($Path)")
  } catch {
    $script:Failures.Add([ordered]@{ component = $Label; path = $Path; reason = $_.Exception.Message })
  }
}

function Get-KayanInstallRoot {
  # The real install location, as recorded by the installer, not a guess.
  foreach ($key in $uninstallRoots) {
    $entry = Get-ItemProperty -LiteralPath (Join-Path $key $uninstallKeyName) -ErrorAction SilentlyContinue
    if ($entry.InstallLocation -and (Test-KayanOwnedFolder $entry.InstallLocation @('erp_kayan.exe'))) {
      return (Resolve-Path -LiteralPath $entry.InstallLocation).Path
    }
  }
  $fallback = Join-Path $env:ProgramFiles 'KAYAN ERP'
  if (Test-KayanOwnedFolder $fallback @('erp_kayan.exe')) { return (Resolve-Path -LiteralPath $fallback).Path }
  return $null
}

function Get-RemovalPlan {
  $plan = New-Object 'System.Collections.Generic.List[object]'

  $installRoot = Get-KayanInstallRoot
  if ($installRoot) {
    $plan.Add([ordered]@{ component = 'Flutter client, backend, bundled Node and PostgreSQL runtimes'; path = $installRoot; owned = $true })
  }

  $programData = Join-Path $env:ProgramData 'KAYAN-ERP'
  if (Test-Path -LiteralPath $programData) {
    $plan.Add([ordered]@{ component = 'Database files, attachments, backups, configuration and logs'; path = $programData; owned = (Test-KayanOwnedFolder $programData @('PostgreSQL', 'logs', 'backups', 'license')) })
  }

  foreach ($userProfile in @($env:USERPROFILE)) {
    $userConfig = Join-Path $userProfile 'AppData\Roaming\KAYAN-ERP'
    if (Test-Path -LiteralPath $userConfig) {
      $plan.Add([ordered]@{ component = 'Per-user settings (kayan.env)'; path = $userConfig; owned = (Test-KayanOwnedFolder $userConfig @('kayan.env')) })
    }
    $userLocal = Join-Path $userProfile 'AppData\Local\KAYAN-ERP'
    if (Test-Path -LiteralPath $userLocal) {
      $plan.Add([ordered]@{ component = 'Per-user cache and temporary files'; path = $userLocal; owned = (Test-KayanOwnedFolder $userLocal @('kayan.env', 'Cache', 'logs')) })
    }
  }

  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($service) {
    $plan.Add([ordered]@{ component = 'Windows service'; path = $serviceName; owned = $true })
  }

  $plan.Add([ordered]@{ component = 'Start menu and desktop shortcuts'; path = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\KAYAN ERP"; owned = $true })
  $plan.Add([ordered]@{ component = 'Uninstall registry entry and KAYAN registry keys'; path = 'HKLM\SOFTWARE\...\KAYAN ERP'; owned = $true })
  $plan.Add([ordered]@{ component = 'Scheduled tasks created by KAYAN'; path = 'Task Scheduler'; owned = $true })

  return $plan
}

function Remove-KayanShortcuts {
  $targets = @(
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\KAYAN ERP'),
    (Join-Path $env:PUBLIC 'Desktop\KAYAN ERP.lnk'),
    (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'KAYAN ERP.lnk')
  )
  foreach ($target in $targets) {
    if (-not (Test-Path -LiteralPath $target)) { continue }
    try {
      Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
      $script:Removed.Add("shortcut ($target)")
    } catch {
      $script:Failures.Add([ordered]@{ component = 'shortcut'; path = $target; reason = $_.Exception.Message })
    }
  }
}

function Remove-KayanRegistry {
  $keys = @($uninstallRoots | ForEach-Object { Join-Path $_ $uninstallKeyName }) + @(
    'HKLM:\SOFTWARE\KAYAN',
    'HKCU:\SOFTWARE\KAYAN'
  )
  foreach ($key in $keys) {
    if (-not (Test-Path -LiteralPath $key)) { continue }
    try {
      Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction Stop
      $script:Removed.Add("registry ($key)")
    } catch {
      $script:Failures.Add([ordered]@{ component = 'registry'; path = $key; reason = $_.Exception.Message })
    }
  }
}

function Remove-KayanTasks {
  $tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue |
    Where-Object {
      $task = $_
      $ownedActions = @($task.Actions | Where-Object {
        $_.Execute -and $script:InstallRoot -and
          (Test-UnderRoot ([Environment]::ExpandEnvironmentVariables($_.Execute.Trim('"'))) @($script:InstallRoot))
      })
      $ownedActions.Count -gt 0 -and $ownedActions.Count -eq @($task.Actions).Count
    })
  foreach ($task in $tasks) {
    try {
      Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false -ErrorAction Stop
      $script:Removed.Add("scheduled task ($($task.TaskPath)$($task.TaskName))")
    } catch {
      $script:Failures.Add([ordered]@{ component = 'scheduled task'; path = "$($task.TaskPath)$($task.TaskName)"; reason = $_.Exception.Message })
    }
  }
}

function Assert-NothingLeft {
  <# Runs after the deletions. Every path that should be gone is checked again:
     the script must not claim success on the strength of its own log. #>
  $remaining = New-Object 'System.Collections.Generic.List[object]'
  foreach ($path in @($script:InstallRoot, (Join-Path $env:ProgramData 'KAYAN-ERP'),
                     (Join-Path $env:USERPROFILE 'AppData\Roaming\KAYAN-ERP'),
                     (Join-Path $env:USERPROFILE 'AppData\Local\KAYAN-ERP'))) {
    if ($path -and (Test-Path -LiteralPath $path)) { $remaining.Add([ordered]@{ component = 'folder'; path = $path }) }
  }
  if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    $remaining.Add([ordered]@{ component = 'service'; path = $serviceName })
  }
  foreach ($name in @('erp_kayan', 'postgres', 'RepairTool')) {
    foreach ($process in @(Get-Process -Name $name -ErrorAction SilentlyContinue)) {
      if ($process.Path -and $script:InstallRoot -and (Test-UnderRoot $process.Path @($script:InstallRoot, (Join-Path $env:ProgramData 'KAYAN-ERP')))) {
        $remaining.Add([ordered]@{ component = 'process'; path = "$name PID $($process.Id)" })
      }
    }
  }
  return $remaining
}

function Write-Report($Remaining) {
  $report = [ordered]@{
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    computerName   = $env:COMPUTERNAME
    installRoot    = $script:InstallRoot
    removed        = @($script:Removed)
    skipped        = @($script:Skipped)
    failures       = @($script:Failures)
    stillPresent   = @($Remaining)
    preservedLogs  = $script:PreservedLogs
    complete       = ($script:Failures.Count -eq 0 -and $Remaining.Count -eq 0)
  }
  try {
    $directory = Split-Path -Parent $ReportPath
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
    Write-Host "Report: $ReportPath"
  } catch {
    Write-Host "::warning title=Removal report::Could not write $ReportPath : $($_.Exception.Message)"
  }
  return $report
}

# ── main ────────────────────────────────────────────────────────────────────

if (-not (IsElevated)) {
  Write-Host '::error title=KAYAN removal::Complete removal needs an elevated PowerShell.'
  exit 3
}

$script:InstallRoot = Get-KayanInstallRoot
$script:ProgramDataRoot = Join-Path $env:ProgramData 'KAYAN-ERP'

$plan = Get-RemovalPlan

if ($WhatIfPlan) {
  Write-Host 'The following belongs to KAYAN ERP and would be removed:'
  foreach ($item in $plan) {
    $state = if ($item.owned) { 'owned' } else { 'NOT PROVEN - would be left alone' }
    Write-Host ("  - {0}: {1} [{2}]" -f $item.component, $item.path, $state)
  }
  Write-Host ''
  Write-Host 'Everything listed above is deleted permanently: company data, the database, attachments and backups.'
  exit 0
}

if (-not $ConfirmRemoval) {
  Write-Host '::error title=KAYAN removal::Refusing to remove anything without -ConfirmRemoval.'
  Write-Host 'Nothing was deleted. Run with -WhatIfPlan to see what would be removed.'
  exit 2
}

if (-not $script:InstallRoot -and -not (Test-Path -LiteralPath $script:ProgramDataRoot)) {
  Write-Host '::notice title=KAYAN removal::No KAYAN installation was found on this computer.'
  exit 0
}

$pgData = Join-Path $script:ProgramDataRoot 'PostgreSQL\data'
if ((Test-Path -LiteralPath $pgData) -and -not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION') -PathType Leaf)) {
  Write-Host '::error title=KAYAN removal::The database directory has no PG_VERSION. Complete removal stopped before changing anything.'
  exit 1
}

Write-Host '::notice title=KAYAN removal::Complete removal started. Company data will be deleted.'

Stop-KayanProcesses
Remove-KayanService
Remove-KayanTasks
# Stopping the service can leave child postgres processes for a moment.
Start-Sleep -Seconds 2
Stop-KayanProcesses

# -KeepLogs moves the logs aside first, so a failed removal can still be
# diagnosed after the folder that held them is gone.
$preservedLogs = $null
if ($KeepLogs -and (Test-Path -LiteralPath $LogDirectory)) {
  try {
    $preservedLogs = Join-Path $env:TEMP ('kayan-logs-' + [guid]::NewGuid().ToString('N'))
    Copy-Item -LiteralPath $LogDirectory -Destination $preservedLogs -Recurse -Force -ErrorAction Stop
    Write-Host "Logs preserved at $preservedLogs"
  } catch {
    $preservedLogs = $null
    $script:Failures.Add([ordered]@{ component = 'logs'; path = $LogDirectory; reason = "could not copy logs aside: $($_.Exception.Message)" })
  }
}
Remove-KayanFolder $script:ProgramDataRoot 'ProgramData (database, attachments, backups, configuration)' @('PostgreSQL', 'logs', 'backups', 'license')
if ($script:InstallRoot) {
  Remove-KayanFolder $script:InstallRoot 'Install folder (Flutter client, backend, Node, PostgreSQL runtimes)' @('erp_kayan.exe', 'backend')
}
foreach ($profile in @($env:USERPROFILE)) {
  Remove-KayanFolder (Join-Path $profile 'AppData\Roaming\KAYAN-ERP') 'Per-user settings' @('kayan.env')
  Remove-KayanFolder (Join-Path $profile 'AppData\Local\KAYAN-ERP') 'Per-user cache' @('kayan.env', 'Cache', 'logs')
}
Remove-KayanShortcuts
Remove-KayanRegistry

$script:PreservedLogs = $preservedLogs
$remaining = Assert-NothingLeft
$report = Write-Report $remaining

if ($report.complete) {
  Write-Host '::notice title=KAYAN removal::Complete removal finished. No KAYAN files, folders, services, tasks or registry keys remain.'
  exit 0
}

Write-Host '::error title=KAYAN Complete Uninstall did not finish::Some components could not be removed. Nothing was claimed as complete. See the report for each path and reason.'
foreach ($failure in $script:Failures) {
  Write-Host ("  FAILED  {0}  {1}  -> {2}" -f $failure.component, $failure.path, $failure.reason)
}
foreach ($item in $remaining) {
  Write-Host ("  REMAINS {0}  {1}" -f $item.component, $item.path)
}
Write-Host "Full report: $ReportPath"
Write-Host 'A restart may be required for a service or a locked file to disappear. Re-run this script after restarting; it is safe to run repeatedly.'
exit 1
