@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo [Chaq] Starting production API server and Agent worker...

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH. Please install Node.js 20.11 or newer.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found in PATH.
  pause
  exit /b 1
)

node scripts\start-production-server.js
if errorlevel 1 goto :fail

exit /b 0

:fail
echo [ERROR] Chaq production server startup failed.
echo [ERROR] Check .logs\api-prod.log and .logs\worker-prod.log for details.
pause
exit /b 1
