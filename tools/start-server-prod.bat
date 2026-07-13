@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

if "%CHAQ_PROD_SERVER_PORT%"=="" set "CHAQ_PROD_SERVER_PORT=24538"

echo [Chaq] Starting production API server and Agent worker...
echo [Chaq] Production API: http://127.0.0.1:%CHAQ_PROD_SERVER_PORT%/api
echo [Chaq] Public API URL: https://chaq.yaozher.com/api
echo [Chaq] Cloudflared service target: http://127.0.0.1:%CHAQ_PROD_SERVER_PORT%
echo [Chaq] Public bind: 0.0.0.0:%CHAQ_PROD_SERVER_PORT%
echo [Chaq] Server will be managed in the background. Logs are saved in .logs.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH. Please install Node.js 22.12 or newer.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found in PATH.
  pause
  exit /b 1
)

node scripts\start-production-server.js --restart --public
if errorlevel 1 goto :fail

node scripts\check-public-api.js https://chaq.yaozher.com/api
if errorlevel 1 (
  echo [WARN] Local production API is ready, but the public Cloudflared hostname is not ready yet.
  echo [WARN] In Cloudflare Zero Trust, add public hostname chaq.yaozher.com with service http://127.0.0.1:%CHAQ_PROD_SERVER_PORT%.
)

echo [Chaq] Production server is ready. You can close this window; API and worker will keep running.
pause
exit /b 0

:fail
echo [ERROR] Chaq production server startup failed.
echo [ERROR] Check .logs\api-prod.log and .logs\worker-prod.log for details.
pause
exit /b 1
