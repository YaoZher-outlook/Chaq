@echo off
setlocal
chcp 65001 >nul

set "TOOLS=%~dp0"

echo [Chaq] Starting public-bind API server and desktop client...
node "%TOOLS%..\scripts\check-server-ready.js"
if errorlevel 2 goto :port_conflict
if not errorlevel 1 goto :start_client

start "Chaq Server Public" cmd.exe /k call "%TOOLS%start-server-public.bat"
powershell.exe -NoProfile -Command "$deadline = (Get-Date).AddSeconds(90); do { try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:24537/api/health/ready' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Seconds 2 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo [ERROR] Chaq API did not become ready within 90 seconds.
  pause
  exit /b 1
)

:start_client
node "%TOOLS%..\scripts\check-ports.js" desktop 27337 --running >nul 2>nul
if not errorlevel 1 (
  echo [Chaq] Desktop client is already running. No second instance was started.
  exit /b 0
)
start "Chaq Desktop" cmd.exe /k call "%TOOLS%start-client.bat"

exit /b 0

:port_conflict
echo [ERROR] Port 24537 is occupied by a service that is not a ready Chaq API.
pause
exit /b 1
