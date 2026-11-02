# Verifies the three delivered features (attached letterhead, packing units,
# print price policy) on an installation of KAYAN ERP that is already running
# on this computer with a real, machine-bound licence.
#
# Why this exists next to scripts\smoke-test-installed-windows.ps1:
#
#   * The smoke test builds its own throwaway Windows VM, installs, and tears
#     everything down. It is deliberately destructive and refuses to run on a
#     machine that already holds KAYAN data.
#   * A product installer enforces its licence, so its business routes answer
#     403 until the copy is activated. An activation key names one machine
#     (the fingerprint of the computer), so it cannot be minted for a VM that
#     does not exist yet: only the supplier's private key can sign one, and it
#     never leaves the supplier's own machine.
#
# This script therefore does the one thing CI cannot: it points the same
# checker at a licensed installation, on the machine the licence names. It is
# non-destructive. It does not move, replace or delete the verification key,
# the licence state, the database or any company setting. The only write it
# makes to the installation is the activation the customer would perform in
# the program's own licence screen, and only when -ActivationKeyPath is given.
#
# Usage (from a checkout of this repository, as the administrator):
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File distribution\windows\verify-licensed-install.ps1 `
#     -ActivationKeyPath .\kayan-activation.key `
#     -AdminUsername <the installation's administrator> `
#     -AdminPassword '<that account's password>' `
#     -ConfirmTestCompany
#
# The checker creates its own test company data (an item, a quotation, a
# purchase, an issue, a stock count and one clerk user) exactly as the CI
# smoke test does. Run it against a test company, never against live books.

[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:ProgramFiles 'KAYAN ERP'),
  [string]$BaseUrl = '',
  [string]$ActivationKeyPath = '',
  [string]$AdminUsername = $env:KAYAN_ADMIN_USERNAME,
  [string]$AdminPassword = $env:KAYAN_ADMIN_PASSWORD,
  [string]$ReportPath = (Join-Path $env:TEMP 'kayan-licensed-install-report.json'),
  [switch]$ConfirmTestCompany
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Text) {
  Write-Host ("[{0}] {1}" -f ((Get-Date).ToUniversalTime().ToString('HH:mm:ss')), $Text)
}

function Stop-Blocked([string]$Reason) {
  # Exit code 2 means "blocked, nothing was proven" - never 0, which would
  # read as a pass in a build log.
  Write-Host "BLOCKED: $Reason" -ForegroundColor Yellow
  exit 2
}

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') { Stop-Blocked 'This check runs on Windows only.' }
if (-not $ConfirmTestCompany) {
  # The checker creates real documents. Protecting the customer's books matters
  # more than convenience, so this is a switch that must be typed on purpose.
  Stop-Blocked 'Re-run with -ConfirmTestCompany once you are sure this installation holds test data: the checker creates an item, a quotation, a purchase, an issue and a stock count.'
}
if (-not $AdminUsername -or -not $AdminPassword) {
  Stop-Blocked 'Pass -AdminUsername and -AdminPassword (or set KAYAN_ADMIN_USERNAME / KAYAN_ADMIN_PASSWORD) for the installation administrator account.'
}

$install = (Resolve-Path -LiteralPath $InstallRoot -ErrorAction SilentlyContinue)
if (-not $install) { Stop-Blocked "KAYAN ERP is not installed at $InstallRoot." }
$install = $install.Path
$node = Join-Path $install 'backend\node\node.exe'
$modules = Join-Path $install 'backend\node_modules'
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { Stop-Blocked "The installed program has no bundled Node runtime at $node." }
if (-not (Test-Path -LiteralPath $modules -PathType Container)) { Stop-Blocked "The installed program has no bundled dependencies at $modules." }

$checker = Join-Path $PSScriptRoot '..\..\backend\scripts\verify-installed-features.mjs'
if (-not (Test-Path -LiteralPath $checker -PathType Leaf)) {
  Stop-Blocked "This command has to be run from a checkout of the repository: $checker was not found."
}
$checker = (Resolve-Path -LiteralPath $checker).Path

# ── find the running API of this installation, never a development server
$candidates = @()
if ($BaseUrl) {
  $candidates += $BaseUrl.TrimEnd('/')
} else {
  foreach ($port in @(3000, 3001, 3002, 3003, 3010, 3020)) {
    $candidates += "http://127.0.0.1:$port/api/v1"
  }
}
$api = ''
foreach ($candidate in $candidates) {
  try {
    $health = Invoke-RestMethod -Uri "$candidate/health" -TimeoutSec 5
    if ($health) {
      # The installed payload is what makes an API "this installation": a
      # development server on the same port would not have the bundled tree.
      $api = $candidate
      break
    }
  } catch { }
}
if (-not $api) {
  Stop-Blocked "No running KAYAN API answered on $($candidates -join ', '). Start KAYAN ERP once, then run this again."
}
Write-Step "Installed program: $install"
Write-Step "API: $api"

$status = Invoke-RestMethod -Uri "$api/license/status" -TimeoutSec 15
Write-Step ("Licence before: state={0} blocked={1} configured={2}" -f $status.state, $status.blocked, $status.configured)

$loginPayload = @{ username = $AdminUsername; password = $AdminPassword } | ConvertTo-Json -Compress
$login = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType 'application/json' -Body $loginPayload -TimeoutSec 30
if (-not $login.accessToken) { Stop-Blocked 'Sign-in with the administrator account failed; the checker needs a super administrator to activate and to save the print policy.' }
$headers = @{ Authorization = "Bearer $($login.accessToken)" }

$activationError = ''
if ($ActivationKeyPath) {
  $keyPath = (Resolve-Path -LiteralPath $ActivationKeyPath -ErrorAction SilentlyContinue)
  if (-not $keyPath) { Stop-Blocked "The activation key file does not exist: $ActivationKeyPath" }
  $key = (Get-Content -LiteralPath $keyPath.Path -Raw).Trim()
  if (-not $key) { Stop-Blocked 'The activation key file is empty.' }
  Write-Step 'Activating this machine with the supplied key (the same call the licence screen makes).'
  try {
    $activated = Invoke-RestMethod -Method Post -Uri "$api/license/activate" -Headers $headers -ContentType 'application/json' -Body (@{ key = $key } | ConvertTo-Json -Compress) -TimeoutSec 30
    Write-Step ("Activation answered: {0}" -f (($activated | ConvertTo-Json -Compress -Depth 3)))
  } catch {
    # A refusal is reported with the rest of the unlicensed state below, which
    # also prints this machine's request code: the usual cause is a key issued
    # for another computer.
    $activationError = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $activationError = $_.ErrorDetails.Message }
  }
  $status = Invoke-RestMethod -Uri "$api/license/status" -TimeoutSec 15
}

if ($status.blocked -eq $true -or $status.state -eq 'UNLICENSED') {
  $code = ''
  try { $code = (Invoke-RestMethod -Uri "$api/license/request-code" -Headers $headers -TimeoutSec 15).code } catch { }
  Write-Host 'This installation is not licensed, so its business routes refuse work by design.'
  Write-Host 'That refusal is correct and is not something this script may bypass.'
  if ($activationError) { Write-Host "Activation refused: $activationError" }
  Write-Host ''
  Write-Host 'To close this check the supplier has to:'
  Write-Host '  1. read the activation request code this machine shows (also printed below);'
  Write-Host '  2. issue an ACTIVATION key for that machine with the key generator and the'
  Write-Host '     supplier private key that matches distribution\windows\public-key.pem;'
  Write-Host '  3. hand the key back, and re-run this script with -ActivationKeyPath <file>.'
  Write-Host ''
  Write-Host "Activation request code: $code"
  Stop-Blocked 'No valid licence on this installation, so the three features were not exercised here.'
}
Write-Step ("Licence now: state={0} licensed={1}" -f $status.state, ($status.state -eq 'ACTIVE'))

# ── the three features, through the installed API, by the shipped runtime
$env:KAYAN_API_URL = $api
$env:KAYAN_ADMIN_USERNAME = $AdminUsername
$env:KAYAN_ADMIN_PASSWORD = $AdminPassword
$env:KAYAN_INSTALLED_MODULES = $modules
$started = Get-Date
try {
  & $node $checker
  $exit = $LASTEXITCODE
} finally {
  Remove-Item Env:KAYAN_API_URL, Env:KAYAN_ADMIN_USERNAME, Env:KAYAN_ADMIN_PASSWORD, Env:KAYAN_INSTALLED_MODULES -ErrorAction SilentlyContinue
}
$elapsed = [int]((Get-Date) - $started).TotalSeconds

$sourceCommit = ''
try {
  $sourceCommit = (& git -C (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) rev-parse HEAD 2>$null | Select-Object -First 1)
} catch { $sourceCommit = '' }

$report = [ordered]@{
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
  installRoot = $install
  api = $api
  bundledNode = (& $node --version)
  licenceState = $status.state
  licenceId = $status.licenseId
  machineId = $status.machineId
  activationPerformed = [bool]$ActivationKeyPath
  featuresExitCode = $exit
  featuresPassed = ($exit -eq 0)
  seconds = $elapsed
  sourceCommit = $sourceCommit
}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
Write-Step "Report written: $ReportPath"

if ($exit -ne 0) {
  Write-Host 'FAILED: the installed, licensed program did not pass the three feature checks. The report names the step that failed.' -ForegroundColor Red
  exit 1
}
Write-Host 'PASS: the installed, licensed program passed the attached-letterhead, packing-unit and print-price-policy checks.' -ForegroundColor Green
exit 0
