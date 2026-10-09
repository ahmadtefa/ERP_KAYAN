[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$UserSettingsPath,
  [string]$ProgramDataRoot = (Join-Path $env:ProgramData 'KAYAN-ERP')
)
$ErrorActionPreference = 'Stop'
$bootstrapLog = Join-Path (Join-Path $env:ProgramData 'KAYAN-ERP') 'logs\installer.log'
trap {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bootstrapLog) | Out-Null
    $message = $_.Exception.Message
    $message = [regex]::Replace($message, '(?i)postgres(?:ql)?://[^\s"'']+', '[DATABASE URL REDACTED]')
    $message = [regex]::Replace($message, '(?i)(password\s*[=:]\s*)[^\s;]+', '$1[REDACTED]')
    Add-Content -LiteralPath $bootstrapLog -Value ("{0:u} {1}" -f (Get-Date),$message) -Encoding UTF8
  } catch { }
  Write-Output 'KAYAN runtime setup failed. See the protected installer log for a redacted diagnostic.'
  exit 1
}
$serviceName = 'KayanERPPostgreSQL'
$pgRoot = Join-Path $PSScriptRoot 'backend\postgres'
$pgBin = Join-Path $pgRoot 'bin'
$pgData = Join-Path $ProgramDataRoot 'PostgreSQL\data'
$pgLog = Join-Path $ProgramDataRoot 'logs\postgresql.log'
$bootstrapMarker = Join-Path $ProgramDataRoot 'installer-bootstrap-v1'

# Refuse to claim a foreign PostgreSQL process on the fixed local port.
$probe = [Net.Sockets.TcpClient]::new()
try {
  $connect = $probe.BeginConnect('127.0.0.1',5432,$null,$null)
  if ($connect.AsyncWaitHandle.WaitOne(500)) {
    $connected = $false
    try { $probe.EndConnect($connect); $connected = $true } catch [System.Net.Sockets.SocketException] { }
    if ($connected) {
      $occupant = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
      if (-not $occupant -or $occupant.Status -eq 'Stopped') {
        throw 'Port 5432 is already in use by another service. Stop that service or choose an isolated machine before installing bundled KAYAN PostgreSQL; nothing was changed.'
      }
    }
  }
} finally { $probe.Dispose() }

$vcRuntime = Join-Path $PSScriptRoot 'prerequisites\vc_redist.x64.exe'
if (Test-Path $vcRuntime) {
  $vc = Start-Process -FilePath $vcRuntime -ArgumentList '/install','/quiet','/norestart' -Wait -PassThru -WindowStyle Hidden
  if ($vc.ExitCode -notin @(0,1638,3010)) { throw "Microsoft Visual C++ runtime installation failed ($($vc.ExitCode))." }
}

function Invoke-Pg([string]$Exe, [string[]]$Args) {
  & $Exe @Args
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL command failed ($LASTEXITCODE): $([IO.Path]::GetFileName($Exe))" }
}
function Invoke-PsqlInput([string]$Exe, [string[]]$Args, [string]$Sql) {
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $Exe
  $start.Arguments = $Args -join ' '
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  if ($env:PGPASSWORD) { $start.EnvironmentVariables['PGPASSWORD'] = $env:PGPASSWORD }
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) { throw 'Could not launch PostgreSQL initialization client.' }
  $process.StandardInput.WriteLine($Sql)
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "PostgreSQL initialization SQL failed ($($process.ExitCode)); details are in the PostgreSQL log." }
}
function Set-PrivateAcl([string]$Path, [string]$Principal) {
  & icacls.exe $Path '/inheritance:r' '/grant:r' "$Principal`:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' 'BUILTIN\Administrators:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not secure ACLs on '$Path'." }
}
# A running Windows service is not the same thing as a PostgreSQL that accepts
# connections. Ask the server itself before anything (Prisma included) touches
# the database, so a slow start is waited out and a real failure is reported.
function Wait-PgReady {
  $ready = Join-Path $pgBin 'pg_isready.exe'
  if (-not (Test-Path $ready)) { throw 'Bundled PostgreSQL readiness tool is missing.' }
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    & $ready -h 127.0.0.1 -p 5432 -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 1
  }
  throw 'PostgreSQL did not accept connections before the 60 second deadline. Existing data was not changed; see the PostgreSQL log.'
}
function Start-PgService {
  $current = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($current -and $current.Status -ne 'Running') {
    Start-Service -Name $serviceName
    (Get-Service -Name $serviceName).WaitForStatus('Running',[TimeSpan]::FromSeconds(60))
  }
  Wait-PgReady
}
function New-Secret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
    return [BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()
  } finally { $rng.Dispose() }
}

if (-not (Test-Path (Join-Path $pgBin 'initdb.exe'))) { throw 'Bundled PostgreSQL runtime is incomplete.' }
if (-not (Test-Path (Join-Path $PSScriptRoot 'backend\node\node.exe'))) { throw 'Bundled Node runtime is missing.' }
New-Item -ItemType Directory -Force -Path $ProgramDataRoot, (Split-Path -Parent $pgData), (Split-Path -Parent $pgLog), (Split-Path -Parent $UserSettingsPath) | Out-Null

function Save-UserSettings([hashtable]$Values) {
  $profilePath = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $UserSettingsPath)))
  $profileRecord = Get-CimInstance Win32_UserProfile | Where-Object { $_.LocalPath -ieq $profilePath } | Select-Object -First 1
  if (-not $profileRecord) { throw 'Could not resolve the installing user profile to set private settings ACLs.' }
  $identity = ([Security.Principal.SecurityIdentifier]::new([string]$profileRecord.SID)).Translate([Security.Principal.NTAccount]).Value
  $body = @('# KAYAN ERP machine-local runtime configuration; do not share this file.') + @($Values.GetEnumerator() | Sort-Object Key | ForEach-Object { '{0}="{1}"' -f $_.Key,$_.Value })
  Set-Content -LiteralPath $UserSettingsPath -Value $body -Encoding ASCII
  Set-PrivateAcl (Split-Path -Parent $UserSettingsPath) $identity
}

$settingsExists = Test-Path -LiteralPath $UserSettingsPath
$settings = @{}
if ($settingsExists) {
  foreach ($line in Get-Content -LiteralPath $UserSettingsPath) {
    if ($line -match '^\s*([A-Z_]+)="?(.*?)"?\s*$') { $settings[$matches[1]] = $matches[2].Trim('"') }
  }
}

if (-not (Test-Path (Join-Path $pgData 'PG_VERSION'))) {
  if (Test-Path $pgData) {
    if (Get-ChildItem -LiteralPath $pgData -Force -ErrorAction SilentlyContinue | Select-Object -First 1) {
      throw 'The PostgreSQL data directory exists but is not initialized. Refusing to remove or overwrite it.'
    }
  }
  if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    throw "A KAYAN PostgreSQL service is registered but its data directory is missing. The service was left untouched and no data was changed. Remove the leftover '$serviceName' service manually, or restore the database directory, before reinstalling."
  }
  if ($settingsExists) {
    if (-not (Test-Path -LiteralPath $bootstrapMarker)) {
      throw 'Existing runtime settings were found without a KAYAN database cluster. They were preserved; refusing to overwrite or repurpose them.'
    }
    $existingDbUrl = $settings['DATABASE_URL']
    if ($existingDbUrl -notmatch '^postgresql://erp_app:([a-fA-F0-9]+)@127\.0\.0\.1:5432/erp_kayan\?schema=public$') {
      throw 'An existing user settings file points outside the bundled local database. It was preserved; refusing to replace those settings or initialize an unrelated database.'
    }
    $dbPassword = $matches[1]
  } else { $dbPassword = New-Secret }
  $settings['DATABASE_URL'] = "postgresql://erp_app:$dbPassword@127.0.0.1:5432/erp_kayan?schema=public"
  $settings['ADMIN_DATABASE_URL'] = "postgresql://postgres:$dbPassword@127.0.0.1:5432/postgres?schema=public"
  if (-not $settings['JWT_ACCESS_SECRET']) { $settings['JWT_ACCESS_SECRET'] = New-Secret }
  if (-not $settings['JWT_REFRESH_SECRET']) { $settings['JWT_REFRESH_SECRET'] = New-Secret }
  if (-not $settings['JWT_ACCESS_TTL']) { $settings['JWT_ACCESS_TTL'] = '900' }
  if (-not $settings['JWT_REFRESH_TTL']) { $settings['JWT_REFRESH_TTL'] = '1209600' }
  # Persist recovery information before touching the new cluster. If setup is
  # interrupted, a rerun reuses these values rather than changing user config.
  Set-PrivateAcl $ProgramDataRoot 'BUILTIN\Administrators'
  if (-not (Test-Path -LiteralPath $bootstrapMarker)) {
    Set-Content -LiteralPath $bootstrapMarker -Value 'KAYAN PostgreSQL 17 installer bootstrap v1' -Encoding ASCII
  }
  Save-UserSettings $settings
  $tempPassword = Join-Path $ProgramDataRoot 'postgres-init-password.tmp'
  [IO.File]::WriteAllText($tempPassword, $dbPassword, [Text.Encoding]::ASCII)
  Set-PrivateAcl $ProgramDataRoot 'BUILTIN\Administrators'
  try {
    Invoke-Pg (Join-Path $pgBin 'initdb.exe') @('-D',$pgData,'-U','postgres','-A','scram-sha-256','--pwfile',$tempPassword,'-E','UTF8')
  } finally { Remove-Item -LiteralPath $tempPassword -Force -ErrorAction SilentlyContinue }

  $conf = Join-Path $pgData 'postgresql.conf'
  Add-Content -LiteralPath $conf -Value "`n# KAYAN local-only database configuration`nlisten_addresses = '127.0.0.1'`nport = 5432`npassword_encryption = 'scram-sha-256'`nlogging_collector = on`nlog_directory = '$($ProgramDataRoot.Replace('\','/'))/logs'`nlog_filename = 'postgresql-%Y-%m-%d.log'`n"
  $hba = Join-Path $pgData 'pg_hba.conf'
  Set-Content -LiteralPath $hba -Value @('# TYPE  DATABASE        USER            ADDRESS                 METHOD','local   all             all                                     scram-sha-256','host    all             all             127.0.0.1/32            scram-sha-256','host    all             all             ::1/128                 reject') -Encoding ASCII
  $env:DATABASE_URL = "postgresql://erp_app:$dbPassword@127.0.0.1:5432/erp_kayan?schema=public"
  $env:ADMIN_DATABASE_URL = "postgresql://postgres:$dbPassword@127.0.0.1:5432/postgres?schema=public"
  $env:PGPASSWORD = $dbPassword
  # Start postgres briefly as the installer, create the least-privileged app role/db, then register the permanent service.
  $pgCtl = Join-Path $pgBin 'pg_ctl.exe'
  Invoke-Pg $pgCtl @('start','-D',$pgData,'-l',$pgLog,'-w','-t','60')
  try {
    Invoke-PsqlInput (Join-Path $pgBin 'psql.exe') @('-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1') "CREATE ROLE erp_app WITH LOGIN PASSWORD '$dbPassword';"
    Invoke-Pg (Join-Path $pgBin 'createdb.exe') @('-h','127.0.0.1','-U','postgres','-O','erp_app','erp_kayan')
    } finally {
      Invoke-Pg $pgCtl @('stop','-D',$pgData,'-m','fast','-w')
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
  Invoke-Pg $pgCtl @('register','-N',$serviceName,'-U','NT AUTHORITY\LocalService','-D',$pgData,'-S','auto')
  Set-PrivateAcl $pgData 'NT AUTHORITY\LOCAL SERVICE'
  Set-PrivateAcl (Split-Path -Parent $pgLog) 'NT AUTHORITY\LOCAL SERVICE'
  Start-PgService
  Remove-Item Env:DATABASE_URL,Env:ADMIN_DATABASE_URL -ErrorAction SilentlyContinue
} else {
  $version = (Get-Content (Join-Path $pgData 'PG_VERSION') -Raw).Trim()
  if ($version -ne '17') { throw "Existing PostgreSQL data version $version is incompatible with bundled PostgreSQL 17. Data was not changed." }
  if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
    Invoke-Pg (Join-Path $pgBin 'pg_ctl.exe') @('register','-N',$serviceName,'-U','NT AUTHORITY\LocalService','-D',$pgData,'-S','auto')
  }
  Set-PrivateAcl $pgData 'NT AUTHORITY\LOCAL SERVICE'
  Set-PrivateAcl (Split-Path -Parent $pgLog) 'NT AUTHORITY\LOCAL SERVICE'
  Start-PgService
}

if (-not (Test-Path -LiteralPath $UserSettingsPath)) { throw 'Per-user runtime settings were not created.' }
Write-Output 'KAYAN PostgreSQL is installed and running. Company database files are under ProgramData and will be kept on uninstall.'
