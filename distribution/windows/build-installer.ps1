[CmdletBinding()]
param(
  [string]$Output = 'build\windows-installer',
  [switch]$SkipInstaller
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backend = Join-Path $root 'backend'
$stage = Join-Path $root 'build\windows-installer-stage'
$outputPath = if ([IO.Path]::IsPathRooted($Output)) { [IO.Path]::GetFullPath($Output) } else { [IO.Path]::GetFullPath((Join-Path $root $Output)) }
$version = (Get-Content (Join-Path $root 'pubspec.yaml') | Where-Object { $_ -match '^version:' } | Select-Object -First 1) -replace '^version:\s*', ''
$appVersion = ($version -split '\+')[0]
$nodeVersion = '24.21.0'
$postgresVersion = '17.7-1'
$nodeArchive = "node-v$nodeVersion-win-x64.zip"
$postgresArchive = "postgresql-$postgresVersion-windows-x64-binaries.zip"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeArchive"
$postgresUrl = "https://get.enterprisedb.com/postgresql/$postgresArchive"
$vcRuntimeUrl = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
$nodeSha256 = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
$postgresSha256 = '2aacc055d9bac49763ac0164759c13866bc0235123d7ffdbb6a6aaa20dc25d9a'

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Required build command '$Name' was not found. Install it on the Windows build machine." }
}
function Get-VerifiedArchive([string]$Url, [string]$Destination, [string]$Sha256) {
  if (-not (Test-Path $Destination)) {
    Write-Host "Downloading $([IO.Path]::GetFileName($Destination))..."
    Invoke-WebRequest -Uri $Url -OutFile $Destination
  }
  $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Sha256) { throw "Checksum mismatch for $([IO.Path]::GetFileName($Destination)); refusing to use it." }
}
function Run-Native([string]$File, [string[]]$Arguments, [string]$WorkingDirectory) {
  Push-Location $WorkingDirectory
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $File $($Arguments -join ' ')" }
  } finally { Pop-Location }
}

if (-not [Environment]::Is64BitOperatingSystem) { throw 'Only Windows x64 is supported. Flutter Windows and the bundled PostgreSQL distribution do not provide a supported 32-bit product build.' }
Require-Command 'flutter'
Require-Command 'node'
Require-Command 'npm'
Require-Command 'git'
$flutter = Get-Command flutter
if ($flutter.Source -notmatch '\.bat$|\.cmd$') { $flutterCommand = 'flutter' } else { $flutterCommand = $flutter.Source }
$iscc = Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue
if (-not $SkipInstaller -and -not $iscc) {
  foreach ($candidate in @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe")) {
    if (Test-Path $candidate) { $iscc = @{ Source = $candidate }; break }
  }
  if (-not $iscc) { throw 'Inno Setup 6 is required to generate the .exe installer. Install it on the Windows build host; it is not needed by customers.' }
}

$drive = [IO.Path]::GetPathRoot($stage)
$driveName = $drive.TrimEnd([char[]]@('\',':'))
$free = (Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue).Free
if ($free -and $free -lt 5GB) { throw 'At least 5 GB of free space is required for Windows build staging.' }
New-Item -ItemType Directory -Force -Path $stage, $outputPath, (Join-Path $stage 'downloads') | Out-Null
$nodeZip = Join-Path $stage "downloads\$nodeArchive"
$pgZip = Join-Path $stage "downloads\$postgresArchive"
Get-VerifiedArchive $nodeUrl $nodeZip $nodeSha256
Get-VerifiedArchive $postgresUrl $pgZip $postgresSha256
$vcRuntime = Join-Path $stage 'downloads\vc_redist.x64.exe'
if (-not (Test-Path $vcRuntime)) { Invoke-WebRequest -Uri $vcRuntimeUrl -OutFile $vcRuntime }
$vcSignature = Get-AuthenticodeSignature -FilePath $vcRuntime
if ($vcSignature.Status -ne 'Valid' -or $vcSignature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
  throw 'The Microsoft Visual C++ x64 redistributable signature could not be verified.'
}

$app = Join-Path $stage 'KAYAN-ERP'
if (Test-Path $app) { Remove-Item -LiteralPath $app -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $app 'backend'), (Join-Path $app 'backend\node'), (Join-Path $app 'backend\postgres'), (Join-Path $app 'build\web') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $app 'licenses') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $app 'prerequisites') | Out-Null
Copy-Item $vcRuntime (Join-Path $app 'prerequisites\vc_redist.x64.exe') -Force

Write-Host '[1/8] Build backend and Prisma client'
Run-Native 'npm.cmd' @('ci','--no-audit','--no-fund') $backend
Run-Native 'npm.cmd' @('run','prisma:generate') $backend
Run-Native 'npm.cmd' @('run','build') $backend

Write-Host '[2/8] Stage production backend files (development .env is excluded)'
foreach ($relative in @('dist','prisma','scripts','package.json','package-lock.json','nest-cli.json','tsconfig.json')) {
  Copy-Item -LiteralPath (Join-Path $backend $relative) -Destination (Join-Path $app 'backend') -Recurse -Force
}
Run-Native 'npm.cmd' @('ci','--omit=dev','--no-audit','--no-fund') (Join-Path $app 'backend')
# prepare-database.mjs intentionally shells out to the Prisma CLI to apply the same checked-in migrations.
Run-Native 'npm.cmd' @('install','--no-save','--omit=dev','--no-audit','--no-fund','prisma@6.19.3') (Join-Path $app 'backend')
Run-Native 'node.exe' @((Join-Path $app 'backend\node_modules\prisma\build\index.js'),'generate') (Join-Path $app 'backend')

Write-Host '[3/8] Build Flutter Windows x64 and production Web'
Run-Native $flutterCommand @('build','windows','--release','--dart-define=APP_ENV=production') $root
$release = Join-Path $root 'build\windows\x64\runner\Release'
if (-not (Test-Path (Join-Path $release 'erp_kayan.exe'))) {
  $release = Join-Path $root 'build\windows\runner\Release'
}
if (-not (Test-Path (Join-Path $release 'erp_kayan.exe'))) { throw 'Flutter Windows x64 release output is missing erp_kayan.exe.' }
Copy-Item (Join-Path $release '*') $app -Recurse -Force
Run-Native $flutterCommand @('build','web','--release','--base-href=/','--dart-define=APP_ENV=production','--dart-define=API_BASE_URL=/api/v1') $root
Copy-Item (Join-Path $root 'build\web\*') (Join-Path $app 'build\web') -Recurse -Force

Write-Host '[4/8] Bundle official Node.js x64 and PostgreSQL 17 x64'
Expand-Archive -LiteralPath $nodeZip -DestinationPath (Join-Path $stage 'extract-node') -Force
$nodeFolder = Get-ChildItem (Join-Path $stage 'extract-node') -Directory | Select-Object -First 1
Copy-Item (Join-Path $nodeFolder.FullName '*') (Join-Path $app 'backend\node') -Recurse -Force
Expand-Archive -LiteralPath $pgZip -DestinationPath (Join-Path $stage 'extract-postgres') -Force
$pgBin = Get-ChildItem (Join-Path $stage 'extract-postgres') -Directory -Recurse | Where-Object { Test-Path (Join-Path $_.FullName 'bin\initdb.exe') } | Select-Object -First 1
if (-not $pgBin) { throw 'The verified PostgreSQL archive did not contain bin\initdb.exe.' }
Copy-Item (Join-Path $pgBin.FullName '*') (Join-Path $app 'backend\postgres') -Recurse -Force
$pgRoot = Split-Path -Parent $pgBin.FullName
foreach ($licenseName in @('LICENSE','COPYRIGHT','README')) {
  Get-ChildItem $pgRoot -Filter $licenseName -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $target = Join-Path $app "licenses\PostgreSQL-$($_.Name)"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item $_.FullName $target -Force
  }
}
Get-ChildItem $nodeFolder.FullName -Filter 'LICENSE*' -File -ErrorAction SilentlyContinue | Copy-Item -Destination (Join-Path $app 'licenses') -Force -ErrorAction SilentlyContinue

Write-Host '[5/8] Add database lifecycle and first-run setup scripts'
Copy-Item (Join-Path $PSScriptRoot 'install-runtime.ps1') $app
Copy-Item (Join-Path $PSScriptRoot 'remove-runtime.ps1') $app
Copy-Item (Join-Path $PSScriptRoot 'database-control.ps1') $app
Copy-Item (Join-Path $PSScriptRoot 'README.txt') $app
Copy-Item (Join-Path $PSScriptRoot 'THIRD_PARTY_NOTICES.md') $app
Copy-Item (Join-Path $PSScriptRoot 'installer.iss') (Join-Path $stage 'installer.iss')

Write-Host '[6/8] Verify staged runtime essentials and absence of development .env'
$required = @('erp_kayan.exe','backend\dist\src\main.js','backend\dist\prisma\seed.js','backend\scripts\prepare-database.mjs','backend\node\node.exe','backend\postgres\bin\pg_ctl.exe','backend\postgres\bin\pg_isready.exe','build\web\index.html','install-runtime.ps1','remove-runtime.ps1','database-control.ps1','prerequisites\vc_redist.x64.exe')
foreach ($item in $required) { if (-not (Test-Path (Join-Path $app $item))) { throw "Staged package is missing $item" } }
$secretEnvironmentFiles = Get-ChildItem -LiteralPath $app -Force -File -Recurse | Where-Object { $_.Name -eq '.env' -or $_.Name -like '.env.*' }
if ($secretEnvironmentFiles) { throw 'Environment files are forbidden in the installer package.' }

Write-Host '[7/8] Write artifact manifest with exact pinned versions'
$manifest = [ordered]@{ product='KAYAN ERP'; productVersion=$appVersion; architecture='x64'; nodeVersion=$nodeVersion; postgresqlVersion=($postgresVersion -replace '-1$',''); flutterVersion=((flutter --version --machine | ConvertFrom-Json).frameworkVersion); sourceCommit=(git -C $root rev-parse HEAD); windowsInstallerTested=$false }
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'runtime-manifest.json') -Encoding UTF8

if (-not $SkipInstaller) {
  Write-Host '[8/8] Compile standalone Inno Setup installer'
  & $iscc.Source "/DSourceDir=$app" "/DOutputDir=$outputPath" "/DAppVersion=$appVersion" (Join-Path $stage 'installer.iss')
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed ($LASTEXITCODE)." }
  $versionedSetup = Join-Path $outputPath "KAYAN-ERP-Setup-$appVersion-x64.exe"
  $canonicalSetup = Join-Path $outputPath "KAYAN-ERP-Setup.exe"
  if (Test-Path $versionedSetup) {
    Copy-Item -LiteralPath $versionedSetup -Destination $canonicalSetup -Force
  }
}
Write-Host "Build staging: $app"
if (-not $SkipInstaller) {
  Write-Host "Installer: $(Join-Path $outputPath "KAYAN-ERP-Setup-$appVersion-x64.exe")"
  Write-Host "Canonical Installer: $(Join-Path $outputPath "KAYAN-ERP-Setup.exe")"
}
Write-Host 'A native Windows install/service test is still required; build host does not prove runtime behavior.'
