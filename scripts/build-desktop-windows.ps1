<#
.SYNOPSIS
  Builds the Windows desktop copy of KAYAN ERP: one folder that starts its own
  API server, with no terminal, no Node on PATH and no commands to type.

.DESCRIPTION
  The result is a folder (and a .zip beside it) shaped like this:

      KAYAN-ERP\
        erp_kayan.exe                 the program
        flutter_windows.dll, data\    the client runtime
        backend\dist\src\main.js      the API server
        backend\node_modules\         its libraries, production only
        backend\prisma\               the schema and its migrations
        backend\scripts\              database preparation
        backend\node\node.exe         a Node runtime that ships with the app

  Beside the folder it also produces KAYAN-ERP-windows.zip, and - when Inno
  Setup is installed on this machine - KAYAN-ERP-Setup-<version>.exe, the single
  file a customer double-clicks. Only the build machine needs Flutter, Node and
  (optionally) Inno Setup.

  Run this from the repository root, on a Windows machine, with Flutter and
  Node installed for *building* (the end user needs neither).

.PARAMETER Output
  Where to assemble. Default: build\desktop

.PARAMETER SkipZip
  Skip producing the .zip (assembly only).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-desktop-windows.ps1
#>

[CmdletBinding()]
param(
  [string]$Output = "build\desktop",
  [switch]$SkipZip,
  [string]$NodeVersion = "24.21.0"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($number, $text) {
  Write-Host ""
  Write-Host "[$number] $text" -ForegroundColor Cyan
}

function Fail($text) {
  Write-Host ""
  Write-Host "[X] $text" -ForegroundColor Red
  exit 1
}

function Need($command, $hint) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    Fail "$command is not on PATH. $hint"
  }
}

function Get-PeMachine([string]$path) {
  $stream = [System.IO.File]::OpenRead($path)
  $reader = [System.IO.BinaryReader]::new($stream)
  try {
    if ($reader.ReadUInt16() -ne 0x5A4D) { return $null }
    $stream.Position = 0x3c
    $stream.Position = $reader.ReadInt32()
    if ($reader.ReadUInt32() -ne 0x00004550) { return $null }
    return $reader.ReadUInt16()
  } finally {
    $reader.Dispose()
  }
}

Write-Host "============================================================"
Write-Host "  KAYAN ERP  -  building the Windows desktop program"
Write-Host "============================================================"

Need flutter "Install it from https://docs.flutter.dev/get-started/install/windows"
Need node    "Install it from https://nodejs.org (only for building, not for the user)."
Need npm     "Install Node.js from https://nodejs.org (only for building)."
if ((node -p "process.arch").Trim() -ne "x64") {
  Fail "The build-time Node.js must be x64 so native npm dependencies are built for Windows x64."
}

$stage = Join-Path $root $Output
$appFolder = Join-Path $stage "KAYAN-ERP"
$backendFolder = Join-Path $appFolder "backend"
$backendSource = Join-Path $root "backend"

# ---------------------------------------------------------------- 1. server
Step "1/7" "Building the API server"
Push-Location $backendSource
try {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed in backend." }

  npx prisma generate
  if ($LASTEXITCODE -ne 0) { Fail "prisma generate failed." }

  npm run build
  if ($LASTEXITCODE -ne 0) { Fail "nest build failed." }
} finally {
  Pop-Location
}

# --------------------------------------------------------------- 2. staging
Step "2/7" "Assembling the program folder"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $backendFolder | Out-Null

# Only the pieces a running server needs. No source, no tests, no secrets.
Copy-Item (Join-Path $backendSource "dist") $backendFolder -Recurse
Copy-Item (Join-Path $backendSource "prisma") $backendFolder -Recurse
Copy-Item (Join-Path $backendSource "scripts") $backendFolder -Recurse
Copy-Item (Join-Path $backendSource "package.json") $backendFolder
Copy-Item (Join-Path $backendSource "package-lock.json") $backendFolder
Copy-Item (Join-Path $backendSource ".env.production.example") $backendFolder

# The development .env is deliberately NOT copied. The packaged program writes
# its own settings, with fresh secrets, into the machine's application-data
# folder on first run. See docs/DESKTOP_WINDOWS.md.

# Source maps belong to a debugging session on the build machine, not to a
# customer's installation: they point at source files that do not travel, and
# they make the package bigger for nothing anyone can use. The compiled server
# runs exactly the same without them.
$maps = @(Get-ChildItem (Join-Path $backendFolder "dist") -Recurse -Filter "*.map" -ErrorAction SilentlyContinue)
if ($maps.Count -gt 0) {
  $maps | Remove-Item -Force
  Write-Host "      left $($maps.Count) source map(s) out of the package"
}

# Declaration files are read by a compiler, and prisma\seed.ts is read by a
# developer's ts-node. The packaged server needs neither: what runs on a fresh
# machine is dist\prisma\seed.js, the compiled form of that same file, called
# by scripts\prepare-database.mjs.
$declarations = @(Get-ChildItem (Join-Path $backendFolder "dist") -Recurse -Filter "*.d.ts" -ErrorAction SilentlyContinue)
if ($declarations.Count -gt 0) {
  $declarations | Remove-Item -Force
  Write-Host "      left $($declarations.Count) declaration file(s) out of the package"
}
$seedSource = Join-Path $backendFolder "prisma\seed.ts"
if (Test-Path $seedSource) {
  Remove-Item -Force $seedSource
  Write-Host "      left the server's TypeScript source out of the package"
}

# ------------------------------------------------- 3. production libraries
Step "3/7" "Installing the server's libraries (production only)"
Push-Location $backendFolder
try {
  npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail "npm ci failed while assembling the server." }

  # Prisma needs its query engine for Windows next to the generated client.
  npx prisma generate
  if ($LASTEXITCODE -ne 0) { Fail "prisma generate failed in the staged server." }
} finally {
  Pop-Location
}

# --------------------------------------------------------- 4. Node runtime
Step "4/7" "Adding the Node runtime the program ships with"
$toolsFolder = Join-Path $env:LOCALAPPDATA "kayan-tools"
$portableNode = Join-Path $toolsFolder "node\node.exe"
$zipUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"

if ((Test-Path $portableNode) -and (Get-PeMachine $portableNode) -ne 0x8664) {
  Write-Host "      cached node.exe is not x64; replacing it"
  Remove-Item -Recurse -Force (Split-Path -Parent $portableNode)
}

if (-not (Test-Path $portableNode)) {
  Write-Host "      downloading Node $NodeVersion (about 36 MB)"
  $zipFile = Join-Path $env:TEMP "kayan-node-$NodeVersion.zip"
  if (Test-Path $zipFile) { Remove-Item -Force $zipFile }
  try {
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile -UseBasicParsing
  } catch {
    Fail "Could not download Node from $zipUrl . Download it in a browser, save it as $zipFile, and run this script again."
  }
  New-Item -ItemType Directory -Force -Path $toolsFolder | Out-Null
  Expand-Archive -Path $zipFile -DestinationPath $toolsFolder -Force
  $extracted = Join-Path $toolsFolder "node-v$NodeVersion-win-x64"
  if (Test-Path (Join-Path $extracted "node.exe")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $toolsFolder "node") | Out-Null
    Copy-Item (Join-Path $extracted "*") (Join-Path $toolsFolder "node") -Recurse -Force
  }
  if (-not (Test-Path $portableNode)) { Fail "Node was downloaded but node.exe was not found." }
}
if ((Get-PeMachine $portableNode) -ne 0x8664) {
  Fail "The bundled node.exe is not a Windows x64 (AMD64) binary."
}

$runtimeFolder = Join-Path $backendFolder "node"
New-Item -ItemType Directory -Force -Path $runtimeFolder | Out-Null
Copy-Item $portableNode $runtimeFolder -Force
# node.exe needs nothing else to run a script, but the licence travels with it.
$license = Join-Path (Split-Path -Parent $portableNode) "LICENSE"
if (Test-Path $license) { Copy-Item $license $runtimeFolder -Force }
Write-Host "      node.exe copied into the program folder"

# ------------------------------------------------------------- 5. client
Step "5/7" "Building the client (Flutter, Windows, release)"
# Flutter's Windows build target is x64 (the Flutter tool generates CMake with
# the x64 platform); the output path below and the PE check enforce the result.
flutter build windows --release --dart-define=APP_ENV=production
if ($LASTEXITCODE -ne 0) { Fail "flutter build windows failed." }

$release = Join-Path $root "build\windows\x64\runner\Release"
if (-not (Test-Path (Join-Path $release "erp_kayan.exe"))) {
  Fail "The client build finished but erp_kayan.exe is not in $release ."
}
Copy-Item (Join-Path $release "*") $appFolder -Recurse -Force

# Reject any x86, ARM64, malformed, or non-PE Windows native binary before
# creating distributable artifacts.
$nativeFiles = Get-ChildItem -Path $appFolder -Recurse -File |
  Where-Object { $_.Extension -in @(".exe", ".dll", ".node") }
$windowsNativeCount = 0
foreach ($file in $nativeFiles) {
  $machine = Get-PeMachine $file.FullName
  if ($null -eq $machine) {
    if ($file.Extension -eq ".node") { continue }
    Fail "Expected a Windows PE binary but found an invalid file: $($file.FullName)"
  }
  if ($machine -ne 0x8664) {
    Fail "Native dependency is not Windows x64 (AMD64): $($file.FullName)"
  }
  $windowsNativeCount++
}
Write-Host "      verified $windowsNativeCount Windows native binaries: all x64 (AMD64)"

# ------------------------------------------------------------- 6. notes
Step "6/7" "Writing the note that travels with the program"
$note = @"
KAYAN ERP - Windows desktop copy
================================

To run the program, double-click:   erp_kayan.exe

The program starts its own server on this machine. No terminal, no Node.js,
no commands.

What this copy needs on the machine
-----------------------------------
1. PostgreSQL, installed and running, holding the company's data.
   The program connects to the address written in:
       %APPDATA%\KAYAN-ERP\kayan.env
   That file is created automatically the first time the program runs, with
   fresh random signing keys. Edit it only if the database is somewhere else
   or uses different credentials. Keep DATABASE_URL and ADMIN_DATABASE_URL on
   the same PostgreSQL host and port (the Windows setup scripts use 127.0.0.1:5432).
   The administrator URL is used to create/update the erp_app password before
   migrations. If PostgreSQL reports Prisma P1000, correct both URLs and
   restart the program. The settings file contains database credentials; keep
   the Windows user account and that file protected.

2. That is all. Node.js, Flutter and Git are NOT needed on this machine.

If the program reports that the server did not start
----------------------------------------------------
Read the log, which is written to:
    %APPDATA%\KAYAN-ERP\logs\backend.log
The most common cause is PostgreSQL not running. Start it, then reopen the
program.

What is inside this folder
--------------------------
erp_kayan.exe          the program itself
data\                  its screens and translations
backend\dist\          the API server
backend\node_modules\  the server's libraries
backend\prisma\        the database schema and its migrations
backend\scripts\       the step that prepares the database
backend\node\node.exe  the Node runtime the server runs on

Nothing in this folder is a secret. The settings and the signing keys live in
%APPDATA%\KAYAN-ERP\ on the machine that runs it.
"@
Set-Content -Path (Join-Path $appFolder "README.txt") -Value $note -Encoding UTF8

# ---------------------------------------------------------------- zip
if (-not $SkipZip) {
  $zipPath = Join-Path $stage "KAYAN-ERP-windows.zip"
  if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
  Write-Host ""
  Write-Host "      packing the .zip (this takes a minute)"
  Compress-Archive -Path (Join-Path $appFolder "*") -DestinationPath $zipPath
}

# ------------------------------------------------------- 7. installer (optional)
Step "7/7" "Making the installer a customer can run"
$installer = $null
$iscc = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
if (-not $iscc) {
  # ${env:ProgramFiles(x86)} needs the braces: without them PowerShell expands
  # $env:ProgramFiles and leaves "(x86)" as literal text, which builds a path
  # that never exists - and the installer would silently never be made.
  foreach ($probe in @(
      "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
      "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
      "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe")) {
    if ($probe -and (Test-Path $probe)) { $iscc = @{ Source = $probe }; break }
  }
}
if ($iscc) {
  & $iscc.Source "/DSourceDir=$appFolder" "/DOutputDir=$stage" `
                 (Join-Path $root "scripts\installer-windows.iss")
  if ($LASTEXITCODE -ne 0) { Fail "Inno Setup ran but did not produce the installer." }
  $installer = Join-Path $stage "KAYAN-ERP-Setup-1.0.0.exe"
  Write-Host "      installer written"
} else {
  Write-Host "      Inno Setup is not on this machine, so no .exe installer was made."
  Write-Host "      The folder and the .zip above are complete and can be copied as they are."
  Write-Host "      For a one-file installer: install Inno Setup 6 from https://jrsoftware.org/isdl.php"
  Write-Host "      and run this script again."
}

$size = (Get-ChildItem $appFolder -Recurse -Force | Measure-Object -Property Length -Sum).Sum
Write-Host ""
Write-Host "============================================================"
Write-Host "  DONE" -ForegroundColor Green
Write-Host "============================================================"
Write-Host ""
Write-Host "  Program folder : $appFolder"
Write-Host "  Total size     : $([math]::Round($size / 1MB, 1)) MB"
if (-not $SkipZip) {
  Write-Host "  Zip            : $(Join-Path $stage 'KAYAN-ERP-windows.zip')"
}
if ($installer) {
  Write-Host "  Installer      : $installer   <- the file a customer runs" -ForegroundColor Green
}
Write-Host ""
Write-Host "  Try it now:"
Write-Host "      $appFolder\erp_kayan.exe"
Write-Host ""
Write-Host "  To put it on another machine: copy the zip, unpack it anywhere, and"
Write-Host "  double-click erp_kayan.exe. That machine needs PostgreSQL, and nothing"
Write-Host "  else."
Write-Host ""
