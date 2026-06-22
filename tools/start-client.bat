@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo [Chaq] Starting desktop client...
echo [Chaq] For marketplace and cloud-model features, run tools\start-server.bat in another window.

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

set "npm_config_electron_mirror="
set "npm_config_electron_config_cache="
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_CACHE=E:\Environment\Chaq\electron-cache"
set "electron_config_cache=E:\Environment\Chaq\electron-cache"
set "CHAQ_RUNTIME_CACHE=E:\Environment\Chaq\runtime-cache-v2"

call npm.cmd run env:prepare
if errorlevel 1 goto :fail

node scripts\check-ports.js desktop 27337 --running >nul 2>nul
if not errorlevel 1 (
  echo [Chaq] Desktop client is already running. No second instance was started.
  exit /b 0
)

if not exist "node_modules" (
  echo [Chaq] node_modules not found. Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto :fail
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Chaq] Electron runtime not found. Installing Electron runtime...
  call npm.cmd run electron:install
  if errorlevel 1 goto :fail
)

echo [Chaq] Desktop renderer will use http://localhost:27337
call npm.cmd run dev:desktop
if errorlevel 1 goto :fail

exit /b 0

:fail
echo [ERROR] Chaq desktop startup failed.
pause
exit /b 1
