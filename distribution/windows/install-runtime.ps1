<#
    KAYAN ERP - Windows runtime setup.

    Runs from the installer, elevated, and does four things:

      1. writes the protected machine settings (kayan.env) with a random
         database password and random JWT secrets,
      2. initializes the bundled PostgreSQL 17 cluster (once, and never over
         an existing one),
      3. registers and starts the KayanERPPostgreSQL Windows service,
      4. creates the erp_app role and the erp_kayan database, and
      5. prepares that database for the program - a backup first, then the
         same migrations the program would run on its own.

    It never deletes, resets or overwrites an existing database.

    The customer's answer on Setup's company page arrives as -CompanyMode and
    decides which of two very different things this is allowed to do:

      New       an empty database and the first-run screen. If this computer
                already holds company data, setup stops and says so; a "new
                company" is never a quiet wipe of an old one.
      Existing  this computer's database is kept, checked to be a KAYAN
                database owned by this installation, backed up, and upgraded
                in place. If no database is here, setup stops and says so
                instead of creating an empty one over the customer's data.

    Two Windows details decide how this works, and both of them used to make
    the setup fail on a fresh machine:

    a) PostgreSQL refuses to run with administrative permissions. Its own
       check (src/backend/main/main.c) aborts with "Execution of PostgreSQL
       by a user with administrative permissions is not permitted." before
       the server does anything at all, and that includes the bootstrap
       backend that initdb starts. The installer runs elevated, so initdb
       is started here with a token whose Administrators and Power Users
       groups are marked deny-only - exactly what a normal, non-elevated
       administrator session looks like. The server itself runs as the
       restricted LocalService account, which is not an administrator.

    b) The cluster has to be created inside its final data directory. The
       files PostgreSQL creates inherit the permissions of the directory
       they are created in, and the service account needs to be able to
       write every one of them. A cluster that is built somewhere else and
       moved afterwards keeps the permissions of the place it came from, and
       the server then cannot write its own WAL files.

    Every step records what it is doing in %ProgramData%\KAYAN-ERP\logs\
    installer.log, and the failing step is named in the error the customer
    sees. Connection strings and passwords are redacted everywhere.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$UserSettingsPath,
  [string]$ProgramDataRoot = (Join-Path $env:ProgramData 'KAYAN-ERP'),
  # 'Auto' keeps the behaviour of callers that predate the company page: a
  # database on disk is treated as an existing company, nothing on disk as a
  # new one. Setup always passes the answer the customer gave.
  [ValidateSet('New','Existing','Auto')][string]$CompanyMode = 'Auto'
)
$ErrorActionPreference = 'Stop'
$bootstrapLog = Join-Path (Join-Path $env:ProgramData 'KAYAN-ERP') 'logs\installer.log'
$resultLog = Join-Path (Join-Path $env:ProgramData 'KAYAN-ERP') 'logs\installer-result.txt'
$script:stage = 'starting'
$script:unprivilegedReady = $false

function Protect-Secret([string]$Text) {
  # Nothing that reaches a log file may contain a password or a connection
  # string. The log is protected, but it is still a file on the machine.
  if ([string]::IsNullOrEmpty($Text)) { return '' }
  $protected = [regex]::Replace($Text, '(?i)postgres(?:ql)?://[^\s"'']+', '[DATABASE URL REDACTED]')
  $protected = [regex]::Replace($protected, '(?i)(password\s*[=:]\s*)[^\s;]+', '$1[REDACTED]')
  $protected = [regex]::Replace($protected, "(?i)(password\s+')[^']+(')", '$1[REDACTED]$2')
  return $protected
}

function Write-Result([string]$Message) {
  # The one line the installer shows the customer when something goes wrong.
  # It is written without a byte order mark, so the installer can read it as
  # it is, and it always stays on a single short line.
  try {
    $single = (Protect-Secret $Message) -replace '[\r\n]+', ' '
    if ($single.Length -gt 400) { $single = $single.Substring(0, 400) }
    [IO.File]::WriteAllText($resultLog, $single, (New-Object Text.UTF8Encoding($false)))
  } catch { }
}

function Write-RuntimeMarker([string]$Message) {
  # A lighthouse for support and CI: whatever happens, the last marker in the
  # protected log says how far the runtime setup got.
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bootstrapLog) | Out-Null
    Add-Content -LiteralPath $bootstrapLog -Value ("{0:u} {1}" -f (Get-Date),(Protect-Secret $Message)) -Encoding UTF8
  } catch { }
}

function Set-Stage([string]$Name) {
  # The stage is what the customer is told when something goes wrong, so it
  # has to say which part of the setup actually failed.
  $script:stage = $Name
  Write-RuntimeMarker ("KAYAN-RUNTIME-STAGE " + $Name)
  Write-Result ("Last completed step: " + $Name)
}

Write-RuntimeMarker 'KAYAN-RUNTIME-START'
Write-Result 'Last completed step: starting'
trap {
  try {
    $message = $_.Exception.Message
    Write-RuntimeMarker ("KAYAN-RUNTIME-FAILED stage=" + $script:stage + " " + $message)
    # The line the installer shows the customer: the step that failed and
    # what PostgreSQL said about it.
    Write-Result ("Failing step: " + $script:stage + ": " + $message)
  } catch { }
  Write-Output ("KAYAN runtime setup failed during the '" + $script:stage + "' step. Nothing was deleted; see the protected installer log for a redacted diagnostic.")
  exit 1
}
$serviceName = 'KayanERPPostgreSQL'
# The service account is deliberately a restricted built-in account: the
# PostgreSQL server refuses to run with administrative permissions, and this
# account has none.
$serviceAccount = 'NT AUTHORITY\LocalService'
$pgRoot = Join-Path $PSScriptRoot 'backend\postgres'
$pgBin = Join-Path $pgRoot 'bin'
$pgData = Join-Path $ProgramDataRoot 'PostgreSQL\data'
$pgDataParent = Split-Path -Parent $pgData
$pgLog = Join-Path $ProgramDataRoot 'logs\postgresql.log'
$logDirectory = Split-Path -Parent $pgLog
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

Set-Stage 'installing the Microsoft Visual C++ runtime'
$vcRuntime = Join-Path $PSScriptRoot 'prerequisites\vc_redist.x64.exe'
if (Test-Path $vcRuntime) {
  $vc = Start-Process -FilePath $vcRuntime -ArgumentList '/install','/quiet','/norestart' -Wait -PassThru -WindowStyle Hidden
  if ($vc.ExitCode -notin @(0,1638,3010)) { throw "Microsoft Visual C++ runtime installation failed ($($vc.ExitCode))." }
}

Set-Stage 'checking the bundled PostgreSQL runtime'
foreach ($required in @('initdb.exe','pg_ctl.exe','pg_isready.exe','psql.exe')) {
  if (-not (Test-Path (Join-Path $pgBin $required))) {
    throw "The bundled PostgreSQL runtime is incomplete: $required is missing."
  }
}
if (-not (Test-Path (Join-Path $PSScriptRoot 'backend\node\node.exe'))) { throw 'Bundled Node runtime is missing.' }

Set-Stage 'preparing the PostgreSQL bootstrap helper'
try {
  $helperPath = Join-Path $PSScriptRoot 'UnelevatedProcess.cs'
  if (-not (Test-Path -LiteralPath $helperPath)) { throw "The PostgreSQL bootstrap helper is missing: $helperPath" }
  if (-not ('Kayan.UnelevatedProcess' -as [type])) { Add-Type -Path $helperPath }
  $script:unprivilegedReady = $true
} catch {
  # Not fatal by itself: PostgreSQL's own initdb narrows its token when it
  # can. If it cannot, the failure below says so in plain words.
  Write-RuntimeMarker ("KAYAN-RUNTIME-HELPER-UNAVAILABLE " + (Protect-Secret $_.Exception.Message))
}

function Test-CurrentTokenIsAdministrator {
  # PostgreSQL rejects either of these groups when enabled in its process
  # token. The restricted bootstrap helper disables both.
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or
      $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::PowerUser))
  } catch { return $false }
}

function Invoke-Pg([string]$Exe, [string[]]$Arguments) {
  # Preserve PostgreSQL's actual diagnostic output in the protected installer
  # log. First-run failures otherwise look identical to users and CI even when
  # the underlying causes differ.
  # Windows PowerShell 5.1 turns native stderr lines into error records when
  # they are redirected; with ErrorActionPreference=Stop that would abort a
  # perfectly healthy command that only wrote a note to stderr.
  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $commandOutput = @(& $Exe @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousEap
  }
  if ($exitCode -ne 0) {
    $details = ($commandOutput | Out-String).Trim()
    if ($details.Length -gt 4000) { $details = $details.Substring(0,4000) }
    throw "PostgreSQL command failed ($exitCode): $([IO.Path]::GetFileName($Exe)). Output: $details"
  }
  if ($commandOutput.Count -gt 0) { $commandOutput | ForEach-Object { Write-Output $_ } }
}

function Get-DatabaseScalar([string]$Database, [string]$User, [string]$Sql) {
  # One value out of the bundled psql, through the same error handling the
  # rest of this script uses. -tA prints the value and nothing else, and
  # ON_ERROR_STOP turns a bad query into a non-zero exit instead of an empty
  # line that would read like a legitimate answer.
  $psql = Join-Path $pgBin 'psql.exe'
  $lines = Invoke-Pg -Exe $psql -Arguments @('-h','127.0.0.1','-p','5432','-U',$User,'-d',$Database,'-tA','-v','ON_ERROR_STOP=1','-c',$Sql)
  $value = @($lines | Where-Object { $null -ne $_ -and ("$_").Trim() -ne '' } | Select-Object -Last 1)
  if ($value.Count -eq 0) { return '' }
  return ("$($value[0])").Trim()
}

function Invoke-DatabasePrepare([hashtable]$Settings, [int]$CompanyCount) {
  # The program already prepares its database on every launch: the migrations
  # and the KAYAN-DB-STATE line below come from that same script. Running it
  # here means Setup can tell the customer whether the upgrade worked, and it
  # happens only after the previous schema is safely in a verified backup.
  $prepare = Join-Path $PSScriptRoot 'backend\scripts\prepare-database.mjs'
  if (-not (Test-Path -LiteralPath $prepare)) {
    Write-RuntimeMarker 'KAYAN-DB-PREPARE-UNAVAILABLE (script missing from the package)'
    return ''
  }
  if (-not $Settings['ADMIN_DATABASE_URL']) {
    Write-RuntimeMarker 'KAYAN-DB-PREPARE-UNAVAILABLE (no administrator connection in settings)'
    return ''
  }
  if ($CompanyCount -gt 0) {
    Set-Stage 'backing up the company database before the upgrade'
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupDir = Join-Path $ProgramDataRoot ('backups\before-upgrade-' + $stamp)
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Set-PrivateAcl $backupDir @('BUILTIN\Administrators')
    $dumpFile = Join-Path $backupDir 'before-upgrade.dump'
    # pg_dump is not given a prompt; the password comes from the same
    # connection string the program uses.
    $dumpPassword = ''
    if ($Settings['DATABASE_URL'] -match '^postgresql://[^:]+:([^@]+)@') { $dumpPassword = $matches[1] }
    if (-not $dumpPassword) { throw 'The settings do not carry a database password, so no backup could be taken before the upgrade. Nothing was changed.' }
    $env:PGPASSWORD = $dumpPassword
    try {
      Invoke-Pg -Exe (Join-Path $pgBin 'pg_dump.exe') -Arguments @('-h','127.0.0.1','-p','5432','-U','erp_app','-d','erp_kayan','-Fc','--no-password','-f',$dumpFile) | Out-Null
      if (-not (Test-Path -LiteralPath $dumpFile)) {
        throw 'The backup taken before the upgrade was not written, so the upgrade stopped before changing the database.'
      }
      $file = Get-Item -LiteralPath $dumpFile
      if ($file.Length -le 0) {
        throw 'The backup taken before the upgrade is empty, so the upgrade stopped before changing the database.'
      }
      $toc = @(Invoke-Pg -Exe (Join-Path $pgBin 'pg_restore.exe') -Arguments @('--list',$dumpFile) | Where-Object { "$_" -match '^\d+;' })
    } finally {
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
    if ($toc.Count -eq 0) {
      throw 'The backup taken before the upgrade cannot be read back, so the upgrade stopped before changing the database.'
    }
    Write-RuntimeMarker ("KAYAN-UPGRADE-BACKUP-OK " + $dumpFile + " (" + $file.Length + " bytes, " + $toc.Count + " objects)")
  }

  Set-Stage 'applying the database upgrade'
  $node = Join-Path $PSScriptRoot 'backend\node\node.exe'
  if (-not (Test-Path -LiteralPath $node)) { throw 'The bundled Node runtime is missing, so the database upgrade could not run.' }
  $env:DATABASE_URL = $Settings['DATABASE_URL']
  $env:ADMIN_DATABASE_URL = $Settings['ADMIN_DATABASE_URL']
  try {
    $output = Invoke-Pg -Exe $node -Arguments @($prepare)
  } finally {
    Remove-Item Env:DATABASE_URL,Env:ADMIN_DATABASE_URL -ErrorAction SilentlyContinue
  }
  $state = ''
  foreach ($line in @($output)) {
    if ("$line" -match 'KAYAN-DB-STATE=(\w+)') { $state = $matches[1] }
  }
  if (-not $state) { $state = 'unknown' }
  Write-RuntimeMarker ("KAYAN-UPGRADE-MIGRATIONS-OK state=" + $state)
  return $state
}

function Invoke-PgBootstrap([string]$Exe, [string[]]$Arguments, [string]$WorkingDirectory) {
  # initdb starts postgres in bootstrap mode, and PostgreSQL rejects a process
  # whose token has enabled Administrators/Power Users membership. Its own
  # restricted-token re-exec can be blocked by endpoint security policy. Start
  # it with PostgreSQL-compatible restricted credentials ourselves and set
  # PG_RESTRICT_EXEC so initdb does not need a second re-exec.
  $outputFile = Join-Path $logDirectory ('initdb-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.log')
  $isPrivileged = Test-CurrentTokenIsAdministrator
  if ($isPrivileged -and -not $script:unprivilegedReady) {
    throw 'The PostgreSQL restricted-token helper could not be prepared. Refusing to start initdb with administrative permissions.'
  }
  if (-not $isPrivileged) {
    Write-RuntimeMarker 'KAYAN-RUNTIME-BOOTSTRAP-DIRECT-NONADMIN'
    Invoke-Pg -Exe $Exe -Arguments $Arguments
    return
  }

  # The helper starts the program itself, so quote the paths with spaces.
  $quoted = @($Arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"','\"') + '"' } else { $_ } })
  $oldRestrictExec = $env:PG_RESTRICT_EXEC
  try {
    # PostgreSQL initdb otherwise repeats the same CreateProcessAsUser step
    # internally, the Windows security-policy failure this helper avoids.
    $env:PG_RESTRICT_EXEC = '1'
    Write-RuntimeMarker 'KAYAN-RUNTIME-BOOTSTRAP-RESTRICTED'
    $exitCode = [Kayan.UnelevatedProcess]::Run($Exe, ($quoted -join ' '), $WorkingDirectory, $outputFile, 900000)
  } catch {
    $reason = Protect-Secret $_.Exception.Message
    Write-RuntimeMarker ("KAYAN-RUNTIME-BOOTSTRAP-HELPER-FAILED " + $reason)
    throw "PostgreSQL restricted-token bootstrap could not start: $reason"
  } finally {
    if ($null -eq $oldRestrictExec) { Remove-Item Env:PG_RESTRICT_EXEC -ErrorAction SilentlyContinue }
    else { $env:PG_RESTRICT_EXEC = $oldRestrictExec }
  }

  $output = ''
  if (Test-Path -LiteralPath $outputFile) { $output = Get-Content -LiteralPath $outputFile -Raw -ErrorAction SilentlyContinue }
  if ($output) { Write-Output (Protect-Secret $output) }
  if ($exitCode -ne 0) {
    $details = ($output | Out-String).Trim()
    if ($details.Length -gt 4000) { $details = $details.Substring(0,4000) }
    throw "PostgreSQL initialization failed ($exitCode). Output: $(Protect-Secret $details)"
  }
}

function Invoke-PsqlInput([string]$Exe, [string[]]$Arguments, [string]$Sql) {
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $Exe
  $start.Arguments = $Arguments -join ' '
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
  if ($process.ExitCode -ne 0) {
    $details = (($stdout + "`n" + $stderr) | Out-String).Trim()
    if ($details.Length -gt 4000) { $details = $details.Substring(0,4000) }
    throw "PostgreSQL initialization SQL failed ($($process.ExitCode)). Output: $(Protect-Secret $details)"
  }
}
function Test-ExistingPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  if (Test-Path -LiteralPath $Path) { return $true }
  $parent = Split-Path -Parent $Path
  $leaf = Split-Path -Leaf $Path
  if (-not $parent -or -not $leaf) { return $false }
  if (-not (Test-Path -LiteralPath $parent)) { return $false }
  $found = @(Get-ChildItem -LiteralPath $parent -Filter $leaf -Force -ErrorAction SilentlyContinue)
  return ($found.Count -gt 0)
}

function Recover-RawAcl([string]$Path) {
  if (-not (Test-ExistingPath $Path)) { return }
  if ($script:unprivilegedReady) {
    try { [Kayan.UnelevatedProcess]::RecoverFileAccess($Path) } catch { }
  }
  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & takeown.exe /F $Path *> $null
    if ($LASTEXITCODE -ne 0) { & takeown.exe /F $Path /A *> $null }
    & icacls.exe $Path /reset *> $null
    & attrib.exe -R -S -H $Path *> $null
  } finally {
    $ErrorActionPreference = $previousEap
  }
}

function Set-PrivateAcl([string]$Path, [string[]]$Principals) {
  # Strict least-privilege: SYSTEM, Administrators, and explicitly authorized
  # user(s). NEVER grant BUILTIN\Users or Everyone access to database passwords
  # or signing secrets. One /grant:r per principal on purpose: icacls rejects
  # multi-token grants on some builds and can leave the object with inheritance
  # removed but no grants at all - invisible even to its creator.
  if (-not (Test-ExistingPath $Path)) { throw "Cannot secure missing path: $Path" }
  if (-not (Test-Path -LiteralPath $Path)) { Recover-RawAcl $Path }
  # Container ACEs carry (OI)(CI); file ACEs must not - icacls refuses the
  # whole grant otherwise and the object ends up with an empty DACL.
  $inherit = if (Test-Path -LiteralPath $Path -PathType Container) { '(OI)(CI)F' } else { 'F' }
  # The caller's own SID always works even when a UAC-filtered token makes
  # BUILTIN\Administrators a deny-only group.
  $mine = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $grants = @('SYSTEM', 'BUILTIN\Administrators', $mine) + @($Principals | Where-Object { $_ })
  $grants = @($grants | Select-Object -Unique)
  $aclArgs = @($Path, '/inheritance:r')
  foreach ($who in $grants) {
    $spec = if ($who -match '^S-1-') { "*$who`:$inherit" } else { "$who`:$inherit" }
    $aclArgs += '/grant:r'
    $aclArgs += $spec
  }
  & icacls.exe @aclArgs | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Recover-RawAcl $Path
    # Non-English Windows fallback using well-known SIDs:
    # S-1-5-18 = SYSTEM, S-1-5-32-544 = Administrators
    $sidArgs = @($Path, '/inheritance:r')
    foreach ($who in $grants) {
      $sid = if ($who -match '^S-1-') { $who } else {
        try { (New-Object Security.Principal.NTAccount($who)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { $null }
      }
      if ($sid) { $sidArgs += '/grant:r'; $sidArgs += "*$sid`:$inherit" }
    }
    & icacls.exe @sidArgs | Out-Null
    if ($LASTEXITCODE -ne 0) {
      # Never leave an object with inheritance stripped and no grants.
      & icacls.exe $Path /inheritance:e | Out-Null
      throw "Could not secure $Path with icacls."
    }
  }
}

function Repair-ProtectedFileAccess([string]$Path, [string[]]$Principals) {
  if (-not (Test-ExistingPath $Path)) { return $false }
  $needsRecovery = $false
  try {
    [void][IO.File]::ReadAllBytes($Path)
  } catch {
    $needsRecovery = $true
  }
  if (-not $needsRecovery) {
    try {
      $aclText = (@(& icacls.exe $Path 2>$null) -join ' ')
      if ($aclText -notmatch ':\((?:[^)]*F|[^)]*M|[^)]*W)') { $needsRecovery = $true }
    } catch { $needsRecovery = $true }
  }
  if ($needsRecovery) {
    Write-RuntimeMarker ("KAYAN-RUNTIME-ACL-RECOVERING " + $Path)
    Recover-RawAcl $Path
    Write-RuntimeMarker ("KAYAN-RUNTIME-ACL-RECOVERED " + $Path)
  }
  Set-PrivateAcl $Path $Principals
  return $true
}

function Read-SettingsFile([string]$Path, [string[]]$Principals) {
  $map = @{}
  if (-not (Test-ExistingPath $Path)) { return $map }
  [void](Repair-ProtectedFileAccess $Path $Principals)
  foreach ($line in Get-Content -LiteralPath $Path) {
    $clean = $line.TrimStart([char]0xFEFF)
    if ($clean -match '^\s*([A-Z_]+)="?(.*?)"?\s*$') {
      $map[$matches[1]] = $matches[2].Trim('"')
    }
  }
  return $map
}

function Secure-PgDataDirectory([switch]$Recurse) {
  # The service account has to be able to read and write every file of the
  # cluster, and no other local user may read them.
  #
  # The container carries the wanted principals with inheritable rights, and
  # every file inside inherits them again.
  Set-PrivateAcl $pgData @($serviceAccount)
  if (-not $Recurse) { return }
  # A cluster that was created somewhere else - by an older installer, or by
  # a different tool - may retain explicit grants from its former directory.
  # Merely enabling inheritance would leave those grants in place. Reset the
  # ACLs on the data tree so every object inherits only the protected grants
  # on this directory; this changes file permissions, never database content.
  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & icacls.exe $pgData /reset /T /C | Out-Null
    $aclExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousEap
  }
  if ($aclExit -ne 0) { throw "Could not reset inherited PostgreSQL data-directory permissions (icacls exit $aclExit). Database files were not changed." }
  # Reapply a protected ACL at the cluster root. Its inheritable grants flow
  # to every existing and future file and directory below it.
  Set-PrivateAcl $pgData @($serviceAccount)
}

function Get-ActiveDesktopUserContext {
  $userName = $null
  try {
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    if ($cs -and $cs.UserName) { $userName = $cs.UserName }
  } catch { }

  if (-not $userName) {
    try {
      $explorer = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($explorer) {
        $owner = Invoke-CimMethod -InputObject $explorer -MethodName GetOwner -ErrorAction SilentlyContinue
        if ($owner -and $owner.User) {
          $userName = if ($owner.Domain) { "$($owner.Domain)\$($owner.User)" } else { $owner.User }
        }
      }
    } catch { }
  }

  if (-not $userName) {
    $userName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  }

  $sid = $null
  $profilePath = $null
  try {
    $account = New-Object Security.Principal.NTAccount($userName)
    $sidObj = $account.Translate([Security.Principal.SecurityIdentifier])
    $sid = $sidObj.Value
    $profileRecord = Get-CimInstance Win32_UserProfile -ErrorAction SilentlyContinue | Where-Object { $_.SID -eq $sid } | Select-Object -First 1
    if ($profileRecord) { $profilePath = $profileRecord.LocalPath }
  } catch { }

  return [PSCustomObject]@{
    UserName = $userName
    Sid = $sid
    ProfilePath = $profilePath
  }
}
# A running Windows service is not the same thing as a PostgreSQL that accepts
# connections. Ask the server itself before anything (Prisma included) touches
# the database, so a slow start is waited out and a real failure is reported.
function Get-PgLogTail {
  # The newest PostgreSQL log lines, for the error a person will actually see.
  try {
    $newest = Get-ChildItem -Path $logDirectory -Filter 'postgresql-*.log' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newest) {
      $tail = (Get-Content -LiteralPath $newest.FullName -Tail 20 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
      if ($tail) { return "[postgresql log $($newest.Name)]$([Environment]::NewLine)$tail" }
    }
    if (Test-Path -LiteralPath $pgLog) {
      $tail = (Get-Content -LiteralPath $pgLog -Tail 20 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
      if ($tail) { return "[postgresql log]$([Environment]::NewLine)$tail" }
    }
  } catch { }
  return '(no PostgreSQL log output was found)'
}
function Get-ServiceEventTail {
  # The Windows event log is where a service that dies immediately leaves its
  # own last words. Best effort only.
  try {
    $events = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = (Get-Date).AddMinutes(-15) } -MaxEvents 40 -ErrorAction SilentlyContinue |
      Where-Object { $_.ProviderName -match 'postgres|Service Control Manager' -or $_.Message -match 'postgres' } |
      Select-Object -First 6
    if ($events) {
      $lines = foreach ($event in $events) {
        '{0:u} {1}: {2}' -f $event.TimeCreated, $event.ProviderName, (($event.Message -replace '\s+',' ').Trim())
      }
      return ($lines -join [Environment]::NewLine)
    }
  } catch { }
  return ''
}
function Wait-PgReady {
  $ready = Join-Path $pgBin 'pg_isready.exe'
  if (-not (Test-Path $ready)) { throw 'Bundled PostgreSQL readiness tool is missing.' }
  $deadline = (Get-Date).AddSeconds(90)
  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    while ((Get-Date) -lt $deadline) {
      & $ready -h 127.0.0.1 -p 5432 -U postgres *> $null
      if ($LASTEXITCODE -eq 0) { return }
      Start-Sleep -Seconds 1
    }
  } finally {
    $ErrorActionPreference = $previousEap
  }
  $events = Get-ServiceEventTail
  $message = 'PostgreSQL did not accept connections before the 90 second deadline. Existing data was not changed. ' + (Get-PgLogTail)
  if ($events) { $message += [Environment]::NewLine + $events }
  throw $message
}
function Start-PgService {
  $current = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if (-not $current) { throw "The PostgreSQL service '$serviceName' is not registered. " + (Get-PgLogTail) }
  if ($current.Status -ne 'Running') {
    try {
      Start-Service -Name $serviceName
      (Get-Service -Name $serviceName).WaitForStatus('Running',[TimeSpan]::FromSeconds(60))
    } catch {
      throw ("The PostgreSQL service '$serviceName' did not start. " + (Get-PgLogTail))
    }
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

Set-Stage 'creating the protected installation folders'
New-Item -ItemType Directory -Force -Path $ProgramDataRoot, $pgDataParent, $logDirectory | Out-Null
if ($UserSettingsPath) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $UserSettingsPath) | Out-Null
}
Set-PrivateAcl $ProgramDataRoot @('BUILTIN\Administrators', $serviceAccount)
Set-PrivateAcl $pgDataParent @('BUILTIN\Administrators', $serviceAccount)
Set-PrivateAcl $logDirectory @('BUILTIN\Administrators', $serviceAccount)

function Get-AuthorizedSettingsPrincipals {
  $activeContext = Get-ActiveDesktopUserContext
  $authorizedPrincipals = @()
  if ($activeContext.Sid) { $authorizedPrincipals += $activeContext.Sid }
  if ($activeContext.UserName) { $authorizedPrincipals += $activeContext.UserName }
  return [PSCustomObject]@{
    Context = $activeContext
    Principals = $authorizedPrincipals
  }
}

function Save-UserSettings([hashtable]$Values) {
  $authInfo = Get-AuthorizedSettingsPrincipals
  $activeContext = $authInfo.Context
  $authorizedPrincipals = $authInfo.Principals
  $body = @('# KAYAN ERP machine-local runtime configuration; do not share this file.') + @($Values.GetEnumerator() | Sort-Object Key | ForEach-Object { '{0}="{1}"' -f $_.Key,$_.Value })

  # 1. Save to the designated user settings path (caller profile)
  if ($UserSettingsPath) {
    Set-PrivateAcl (Split-Path -Parent $UserSettingsPath) $authorizedPrincipals
    if (Test-ExistingPath $UserSettingsPath) {
      [void](Repair-ProtectedFileAccess $UserSettingsPath $authorizedPrincipals)
    }
    Set-Content -LiteralPath $UserSettingsPath -Value $body -Encoding ASCII
    Set-PrivateAcl $UserSettingsPath $authorizedPrincipals
  }

  # 2. If the active desktop user is a standard user whose profile differs from caller,
  # securely provision their private AppData settings so they can run the ERP immediately
  if ($activeContext.ProfilePath) {
    $activeUserKayanDir = Join-Path $activeContext.ProfilePath 'AppData\Roaming\KAYAN-ERP'
    $activeUserKayanEnv = Join-Path $activeUserKayanDir 'kayan.env'
    if ($activeUserKayanEnv -ne $UserSettingsPath) {
      New-Item -ItemType Directory -Force -Path $activeUserKayanDir | Out-Null
      Set-PrivateAcl $activeUserKayanDir $authorizedPrincipals
      if (Test-ExistingPath $activeUserKayanEnv) {
        [void](Repair-ProtectedFileAccess $activeUserKayanEnv $authorizedPrincipals)
      }
      Set-Content -LiteralPath $activeUserKayanEnv -Value $body -Encoding ASCII
      Set-PrivateAcl $activeUserKayanEnv $authorizedPrincipals
    }
  }

  # 3. Secure machine-level fallback in ProgramData:
  # Strictly restricted to SYSTEM, Administrators, and the active authorized user.
  # BUILTIN\Users has NO ACCESS.
  $machineConfig = Join-Path $ProgramDataRoot 'kayan.env'
  if (Test-ExistingPath $machineConfig) {
    [void](Repair-ProtectedFileAccess $machineConfig $authorizedPrincipals)
  }
  Set-Content -LiteralPath $machineConfig -Value $body -Encoding ASCII
  Set-PrivateAcl $machineConfig $authorizedPrincipals
}

$authInfo = Get-AuthorizedSettingsPrincipals
$initialPrincipals = $authInfo.Principals
if (Test-ExistingPath $bootstrapMarker) {
  [void](Repair-ProtectedFileAccess $bootstrapMarker @('BUILTIN\Administrators', $serviceAccount))
}
$machineSettingsPath = Join-Path $ProgramDataRoot 'kayan.env'
$machineSettings = Read-SettingsFile $machineSettingsPath $initialPrincipals
$userSettings = Read-SettingsFile $UserSettingsPath $initialPrincipals
$settings = @{}
foreach ($entry in $machineSettings.GetEnumerator()) {
  $settings[$entry.Key] = $entry.Value
}
foreach ($entry in $userSettings.GetEnumerator()) {
  $settings[$entry.Key] = $entry.Value
}
$bundledDbUrlPattern = '^postgresql://erp_app:([a-fA-F0-9]+)@127\.0\.0\.1:5432/erp_kayan\?schema=public$'
if ($machineSettings['DATABASE_URL'] -match $bundledDbUrlPattern -and
    $userSettings['DATABASE_URL'] -and
    $userSettings['DATABASE_URL'] -notmatch $bundledDbUrlPattern) {
  $settings['DATABASE_URL'] = $machineSettings['DATABASE_URL']
  if ($machineSettings['ADMIN_DATABASE_URL']) {
    $settings['ADMIN_DATABASE_URL'] = $machineSettings['ADMIN_DATABASE_URL']
  }
}
$settingsExists = $settings.Count -gt 0
$clusterExists = Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION')

# ── A new company or the one already on this computer ───────────────────────
# The answer decides everything below, so it is resolved before anything is
# written, started or created.
# Repair runs this script without the page's answer; 'Auto' then means "do
# the safe thing", and only a mode the customer actually chose is held to the
# strict refusals below.
$CompanyModeChosen = $CompanyMode -ne 'Auto'
if ($CompanyMode -eq 'Auto') {
  $CompanyMode = if ($clusterExists) { 'Existing' } else { 'New' }
}
Write-RuntimeMarker ("KAYAN-COMPANY-MODE " + $CompanyMode)
if ($CompanyMode -eq 'Existing' -and -not $clusterExists) {
  throw 'Setup was told to keep an existing company, but this computer has no KAYAN database yet. Nothing was installed and nothing was deleted. Run Setup again and choose "A new company" on the company page.'
}

if (-not $clusterExists) {
  # The only mode that makes sense on a machine with no database: a new
  # company. Saying so in the log is what lets support and CI tell the two
  # paths apart afterwards.
  Write-RuntimeMarker 'KAYAN-COMPANY-NEW-CLUSTER'
  Set-Stage 'preparing the PostgreSQL data directory'
  if (Test-Path $pgData) {
    if (Get-ChildItem -LiteralPath $pgData -Force -ErrorAction SilentlyContinue | Select-Object -First 1) {
      throw 'The PostgreSQL data directory exists but is not initialized. Refusing to remove or overwrite it.'
    }
  }
  if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    throw "A KAYAN PostgreSQL service is registered but its data directory is missing. The service was left untouched and no data was changed. Remove the leftover '$serviceName' service manually, or restore the database directory, before reinstalling."
  }
  if ($settingsExists) {
    $existingDbUrl = $settings['DATABASE_URL']
    if ($existingDbUrl -match $bundledDbUrlPattern) {
      $dbPassword = $matches[1]
    } elseif ($existingDbUrl -eq 'postgresql://erp_app:postgres@127.0.0.1:5433/erp_kayan?schema=public') {
      # Uninitialized first-run placeholder created by the desktop shell before
      # the bundled PostgreSQL runtime was set up; preserve JWT secrets and
      # provision the local 5432 database credential.
      $dbPassword = New-Secret
    } elseif (-not (Test-Path -LiteralPath $bootstrapMarker)) {
      throw 'Existing runtime settings were found without a KAYAN database cluster. They were preserved; refusing to overwrite or repurpose them.'
    } else {
      throw 'An existing user settings file points outside the bundled local database. It was preserved; refusing to replace those settings or initialize an unrelated database.'
    }
  } else { $dbPassword = New-Secret }
  $settings['DATABASE_URL'] = "postgresql://erp_app:$dbPassword@127.0.0.1:5432/erp_kayan?schema=public"
  $settings['ADMIN_DATABASE_URL'] = "postgresql://postgres:$dbPassword@127.0.0.1:5432/postgres?schema=public"
  if (-not $settings['JWT_ACCESS_SECRET']) { $settings['JWT_ACCESS_SECRET'] = New-Secret }
  if (-not $settings['JWT_REFRESH_SECRET']) { $settings['JWT_REFRESH_SECRET'] = New-Secret }
  if (-not $settings['JWT_ACCESS_TTL']) { $settings['JWT_ACCESS_TTL'] = '900' }
  if (-not $settings['JWT_REFRESH_TTL']) { $settings['JWT_REFRESH_TTL'] = '1209600' }
  # The data directory and the log directory are created here, with the
  # service account already able to use them, and with inheritance switched
  # on. Everything PostgreSQL creates inside them inherits these rights, so
  # the service can write its own files.
  Set-PrivateAcl $ProgramDataRoot @('BUILTIN\Administrators', $serviceAccount)
  Set-PrivateAcl $pgDataParent @('BUILTIN\Administrators', $serviceAccount)
  Set-PrivateAcl $logDirectory @('BUILTIN\Administrators', $serviceAccount)
  # Persist recovery information before touching the new cluster. If setup is
  # interrupted, a rerun reuses these values rather than changing user config.
  if (-not (Test-ExistingPath $bootstrapMarker)) {
    Set-Content -LiteralPath $bootstrapMarker -Value 'KAYAN PostgreSQL 17 installer bootstrap v1' -Encoding ASCII
  }
  [void](Repair-ProtectedFileAccess $bootstrapMarker @('BUILTIN\Administrators', $serviceAccount))
  Save-UserSettings $settings
  # The cluster is created inside its final directory. PostgreSQL inherits the
  # permissions of the directory it creates its files in, and the service
  # account has to be able to write every one of them.
  if (-not (Test-Path -LiteralPath $pgData -PathType Container)) {
    [void][IO.Directory]::CreateDirectory($pgData)
  }
  if (-not (Test-Path -LiteralPath $pgData -PathType Container)) {
    throw "The cluster directory could not be created: $pgData"
  }
  Set-PrivateAcl $pgData @('BUILTIN\Administrators', $serviceAccount)
  # Keep the one-time bootstrap password file in the installer process's own
  # temporary directory, not ProgramDataRoot: that directory is deliberately
  # restricted to SYSTEM/Administrators and may exclude the interactive token
  # that launches initdb on Windows.
  $tempPassword = Join-Path $env:TEMP ('kayan-postgres-init-' + [guid]::NewGuid().ToString('N') + '.tmp')
  [IO.File]::WriteAllText($tempPassword, $dbPassword, [Text.Encoding]::ASCII)
  $currentIdentitySid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  Set-PrivateAcl $tempPassword @($currentIdentitySid)

  Set-Stage 'initializing the PostgreSQL cluster'
  try {
    Invoke-PgBootstrap -Exe (Join-Path $pgBin 'initdb.exe') -Arguments @('-D',$pgData,'-U','postgres','-A','scram-sha-256','--pwfile',$tempPassword,'-E','UTF8') -WorkingDirectory $pgBin
  } finally { Remove-Item -LiteralPath $tempPassword -Force -ErrorAction SilentlyContinue }
  if (-not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
    throw 'PostgreSQL did not create a usable cluster in the data directory.'
  }

  Set-Stage 'configuring the PostgreSQL cluster'
  $conf = Join-Path $pgData 'postgresql.conf'
  Add-Content -LiteralPath $conf -Value "`n# KAYAN local-only database configuration`nlisten_addresses = '127.0.0.1'`nport = 5432`npassword_encryption = 'scram-sha-256'`nlogging_collector = on`nlog_directory = '$($ProgramDataRoot.Replace('\','/'))/logs'`nlog_filename = 'postgresql-%Y-%m-%d.log'`n"
  $hba = Join-Path $pgData 'pg_hba.conf'
  Set-Content -LiteralPath $hba -Value @('# TYPE  DATABASE        USER            ADDRESS                 METHOD','local   all             all                                     scram-sha-256','host    all             all             127.0.0.1/32            scram-sha-256','host    all             all             ::1/128                 scram-sha-256') -Encoding ASCII

  Set-Stage 'securing the PostgreSQL data directory'
  Secure-PgDataDirectory

  Set-Stage 'registering the KayanERPPostgreSQL service'
  $pgCtl = Join-Path $pgBin 'pg_ctl.exe'
  if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
    Invoke-Pg -Exe $pgCtl -Arguments @('register','-N',$serviceName,'-U',$serviceAccount,'-D',$pgData,'-S','auto')
  }
  Set-PrivateAcl $pgData @('BUILTIN\Administrators', $serviceAccount)
  Set-PrivateAcl $logDirectory @('BUILTIN\Administrators', $serviceAccount)

  Set-Stage 'starting the KayanERPPostgreSQL service'
  Start-PgService

  Set-Stage 'creating the erp_app role and the erp_kayan database'
  $env:DATABASE_URL = "postgresql://erp_app:$dbPassword@127.0.0.1:5432/erp_kayan?schema=public"
  $env:ADMIN_DATABASE_URL = "postgresql://postgres:$dbPassword@127.0.0.1:5432/postgres?schema=public"
  $env:PGPASSWORD = $dbPassword
  try {
    Invoke-PsqlInput (Join-Path $pgBin 'psql.exe') @('-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1') "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'erp_app') THEN CREATE ROLE erp_app WITH LOGIN PASSWORD '$dbPassword'; ELSE ALTER ROLE erp_app WITH LOGIN PASSWORD '$dbPassword'; END IF; END `$`$;"
    Invoke-PsqlInput (Join-Path $pgBin 'psql.exe') @('-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1') "SELECT 'CREATE DATABASE erp_kayan OWNER erp_app' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'erp_kayan')\gexec"
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
  Remove-Item Env:DATABASE_URL,Env:ADMIN_DATABASE_URL -ErrorAction SilentlyContinue
  # The database is empty by construction: nothing here imports demo data,
  # and the first-run screen is what asks for the company and the general
  # manager. Preparing it now only creates the schema the program expects.
  Write-RuntimeMarker 'KAYAN-COMPANY-NEW-DATABASE-EMPTY (no company, no demo data)'
  [void](Invoke-DatabasePrepare $settings 0)
} else {
  Set-Stage 'checking the existing PostgreSQL cluster'
  $version = (Get-Content (Join-Path $pgData 'PG_VERSION') -Raw).Trim()
  if ($version -ne '17') { throw "Existing PostgreSQL data version $version is incompatible with bundled PostgreSQL 17. Data was not changed." }
  if (-not $settingsExists) {
    throw 'Company data was found, but the protected settings file that holds its database credentials is missing. Nothing was changed. Restore kayan.env from a backup, or move the database directory aside yourself after taking a backup of the company data.'
  }
  if (-not $settings['JWT_ACCESS_SECRET']) { $settings['JWT_ACCESS_SECRET'] = New-Secret }
  if (-not $settings['JWT_REFRESH_SECRET']) { $settings['JWT_REFRESH_SECRET'] = New-Secret }
  if (-not $settings['JWT_ACCESS_TTL']) { $settings['JWT_ACCESS_TTL'] = '900' }
  if (-not $settings['JWT_REFRESH_TTL']) { $settings['JWT_REFRESH_TTL'] = '1209600' }

  Set-Stage 'securing the PostgreSQL data directory'
  # The same rights the first install gives the cluster, so an upgrade does
  # not leave the service account unable to write its own files.
  Set-PrivateAcl $ProgramDataRoot @('BUILTIN\Administrators', $serviceAccount)
  Set-PrivateAcl $pgDataParent @('BUILTIN\Administrators', $serviceAccount)
  Set-PrivateAcl $logDirectory @('BUILTIN\Administrators', $serviceAccount)
  Secure-PgDataDirectory -Recurse

  Set-Stage 'registering the KayanERPPostgreSQL service'
  $pgCtl = Join-Path $pgBin 'pg_ctl.exe'
  if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
    Invoke-Pg -Exe $pgCtl -Arguments @('register','-N',$serviceName,'-U',$serviceAccount,'-D',$pgData,'-S','auto')
  }
  Set-PrivateAcl $logDirectory @('BUILTIN\Administrators', $serviceAccount)

  Set-Stage 'starting the KayanERPPostgreSQL service'
  Start-PgService

  # ── Is this really the KAYAN company database of this installation? ───────
  # The settings claim it. This proves it before anything is upgraded or even
  # written back: the connection has to point at the bundled cluster, the
  # database has to exist and be owned by the application role, that role has
  # to be able to sign in, and the KAYAN tables have to be there. A familiar
  # name is never on its own evidence that this is the right data.
  Set-Stage 'verifying the company database'
  if ($settings['DATABASE_URL'] -match $bundledDbUrlPattern) {
    $dbPassword = $matches[1]
  } else {
    throw 'The settings on this computer point at a database outside the bundled KAYAN PostgreSQL. Nothing was changed. Run Setup again and choose "A new company" on the company page, or point the settings back at the local database first.'
  }
  $env:PGPASSWORD = $dbPassword
  $companyCount = 0
  try {
    $owner = Get-DatabaseScalar 'postgres' 'postgres' "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'erp_kayan'"
    if ($owner -eq '') {
      if ($CompanyMode -eq 'Existing' -and $CompanyModeChosen) {
        throw 'Setup was told to keep an existing company, but this computer has no company database to keep. Nothing was changed. Run Setup again and choose "A new company" on the company page.'
      }
      Write-RuntimeMarker 'KAYAN-COMPANY-NEW-DATABASE-EMPTY (database not created yet)'
    } elseif ($owner -ne 'erp_app') {
      throw ("The database named erp_kayan on this computer belongs to another owner ('" + $owner + "'), so it is not this installation's company database. Nothing was changed. Run Setup again and choose ""A new company"", or restore this installation's own database before installing over it.")
    } else {
      $hasSchema = Get-DatabaseScalar 'erp_kayan' 'erp_app' "SELECT (to_regclass('public.companies') IS NOT NULL AND to_regclass('public._prisma_migrations') IS NOT NULL)::text"
      if ($hasSchema -ne 'true') {
        if ($CompanyMode -eq 'Existing' -and $CompanyModeChosen) {
          throw 'Setup was told to keep an existing company, but the local KAYAN database holds no company tables yet, so there is no company here to keep. Nothing was changed. Run Setup again and choose "A new company" on the company page.'
        }
        Write-RuntimeMarker 'KAYAN-COMPANY-NEW-DATABASE-EMPTY (schema not created yet)'
      } else {
        $countText = Get-DatabaseScalar 'erp_kayan' 'erp_app' 'SELECT count(*) FROM companies'
        if ($countText -notmatch '^\d+$') {
          throw 'The company database did not answer a count of its companies. Nothing was changed; see the protected installer log for what PostgreSQL said.'
        }
        $companyCount = [int]$countText
        if ($CompanyMode -eq 'New' -and $companyCount -gt 0) {
          throw ("Setup was told to create a new company, but this computer already holds company data (" + $companyCount + " company record(s)) in its KAYAN database. Nothing was deleted and nothing was upgraded. Run Setup again and choose ""An existing company"" to keep it, or use the KAYAN ERP ""Reset (start fresh)"" tool, which takes a verified backup before it creates anything.")
        }
        if ($CompanyMode -eq 'Existing') {
          Write-RuntimeMarker ("KAYAN-COMPANY-EXISTING-VERIFIED companies=" + $companyCount)
        } else {
          Write-RuntimeMarker ("KAYAN-COMPANY-NEW-DATABASE-EMPTY companies=" + $companyCount)
        }
      }
    }
    Invoke-PsqlInput (Join-Path $pgBin 'psql.exe') @('-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1') "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'erp_app') THEN CREATE ROLE erp_app WITH LOGIN PASSWORD '$dbPassword'; END IF; END `$`$;"
    Invoke-PsqlInput (Join-Path $pgBin 'psql.exe') @('-h','127.0.0.1','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1') "SELECT 'CREATE DATABASE erp_kayan OWNER erp_app' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'erp_kayan')\gexec"
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }

  # The settings file is written back only after the database has been
  # identified, and the database itself is touched only after that - with a
  # verified backup first whenever it holds a company.
  Save-UserSettings $settings
  [void](Invoke-DatabasePrepare $settings $companyCount)
}

if (-not (Test-Path -LiteralPath $UserSettingsPath)) { throw 'Per-user runtime settings were not created.' }
Set-Stage 'finished'
Write-RuntimeMarker 'KAYAN-RUNTIME-OK'
Write-Output 'KAYAN PostgreSQL is installed and running. Company database files are under ProgramData and will be kept on uninstall.'
