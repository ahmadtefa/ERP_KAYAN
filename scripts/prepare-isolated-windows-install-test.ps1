# PREPARATION ONLY: creates a Windows Sandbox configuration and guest script;
# it does not start Sandbox, install anything, or access an existing database.
# Inputs must be independently inspected installers in separate directories
# containing only the respective EXE. The only writable host mapping is a new,
# empty results directory. A Sandbox result is not signed release evidence.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$PreviousSetup,
  [Parameter(Mandatory = $true)][string]$CandidateSetup
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Preparation requires Windows.' }
function Get-IsolatedInput([string]$Path) {
  $file = Get-Item -LiteralPath $Path -Force
  if ($file.PSIsContainer -or $file.Attributes -band [IO.FileAttributes]::ReparsePoint -or $file.Name -notmatch '^[A-Za-z0-9._-]+\.exe$') {
    throw 'Each input must be an ordinary EXE with a simple filename.'
  }
  $parent = Get-Item -LiteralPath $file.DirectoryName -Force
  if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Mapped input folders must not be reparse points.' }
  $entries = @(Get-ChildItem -LiteralPath $parent.FullName -Force)
  if ($entries.Count -ne 1 -or $entries[0].FullName -ne $file.FullName) {
    throw 'Each mapped input folder must contain only the independently inspected installer.'
  }
  return $file
}
$previous = Get-IsolatedInput $PreviousSetup
$candidate = Get-IsolatedInput $CandidateSetup
if ($previous.DirectoryName -eq $candidate.DirectoryName) { throw 'Use separate input folders.' }
$base = Join-Path ([IO.Path]::GetTempPath()) ('kayan-sandbox-' + [guid]::NewGuid().ToString('N'))
$inputDir = Join-Path $base 'guest-script'
$resultDir = Join-Path $base 'results'
[void](New-Item -ItemType Directory -Path $inputDir)
[void](New-Item -ItemType Directory -Path $resultDir)
$guest = @'
$ErrorActionPreference = 'Stop'
# This script is launched only by the generated Sandbox configuration. Its
# outputs are diagnostic and must never by themselves authorize publication.
$root = 'C:\Users\WDAGUtilityAccount\Desktop'
$output = Join-Path $root 'Results\result.json'
$prev = Join-Path $root 'Previous\__PREVIOUS__'
$next = Join-Path $root 'Candidate\__CANDIDATE__'
$oldHash = (Get-FileHash -LiteralPath $prev -Algorithm SHA256).Hash
$newHash = (Get-FileHash -LiteralPath $next -Algorithm SHA256).Hash
function Install([string]$file) {
  $process = Start-Process -FilePath $file -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -PassThru
  if (-not $process.WaitForExit(2700000)) { throw 'Installer timed out inside Sandbox.' }
  if ($process.ExitCode -ne 0) { throw 'Installer returned a failure inside Sandbox.' }
}
try {
  Install $prev
  $key = Join-Path $env:ProgramData 'KAYAN-ERP\license\public-key.pem'
  $marker = Join-Path $env:ProgramData 'KAYAN-ERP\license\enforcement.required'
  if (-not (Test-Path -LiteralPath $key) -or -not (Test-Path -LiteralPath $marker)) { throw 'Initial enforced public key or marker is missing.' }
  $before = (Get-FileHash -LiteralPath $key -Algorithm SHA256).Hash
  if (-not (Get-Service -Name 'KayanERPPostgreSQL' -ErrorAction SilentlyContinue)) { throw 'Initial PostgreSQL service is missing.' }
  Install $next
  if (-not (Test-Path -LiteralPath $key) -or -not (Test-Path -LiteralPath $marker)) { throw 'Upgrade removed the enforced key or marker.' }
  $after = (Get-FileHash -LiteralPath $key -Algorithm SHA256).Hash
  if ($before -ne $after) { throw 'Upgrade changed the installed public-key file.' }
  if (-not (Get-Service -Name 'KayanERPPostgreSQL' -ErrorAction SilentlyContinue)) { throw 'PostgreSQL service is missing after upgrade.' }
  @{ status = 'basic-install-and-upgrade-only'; previousSha256 = $oldHash; candidateSha256 = $newHash; publicKeyUnchanged = $true; activeLicenceTested = $false; releaseApproved = $false } |
    ConvertTo-Json | Set-Content -LiteralPath $output -Encoding UTF8
} catch {
  @{ status = 'failed'; previousSha256 = $oldHash; candidateSha256 = $newHash; activeLicenceTested = $false; releaseApproved = $false } |
    ConvertTo-Json | Set-Content -LiteralPath $output -Encoding UTF8
  throw
}
'@
$guest = $guest.Replace('__PREVIOUS__', $previous.Name).Replace('__CANDIDATE__', $candidate.Name)
Set-Content -LiteralPath (Join-Path $inputDir 'guest.ps1') -Value $guest -Encoding UTF8
function XmlEscape([string]$value) { return [System.Security.SecurityElement]::Escape($value) }
# Sandbox mappings are read-only except for a fresh, dedicated results folder.
# Networking is disabled, and no host customer paths or services are mapped.
$config = @"
<Configuration>
  <Networking>Disable</Networking>
  <VGpu>Disable</VGpu>
  <MappedFolders>
    <MappedFolder><HostFolder>$(XmlEscape $previous.DirectoryName)</HostFolder><SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\Previous</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$(XmlEscape $candidate.DirectoryName)</HostFolder><SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\Candidate</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$(XmlEscape $inputDir)</HostFolder><SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\Guest</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$(XmlEscape $resultDir)</HostFolder><SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\Results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\WDAGUtilityAccount\Desktop\Guest\guest.ps1</Command></LogonCommand>
</Configuration>
"@
Set-Content -LiteralPath (Join-Path $base 'isolated-install-upgrade.wsb') -Value $config -Encoding UTF8
Write-Host 'Sandbox configuration prepared; nothing was started or installed.'
Write-Host "Configuration: $base\isolated-install-upgrade.wsb"
Write-Host 'Execution needs explicit approval and a Windows Sandbox-capable host. It starts a disposable PostgreSQL instance inside the guest.'
Write-Host 'This basic check does not activate an old synthetic licence, verify the final installer payload, or approve a release.'
