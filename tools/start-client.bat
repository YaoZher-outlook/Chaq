@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

set "EXE=apps\desktop\release\win-unpacked\Chaq.exe"

echo [Chaq] Starting desktop client...
echo [Chaq] Public API URL: https://chaq.yaozher.com/api
echo [Chaq] Cloudflared service target: http://127.0.0.1:24538

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH. Please install Node.js 22.12 or newer.
  pause
  exit /b 1
)

node scripts\check-api-ready.js 24538 24537
if errorlevel 1 (
  echo [Chaq] No ready API was found. Restarting production API server first...
  node scripts\start-production-server.js --restart --public
  if errorlevel 1 goto :fail
)

node scripts\check-public-api.js https://chaq.yaozher.com/api
if errorlevel 1 (
  echo [WARN] Public API is not reachable yet. Login will fail until Cloudflared is configured.
  echo [WARN] Cloudflared hostname: chaq.yaozher.com
  echo [WARN] Cloudflared service target: http://127.0.0.1:24538
  if "%CHAQ_REQUIRE_PUBLIC_API_CHECK%"=="1" (
    pause
    exit /b 1
  )
  echo [WARN] Launching desktop anyway. Set CHAQ_REQUIRE_PUBLIC_API_CHECK=1 to block on this check.
)

if "%CHAQ_REBUILD_CLIENT%"=="1" goto :package
if not exist "%EXE%" goto :package
powershell.exe -NoProfile -Command "$exe = Get-Item '%EXE%' -ErrorAction SilentlyContinue; $latest = Get-ChildItem 'apps\desktop\src','packages\shared\src' -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if (-not $exe -or ($latest -and $latest.LastWriteTime -gt $exe.LastWriteTime)) { exit 1 }"
if errorlevel 1 goto :package
goto :launch

:package
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm.cmd was not found in PATH.
  pause
  exit /b 1
)

if not exist "node_modules\electron\package.json" (
  echo [Chaq] Desktop dependencies not found. Installing into project-relative caches...
  node scripts\install-dependencies.js
  if errorlevel 1 goto :fail
)

echo [Chaq] Building packaged desktop client...
call npm.cmd run build -w @chaq/shared
if errorlevel 1 goto :fail
call npm.cmd run package -w @chaq/desktop
if errorlevel 1 goto :fail
if not exist "%EXE%" goto :missing

:launch
start "Chaq" "%EXE%"
exit /b 0

:missing
echo [ERROR] Packaged desktop executable was not found at %EXE%.
goto :fail

:fail
echo [ERROR] Chaq desktop startup failed.
pause
exit /b 1
