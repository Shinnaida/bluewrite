@echo off
setlocal enableextensions

REM ============================================================================
REM  BlueWrite — bring the local stack up.
REM
REM  TWO SERVERS, TWO PORTS, and both are needed for the app to work:
REM
REM    * the API, `php -S 127.0.0.1:8099`  — the JSON front controller. It ALSO
REM      serves the built app from public/, so http://127.0.0.1:8099/ is a
REM      complete copy of BlueWrite on its own (no dev server involved).
REM    * the dev server, Vite on 127.0.0.1:5180 — the live-reload URL, which
REM      proxies /api to the API above (see vite.config.js).
REM
REM  WHY THIS FILE EXISTS. The app reports "Connection to the BlueWrite server
REM  was lost" the moment the origin the tab is open on stops answering, and that
REM  kept happening because the servers were started by hand from a terminal that
REM  later closed. Started from here — and especially from a logon task, where
REM  Windows owns the process rather than a shell — they come back on their own.
REM
REM  SAFE TO RUN ANY NUMBER OF TIMES: each server is started only if nothing is
REM  already listening on its port, so running this while the app is up does
REM  nothing at all.
REM ============================================================================

set "ROOT=%~dp0.."

REM ---- PHP, wherever Laragon put it -------------------------------------------
set "PHP="
for /d %%d in ("C:\laragon\bin\php\php-*") do set "PHP=%%~fd\php.exe"
if not defined PHP (
  where php >nul 2>&1 && set "PHP=php"
)
if not defined PHP (
  echo [bluewrite] No PHP found. Install Laragon, or add php.exe to PATH.
  exit /b 1
)

REM ---- The API + built app, on 8099 -------------------------------------------
netstat -ano | findstr /r /c:"127.0.0.1:8099 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [bluewrite] starting the API on http://127.0.0.1:8099/
  start "bluewrite api" /min /d "%ROOT%" "%PHP%" -S 127.0.0.1:8099 -t public router.php
) else (
  echo [bluewrite] the API is already up on 8099
)

REM ---- The dev server, on 5180 -------------------------------------------------
netstat -ano | findstr /r /c:"127.0.0.1:5180 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [bluewrite] starting the dev server on http://127.0.0.1:5180/
  start "bluewrite dev" /min /d "%ROOT%" cmd /c "node node_modules\vite\bin\vite.js --port 5180 --strictPort"
) else (
  echo [bluewrite] the dev server is already up on 5180
)

endlocal
