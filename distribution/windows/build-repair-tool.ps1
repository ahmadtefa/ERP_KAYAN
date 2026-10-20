<#
.SYNOPSIS
  Compiles distribution\windows\RepairTool.exe from RepairTool.cs.

.DESCRIPTION
  Uses the C# compiler that ships with the .NET Framework, so the build host
  needs no extra SDK and no NuGet restore. Called by build-installer.ps1 (to
  place the executable inside the staged package) and by CI as an early check,
  so a C# error fails the build in seconds rather than after the long Flutter
  build.

.PARAMETER OutputPath
  Full or relative path of the RepairTool.exe to produce.

.PARAMETER IconPath
  Optional .ico used for the executable icon.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File distribution\windows\build-repair-tool.ps1 -OutputPath build\RepairTool.exe
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$IconPath = ''
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'RepairTool.cs'
$manifest = Join-Path $PSScriptRoot 'RepairTool.manifest'
foreach ($required in @($source, $manifest)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "RepairTool source file is missing: $required" }
}

$cscCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw 'The .NET Framework C# compiler (csc.exe) was not found; it is required to build RepairTool.exe.' }

$outputFull = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $outputFull
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }

$arguments = @(
  '/nologo',
  '/target:winexe',
  '/platform:anycpu',
  '/optimize+',
  ('/out:' + $outputFull),
  ('/win32manifest:' + $manifest),
  '/r:System.dll',
  '/r:System.Drawing.dll',
  '/r:System.Windows.Forms.dll',
  $source
)
if ($IconPath -and (Test-Path -LiteralPath $IconPath)) {
  $arguments += ('/win32icon:' + [IO.Path]::GetFullPath($IconPath))
}

& $csc @arguments
if ($LASTEXITCODE -ne 0) { throw "RepairTool.exe compilation failed ($LASTEXITCODE)." }
if (-not (Test-Path -LiteralPath $outputFull)) { throw 'RepairTool.exe was not produced by the C# compiler.' }
Write-Host "RepairTool.exe built: $outputFull"
