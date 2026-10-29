[CmdletBinding()]
param(
  [string]$Output = 'build\windows-installer',
  # Required acknowledgement: this script runs npm ci, Prisma and Flutter,
  # which modify generated files. Use only a reviewed disposable source copy.
  [switch]$DisposableSource,
  [switch]$SkipInstaller,
  # Builds the product without licences enforced. Only for development: such a
  # build refuses every customer key, and it must never be handed to a
  # customer. Without this switch a build that cannot find the operator's
  # public key fails instead of shipping quietly unprotected - that is how a
  # released Setup came to run without asking for an activation key.
  [switch]$EvaluationBuild,
  # An explicitly labelled diagnostic installer using a throwaway public key.
  # It must never be published or given to a customer as a product installer.
  [switch]$TestSignedBuild,
  # Where the licence public key is when it is not beside this script. A
  # release passes the operator's key (or drops it beside this script); the CI
  # job passes a throwaway key it generated for that run, so the Setup it
  # installs really does enforce licences and activation can be tested end to
  # end. Only the public key is ever read: nothing in this build can issue a
  # licence.
  [string]$LicencePublicKeyPath = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $DisposableSource) {
  throw 'Build refused: use -DisposableSource only in a reviewed, disposable copy of the actual working tree. npm ci and Flutter modify generated files.'
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$backend = Join-Path $root 'backend'
# Each invocation gets its own staging directory; an earlier run is never
# removed or reused. Build only from an isolated copy of the working tree:
# npm ci, Prisma and Flutter can still overwrite generated files in that copy.
$stage = Join-Path (Join-Path $root 'build\windows-installer-stage') ([guid]::NewGuid().ToString('N'))
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

# Fail before staging, downloads, or compilation. Production is the default;
# test and evaluation are explicit and receive different installer names.
if ($EvaluationBuild -and $TestSignedBuild) { throw 'EvaluationBuild and TestSignedBuild are mutually exclusive.' }
if ($EvaluationBuild -and $LicencePublicKeyPath) { throw 'An evaluation build must not be given a licence public key.' }
$buildKind = if ($EvaluationBuild) { 'evaluation' } elseif ($TestSignedBuild) { 'test-signed' } else { 'product' }
$setupBase = switch ($buildKind) {
  'test-signed' { 'KAYAN-ERP-TEST-ONLY-Setup' }
  'evaluation' { 'KAYAN-ERP-EVALUATION-ONLY-Setup' }
  default { 'KAYAN-ERP-Setup' }
}
$licencePublicKey = $null
if (-not $EvaluationBuild) {
  $licenceCandidates = @()
  if ($LicencePublicKeyPath) {
    $explicitKey = if ([IO.Path]::IsPathRooted($LicencePublicKeyPath)) { [IO.Path]::GetFullPath($LicencePublicKeyPath) } else { [IO.Path]::GetFullPath((Join-Path $root $LicencePublicKeyPath)) }
    # Never fall back to a different file if the caller chose an explicit path.
    if (-not (Test-Path -LiteralPath $explicitKey -PathType Leaf)) { throw 'The explicitly requested licence public key file is missing.' }
    $licenceCandidates += $explicitKey
  } else {
    $licenceCandidates += @((Join-Path $PSScriptRoot 'public-key.pem'), (Join-Path $PSScriptRoot 'licensing\public-key.pem'))
  }
  $licencePublicKey = $licenceCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required to validate the licence build policy.' }
$policy = Join-Path $root 'scripts\license-build-policy.mjs'
if ($licencePublicKey) { & node $policy --mode $buildKind --public-key $licencePublicKey } else { & node $policy --mode $buildKind }
if ($LASTEXITCODE -ne 0) { throw 'Licence build policy validation failed. No installer was built.' }
# Never overwrite an earlier installer or compiler log. A new directory is
# required, not merely an empty shared one that another process could use.
if (Test-Path -LiteralPath $outputPath) { throw 'Installer output path already exists; choose a new directory.' }
if (Test-Path -LiteralPath $stage) { throw 'The unique staging directory already exists; refusing to reuse it.' }
[void](New-Item -ItemType Directory -Path $outputPath -ErrorAction Stop)

# The build log is the only thing that can explain a failed build, and the
# job log of a CI run is not always readable. It is written next to the
# installer and repeated as a GitHub annotation when something goes wrong.
$buildLog = Join-Path $stage 'windows-installer-build.log'
$transcriptRunning = $false
try {
  New-Item -ItemType Directory -Path (Split-Path -Parent $buildLog) | Out-Null
  Start-Transcript -Path $buildLog | Out-Null
  $transcriptRunning = $true
} catch {
  Write-Host "Could not start the build transcript: $($_.Exception.Message)"
}
trap {
  $reason = $_.Exception.Message
  if ($transcriptRunning) { try { Stop-Transcript | Out-Null } catch { } }
  Write-Host ("::error title=Windows installer build failed::" + (($reason -replace '[\r\n]+', ' ')))
  try {
    $tail = @(Get-Content -LiteralPath $buildLog -Tail 60 -ErrorAction SilentlyContinue)
    if ($tail.Count -gt 0) {
      $flat = (($tail -join ' | ') -replace '[\r\n]+', ' ')
      if ($flat.Length -gt 3000) { $flat = $flat.Substring($flat.Length - 3000) }
      Write-Host ("::error title=Installer build log::" + $flat)
    }
  } catch { }
  exit 1
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Required build command '$Name' was not found. Install it on the Windows build machine." }
}
function Invoke-DownloadWithRetry([string]$Url, [string]$Destination, [int]$Attempts = 3) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      $attemptPath = "$Destination.attempt-$attempt"
      if ((Test-Path -LiteralPath $Destination) -or (Test-Path -LiteralPath $attemptPath)) {
        throw 'A download target already exists; refusing to overwrite it.'
      }
      Write-Host "Downloading $([IO.Path]::GetFileName($Destination)) (attempt $attempt/$Attempts)..."
      Invoke-WebRequest -Uri $Url -OutFile $attemptPath -TimeoutSec 300
      if (-not (Test-Path -LiteralPath $attemptPath) -or (Get-Item -LiteralPath $attemptPath).Length -le 0) {
        throw "Download produced an empty file: $attemptPath"
      }
      Move-Item -LiteralPath $attemptPath -Destination $Destination
      return
    } catch {
      $message = $_.Exception.Message
      # Preserve any partial download for inspection in this run's private
      # staging directory; each retry uses a different filename.
      if ($attempt -ge $Attempts) {
        throw "Download failed after $Attempts attempts for $Url. Last error: $message"
      }
      Write-Host "Download attempt $attempt failed: $message. Retrying in $($attempt * 5) seconds..."
      Start-Sleep -Seconds ($attempt * 5)
    }
  }
}
function Get-VerifiedArchive([string]$Url, [string]$Destination, [string]$Sha256) {
  $validExistingFile = $false
  if (Test-Path -LiteralPath $Destination) {
    $existingHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    $validExistingFile = $existingHash -eq $Sha256
    if (-not $validExistingFile) {
      throw "Checksum-mismatched archive was left untouched: $([IO.Path]::GetFileName($Destination))"
    }
  }
  if (-not $validExistingFile) {
    Invoke-DownloadWithRetry -Url $Url -Destination $Destination
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
# Use the icon assets from the supplied working-tree snapshot as-is. The icon
# generator overwrites tracked Windows/web assets and also writes Android files.
foreach ($icon in @('windows\runner\resources\app_icon.ico', 'web\favicon.png', 'web\icons\Icon-192.png', 'web\icons\Icon-512.png', 'web\icons\Icon-maskable-192.png', 'web\icons\Icon-maskable-512.png')) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $icon) -PathType Leaf)) { throw "Required existing icon asset is missing: $icon" }
}
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
if (-not (Test-Path $vcRuntime)) { Invoke-DownloadWithRetry -Url $vcRuntimeUrl -Destination $vcRuntime }
$vcSignature = Get-AuthenticodeSignature -FilePath $vcRuntime
if ($vcSignature.Status -ne 'Valid' -or $vcSignature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
  throw 'The Microsoft Visual C++ x64 redistributable signature could not be verified.'
}

$app = Join-Path $stage 'KAYAN-ERP'
if (Test-Path -LiteralPath $app) { throw 'Staging app directory already exists; refusing to replace it.' }
New-Item -ItemType Directory -Force -Path (Join-Path $app 'backend'), (Join-Path $app 'backend\node'), (Join-Path $app 'backend\postgres'), (Join-Path $app 'build\web') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $app 'licenses') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $app 'prerequisites') | Out-Null
# The downloadable sample backup is not runtime configuration or a system
# seed. This explicit demo JSON copy is omitted for every build mode; the
# final payload still requires independent sensitive-content inspection.
# The optional demo-download endpoint returns its existing 404 when absent;
# normal backup/restore and first-run initialization do not depend on it.
Copy-Item $vcRuntime (Join-Path $app 'prerequisites\vc_redist.x64.exe') -Force

Write-Host '[1/8] Build backend and Prisma client'
Run-Native 'npm.cmd' @('ci','--no-audit','--no-fund') $backend
Run-Native 'npm.cmd' @('run','prisma:generate') $backend
Run-Native 'npm.cmd' @('run','build') $backend

Write-Host '[2/8] Stage production backend files (development .env is excluded)'
# The licence of the Arabic typeface travels with the program: the font is
# embedded in the bundle, and its licence has to ship beside it.
# Copy runtime trees into fresh staging, omitting compiled test suites, test
# directories and the development demo seeder; never remove source files.
foreach ($relative in @('dist','prisma')) {
  $sourceRoot = Join-Path $backend $relative
  if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) { throw "Missing runtime tree $relative." }
  foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse) {
    $subPath = $file.FullName.Substring($sourceRoot.Length).TrimStart('\','/')
    if ($subPath -match '(^|[\\/])(__tests__|tests?|fixtures|demo-data)([\\/]|$)' -or
        $file.Name -match '(?i)(\.spec\.|\.test\.|^seed-demo\.)') { continue }
    $destination = Join-Path (Join-Path $app "backend\$relative") $subPath
    [void](New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force)
    Copy-Item -LiteralPath $file.FullName -Destination $destination
  }
}
foreach ($relative in @('package.json','package-lock.json','nest-cli.json','tsconfig.json','OFL-NotoNaskhArabic.txt')) {
  Copy-Item -LiteralPath (Join-Path $backend $relative) -Destination (Join-Path $app 'backend')
}
# Do not ship scenario runners or the demo data generator. These two modules
# are the runtime database preparer and its direct dependencies.
$runtimeScripts = Join-Path $app 'backend\scripts'
[void](New-Item -ItemType Directory -Path $runtimeScripts)
foreach ($script in @('prepare-database.mjs', 'database-state.mjs', 'migrate-deploy.mjs')) {
  Copy-Item -LiteralPath (Join-Path $backend "scripts\$script") -Destination $runtimeScripts
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
# The official archive also contains pgAdmin and unrelated tooling. Recursing
# into its deeply nested Python packages coincided with Inno failing while
# compressing a 264-character pgAdmin path on the Windows runner. The service needs
# PostgreSQL's binaries, extension libraries and shared data, not pgAdmin. Copy
# only those runtime trees into this fresh staging directory; never delete or
# modify anything in the downloaded archive.
foreach ($runtimeDir in @('bin', 'lib', 'share')) {
  $source = Join-Path $pgBin.FullName $runtimeDir
  if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Verified PostgreSQL archive is missing runtime directory $runtimeDir." }
  Copy-Item -LiteralPath $source -Destination (Join-Path $app 'backend\postgres') -Recurse -Force
}
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
Copy-Item (Join-Path $PSScriptRoot 'repair-runtime.ps1') $app
Copy-Item (Join-Path $PSScriptRoot 'reset-kayan.ps1') $app
Copy-Item (Join-Path $PSScriptRoot 'repair-kayan.bat') $app
Copy-Item (Join-Path $PSScriptRoot 'remove-runtime.ps1') $app
Copy-Item (Join-Path $PSScriptRoot 'database-control.ps1') $app
Copy-Item (Join-Path $PSScriptRoot 'UnelevatedProcess.cs') $app
Copy-Item (Join-Path $PSScriptRoot 'README.txt') $app
Copy-Item (Join-Path $PSScriptRoot 'THIRD_PARTY_NOTICES.md') $app
# Offline licensing: a build prepared for customers carries the operator's
# PUBLIC key only. The private key never leaves the supplier's key generator.
#
# A build with no key cannot verify any licence, so shipping one would mean
# shipping a copy that runs without an activation key. That is a build error,
# not a warning: the only way to produce such a build is to ask for it with
# -EvaluationBuild, and then the manifest and the installer's own log say so.
if ($licencePublicKey) {
  # Canonical destination even when the supplied file has a different name.
  $stagedPublicKey = Join-Path $app 'public-key.pem'
  Copy-Item -LiteralPath $licencePublicKey -Destination $stagedPublicKey -Force
  # Validate the actual staged bytes too, not only the source selected earlier.
  & node $policy --mode $buildKind --public-key $stagedPublicKey
  if ($LASTEXITCODE -ne 0) { throw 'Staged licence public key failed policy validation.' }
  $licenceMode = 'enforce'
  $licenceKeySha256 = (Get-FileHash -LiteralPath $stagedPublicKey -Algorithm SHA256).Hash
  Write-Host "Licensing: enforcement ON ($buildKind); staged public key SHA256 $licenceKeySha256"
} else {
  $licenceMode = 'warn'
  $licenceKeySha256 = ''
  Write-Host '::warning title=Evaluation build::This EVALUATION-ONLY build does not enforce licences and must not be given to customers.'
}
Copy-Item (Join-Path $PSScriptRoot 'installer.iss') (Join-Path $stage 'installer.iss')
# The icon Inno Setup embeds into Setup.exe (SetupIconFile in installer.iss).
# generate_app_icons.py above has just refreshed it from the brand image.
Copy-Item (Join-Path $root 'windows\runner\resources\app_icon.ico') (Join-Path $stage 'setup.ico')

# Compile the real RepairTool.exe that ships in the Start menu and is exercised
# by scripts\smoke-test-installed-windows.ps1.
Write-Host 'Compiling RepairTool.exe'
$repairToolExe = Join-Path $app 'RepairTool.exe'
& (Join-Path $PSScriptRoot 'build-repair-tool.ps1') -OutputPath $repairToolExe -IconPath (Join-Path $root 'windows\runner\resources\app_icon.ico')
if (-not (Test-Path -LiteralPath $repairToolExe)) { throw 'RepairTool.exe was not produced by the C# compiler.' }

Write-Host '[6/8] Verify staged runtime essentials and absence of development .env'
$required = @('erp_kayan.exe','backend\dist\src\main.js','backend\dist\prisma\seed.js','backend\scripts\prepare-database.mjs','backend\scripts\database-state.mjs','backend\scripts\migrate-deploy.mjs','backend\node_modules\prisma\build\index.js','backend\prisma\schema.prisma','backend\prisma\migrations\migration_lock.toml','backend\node\node.exe','backend\postgres\bin\pg_ctl.exe','backend\postgres\bin\pg_isready.exe','backend\postgres\bin\initdb.exe','backend\postgres\bin\psql.exe','backend\postgres\bin\pg_dump.exe','backend\postgres\bin\pg_restore.exe','build\web\index.html','install-runtime.ps1','repair-runtime.ps1','reset-kayan.ps1','repair-kayan.bat','remove-runtime.ps1','database-control.ps1','UnelevatedProcess.cs','RepairTool.exe','prerequisites\vc_redist.x64.exe')
foreach ($item in $required) { if (-not (Test-Path (Join-Path $app $item))) { throw "Staged package is missing $item" } }
$migrationFiles = @(Get-ChildItem -LiteralPath (Join-Path $app 'backend\prisma\migrations') -Filter 'migration.sql' -File -Recurse)
if ($migrationFiles.Count -eq 0) { throw 'Staged package has no Prisma migrations.' }
$secretEnvironmentFiles = Get-ChildItem -LiteralPath $app -Force -File -Recurse | Where-Object { $_.Name -eq '.env' -or $_.Name -like '.env.*' }
if ($secretEnvironmentFiles) { throw 'Environment files are forbidden in the installer package.' }

Write-Host '[7/8] Write artifact manifest with exact pinned versions'
$sourceCommit = & git -C $root rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Unable to read source HEAD.' }
$sourceStatus = @(& git -C $root status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Unable to read source working-tree status.' }
# HEAD alone never identifies a dirty tree; ignored inputs are not covered by
# Git status either. A separately reviewed source inventory is still required.
$manifest = [ordered]@{ product='KAYAN ERP'; productVersion=$appVersion; architecture='x64'; nodeVersion=$nodeVersion; postgresqlVersion=($postgresVersion -replace '-1$',''); flutterVersion=((flutter --version --machine | ConvertFrom-Json).frameworkVersion); sourceCommit=$sourceCommit; sourceTreeDirty=($sourceStatus.Count -gt 0); sourceTreeIgnoresNotAudited=$true; windowsInstallerTested=$false; licenseBuildKind=$buildKind; licenseEnforcement=$licenceMode; licensePublicKeySha256=$licenceKeySha256 }
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $app 'runtime-manifest.json') -Encoding UTF8

if (-not $SkipInstaller) {
  Write-Host '[8/8] Compile standalone Inno Setup installer'
  if (-not (Test-Path -LiteralPath $outputPath)) { [void][IO.Directory]::CreateDirectory($outputPath) }
  # ISCC has no /LOG switch (it rejects any option it does not know, which is
  # how the previous attempt ended as a bare "failed (2)"). Its diagnosis goes
  # to stdout/stderr, so the compiler's own output is captured to the log here
  # and its last lines are repeated in the error. 2>&1 also keeps PowerShell
  # from turning a compiler message into a terminating NativeCommandError
  # before the exit code can be read.
  $isccLog = Join-Path $outputPath 'iscc.log'
  $isccArguments = @("/DSourceDir=$app", "/DOutputDir=$outputPath", "/DAppVersion=$appVersion", "/DKayanBuildKind=$buildKind", (Join-Path $stage 'installer.iss'))
  $isccOutput = @(& $iscc.Source @isccArguments 2>&1 | ForEach-Object { "$_" })
  $isccExit = $LASTEXITCODE
  [IO.File]::WriteAllText($isccLog, ($isccOutput -join [Environment]::NewLine))
  $isccOutput | ForEach-Object { Write-Host $_ }
  if ($isccExit -ne 0) {
    $details = (($isccOutput | Select-Object -Last 30) -join ' | ')
    if (-not $details) { $details = 'ISCC printed nothing; see the build log.' }
    if ($details.Length -gt 3000) { $details = $details.Substring($details.Length - 3000) }
    Write-Host "::error title=Inno Setup::$(($details -replace '%','%25') -replace '\r?\n','%0A')"
    throw "Inno Setup failed ($isccExit). $details"
  }
  $versionedSetup = Join-Path $outputPath "$setupBase-$appVersion-x64.exe"
  $canonicalSetup = Join-Path $outputPath "$setupBase.exe"
  if (-not (Test-Path -LiteralPath $versionedSetup -PathType Leaf)) { throw 'Inno Setup did not produce the expected mode-specific installer.' }
  Copy-Item -LiteralPath $versionedSetup -Destination $canonicalSetup -Force
}
Write-Host "Build staging: $app"
if (-not $SkipInstaller) {
  Write-Host "Installer: $(Join-Path $outputPath "$setupBase-$appVersion-x64.exe")"
  Write-Host "Canonical Installer: $(Join-Path $outputPath "$setupBase.exe")"
}
Write-Host 'A native Windows install/service test is still required; build host does not prove runtime behavior.'
