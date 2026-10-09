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
if ($service -and (Test-Path $pgCtl) -and (Test-Path (Join-Path $data 'PG_VERSION'))) {
  & $pgCtl unregister -N $serviceName -D $data | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not unregister the KAYAN PostgreSQL service. Database files were retained.' }
}
Write-Output "KAYAN PostgreSQL service removed. Database data retained at '$data'."
