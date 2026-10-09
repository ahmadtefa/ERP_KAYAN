[CmdletBinding()]
param([string]$ProgramDataRoot = (Join-Path $env:ProgramData 'KAYAN-ERP'))
$ErrorActionPreference = 'Stop'
$serviceName = 'KayanERPPostgreSQL'
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne 'Stopped') {
  Stop-Service -Name $serviceName -Force
  (Get-Service -Name $serviceName).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60))
}
$pgCtl = Join-Path $PSScriptRoot 'backend\postgres\bin\pg_ctl.exe'
$data = Join-Path $ProgramDataRoot 'PostgreSQL\data'
# Only the service registration is removed here. Database files under
# ProgramData are company data and are deliberately never touched.
if ($service) {
  if (Test-Path $pgCtl) {
    $unregisterArgs = @('unregister', '-N', $serviceName)
    if (Test-Path (Join-Path $data 'PG_VERSION')) { $unregisterArgs += @('-D', $data) }
    & $pgCtl @unregisterArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not unregister the KAYAN PostgreSQL service. Database files were retained.' }
  } else {
    # The program files are missing or broken; remove the leftover service
    # registration so no broken service entry survives the uninstall.
    & sc.exe delete $serviceName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove the leftover KAYAN PostgreSQL service registration. Database files were retained.' }
  }
}
Write-Output "KAYAN PostgreSQL service removed. Database data retained at '$data'."
