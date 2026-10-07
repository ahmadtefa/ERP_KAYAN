@echo off
chcp 65001 >nul
title KAYAN ERP API  -  KEEP THIS WINDOW OPEN
cd /d "%~dp0\..\backend"

echo ============================================================
echo   KAYAN ERP API  -  KEEP THIS WINDOW OPEN
echo ============================================================
echo.
echo   This window IS the server.
echo.
echo   The client shows "cannot reach the server" whenever this
echo   window is closed, so leave it open while you work.
echo.
echo   To stop the server on purpose, press Ctrl+C here.
echo ------------------------------------------------------------
echo.

call npm run start:dev

echo.
echo ============================================================
echo   THE SERVER HAS STOPPED
echo ============================================================
echo.
echo   The client will now say "cannot reach the server" until
echo   you start the server again. To do that, run:
echo.
echo       scripts\start-backend.bat
echo.
echo   If the server stopped by itself, scroll up for the error
echo   and send it to whoever is helping you.
echo.
pause
