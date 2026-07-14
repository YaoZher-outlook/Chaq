@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
node scripts\start-production-server.js --local-preview --stop
if errorlevel 1 (
  echo [ERROR] Could not stop the Chaq local preview server. Check .logs for details.
  if not "%CHAQ_NONINTERACTIVE%"=="1" pause
  exit /b 1
)
echo [Chaq] Local preview API and Agent worker are stopped.
if not "%CHAQ_NONINTERACTIVE%"=="1" pause
