@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo [Chaq] Starting production desktop client...

set "EXE=apps\desktop\release\win-unpacked\Chaq.exe"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH. Please install Node.js 20.11 or newer.
  pause
  exit /b 1
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
echo [ERROR] Chaq production desktop startup failed.
pause
exit /b 1
