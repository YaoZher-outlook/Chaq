@echo off
setlocal
chcp 65001 >nul

set "CHAQ_SERVER_BIND=0.0.0.0"
echo [Chaq] Public LAN mode: API will bind to 0.0.0.0:24537.
echo [Chaq] Put a TLS reverse proxy or Cloudflare Tunnel in front of this before sharing it outside your LAN.
call "%~dp0start-server.bat"
