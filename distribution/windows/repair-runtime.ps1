<#
    KAYAN ERP - Bundled Windows runtime and database repair tool.

    Safely repairs a local KAYAN ERP installation without deleting, resetting,
    or overwriting company data or existing database credentials:

      1. Elevates to Administrator if started by a standard user.
      2. Stops any running erp_kayan.exe instance so files are not locked.
      3. Re-runs install-runtime.ps1 to verify/install the bundled Visual C++
         runtime, recover any broken/empty DACLs on kayan.env or the PostgreSQL
         data directory, register and start KayanERPPostgreSQL, and verify
         127.0.0.1:5432 readiness.
      4. Runs the bundled Node runtime with backend\scripts\prepare-database.mjs
         to ensure checked-in Prisma migrations are applied.
#>
[CmdletBinding()]
param(
  [string]$UserSettingsPath = (Join-Path $env:APPDATA 'KAYAN-ERP\kayan.env'),
  [string]$ProgramDataRoot = (Join-Path $env:ProgramData 'KAYAN-ERP'),
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$bootstrapLog = Join-Path $ProgramDataRoot 'logs\installer.log'

function Protect-Secret([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return '' }
  $protected = [regex]::Replace($Text, '(?i)postgres(?:ql)?://[^\s"'']+', '[DATABASE URL REDACTED]')
  $protected = [regex]::Replace($protected, '(?i)(password\s*[=:]\s*)[^\s;]+', '$1[REDACTED]')
  $protected = [regex]::Replace($protected, "(?i)(password\s+')[^']+(')", '$1[REDACTED]$2')
  return $protected
}

function Write-RepairMarker([string]$Message) {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bootstrapLog) | Out-Null
    Add-Content -LiteralPath $bootstrapLog -Value ("{0:u} {1}" -f (Get-Date),(Protect-Secret $Message)) -Encoding UTF8
  } catch { }
}

try {
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
    if ($Quiet) { $argList += '-Quiet' }
    $child = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList $argList
    if ($child.ExitCode -ne 0) {
      throw "Elevated repair exited with code $($child.ExitCode). Check $bootstrapLog for details."
    }
    exit 0
  }

  Write-RepairMarker 'KAYAN-REPAIR-START'
  Get-Process -Name 'erp_kayan' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

  $installRuntime = Join-Path $PSScriptRoot 'install-runtime.ps1'
  if (-not (Test-Path -LiteralPath $installRuntime)) {
    throw "Bundled runtime setup script is missing: $installRuntime"
  }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installRuntime -UserSettingsPath $UserSettingsPath -ProgramDataRoot $ProgramDataRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Runtime repair step failed with exit code $LASTEXITCODE."
  }

  $machineSettings = Join-Path $ProgramDataRoot 'kayan.env'
  $settingsFile = if (Test-Path -LiteralPath $machineSettings) { $machineSettings } elseif (Test-Path -LiteralPath $UserSettingsPath) { $UserSettingsPath } else { $null }
  if (-not $settingsFile) {
    throw 'Runtime settings file (kayan.env) was not found after runtime repair.'
  }

  $envValues = @{}
  foreach ($line in Get-Content -LiteralPath $settingsFile) {
    $clean = $line.TrimStart([char]0xFEFF)
    if ($clean -match '^\s*([A-Z_]+)="?(.*?)"?\s*$') {
      $envValues[$matches[1]] = $matches[2].Trim('"')
    }
  }
  foreach ($entry in $envValues.GetEnumerator()) {
    Set-Item -Path ("Env:" + $entry.Key) -Value $entry.Value
  }

  $backendDir = Join-Path $PSScriptRoot 'backend'
  $nodeExe = Join-Path $backendDir 'node\node.exe'
  $prepareScript = Join-Path $backendDir 'scripts\prepare-database.mjs'
  if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $prepareScript)) {
    $prepOut = Join-Path $env:TEMP ('kayan-repair-prep-out-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.log')
    $prepErr = Join-Path $env:TEMP ('kayan-repair-prep-err-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.log')
    try {
      $prep = Start-Process -FilePath $nodeExe -ArgumentList @('scripts\prepare-database.mjs') -WorkingDirectory $backendDir -Wait -PassThru -NoNewWindow -RedirectStandardOutput $prepOut -RedirectStandardError $prepErr
      if ($prep.ExitCode -ne 0) {
        $details = ((Get-Content -LiteralPath $prepOut -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $prepErr -Raw -ErrorAction SilentlyContinue)).Trim()
        throw ("Database migration verification failed ($($prep.ExitCode)): " + (Protect-Secret $details))
      }
    } finally {
      Remove-Item -LiteralPath $prepOut, $prepErr -Force -ErrorAction SilentlyContinue
    }
  }

  Write-RepairMarker 'KAYAN-REPAIR-OK'
  Write-Output 'KAYAN ERP runtime and PostgreSQL service were repaired successfully. Existing company data was preserved.'
  if (-not $Quiet -and [Environment]::UserInteractive) {
    try {
      Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
      [System.Windows.MessageBox]::Show(
        'KAYAN ERP runtime and database service were repaired successfully. Existing company data was preserved.',
        'KAYAN ERP Repair',
        [System.Windows.MessageBoxButton]::OK,
        [System.Windows.MessageBoxImage]::Information
      ) | Out-Null
    } catch { }
  }
} catch {
  $reason = Protect-Secret $_.Exception.Message
  Write-RepairMarker ("KAYAN-REPAIR-FAILED " + $reason)
  if (-not $Quiet -and [Environment]::UserInteractive) {
    try {
      Add-Type -AssemblyName PresentationFramework -ErrorAction SilentlyContinue
      [System.Windows.MessageBox]::Show(
        "KAYAN ERP repair failed. Existing company data was not deleted.`n`n$reason`n`nDiagnostics: $bootstrapLog",
        'KAYAN ERP Repair',
        [System.Windows.MessageBoxButton]::OK,
        [System.Windows.MessageBoxImage]::Error
      ) | Out-Null
    } catch { }
  }
  Write-Error $reason
  exit 1
}
