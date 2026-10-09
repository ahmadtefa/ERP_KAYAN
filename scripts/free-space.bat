@echo off
chcp 65001 >nul
cd /d "%~dp0\.."

REM The work is done in disk-report.ps1, because PowerShell can measure
REM folders and build a report far more reliably than a batch file can.
REM This wrapper only exists so you never have to think about PowerShell's
REM execution policy - Bypass is passed for this one call and nothing else.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0disk-report.ps1" -RootPath "%CD%"

echo.
pause
