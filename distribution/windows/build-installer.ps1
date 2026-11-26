[CmdletBinding()]
param(
  [string]$Output = 'build\windows-installer',
  # Required acknowledgement: this script runs npm ci, Prisma and Flutter,
  # which modify generated files. Use only a reviewed disposable source copy.
  [switch]$DisposableSource,
  [switch]$SkipInstaller,
  # Optional persistent caches. Leave unset in CI to use runner defaults; local
  # builds can point these at the operator's D: drive without baking that
  # machine-specific layout into CI requirements.
  [string]$DownloadsCache = '',
  [string]$NpmCache = '',
  [string]$PubCache = '',
  [string]$TempRoot = '',
  # Builds the product without licences enforced. Only for development: such a
  # build refuses every customer key, and it must never be handed to a
  # customer. Without this switch a build that cannot find the operator's
  # public key fails instead of shipping quietly unprotected - that is how a
  # released Setup came to run without asking for an activation key.
  [switch]$EvaluationBuild,
  # An explicitly labelled diagnostic installer using a throwaway public key.
  # It must never be published or given to a customer as a product installer.
  [switch]$TestSignedBuild,
  [string]$IsccPath = '',
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

# Persistent caches are opt-in and caller-owned. CI runners use their normal
# ephemeral cache setup unless a workflow explicitly supplies cache paths.
$script:downloadsCachePath = $null
if ($DownloadsCache) {
  $script:downloadsCachePath = [IO.Path]::GetFullPath($DownloadsCache)
  [void](New-Item -ItemType Directory -Force -Path $script:downloadsCachePath)
}
if ($NpmCache) {
  $npmCachePath = [IO.Path]::GetFullPath($NpmCache)
  [void](New-Item -ItemType Directory -Force -Path $npmCachePath)
  $env:npm_config_cache = $npmCachePath
}
if ($PubCache) {
  $pubCachePath = [IO.Path]::GetFullPath($PubCache)
  [void](New-Item -ItemType Directory -Force -Path $pubCachePath)
  $env:PUB_CACHE = $pubCachePath
}
if ($TempRoot) {
  $tempRootPath = [IO.Path]::GetFullPath($TempRoot)
  [void](New-Item -ItemType Directory -Force -Path $tempRootPath)
  $env:TEMP = $tempRootPath
  $env:TMP = $tempRootPath
}
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
function Test-VerifiedArtifact([string]$Path, [string]$Sha256, [switch]$RequireMicrosoftSignature) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or (Get-Item -LiteralPath $Path).Length -le 0) { return $false }
  if ($Sha256) {
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256.ToLowerInvariant()) { return $false }
  }
  if ($RequireMicrosoftSignature) {
    $signature = Get-AuthenticodeSignature -FilePath $Path
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') { return $false }
  }
  return $true
}
function Import-VerifiedCachedArtifact([string]$Name, [string]$Destination, [string]$Sha256, [switch]$RequireMicrosoftSignature) {
  if (-not $script:downloadsCachePath) { return $false }
  $cached = Join-Path $script:downloadsCachePath $Name
  if (-not (Test-Path -LiteralPath $cached -PathType Leaf)) { return $false }
  if (-not (Test-VerifiedArtifact $cached $Sha256 -RequireMicrosoftSignature:$RequireMicrosoftSignature)) {
    Write-Warning "Cached artifact failed integrity/signature verification and was left untouched: $cached"
    return $false
  }
  Copy-Item -LiteralPath $cached -Destination $Destination
  if (-not (Test-VerifiedArtifact $Destination $Sha256 -RequireMicrosoftSignature:$RequireMicrosoftSignature)) {
    throw "Cached artifact changed while being copied: $Name"
  }
  Write-Host "Using verified cached artifact: $Name"
  return $true
}
function Save-VerifiedCachedArtifact([string]$Name, [string]$Source, [string]$Sha256, [switch]$RequireMicrosoftSignature) {
  if (-not $script:downloadsCachePath) { return }
  if (-not (Test-VerifiedArtifact $Source $Sha256 -RequireMicrosoftSignature:$RequireMicrosoftSignature)) {
    throw "Refusing to cache an unverified artifact: $Name"
  }
  $target = Join-Path $script:downloadsCachePath $Name
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    if (-not (Test-VerifiedArtifact $target $Sha256 -RequireMicrosoftSignature:$RequireMicrosoftSignature)) {
      Write-Warning "Existing cache entry is invalid and will not be overwritten: $target"
    }
    return
  }
  $temporary = "$target.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    Copy-Item -LiteralPath $Source -Destination $temporary
    if (-not (Test-VerifiedArtifact $temporary $Sha256 -RequireMicrosoftSignature:$RequireMicrosoftSignature)) {
      throw "Cached copy failed integrity/signature verification: $Name"
    }
    Move-Item -LiteralPath $temporary -Destination $target
    Write-Host "Cached verified artifact: $Name"
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}
function Run-Native([string]$File, [string[]]$Arguments, [string]$WorkingDirectory) {
  Push-Location $WorkingDirectory
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $File $($Arguments -join ' ')" }
  } finally { Pop-Location }
}
function Copy-PostgresRuntimeFromArchive([string]$Archive, [string]$Destination, [string]$LicenseDestination) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    # The upstream archive has a single PostgreSQL root (normally pgsql/).
    # Locate it from initdb instead of assuming its directory name, then read
    # only the runtime trees.  In particular, do not materialize pgAdmin's
    # deeply nested Python files on the Windows build machine.
    $initdb = $zip.Entries | Where-Object { $_.FullName -match '(?i)^(?<root>.*?)(?<directory>bin)/initdb\.exe$' } | Select-Object -First 1
    if (-not $initdb) { throw 'The verified PostgreSQL archive did not contain bin\\initdb.exe.' }
    $archiveRoot = $initdb.FullName.Substring(0, $initdb.FullName.Length - 'bin/initdb.exe'.Length)
    $destinationRoot = [IO.Path]::GetFullPath($Destination)
    if (-not $destinationRoot.EndsWith([IO.Path]::DirectorySeparatorChar)) { $destinationRoot += [IO.Path]::DirectorySeparatorChar }

    foreach ($runtimeDir in @('bin', 'lib', 'share')) {
      $entryPrefix = "$archiveRoot$runtimeDir/"
      $runtimeEntries = @($zip.Entries | Where-Object { $_.FullName.StartsWith($entryPrefix, [StringComparison]::OrdinalIgnoreCase) -and -not $_.FullName.EndsWith('/') })
      if ($runtimeEntries.Count -eq 0) { throw "Verified PostgreSQL archive is missing runtime directory $runtimeDir." }
      foreach ($entry in $runtimeEntries) {
        $relative = $entry.FullName.Substring($archiveRoot.Length).Replace('/', [IO.Path]::DirectorySeparatorChar)
        if ($relative -match '(^|[\\/])\.\.([\\/]|$)') { throw "Refusing traversal in PostgreSQL archive entry: $($entry.FullName)" }
        $target = [IO.Path]::GetFullPath((Join-Path $Destination $relative))
        if (-not $target.StartsWith($destinationRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing archive entry outside PostgreSQL runtime destination: $($entry.FullName)" }
        [void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target))
        $input = $entry.Open()
        try {
          $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
          try { $input.CopyTo($output) } finally { $output.Dispose() }
        } finally { $input.Dispose() }
      }
    }

    # Licence notices travel with the PostgreSQL runtime, copied straight from
    # the archive so pgAdmin is never extracted.
    #
    # The notice is NOT always at the archive root: the EDB Windows archive
    # keeps it beside the binaries (pgsql\COPYRIGHT, pgsql\README). The first
    # version of this function matched only "<root>LICENSE", found nothing,
    # `continue`d silently, and the finished package then failed the payload
    # check with "Required runtime payload entries are missing:
    # licenses/PostgreSQL-LICENSE". Search the whole archive, prefer the
    # shallowest match, and keep the historical PostgreSQL-LICENSE name that
    # the manifest and the payload verifier both refer to.
    [void](New-Item -ItemType Directory -Force -Path $LicenseDestination)
    $licenseCopied = $false
    foreach ($licenseName in @('LICENSE','COPYRIGHT','README')) {
      $entry = $zip.Entries |
        Where-Object { $_.FullName -match "(?i)(^|/)$licenseName$" -and -not $_.FullName.EndsWith('/') } |
        Sort-Object { ($_.FullName -split '/').Count } |
        Select-Object -First 1
      if (-not $entry) { continue }
      $target = Join-Path $LicenseDestination "PostgreSQL-$licenseName"
      $input = $entry.Open()
      try {
        $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
        try { $input.CopyTo($output) } finally { $output.Dispose() }
      } finally { $input.Dispose() }
      if ($licenseName -ne 'LICENSE') {
        Copy-Item -LiteralPath $target -Destination (Join-Path $LicenseDestination 'PostgreSQL-LICENSE') -Force
      }
      $licenseCopied = $true
      break
    }
    if (-not $licenseCopied) {
      throw 'The verified PostgreSQL archive carried no LICENSE, COPYRIGHT or README notice; refusing to ship a package without its third-party licence.'
    }
  } finally { $zip.Dispose() }
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
$iscc = if ($IsccPath) {
  if (-not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) { throw 'The explicitly requested Inno compiler is missing.' }
  @{ Source = [IO.Path]::GetFullPath($IsccPath) }
} else { Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue }
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
if (-not (Import-VerifiedCachedArtifact $nodeArchive $nodeZip $nodeSha256)) {
  Get-VerifiedArchive $nodeUrl $nodeZip $nodeSha256
  Save-VerifiedCachedArtifact $nodeArchive $nodeZip $nodeSha256
}
if (-not (Import-VerifiedCachedArtifact $postgresArchive $pgZip $postgresSha256)) {
  Get-VerifiedArchive $postgresUrl $pgZip $postgresSha256
  Save-VerifiedCachedArtifact $postgresArchive $pgZip $postgresSha256
}
$vcRuntime = Join-Path $stage 'downloads\vc_redist.x64.exe'
if (-not (Import-VerifiedCachedArtifact 'vc_redist.x64.exe' $vcRuntime '' -RequireMicrosoftSignature)) {
  Invoke-DownloadWithRetry -Url $vcRuntimeUrl -Destination $vcRuntime
}
$vcSignature = Get-AuthenticodeSignature -FilePath $vcRuntime
if ($vcSignature.Status -ne 'Valid' -or $vcSignature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
  throw 'The Microsoft Visual C++ x64 redistributable signature could not be verified.'
}
Save-VerifiedCachedArtifact 'vc_redist.x64.exe' $vcRuntime '' -RequireMicrosoftSignature

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
    # Source maps are a development aid. They double the size of the shipped
    # JavaScript, they are generated by tsc from the same sources, and they
    # carry absolute paths from the build machine into production. They are
    # excluded here, not disabled: tsconfig keeps sourceMap on for development
    # and the checked-in sources are untouched.
    if ($file.Extension -eq '.map') { continue }
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
foreach ($script in @('prepare-database.mjs', 'database-state.mjs', 'migrate-deploy.mjs', 'apply-migrations.mjs')) {
  Copy-Item -LiteralPath (Join-Path $backend "scripts\$script") -Destination $runtimeScripts
}
Run-Native 'npm.cmd' @('ci','--omit=dev','--no-audit','--no-fund') (Join-Path $app 'backend')
# prepare-database.mjs intentionally shells out to the Prisma CLI to apply the same checked-in migrations.
Run-Native 'npm.cmd' @('install','--no-save','--omit=dev','--no-audit','--no-fund','prisma@6.19.3') (Join-Path $app 'backend')
Run-Native 'node.exe' @((Join-Path $app 'backend\node_modules\prisma\build\index.js'),'generate') (Join-Path $app 'backend')

# Source maps are a development aid. They roughly double the shipped JavaScript
# and they embed absolute paths from the build machine. Two separate producers
# write them: tsc for our own code, and the published packages that arrive with
# npm. dist is filtered while it is copied above; the dependency tree can only
# be filtered here, once npm ci and prisma generate have finished writing it.
# Deleting from the staged copy is deliberate: the developer working tree and
# its node_modules are never touched, and sourceMap stays on for development.
Write-Host '[2b/8] Remove source maps from the staged dependency tree'
$stagedRoots = @((Join-Path $app 'backend'), (Join-Path $app 'build'))
$removedMaps = 0
foreach ($stagedRoot in $stagedRoots) {
  if (-not (Test-Path -LiteralPath $stagedRoot -PathType Container)) { continue }
  foreach ($mapFile in @(Get-ChildItem -LiteralPath $stagedRoot -Filter '*.map' -File -Recurse -ErrorAction SilentlyContinue)) {
    # Nothing that is required to run may disappear. Refuse loudly rather than
    # quietly delete a runtime file that happens to end in .map.
    $relativeMap = $mapFile.FullName.Substring($app.Length).TrimStart('\', '/')
    foreach ($required in @('backend\dist\src\main.js', 'backend\dist\prisma\seed.js')) {
      if ($relativeMap -eq $required) { throw "Refusing to remove a required runtime file: $relativeMap" }
    }
    Remove-Item -LiteralPath $mapFile.FullName -Force
    $removedMaps++
  }
}
if ($removedMaps -gt 0) { Write-Host "  removed $removedMaps source map file(s) from the payload" }

Write-Host '[3/8] Build Flutter Windows x64 and production Web'
$sourceCommit = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'Unable to read the exact source HEAD for the runtime build identity.' }
$sourceStatus = @(& git -C $root status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Unable to read source working-tree status.' }
$sourceDirty = ($sourceStatus.Count -gt 0).ToString().ToLowerInvariant()
$buildIdentity = @(
  "--dart-define=KAYAN_APP_VERSION=$version",
  "--dart-define=KAYAN_SOURCE_COMMIT=$sourceCommit",
  "--dart-define=KAYAN_SOURCE_DIRTY=$sourceDirty"
)
Run-Native $flutterCommand (@('build','windows','--release','--dart-define=APP_ENV=production') + $buildIdentity) $root
$release = Join-Path $root 'build\windows\x64\runner\Release'
if (-not (Test-Path (Join-Path $release 'erp_kayan.exe'))) {
  $release = Join-Path $root 'build\windows\runner\Release'
}
if (-not (Test-Path (Join-Path $release 'erp_kayan.exe'))) { throw 'Flutter Windows x64 release output is missing erp_kayan.exe.' }
Copy-Item (Join-Path $release '*') $app -Recurse -Force
Run-Native $flutterCommand (@('build','web','--release','--base-href=/','--dart-define=APP_ENV=production','--dart-define=API_BASE_URL=/api/v1') + $buildIdentity) $root
Copy-Item (Join-Path $root 'build\web\*') (Join-Path $app 'build\web') -Recurse -Force

Write-Host '[4/8] Bundle official Node.js x64 and PostgreSQL 17 x64'
Expand-Archive -LiteralPath $nodeZip -DestinationPath (Join-Path $stage 'extract-node') -Force
$nodeFolder = Get-ChildItem (Join-Path $stage 'extract-node') -Directory | Select-Object -First 1
Copy-Item (Join-Path $nodeFolder.FullName '*') (Join-Path $app 'backend\node') -Recurse -Force
# The installed application runs node.exe directly; npm/Corepack are build-time
# package managers, not runtime dependencies. Their bundled npm documentation
# also includes private-key examples, so do not ship the package-manager trees
# or command shims in the production installer.
$bundledNodeExtras = @(
  'node_modules\npm',
  'node_modules\corepack',
  'npm.cmd',
  'npx.cmd',
  'corepack.cmd',
  'npm',
  'npx',
  'corepack'
)
foreach ($relativeExtra in $bundledNodeExtras) {
  $extraPath = Join-Path $app "backend\node\$relativeExtra"
  if (Test-Path -LiteralPath $extraPath) {
    Remove-Item -LiteralPath $extraPath -Recurse -Force
  }
}
$nodeModulesPath = Join-Path $app 'backend\node\node_modules'
if (Test-Path -LiteralPath $nodeModulesPath -PathType Container) {
  $remainingNodeModules = @(Get-ChildItem -LiteralPath $nodeModulesPath -Force)
  if ($remainingNodeModules.Count -eq 0) { Remove-Item -LiteralPath $nodeModulesPath -Force }
}
foreach ($relativeExtra in $bundledNodeExtras) {
  if (Test-Path -LiteralPath (Join-Path $app "backend\node\$relativeExtra")) {
    throw "Build-only Node package-manager content remains in the production runtime: $relativeExtra."
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $app 'backend\node\node.exe'))) {
  throw 'The bundled Node.js executable is missing after package-manager pruning.'
}
# The official archive also contains pgAdmin and unrelated tooling. Extract
# only PostgreSQL's runtime trees directly from the verified archive: staging
# pgAdmin's nested Python packages can exceed Windows' path limit.
Copy-PostgresRuntimeFromArchive -Archive $pgZip -Destination (Join-Path $app 'backend\postgres') -LicenseDestination (Join-Path $app 'licenses')
Get-ChildItem $nodeFolder.FullName -Filter 'LICENSE*' -File -ErrorAction SilentlyContinue | Copy-Item -Destination (Join-Path $app 'licenses') -Force -ErrorAction SilentlyContinue

Write-Host '[5/8] Add database lifecycle and first-run setup scripts'
Copy-Item (Join-Path $PSScriptRoot 'install-runtime.ps1') $app
Copy-Item (Join-Path $PSScriptRoot 'repair-runtime.ps1') $app
Copy-Item (Join-Path $PSScriptRoot 'repair-kayan.bat') $app
Copy-Item (Join-Path $PSScriptRoot 'remove-runtime.ps1') $app
Copy-Item (Join-Path $PSScriptRoot 'remove-everything.ps1') $app
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
  $nextPublicKey = Join-Path $PSScriptRoot 'public-key-next.pem'
  if ($buildKind -eq 'product') {
    if (-not (Test-Path -LiteralPath $nextPublicKey -PathType Leaf)) { throw 'The approved transition public key is missing.' }
    & node --test (Join-Path $root 'scripts\license-public-key-transition.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Approved public-key fingerprints did not validate.' }
    Copy-Item -LiteralPath $nextPublicKey -Destination (Join-Path $app 'public-key-next.pem')
    Set-Content -LiteralPath (Join-Path $app 'keyring.required') -Value 'Both pinned Ed25519 public keys are required.' -Encoding ASCII
  }
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
$required = @('erp_kayan.exe','backend\dist\src\main.js','backend\dist\prisma\seed.js','backend\scripts\prepare-database.mjs','backend\scripts\database-state.mjs','backend\scripts\migrate-deploy.mjs','backend\scripts\apply-migrations.mjs','backend\node_modules\prisma\build\index.js','backend\node_modules\pg\package.json','backend\prisma\schema.prisma','backend\prisma\migrations\migration_lock.toml','backend\node\node.exe','backend\postgres\bin\pg_ctl.exe','backend\postgres\bin\pg_isready.exe','backend\postgres\bin\initdb.exe','backend\postgres\bin\psql.exe','backend\postgres\bin\pg_dump.exe','backend\postgres\bin\pg_restore.exe','build\web\index.html','install-runtime.ps1','repair-runtime.ps1','repair-kayan.bat','remove-runtime.ps1','remove-everything.ps1','database-control.ps1','UnelevatedProcess.cs','RepairTool.exe','prerequisites\vc_redist.x64.exe')
foreach ($item in $required) { if (-not (Test-Path (Join-Path $app $item))) { throw "Staged package is missing $item" } }
$migrationFiles = @(Get-ChildItem -LiteralPath (Join-Path $app 'backend\prisma\migrations') -Filter 'migration.sql' -File -Recurse)
if ($migrationFiles.Count -eq 0) { throw 'Staged package has no Prisma migrations.' }
$secretEnvironmentFiles = Get-ChildItem -LiteralPath $app -Force -File -Recurse | Where-Object { $_.Name -eq '.env' -or $_.Name -like '.env.*' }
if ($secretEnvironmentFiles) { throw 'Environment files are forbidden in the installer package.' }
# Third and last line of defence: if any source map survived staging, refuse to
# hand the package to Inno at all, rather than building something the payload
# inspection will reject minutes later on another runner.
$survivingMaps = @(Get-ChildItem -LiteralPath $app -Filter '*.map' -File -Recurse -ErrorAction SilentlyContinue)
if ($survivingMaps.Count -gt 0) {
  throw "The staged package still contains $($survivingMaps.Count) source map file(s), for example $($survivingMaps[0].FullName)."
}

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
