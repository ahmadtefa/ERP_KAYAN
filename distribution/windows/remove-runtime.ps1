[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

# Uninstall removes application binaries, not customer records. Keep the
# machine-wide database, company backups, licence state and user settings so
# a later reinstall can reconnect to the same company without data loss.
$serviceName = 'KayanERPPostgreSQL'

Get-Process -Name 'erp_kayan' -ErrorAction SilentlyContinue | ForEach-Object {
  & taskkill.exe /PID $_.Id /T /F *> $null
}
Start-Sleep -Milliseconds 800

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $serviceName -Force
    (Get-Service -Name $serviceName).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60))
  }

  # Unregister the KAYAN-owned service before Inno removes bundled binaries.
  # The PostgreSQL data directory under ProgramData is deliberately retained.
  $pgCtl = Join-Path $PSScriptRoot 'backend\postgres\bin\pg_ctl.exe'
  $data = Join-Path $env:ProgramData 'KAYAN-ERP\PostgreSQL\data'
  if (Test-Path -LiteralPath $pgCtl) {
    if (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION')) {
      & $pgCtl unregister -N $serviceName -D $data
    } else {
      & $pgCtl unregister -N $serviceName
    }
    if ($LASTEXITCODE -ne 0) {
      throw "Could not unregister $serviceName. Customer database and backups were not removed."
    }
  } else {
    & sc.exe delete $serviceName | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Could not remove the orphaned $serviceName service. Customer database and backups were not removed."
    }
  }
}

# Firewall rules are product-owned configuration, not customer data.
if (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue) {
  $rules = @(Get-NetFirewallRule -ErrorAction Stop |
    Where-Object { $_.DisplayName -like 'KAYAN ERP*' -or $_.DisplayName -like 'KAYAN-ERP*' })
  foreach ($rule in $rules) {
    $rule | Remove-NetFirewallRule -ErrorAction Stop
  }
}

Write-Output 'KAYAN ERP service was stopped and unregistered. Company database, backups, licence state, settings, uploads and logs were preserved. Inno Setup will now remove application files and shortcuts.'
