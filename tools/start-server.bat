@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo [Chaq] Starting API server...

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

call npm.cmd run env:prepare
if errorlevel 1 goto :fail

if not exist "apps\server\.env" (
  echo [Chaq] apps\server\.env not found. Creating it from apps\server\.env.example...
  copy "apps\server\.env.example" "apps\server\.env" >nul
)

if not exist "node_modules" (
  echo [Chaq] node_modules not found. Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto :fail
)

where docker >nul 2>nul
if errorlevel 1 (
  echo [WARN] Docker was not found. Make sure PostgreSQL and Redis are already running.
  call :clear_errorlevel
) else (
  echo [Chaq] Starting PostgreSQL and Redis with Docker Compose...
  docker compose up -d
  if errorlevel 1 (
    echo [WARN] Docker Compose did not start successfully. Continuing in case services already exist.
    call :clear_errorlevel
  )
)

if "%FORCE_PRISMA_GENERATE%"=="1" (
  call :generate_prisma
) else if exist "node_modules\.prisma\client\index.js" (
  echo [Chaq] Prisma Client already exists. Skipping generate to avoid locked Prisma DLL files on Windows.
  call :clear_errorlevel
) else (
  call :generate_prisma
)
if errorlevel 1 goto :fail

echo [Chaq] Applying existing database migrations...
call npm.cmd exec -w @chaq/server -- prisma migrate deploy
if errorlevel 1 goto :fail

call npm.cmd run prisma:seed
if errorlevel 1 goto :fail

echo [Chaq] API server will listen on http://localhost:4537/api
call npm.cmd run dev:server
if errorlevel 1 goto :fail

exit /b 0

:fail
echo [ERROR] Chaq server startup failed.
pause
exit /b 1

:generate_prisma
echo [Chaq] Generating Prisma Client...
call npm.cmd run prisma:generate
if errorlevel 1 (
  if exist "node_modules\.prisma\client\index.js" (
    echo [WARN] Prisma generate failed, but an existing Prisma Client was found. Continuing.
    exit /b 0
  )
  exit /b 1
)
exit /b 0

:clear_errorlevel
exit /b 0
