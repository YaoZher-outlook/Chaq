@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo [Chaq] Starting API server and Agent worker...
echo [Chaq] Local environment files live in E:\Environment\Chaq

set "npm_config_electron_mirror="
set "npm_config_electron_config_cache="

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

node scripts\check-server-ready.js
if errorlevel 2 goto :port_conflict
if not errorlevel 1 (
  echo [Chaq] Server startup skipped because the API is already running.
  exit /b 0
)

call npm.cmd run env:prepare
if errorlevel 1 goto :fail

for /f "usebackq delims=" %%A in (`node scripts\local-env-cmd.js`) do %%A
if errorlevel 1 goto :fail
echo [Chaq] Loaded server env from %CHAQ_ENV_FILE%

if "%CHAQ_SERVER_BIND%"=="" set "CHAQ_SERVER_BIND=127.0.0.1"
set "SERVER_HOST=%CHAQ_SERVER_BIND%"
echo [Chaq] API bind host: %SERVER_HOST%

if not exist "apps\server\.env" (
  echo [Chaq] apps\server\.env not found. Creating it from apps\server\.env.example...
  copy "apps\server\.env.example" "apps\server\.env" >nul
)

if not exist "node_modules" (
  echo [Chaq] node_modules not found. Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto :fail
)

echo [Chaq] Starting local PostgreSQL and Docker Redis...
call npm.cmd run infra:local
if errorlevel 1 goto :fail

set "NEED_PRISMA_GENERATE=0"
if "%FORCE_PRISMA_GENERATE%"=="1" set "NEED_PRISMA_GENERATE=1"
if not exist "node_modules\.prisma\client\index.js" set "NEED_PRISMA_GENERATE=1"
if not exist "node_modules\.prisma\client\schema.prisma" set "NEED_PRISMA_GENERATE=1"
if exist "node_modules\.prisma\client\index.js" (
  powershell.exe -NoProfile -Command "$source = (Get-FileHash 'apps\server\prisma\schema.prisma' -Algorithm SHA256).Hash; $client = if (Test-Path 'node_modules\.prisma\client\schema.prisma') { (Get-FileHash 'node_modules\.prisma\client\schema.prisma' -Algorithm SHA256).Hash } else { '' }; if ($source -ne $client) { exit 1 }"
  if errorlevel 1 set "NEED_PRISMA_GENERATE=1"
)

if "%NEED_PRISMA_GENERATE%"=="1" (
  call :generate_prisma
) else (
  echo [Chaq] Prisma Client matches the current schema.
  call :clear_errorlevel
)
if errorlevel 1 goto :fail

echo [Chaq] Applying existing database migrations...
call npm.cmd exec -w @chaq/server -- prisma migrate deploy
if errorlevel 1 goto :fail

echo [Chaq] Development seed is manual. Run "npm.cmd run prisma:seed" once if you need the admin account.

echo [Chaq] API will listen on %SERVER_HOST%:24537/api and the Agent worker will run beside it.
call npm.cmd run dev:server
if errorlevel 1 goto :fail

exit /b 0

:clear_errorlevel
exit /b 0

:fail
echo [ERROR] Chaq server startup failed.
pause
exit /b 1

:port_conflict
echo [ERROR] Stop the process using port 24537, then run this script again.
pause
exit /b 1

:generate_prisma
echo [Chaq] Generating Prisma Client...
powershell.exe -NoProfile -Command "Remove-Item 'node_modules\.prisma\client\query_engine-windows.dll.node.tmp*' -Force -ErrorAction SilentlyContinue"
call npm.cmd run prisma:generate
if errorlevel 1 (
  echo [ERROR] Prisma Client generation failed. Close stale Chaq Node/Electron processes and retry.
  exit /b 1
)
exit /b 0
