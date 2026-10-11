#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs Microsoft Visual C++ 2015-2022 Redistributable (x64).
  Required by PostgreSQL on Windows if not already present.
.NOTES
  Must be run as Administrator.
  Safe to run multiple times — skips install if already present.
#>

$ErrorActionPreference = 'Stop'

$vcRegPath = 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
$minVersion = [Version]'14.29.0.0'

function Test-VcInstalled {
    if (Test-Path $vcRegPath) {
        try {
            $installed = [Version](Get-ItemPropertyValue $vcRegPath 'Version').TrimStart('v')
            return $installed -ge $minVersion
        } catch { }
    }
    return $false
}

if (Test-VcInstalled) {
    Write-Host "[OK] Visual C++ Redistributable already installed. Skipping." -ForegroundColor Green
    exit 0
}

Write-Host "[INFO] Downloading Visual C++ 2015-2022 Redistributable..." -ForegroundColor Cyan

$url    = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
$tmpDir = Join-Path $env:TEMP 'kayan_vcredist'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$dest = Join-Path $tmpDir 'vc_redist.x64.exe'

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
} catch {
    Write-Error "Download failed: $_"
    exit 1
}

if (-not (Test-Path $dest) -or (Get-Item $dest).Length -lt 1MB) {
    Write-Error "Downloaded file appears invalid or too small."
    exit 1
}

Write-Host "[INFO] Installing Visual C++ Redistributable silently..." -ForegroundColor Cyan
$proc = Start-Process -FilePath $dest -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru
if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
    Write-Host "[OK] Installation complete (exit code: $($proc.ExitCode))." -ForegroundColor Green
    if ($proc.ExitCode -eq 3010) {
        Write-Warning "A system restart is recommended to complete the installation."
    }
} else {
    Write-Error "Installer exited with code $($proc.ExitCode)."
    exit $proc.ExitCode
}

# Cleanup
Remove-Item $dest -Force -ErrorAction SilentlyContinue
