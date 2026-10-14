# Runs the real Windows installer on the CI runner and verifies the local API.
[CmdletBinding()]
param([string]$SetupPath = "build\desktop\KAYAN-Setup.exe")

$ErrorActionPreference = "Stop"
$setup = (Resolve-Path $SetupPath).Path
$installLog = Join-Path $env:TEMP "kayan-setup-smoke.log"
$install = Start-Process -FilePath $setup -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", ("/LOG=" + $installLog)) -Wait -PassThru
$dbLog = Join-Path $env:ProgramData "KAYAN-ERP\installer-db-setup.log"
$dbError = Join-Path $env:ProgramData "KAYAN-ERP\installer-db-setup-error.log"
if ($install.ExitCode -ne 0) {
  $details = @()
  foreach ($path in @($dbLog, $dbError, $installLog)) { if (Test-Path $path) { $details += ("--- " + $path + " ---"); $details += Get-Content $path -Tail 80 } }
  throw ("KAYAN-Setup.exe failed with exit code " + $install.ExitCode + [Environment]::NewLine + ($details -join [Environment]::NewLine))
}

$service = Get-Service -Name "KAYAN_PostgreSQL" -ErrorAction SilentlyContinue
if (-not $service) {
  $details = @()
  foreach ($path in @($dbLog, $dbError, $installLog)) { if (Test-Path $path) { $details += ("--- " + $path + " ---"); $details += Get-Content $path -Tail 80 } }
  throw ("KAYAN_PostgreSQL was not installed as a persistent service." + [Environment]::NewLine + ($details -join [Environment]::NewLine))
}
if ($service.Status -ne "Running") { throw "The installer did not start KAYAN_PostgreSQL." }
$serviceInfo = Get-CimInstance Win32_Service -Filter "Name='KAYAN_PostgreSQL'" -ErrorAction Stop
if ($serviceInfo.PathName -notlike "*$env:ProgramData\KAYAN-ERP\pgsql*") {
  throw ("KAYAN_PostgreSQL is not using its persistent ProgramData runtime: " + $serviceInfo.PathName)
}
$pgRuntime = Join-Path $env:ProgramData "KAYAN-ERP\pgsql"
foreach ($relative in @("bin\initdb.exe", "bin\pg_ctl.exe", "bin\postgres.exe", "bin\psql.exe", "bin\pg_dump.exe", "bin\pg_restore.exe", "share\postgres.bki", "share\timezone", "share\timezonesets", "lib\plpgsql.dll")) {
  $runtimePath = Join-Path $pgRuntime $relative
  if (-not (Test-Path $runtimePath)) { throw ("Installed PostgreSQL runtime is missing " + $relative) }
}
foreach ($tool in @("pg_dump.exe", "pg_restore.exe", "psql.exe", "postgres.exe")) {
  $toolPath = Join-Path $pgRuntime ("bin\" + $tool)
  $toolVersion = & $toolPath --version 2>&1
  if ($LASTEXITCODE -ne 0 -or "$toolVersion" -notmatch [regex]::Escape($tool.Replace(".exe", ""))) { throw ("Installed PostgreSQL tool failed --version: " + $toolPath + " / " + "$toolVersion") }
}
$settings = Join-Path $env:ProgramData "KAYAN-ERP\kayan.env"
if (-not (Test-Path $settings)) { throw "The installer did not write the shared runtime settings file." }

Get-Content $settings | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith("#") -and $line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
    $key = $Matches[1]
    $value = $Matches[2].Trim().Trim('"')
    Set-Item -Path ("Env:" + $key) -Value $value
  }
}

$backend = Join-Path $env:ProgramFiles "KAYAN ERP\backend"
$node = Join-Path $backend "node\node.exe"
if (-not (Test-Path $node)) { throw "The bundled Node runtime was not installed." }
$api = $null
try {
  $prepOut = Join-Path $env:TEMP "kayan-installer-prep-stdout.log"
  $prepErr = Join-Path $env:TEMP "kayan-installer-prep-stderr.log"
  $prepare = Start-Process -FilePath $node -ArgumentList @("scripts\prepare-database.mjs") -WorkingDirectory $backend -Wait -PassThru -NoNewWindow -RedirectStandardOutput $prepOut -RedirectStandardError $prepErr
  if ($prepare.ExitCode -ne 0) {
    $pOut = if (Test-Path $prepOut) { Get-Content $prepOut -Raw } else { "" }
    $pErr = if (Test-Path $prepErr) { Get-Content $prepErr -Raw } else { "" }
    throw ("Database preparation failed with exit code " + $prepare.ExitCode + [Environment]::NewLine + $pOut + [Environment]::NewLine + $pErr)
  }

  $stdout = Join-Path $env:TEMP "kayan-installer-smoke-stdout.log"
  $stderr = Join-Path $env:TEMP "kayan-installer-smoke-stderr.log"
  $api = Start-Process -FilePath $node -ArgumentList @("dist\src\main.js") -WorkingDirectory $backend -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $health = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($api.HasExited) {
      $out = if (Test-Path $stdout) { Get-Content $stdout -Raw } else { "" }
      $err = if (Test-Path $stderr) { Get-Content $stderr -Raw } else { "" }
      throw ("The packaged API exited before becoming healthy." + [Environment]::NewLine + $out + [Environment]::NewLine + $err)
    }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/v1/health" -TimeoutSec 2
      if ($health.status -eq "ok" -and $health.database -eq "up") { break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $health -or $health.status -ne "ok" -or $health.database -ne "up") {
    $out = if (Test-Path $stdout) { Get-Content $stdout -Raw } else { "" }
    $err = if (Test-Path $stderr) { Get-Content $stderr -Raw } else { "" }
    throw ("The installed API did not report status=ok and database=up." + [Environment]::NewLine + $out + [Environment]::NewLine + $err)
  }
  Write-Host "PASS: bundled Node API and PostgreSQL returned status=ok, database=up."

  # Stop the manually launched API and prove the actual packaged Flutter client
  # starts its own backend. This directly covers the original cannot-connect
  # failure mode instead of testing Node in isolation.
  if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
  if ($api) { try { Wait-Process -Id $api.Id -Timeout 10 -ErrorAction SilentlyContinue } catch { } }
  $api = $null
  Start-Sleep -Seconds 2

  # A fresh install intentionally pauses at the first-administrator screen.
  # Seed a CI-only administrator through the exact same preparation script so
  # this test can verify automatic server startup without GUI coordinate hacks.
  $previousAdminUser = $env:KAYAN_ADMIN_USERNAME
  $previousAdminPassword = $env:KAYAN_ADMIN_PASSWORD
  try {
    $env:KAYAN_ADMIN_USERNAME = "ci-admin"
    $env:KAYAN_ADMIN_PASSWORD = "CiSmoke-Admin-Password-7241"
    $seed = Start-Process -FilePath $node -ArgumentList @("scripts\prepare-database.mjs") -WorkingDirectory $backend -Wait -PassThru -NoNewWindow
    if ($seed.ExitCode -ne 0) { throw ("CI first-administrator seeding failed with exit code " + $seed.ExitCode) }
  } finally {
    if ($null -eq $previousAdminUser) { Remove-Item Env:KAYAN_ADMIN_USERNAME -ErrorAction SilentlyContinue } else { $env:KAYAN_ADMIN_USERNAME = $previousAdminUser }
    if ($null -eq $previousAdminPassword) { Remove-Item Env:KAYAN_ADMIN_PASSWORD -ErrorAction SilentlyContinue } else { $env:KAYAN_ADMIN_PASSWORD = $previousAdminPassword }
  }

  $clientPath = Join-Path $env:ProgramFiles "KAYAN ERP\erp_kayan.exe"
  if (-not (Test-Path $clientPath)) { throw ("The installed KAYAN client is missing: " + $clientPath) }
  $client = Start-Process -FilePath $clientPath -WorkingDirectory (Split-Path -Parent $clientPath) -PassThru
  $clientHealth = $null
  try {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      if ($client.HasExited) { throw ("The installed KAYAN client exited with code " + $client.ExitCode + " before starting its backend.") }
      try {
        $clientHealth = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/v1/health" -TimeoutSec 2
        if ($clientHealth.status -eq "ok" -and $clientHealth.database -eq "up") { break }
      } catch { }
      Start-Sleep -Seconds 1
    }
    if (-not $clientHealth -or $clientHealth.status -ne "ok" -or $clientHealth.database -ne "up") {
      $logDir = Join-Path $env:APPDATA "KAYAN-ERP"
      $details = @()
      if (Test-Path $logDir) {
        Get-ChildItem $logDir -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Length -lt 2MB } | ForEach-Object {
          $details += ("--- " + $_.FullName + " ---")
          $details += Get-Content $_.FullName -Tail 80 -ErrorAction SilentlyContinue
        }
      }
      foreach ($line in $details) { Write-Host $line }
      throw ("The actual installed client did not start a healthy local server after 60 seconds." + [Environment]::NewLine + ($details -join [Environment]::NewLine))
    }
    Write-Host "PASS: launching installed erp_kayan.exe by itself started the local API and health check passed."

    $setupStatus = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/v1/setup/status" -TimeoutSec 5
    if ($setupStatus.needsSetup -ne $false) {
      throw ("Expected /api/v1/setup/status needsSetup=false after seeding, got: " + ($setupStatus | ConvertTo-Json -Compress))
    }
    Write-Host "PASS: /api/v1/setup/status reported needsSetup=false."

    $loginPayload = @{
      username = "ci-admin"
      password = "CiSmoke-Admin-Password-7241"
    } | ConvertTo-Json -Compress
    $loginResponse = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/api/v1/auth/login" -ContentType "application/json" -Body $loginPayload -TimeoutSec 10
    if (-not $loginResponse.accessToken -or -not $loginResponse.refreshToken) {
      throw "POST /api/v1/auth/login did not return accessToken and refreshToken."
    }
    if ($loginResponse.user.username -ne "ci-admin") {
      throw ("POST /api/v1/auth/login returned unexpected username: " + $loginResponse.user.username)
    }
    Write-Host "PASS: POST /api/v1/auth/login succeeded against the installed desktop server."

    $meResponse = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:3000/api/v1/auth/me" -Headers @{ Authorization = ("Bearer " + $loginResponse.accessToken) } -TimeoutSec 10
    $meUsername = if ($meResponse.user) { $meResponse.user.username } else { $meResponse.username }
    if ($meUsername -ne "ci-admin") {
      throw ("GET /api/v1/auth/me returned unexpected user payload: " + ($meResponse | ConvertTo-Json -Compress))
    }
    Write-Host "PASS: GET /api/v1/auth/me verified authenticated session with the issued token."
  } finally {
    if ($client -and -not $client.HasExited) {
      $null = $client.CloseMainWindow()
      try { Wait-Process -Id $client.Id -Timeout 10 -ErrorAction SilentlyContinue } catch { }
      if (-not $client.HasExited) { Stop-Process -Id $client.Id -Force -ErrorAction SilentlyContinue }
    }
  }
} finally {
  if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue }
  $installNode = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -eq $node -and $_.CommandLine -like "*$backend*" -and $_.CommandLine -like "*dist*src*main.js*" }
  foreach ($process in $installNode) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Service -Name "KAYAN_PostgreSQL" -Force -ErrorAction SilentlyContinue
}
