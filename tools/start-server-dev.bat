@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo [Chaq] Starting development API server and Agent worker...
echo [Chaq] Development API: http://127.0.0.1:24537/api

set "SERVER_HOST=127.0.0.1"
set "SERVER_PORT=24537"
set "NODE_ENV=development"
set "npm_config_electron_mirror="
set "npm_config_electron_config_cache="

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

node scripts\check-server-ready.js
if errorlevel 2 goto :port_conflict
if not errorlevel 1 (
  echo [Chaq] Development API is already ready. No second server was started.
  exit /b 0
)

call npm.cmd run env:prepare
if errorlevel 1 goto :fail

for /f "usebackq delims=" %%A in (`node scripts\local-env-cmd.js`) do %%A
if errorlevel 1 goto :fail

set "SERVER_HOST=127.0.0.1"
set "SERVER_PORT=24537"
set "NODE_ENV=development"

if not exist "node_modules" (
  echo [Chaq] node_modules not found. Installing dependencies...
  node scripts\install-dependencies.js --server-only
  if errorlevel 1 goto :fail
)

echo [Chaq] Starting local PostgreSQL and Redis...
call npm.cmd run infra:local
if errorlevel 1 goto :fail

call :ensure_prisma
if errorlevel 1 goto :fail

echo [Chaq] Applying database migrations...
call npm.cmd exec -w @chaq/server -- prisma migrate deploy
if errorlevel 1 goto :fail

echo [Chaq] Initializing idempotent local demo data...
set "CHAQ_ALLOW_DEMO_SEED=1"
call npm.cmd run prisma:seed
if errorlevel 1 (
  set "CHAQ_ALLOW_DEMO_SEED=0"
  goto :fail
)
set "CHAQ_ALLOW_DEMO_SEED=0"

echo [Chaq] Dev server will run in this window. Close it to stop API and worker.
call npm.cmd run dev:server
if errorlevel 1 goto :fail

exit /b 0

:ensure_prisma
set "NEED_PRISMA_GENERATE=0"
if "%FORCE_PRISMA_GENERATE%"=="1" set "NEED_PRISMA_GENERATE=1"
if not exist "node_modules\.prisma\client\index.js" set "NEED_PRISMA_GENERATE=1"
if not exist "node_modules\.prisma\client\schema.prisma" set "NEED_PRISMA_GENERATE=1"
if "%NEED_PRISMA_GENERATE%"=="1" (
  echo [Chaq] Generating Prisma Client...
  powershell.exe -NoProfile -Command "Remove-Item 'node_modules\.prisma\client\query_engine-windows.dll.node.tmp*' -Force -ErrorAction SilentlyContinue"
  call npm.cmd run prisma:generate
  if errorlevel 1 exit /b 1
) else (
  echo [Chaq] Prisma Client is available. Skipping generate to avoid Windows DLL locks.
)
exit /b 0

:port_conflict
echo [ERROR] Port 24537 is occupied by a service that is not a ready Chaq API.
pause
exit /b 1

:fail
echo [ERROR] Chaq development server startup failed.
pause
exit /b 1
