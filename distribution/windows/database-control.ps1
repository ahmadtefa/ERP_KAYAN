[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('start','stop','restart','status')][string]$Action)
$ErrorActionPreference = 'Stop'
$name = 'KayanERPPostgreSQL'
function Control-Service([string]$Verb) {
  $s = Get-Service -Name $name -ErrorAction SilentlyContinue
  if (-not $s) {
    # Stopping a service that is not there is a successful no-op. This is also
    # the command the installer runs before an upgrade, and an upgrade must
    # never be blocked because the service is already gone.
    if ($Verb -eq 'stop') { Write-Output 'KAYAN PostgreSQL is not installed; nothing to stop.'; return }
    throw 'KAYAN PostgreSQL is not installed. Repair or reinstall KAYAN ERP.'
  }
  switch ($Verb) {
    'start' { if ($s.Status -ne 'Running') { Start-Service $name; (Get-Service $name).WaitForStatus('Running',[TimeSpan]::FromSeconds(60)) } }
    'stop' { if ($s.Status -ne 'Stopped') { Stop-Service $name -Force; (Get-Service $name).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60)) } }
    'restart' { if ($s.Status -ne 'Stopped') { Stop-Service $name -Force; (Get-Service $name).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(60)) }; Start-Service $name; (Get-Service $name).WaitForStatus('Running',[TimeSpan]::FromSeconds(60)) }
    'status' { Write-Output "KAYAN PostgreSQL: $($s.Status)" }
  }
}
try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Control-Service $Action
  } else {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("& '$PSCommandPath' -Action '$Action'"))
    $child = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded)
    if ($child.ExitCode -ne 0) { throw "Elevated service command exited with code $($child.ExitCode)." }
  }
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Database service action failed.`n$($_.Exception.Message)",'KAYAN ERP',[System.Windows.MessageBoxButton]::OK,[System.Windows.MessageBoxImage]::Error) | Out-Null
  exit 1
}
