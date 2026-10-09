@echo off
chcp 65001 >nul
title KAYAN ERP  -  stopping the API

echo ============================================================
echo   KAYAN ERP  -  stopping the API server
echo ============================================================
echo.

set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do (
  if not "%%p"=="0" (
    echo   stopping process %%p ...
    taskkill /f /pid %%p >nul 2>&1
    set FOUND=1
  )
)

if "%FOUND%"=="0" (
  echo   nothing was listening on port 3000.
  echo   the API was not running.
) else (
  echo.
  echo   the API has been stopped.
)
echo.
echo   Start it again with:   scripts\start-backend.bat
echo   Or run everything with: scripts\pull-and-run.bat
echo.
pause
