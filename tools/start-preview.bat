@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

rem The preview is deliberately self-contained. Ignore machine-level Chaq paths
rem so data, caches and generated configuration stay under this repository.
set "CHAQ_ENV_ROOT="
set "CHAQ_ENV_FILE="
set "DOCKER_CONFIG="

set "EXE=apps\desktop\release-preview\win-unpacked\Chaq.exe"
set "VITE_SERVER_URL=http://127.0.0.1:24538/api"
set "VITE_PUBLIC_SERVER_URL=http://127.0.0.1:24538/api"
set "VITE_ALLOW_LOCAL_API_FALLBACK=1"
set "VITE_FORCE_SERVER_URL=1"

echo [Chaq] Starting the self-contained local production preview...
echo [Chaq] API: http://127.0.0.1:24538/api
echo [Chaq] Data: .chaq-data
echo [Chaq] Logs: .logs

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH. Install Node.js 22.12 or newer.
  goto :fail
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found in PATH.
  goto :fail
)

if not exist "node_modules\electron\package.json" goto :install
if not exist "node_modules\@prisma\client\package.json" goto :install
goto :dependencies_ready

:install
  echo [Chaq] Installing project dependencies into project-relative caches...
  node scripts\install-dependencies.js
  if errorlevel 1 goto :fail

:dependencies_ready

echo [Chaq] Preparing PostgreSQL, Redis, migrations, production API, Agent worker and preview account...
node scripts\start-production-server.js --restart --local-preview
if errorlevel 1 goto :server_fail
node scripts\smoke-local-preview.js
if errorlevel 1 goto :server_fail

if "%CHAQ_REBUILD_CLIENT%"=="1" goto :package
node scripts\package-preview-client.js --check
if errorlevel 1 goto :package
goto :launch

:package
echo [Chaq] Building a fresh localhost-only preview client...
call npm.cmd run package:preview -w @chaq/desktop
if errorlevel 1 goto :client_fail
if not exist "%EXE%" (
  echo [ERROR] Preview executable was not produced at %EXE%.
  goto :fail
)

:launch
echo [Chaq] Launching preview client...
start "Chaq Preview" "%EXE%"
node scripts\prepare-preview-env.js --show-login
echo.
echo [Chaq] Preview is ready. The API and Agent worker continue in the background.
echo [Chaq] Use tools\stop-preview.bat when you want to stop the preview server.
if not "%CHAQ_NONINTERACTIVE%"=="1" pause
exit /b 0

:server_fail
echo [ERROR] Local preview server startup failed.
echo [ERROR] Check .logs\api-prod.log, .logs\worker-prod.log and .chaq-data\logs\postgres.log.
goto :fail

:client_fail
echo [ERROR] Preview client build failed. Close any running preview client and retry.
goto :fail

:fail
echo [ERROR] Chaq local preview startup failed.
if not "%CHAQ_NONINTERACTIVE%"=="1" pause
exit /b 1
