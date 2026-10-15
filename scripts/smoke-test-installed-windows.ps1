# Runs the real Windows installer on the CI runner and verifies the installed local runtime.
[CmdletBinding()]
param([string]$SetupPath = "build\windows-installer\KAYAN-ERP-Setup.exe")

$ErrorActionPreference = "Stop"
$setup = (Resolve-Path $SetupPath).Path
$installLog = Join-Path $env:TEMP "kayan-setup-smoke.log"
$serviceName = "KayanERPPostgreSQL"
$installRoot = Join-Path $env:ProgramFiles "KAYAN ERP"
$backend = Join-Path $installRoot "backend"
$node = Join-Path $backend "node\node.exe"
$settings = Join-Path $env:ProgramData "KAYAN-ERP\kayan.env"

function Read-Details {
  $paths = @(
    $installLog,
    (Join-Path $env:ProgramData "KAYAN-ERP\logs\installer.log"),
    (Join-Path $env:ProgramData "KAYAN-ERP\logs\postgresql.log"),
    (Join-Path $env:APPDATA "KAYAN-ERP\logs\backend.log")
  )
  $out = @()
  foreach ($path in $paths) {
    if (Test-Path $path) {
      $out += "--- $path ---"
      $out += Get-Content $path -Tail 100 -ErrorAction SilentlyContinue
    }
  }
  return ($out -join [Environment]::NewLine)
}

$install = Start-Process -FilePath $setup -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", ("/LOG=" + $installLog)) -Wait -PassThru
if ($install.ExitCode -ne 0) {
  throw ("KAYAN-ERP-Setup.exe failed with exit code $($install.ExitCode)." + [Environment]::NewLine + (Read-Details))
}

# The installer may launch the client through its post-install [Run] entry.
Get-Process -Name erp_kayan -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service) { throw ("The bundled PostgreSQL service '$serviceName' was not installed." + [Environment]::NewLine + (Read-Details)) }
if ($service.Status -ne "Running") { throw ("The bundled PostgreSQL service is not running." + [Environment]::NewLine + (Read-Details)) }

foreach ($relative in @(
  "backend\postgres\bin\initdb.exe",
  "backend\postgres\bin\pg_ctl.exe",
  "backend\postgres\bin\pg_isready.exe",
  "backend\node\node.exe",
  "backend\dist\src\main.js",
  "backend\scripts\prepare-database.mjs",
  "erp_kayan.exe"
)) {
  $path = Join-Path $installRoot $relative
  if (-not (Test-Path $path)) { throw "Installed package is missing $relative" }
}
if (-not (Test-Path $settings)) { throw "The installer did not create $settings" }

$pgReady = Join-Path $installRoot "backend\postgres\bin\pg_isready.exe"
& $pgReady -h 127.0.0.1 -p 5432 -U postgres *> $null
if ($LASTEXITCODE -ne 0) { throw ("Bundled PostgreSQL does not accept connections on 127.0.0.1:5432." + [Environment]::NewLine + (Read-Details)) }
Write-Host "PASS: bundled PostgreSQL service is running and accepting connections."

$envValues = @{}
Get-Content $settings | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)="?(.*?)"?\s*$') { $envValues[$matches[1]] = $matches[2].Trim('"') }
}
foreach ($entry in $envValues.GetEnumerator()) { Set-Item -Path ("Env:" + $entry.Key) -Value $entry.Value }

# Run the exact production database preparation used by the desktop shell.
$prepOut = Join-Path $env:TEMP "kayan-installer-prep-stdout.log"
$prepErr = Join-Path $env:TEMP "kayan-installer-prep-stderr.log"
$prepare = Start-Process -FilePath $node -ArgumentList @("scripts\prepare-database.mjs") -WorkingDirectory $backend -Wait -PassThru -NoNewWindow -RedirectStandardOutput $prepOut -RedirectStandardError $prepErr
if ($prepare.ExitCode -ne 0) {
  throw ("Production database preparation failed with exit code $($prepare.ExitCode)." + [Environment]::NewLine + (Get-Content $prepOut -Raw) + [Environment]::NewLine + (Get-Content $prepErr -Raw) + [Environment]::NewLine + (Read-Details))
}

# Seed only a disposable CI administrator so the desktop shell is allowed to start its API.
$env:KAYAN_ADMIN_USERNAME = "ci-admin"
$env:KAYAN_ADMIN_PASSWORD = "CiSmoke-Admin-Password-7241"
$seed = Start-Process -FilePath $node -ArgumentList @("scripts\prepare-database.mjs") -WorkingDirectory $backend -Wait -PassThru -NoNewWindow
if ($seed.ExitCode -ne 0) { throw ("CI administrator setup failed with exit code $($seed.ExitCode)." + [Environment]::NewLine + (Read-Details)) }
Remove-Item Env:KAYAN_ADMIN_USERNAME,Env:KAYAN_ADMIN_PASSWORD -ErrorAction SilentlyContinue

# The important test: start the actual installed Flutter executable by itself.
$clientPath = Join-Path $installRoot "erp_kayan.exe"
$client = Start-Process -FilePath $clientPath -WorkingDirectory $installRoot -PassThru
try {
  $health = $null
  $apiPort = $null
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if ($client.HasExited) {
      throw ("The installed KAYAN client exited with code $($client.ExitCode) before its local server became healthy." + [Environment]::NewLine + (Read-Details))
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
  if (-not $health -or -not $apiPort) { throw ("The installed KAYAN client did not start a healthy local API within 90 seconds." + [Environment]::NewLine + (Read-Details)) }
  Write-Host "PASS: launching installed erp_kayan.exe started a healthy local API on port $apiPort."

  $loginPayload = @{ username = "ci-admin"; password = "CiSmoke-Admin-Password-7241" } | ConvertTo-Json -Compress
  $login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$apiPort/api/v1/auth/login" -ContentType "application/json" -Body $loginPayload -TimeoutSec 10
  if (-not $login.accessToken) { throw "Installed API login did not return an access token." }
  Write-Host "PASS: installed API accepted a login against the bundled database."
} finally {
  if ($client -and -not $client.HasExited) {
    $null = $client.CloseMainWindow()
    try { Wait-Process -Id $client.Id -Timeout 10 -ErrorAction SilentlyContinue } catch { }
    if (-not $client.HasExited) { Stop-Process -Id $client.Id -Force -ErrorAction SilentlyContinue }
  }
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
}
