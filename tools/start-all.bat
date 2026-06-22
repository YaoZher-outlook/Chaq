@echo off
setlocal
chcp 65001 >nul

set "TOOLS=%~dp0"

echo [Chaq] Starting local API server and desktop client...
start "Chaq Server" cmd.exe /k call "%TOOLS%start-server.bat"
powershell.exe -NoProfile -Command "$deadline = (Get-Date).AddSeconds(90); do { try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:24537/api/health/ready' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Seconds 2 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo [ERROR] Chaq API did not become ready within 90 seconds.
  pause
  exit /b 1
)
start "Chaq Desktop" cmd.exe /k call "%TOOLS%start-client.bat"

exit /b 0
