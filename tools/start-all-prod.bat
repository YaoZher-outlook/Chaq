@echo off
setlocal
chcp 65001 >nul

set "TOOLS=%~dp0"

echo [Chaq] Starting production API server, Agent worker, and desktop client...
call "%TOOLS%start-server-prod.bat"
if errorlevel 1 exit /b 1

call "%TOOLS%start-client-prod.bat"
if errorlevel 1 exit /b 1

exit /b 0
