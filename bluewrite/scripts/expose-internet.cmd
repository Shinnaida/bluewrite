@echo off
setlocal enableextensions

REM ============================================================================
REM  BlueWrite — publish the API on the internet for the phone app.
REM
REM  The phone app needs ONE thing: a reachable address for the API on port
REM  8099 (see docs\INTERNET_ACCESS.md). On station Wi-Fi that is the LAN
REM  address (docs\LAN_SETUP.md). From anywhere else — mobile data, home
REM  Wi-Fi — this script publishes the SAME local API as a public https://
REM  address through an encrypted Cloudflare Tunnel:
REM
REM    * no router port forwarding, no static public IP, no firewall holes
REM      (the tunnel dials OUT; nothing dials in);
REM    * HTTPS in the app, never plain http over the internet — bearer
REM      tokens and blotter photos must not travel readable;
REM    * MySQL (3306) and the dev server (5180) are NEVER published by this.
REM
REM  LEAVE THIS WINDOW OPEN: closing it unpublishes the address. The free
REM  quick-tunnel address changes on every restart — each phone then enters
REM  the new one once (the app offers manual entry itself). For a permanent
REM  address, set up the named tunnel in docs\INTERNET_ACCESS.md.
REM ============================================================================

REM ---- 1. The API must be answering (started by scripts\serve.cmd) -----------
netstat -ano | findstr /r /c:":8099 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [bluewrite] the API is NOT up on 8099. Start it first:
  echo [bluewrite]   scripts\serve.cmd   ^(or double-click Start BlueWrite.bat^)
  echo [bluewrite] then run this file again.
  exit /b 1
)
echo [bluewrite] API is up on 8099.

REM ---- 2. The tunnel agent must be installed (once per server PC) ------------
where cloudflared >nul 2>&1
if errorlevel 1 (
  echo [bluewrite] cloudflared is not installed. Install it once as Administrator:
  echo [bluewrite]   winget install -e --id Cloudflare.cloudflared
  echo [bluewrite] then open a NEW terminal and run this file again.
  exit /b 1
)

echo [bluewrite] publishing http://localhost:8099 to the internet ...
echo [bluewrite] copy the https://....trycloudflare.com URL below into the
echo [bluewrite] phone app's manual server address, then sign in as usual.
echo.
cloudflared tunnel --url http://localhost:8099

endlocal
