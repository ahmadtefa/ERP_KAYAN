#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Safely removes the PostgreSQL Windows service for ERP_KAYAN maintenance.
  Does NOT uninstall PostgreSQL and does NOT delete any data files.
.DESCRIPTION
  Stops and removes the specified PostgreSQL service entry from Windows SCM.
  The PostgreSQL data directory and program files are left intact.
  Run provision-postgresql.ps1 (via pg_ctl register or installer) to re-add the service.
.PARAMETER ServiceName
  Name of the Windows service to remove. Default: postgresql-x64-18
.PARAMETER Force
  If set, forces the service to stop before removal even if it reports running.
.NOTES
  Must be run as Administrator.
  This does NOT uninstall PostgreSQL.
  This does NOT delete any data or configuration.
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ServiceName = 'postgresql-x64-18',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# ── Safety guard: never run destructively without confirmation ────────────────
Write-Warning "This will remove the Windows service '$ServiceName'."
Write-Warning "PostgreSQL data files and program files are NOT affected."
$confirm = Read-Host "Type 'YES' to continue, anything else to abort"
if ($confirm -ne 'YES') {
    Write-Host "[ABORTED] No changes made." -ForegroundColor Yellow
    exit 0
}

# ── Check service exists ──────────────────────────────────────────────────────
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "[OK] Service '$ServiceName' does not exist. Nothing to do." -ForegroundColor Green
    exit 0
}

Write-Host "[INFO] Found service '$ServiceName' (Status: $($svc.Status))." -ForegroundColor Cyan

# ── Stop the service ──────────────────────────────────────────────────────────
if ($svc.Status -ne 'Stopped') {
    Write-Host "[INFO] Stopping service '$ServiceName'..." -ForegroundColor Cyan
    try {
        Stop-Service -Name $ServiceName -Force:$Force -ErrorAction Stop
        $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
        Write-Host "[OK] Service stopped." -ForegroundColor Green
    } catch {
        Write-Error "Failed to stop service: $_"
        Write-Host "Use -Force switch to force stop, or stop the service manually first."
        exit 1
    }
}

# ── Remove the service ────────────────────────────────────────────────────────
Write-Host "[INFO] Removing service '$ServiceName' from Windows SCM..." -ForegroundColor Cyan
if ($PSCmdlet.ShouldProcess($ServiceName, 'Remove Windows service')) {
    & sc.exe delete $ServiceName
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Service '$ServiceName' removed successfully." -ForegroundColor Green
    } else {
        Write-Error "sc.exe delete returned exit code $LASTEXITCODE."
        exit 1
    }
}

Write-Host ""
Write-Host "=== Service removal complete ===" -ForegroundColor Green
Write-Host "  Service name : $ServiceName"
Write-Host "  Data files   : INTACT (not deleted)"
Write-Host ""
Write-Host "To re-register the service, run:"
Write-Host '  pg_ctl register -N "<ServiceName>" -D "<DataDir>"'
