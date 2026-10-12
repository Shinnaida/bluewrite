@echo off
setlocal enableextensions

REM ============================================================================
REM  BlueWrite — bring the local stack up.
REM
REM  THREE THINGS, THREE PORTS, and the app needs all of them:
REM
REM    * the API, `php -S 127.0.0.1:8099`  — the JSON front controller. It ALSO
REM      serves the built app from public/, so http://127.0.0.1:8099/ is a
REM      complete copy of BlueWrite on its own (no dev server involved).
REM    * the dev server, Vite on 127.0.0.1:5180 — the live-reload URL, which
REM      proxies /api to the API above (see vite.config.js).
REM    * MySQL on 3306 — without it every request answers "Database connection
REM      failed", which is the failure that looks like the whole system dying.
REM
REM  WHY THIS FILE EXISTS. The app reports "Connection to the BlueWrite server
REM  was lost" the moment the origin the tab is open on stops answering, and that
REM  kept happening because the servers were started by hand from a terminal that
REM  later closed.
REM
REM  IT ONLY REPORTS, AND THAT IS THE POINT. Every port is asked here so a person
REM  running this file sees what is up and what is not; the STARTING is left to
REM  scripts\watch-servers.ps1, which is the one place that knows how to do it —
REM  the same script the scheduled task runs once a minute. Two reasons, and the
REM  second is the one that was learned the hard way:
REM
REM    1. One implementation. A second copy of "how a server starts" is a second
REM       copy that can drift, and the symptom of drift is a port nobody is on.
REM    2. NO WINDOW, SO NOTHING TO CLOSE. `start /min` used to give each server a
REM       console window in the taskbar, and a console window is not decoration:
REM       the server is its child, so the day somebody tidies the taskbar the
REM       server dies with it — the port comes back a minute later thanks to the
REM       watchdog, and the next window appears. That loop is what "a command
REM       window keeps coming back" was. The watchdog hands each server its own
REM       hidden console instead, so no window exists to close.
REM
REM  SAFE TO RUN ANY NUMBER OF TIMES: a server (or the database) that is already
REM  answering is left exactly as it is. RUNNING SERVERS ARE HIDDEN — there is no
REM  window to close to stop one. Stop a server with Task Manager, or stop the
REM  whole stack healing itself with `watch-servers.ps1 -Uninstall`.
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

REM ---- What is up right now (the three ports, read-only) ----------------------
netstat -ano | findstr /r /c:"127.0.0.1:8099 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [bluewrite] the API is down on 8099
) else (
  echo [bluewrite] the API is already up on 8099
)

netstat -ano | findstr /r /c:"127.0.0.1:5180 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [bluewrite] the dev server is down on 5180
) else (
  echo [bluewrite] the dev server is already up on 5180
)

netstat -ano | findstr /r /c:":3306 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [bluewrite] MySQL is down on 3306
) else (
  echo [bluewrite] MySQL is already up on 3306
)

REM ---- Start whatever is missing, hidden and outside this window --------------
REM The watchdog asks each port again and starts only what is missing: the API on
REM 8099 with the PHP above, the dev server on 5180, and MySQL on 3306 from
REM C:\laragon\data\mysql (never a second one when the port is taken). It also
REM writes every repair to %LOCALAPPDATA%\BlueWrite\watchdog.log.
echo [bluewrite] starting anything that is missing ...
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0watch-servers.ps1"
if errorlevel 1 exit /b 1
echo [bluewrite] done.

endlocal
