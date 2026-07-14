@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
node scripts\start-production-server.js --local-preview --status
if not "%CHAQ_NONINTERACTIVE%"=="1" pause
