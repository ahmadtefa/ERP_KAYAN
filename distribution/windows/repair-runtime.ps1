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

# Where a repair records what it did, in two places.
#
# installer.log is the log a customer and the smoke test already read, but the
# program's own server is often started with its output redirected into that
# same file, and a redirected handle does not share write access: an append
# from here then fails with a sharing violation. That is a real Windows
# behaviour, and swallowing it made a successful repair look like one that had
# recorded nothing.
#
# So every marker goes to installer.log (best effort) *and* to a file only this
# script writes. The repair is only reported successful if at least one of them
# really received the text - a marker nobody can read is not evidence.
$script:markerSink = Join-Path (Split-Path -Parent $bootstrapLog) 'repair-result.txt'

function Add-MarkerLine([string]$Path, [string]$Line) {
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    try {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
      $stream = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Append,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::ReadWrite
      )
      try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Line + [Environment]::NewLine)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
      } finally {
        $stream.Dispose()
      }
      return $true
    } catch {
      Start-Sleep -Milliseconds 200
    }
  }
  return $false
}

function Write-RepairMarker([string]$Message) {
  $line = ("{0:u} {1}" -f (Get-Date),(Protect-Secret $Message))
  $written = @(
    (Add-MarkerLine $script:markerSink $line),
    (Add-MarkerLine $bootstrapLog $line)
  )
  if ($written -contains $false -and ($written -notcontains $true)) {
    # Nothing could be recorded. Say so instead of continuing: the rest of the
    # repair cannot be shown to have happened if its own record is missing.
    throw ("The repair could not write its log to " + $script:markerSink + " or " + $bootstrapLog + ". Check that the KAYAN-ERP folder under ProgramData is writable by an administrator.")
  }
}

# The settings this installation had before the repair. A file that cannot be
# read is an empty answer, not a reason to stop: the repair exists to make an
# unreadable file readable again, and the checks below only compare what could
# really be read.
function Read-SettingsValues([string]$Path) {
  $values = @{}
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $values }
  try {
    foreach ($line in @(Get-Content -LiteralPath $Path -ErrorAction Stop)) {
      if ($line -match '^\s*([A-Z_]+)="?(.*?)"?\s*$') { $values[$matches[1]] = $matches[2].Trim('"') }
    }
  } catch { }
  return $values
}

function Get-SettingsGeneration([hashtable]$Values) {
  $parsed = [int64]0
  if ($Values['KAYAN_SETTINGS_GENERATION'] -and [int64]::TryParse([string]$Values['KAYAN_SETTINGS_GENERATION'], [ref]$parsed)) {
    return $parsed
  }
  return [int64]0
}

function Get-DatabaseNameFromUrl([string]$Url) {
  if (-not $Url) { return '' }
  $match = [regex]::Match($Url, '^postgresql://[^/]+/([^?]+)')
  if (-not $match.Success) { return '' }
  return [Uri]::UnescapeDataString($match.Groups[1].Value)
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

  # What the installation looked like before repair touched anything. Repair
  # must never move the program to another company database, and must never
  # make the settings generation go backwards - that stamp is how the desktop
  # shell decides which of its two settings files is the newer one, and a
  # repair that lowered it could make the program open the previous company.
  $machineSettingsPath = Join-Path $ProgramDataRoot 'kayan.env'
  $settingsBefore = Read-SettingsValues $machineSettingsPath
  $userSettingsBefore = Read-SettingsValues $UserSettingsPath
  $generationBefore = [Math]::Max((Get-SettingsGeneration $settingsBefore), (Get-SettingsGeneration $userSettingsBefore))
  $databaseBefore = Get-DatabaseNameFromUrl $settingsBefore['DATABASE_URL']
  if (-not $databaseBefore) { $databaseBefore = Get-DatabaseNameFromUrl $userSettingsBefore['DATABASE_URL'] }
  $licenceDirectory = Join-Path $ProgramDataRoot 'license'
  $requiresLicence = (Test-Path -LiteralPath (Join-Path $licenceDirectory 'enforcement.required')) -or (Test-Path -LiteralPath (Join-Path $licenceDirectory 'public-key.pem'))

  $installRuntime = Join-Path $PSScriptRoot 'install-runtime.ps1'
  if (-not (Test-Path -LiteralPath $installRuntime)) {
    throw "Bundled runtime setup script is missing: $installRuntime"
  }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installRuntime -UserSettingsPath $UserSettingsPath -ProgramDataRoot $ProgramDataRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Runtime repair step failed with exit code $LASTEXITCODE."
  }

  $machineSettings = Join-Path $ProgramDataRoot 'kayan.env'
  $settingsAfter = Read-SettingsValues $machineSettings
  $userSettingsAfter = Read-SettingsValues $UserSettingsPath
  $generationAfter = [Math]::Max((Get-SettingsGeneration $settingsAfter), (Get-SettingsGeneration $userSettingsAfter))
  if ($generationBefore -gt 0 -and $generationAfter -gt 0 -and $generationAfter -lt $generationBefore) {
    throw ("Repair would lower the settings generation from " + $generationBefore + " to " + $generationAfter + ", which could make the program read an older file and open the previous company. Repair stopped instead.")
  }
  $databaseAfter = Get-DatabaseNameFromUrl $settingsAfter['DATABASE_URL']
  if (-not $databaseAfter) { $databaseAfter = Get-DatabaseNameFromUrl $userSettingsAfter['DATABASE_URL'] }
  if ($databaseBefore -and $databaseAfter -and $databaseBefore -ne $databaseAfter) {
    throw ("Repair would switch the program from database '" + $databaseBefore + "' to '" + $databaseAfter + "'. Repair never changes which company the program opens; it stopped instead. See " + $bootstrapLog)
  }
  Write-RepairMarker ("KAYAN-REPAIR-SETTINGS-KEPT database=" + $databaseAfter + " generation=" + $generationAfter)
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

  # Prove it, do not just say it: briefly start the real API exactly the
  # way the desktop shell does (same bundled Node, same entry point, the
  # same settings already loaded into this process above) and require a
  # real answer from /api/v1/health before the repair may call itself
  # successful. The probe binds loopback only and is always stopped
  # afterwards. An empty database answering needsSetup=true is a PASS:
  # the runtime, the database and the server all work, and first-run
  # setup belongs to the program window, not to this script.
  $mainJs = Join-Path $backendDir 'dist\src\main.js'
  if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $mainJs)) {
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
    if (-not $probePort) {
      throw 'No free local port was available to verify the repaired server.'
    }

    $probeOut = Join-Path $env:TEMP ('kayan-repair-api-out-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.log')
    $probeErr = Join-Path $env:TEMP ('kayan-repair-api-err-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.log')
    $probe = $null
    try {
      $env:PORT = [string]$probePort
      $env:HOST = '127.0.0.1'
      $env:NODE_ENV = 'production'
      $env:NO_COLOR = '1'
      $env:KAYAN_BACKUP_DIR = Join-Path $ProgramDataRoot 'backups'
      $env:KAYAN_UPLOAD_DIR = Join-Path $ProgramDataRoot 'uploads'
      $probe = Start-Process -FilePath $nodeExe -ArgumentList @('dist\src\main.js') -WorkingDirectory $backendDir -PassThru -NoNewWindow -RedirectStandardOutput $probeOut -RedirectStandardError $probeErr
      $health = $null
      $deadline = (Get-Date).AddSeconds(90)
      while ((Get-Date) -lt $deadline) {
        if ($probe.HasExited) { break }
        try {
          $candidate = Invoke-RestMethod -Uri "http://127.0.0.1:$probePort/api/v1/health" -TimeoutSec 3
          if ($candidate.status) { $health = $candidate; break }
        } catch { }
        Start-Sleep -Milliseconds 700
      }
      if (-not $health) {
        $details = ((Get-Content -LiteralPath $probeOut -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $probeErr -Raw -ErrorAction SilentlyContinue)).Trim()
        throw ("The repaired server did not answer on 127.0.0.1:$probePort within 90 seconds: " + (Protect-Secret $details))
      }
      # A repair must not be able to switch licence enforcement off. The
      # installation's own protected folder says whether it must enforce; if
      # it does, the repaired server has to say so, with its verification key
      # in place. This is checked on the running server, not on the settings
      # file, because the server is what decides.
      if ($requiresLicence) {
        if ($null -eq $health.license) {
          throw 'This installation enforces licences, but the repaired server did not report its licence mode, so the repair cannot prove that enforcement survived.'
        }
        if ($health.license.enforcement -ne 'enforce') {
          throw ("This installation enforces licences, but the repaired server reported '" + $health.license.enforcement + "'. Repair would have weakened it, so it is not reported as successful. See " + $bootstrapLog)
        }
        if ($health.license.configured -ne $true) {
          throw ('This installation enforces licences, but its verification key is not readable by the repaired server. Run Repair again, or restore ' + (Join-Path $licenceDirectory 'public-key.pem') + ' from the Setup package.')
        }
        Write-RepairMarker 'KAYAN-REPAIR-LICENCE-ENFORCED'
      }
      if ($health.needsSetup -eq $true) {
        Write-RepairMarker 'KAYAN-REPAIR-VERIFIED server answers; first-run setup still pending'
        Write-Output 'Verified: the server answers and the database is reachable. First-run setup is still pending - open KAYAN ERP to create the company and the first administrator.'
      } else {
        Write-RepairMarker 'KAYAN-REPAIR-VERIFIED server answers; existing company database ready'
        Write-Output 'Verified: the server answers and the existing company database is ready to use.'
      }
    } finally {
      if ($probe -and -not $probe.HasExited) {
        Stop-Process -Id $probe.Id -Force -ErrorAction SilentlyContinue
        try { $probe.WaitForExit(10000) | Out-Null } catch { }
      }
      Remove-Item -LiteralPath $probeOut, $probeErr -Force -ErrorAction SilentlyContinue
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
