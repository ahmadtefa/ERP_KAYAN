[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

# This is a destructive, product-scoped uninstall. The product owner has
# explicitly chosen full removal: database, backups, licence state, settings,
# logs and caches are all removed. Never widen these paths to a drive or a
# shared Node/PostgreSQL installation.
$serviceName = 'KayanERPPostgreSQL'
$programDataRoot = Join-Path $env:ProgramData 'KAYAN-ERP'
$installRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$expectedInstallRoot = [IO.Path]::GetFullPath((Join-Path $env:ProgramFiles 'KAYAN ERP'))

function Remove-OwnedTree([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) { return }
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  if ($full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\')) {
    throw "Refusing to remove a filesystem root: $full"
  }
  & takeown.exe /F $full /R /D Y *> $null
  & icacls.exe $full /grant '*S-1-5-32-544:(OI)(CI)F' /T /C *> $null
  Remove-Item -LiteralPath $full -Recurse -Force
  if (Test-Path -LiteralPath $full) { throw "KAYAN-owned data remains after deletion: $full" }
}

# Stop the desktop client and any child processes before touching its files.
Get-Process -Name 'erp_kayan' -ErrorAction SilentlyContinue | ForEach-Object {
  & taskkill.exe /PID $_.Id /T /F *> $null
}
Start-Sleep -Milliseconds 800

# Stop and unregister only KAYAN's private PostgreSQL service. The bundled
# PostgreSQL directory is inside the KAYAN install tree; shared PostgreSQL
# installations and system-wide Node.js are deliberately not touched.
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $serviceName -Force
    (Get-Service -Name $serviceName).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60))
  }
  $pgCtl = Join-Path $PSScriptRoot 'backend\postgres\bin\pg_ctl.exe'
  if (Test-Path -LiteralPath $pgCtl) {
    & $pgCtl unregister -N $serviceName
    if ($LASTEXITCODE -ne 0) { throw "Could not unregister $serviceName; no KAYAN data was deleted." }
  } else {
    & sc.exe delete $serviceName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not remove the orphaned $serviceName service; no KAYAN data was deleted." }
  }
}

# Remove only firewall rules whose display name is explicitly owned by KAYAN.
if (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue) {
  Get-NetFirewallRule -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'KAYAN ERP*' -or $_.DisplayName -like 'KAYAN-ERP*' } |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

# Remove machine-wide database, licence, licence backups, company backups,
# uploads, settings and diagnostics.
Remove-OwnedTree $programDataRoot

# Settings/logs may have been created in more than one Windows profile.
# Restrict removal to the exact KAYAN-ERP child folders under user profiles.
$profilesRoot = Join-Path $env:SystemDrive 'Users'
if (Test-Path -LiteralPath $profilesRoot) {
  Get-ChildItem -LiteralPath $profilesRoot -Directory -Force -ErrorAction SilentlyContinue |
    ForEach-Object {
      Remove-OwnedTree (Join-Path $_.FullName 'AppData\Roaming\KAYAN-ERP')
      Remove-OwnedTree (Join-Path $_.FullName 'AppData\Local\KAYAN-ERP')
    }
}

# Inno Setup removes installed files and its own Start Menu/uninstall entries
# after InitializeUninstall returns. Verify the app tree is the expected path;
# do not delete it here because the uninstall script itself is running from it.
if ($installRoot -ne $expectedInstallRoot) {
  Write-Warning "Uninstall script is running from '$installRoot' (expected '$expectedInstallRoot'); Inno Setup will remove its registered application directory."
}

Write-Output 'KAYAN ERP service, database, backups, licence state, settings, logs, caches and KAYAN-owned firewall rules have been removed. Inno Setup will now remove the application files and shortcuts.'
