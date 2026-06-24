@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo [Chaq] Starting production API server in public-bind mode...
echo [Chaq] API will bind to 0.0.0.0:24537.
echo [Chaq] Put Cloudflare Tunnel or a TLS reverse proxy in front of this before Internet exposure.

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

node scripts\start-production-server.js --public
if errorlevel 1 goto :fail

exit /b 0

:fail
echo [ERROR] Chaq public production server startup failed.
echo [ERROR] Check .logs\api-prod.log and .logs\worker-prod.log for details.
pause
exit /b 1
