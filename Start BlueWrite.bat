@echo off
title BlueWrite Launcher
setlocal

rem ---- Paths -------------------------------------------------------------
set "PHP=C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe"
set "MYSQLD=C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqld.exe"
set "DB_DATADIR=C:\laragon\data\mysql"
set "UI_PORT=5180"
cd /d "%~dp0bluewrite"

if not exist "%PHP%" (
    echo [ERROR] PHP not found at: %PHP%
    echo         Edit this .bat file and fix the PHP path.
    pause
    exit /b 1
)

rem ---- Make sure the RIGHT MySQL is running --------------------------------
rem This machine has two MySQL installs. The MySQL84 Windows service points at
rem a different data directory WITHOUT the BlueWrite database. If it grabs port
rem 3306, login fails with "Database connection failed". See
rem bluewrite/docs/DEVELOPMENT_STARTUP.md. Never start the MySQL84 service from
rem here; if it is running, this launcher starts Laragon's MySQL only.
netstat -ano | findstr /R /C:":3306 .*LISTENING" >nul
if not errorlevel 1 goto mysql_ok

if not exist "%MYSQLD%" (
    echo [ERROR] Laragon MySQL not found at: %MYSQLD%
    echo         Edit this .bat file and fix the path, or open Laragon and
    echo         click "Start All".
    pause
    exit /b 1
)

echo Starting Laragon MySQL (the instance with the BlueWrite database) ...
start "BlueWrite DB" /min "%MYSQLD%" --no-defaults --datadir="%DB_DATADIR%" --port=3306

set /a dbtries=0
:dbwait
set /a dbtries+=1
if %dbtries% GTR 15 (
    echo [WARNING] MySQL did not come up on port 3306 within 15 seconds.
    echo           Login will fail until the database is running. Try:
    echo             - Open Laragon and click "Start All", or
    echo             - Check that port 3306 is not held by the MySQL84 service.
    timeout /t 3 >nul
    goto mysql_ok
)
netstat -ano | findstr /R /C:":3306 .*LISTENING" >nul
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto dbwait
)
echo MySQL is running.
:mysql_ok

echo Starting BlueWrite API  (PHP on http://127.0.0.1:8099) ...
start "BlueWrite API" /min "%PHP%" -S 127.0.0.1:8099 -t public router.php

echo Starting BlueWrite UI   (Vite on http://localhost:%UI_PORT%) ...
start "BlueWrite UI" /min cmd /c "npm run dev -- --port %UI_PORT% --strictPort"

echo Waiting for the UI to come up ...
set /a tries=0
:wait
set /a tries+=1
if %tries% GTR 30 (
    echo [ERROR] UI did not start within 30 seconds. Check the BlueWrite UI window.
    pause
    exit /b 1
)
curl -s -o nul http://localhost:%UI_PORT%
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait
)

start "" http://localhost:%UI_PORT%
rem ---- TWO OFFICERS, ONE MACHINE, ONE BROWSER ----------------------------
rem The session cookie is host-only, so the SAME app under a DIFFERENT hostname is a
rem second, independent session: localhost and 127.0.0.1 are two cookie jars. Vite
rem serves both. Sign in as somebody else in the second window and the rail in each
rem window shows the other officer. See bluewrite/docs/DEVELOPMENT_STARTUP.md.
rem Remove this one line if you would rather not have the second window open.
start "" http://127.0.0.1:%UI_PORT%
echo.
echo BlueWrite is running in your browser.
echo.
rem Each window is its own sign-in. Use a DIFFERENT account in each, or the rail
rem stays empty - it draws everybody but you.
echo Window 1  http://localhost:%UI_PORT%    sign in as  m.santos    (Admin)
echo Window 2  http://127.0.0.1:%UI_PORT%    sign in as  j.delacruz  (Officer)
echo   ...or e.ramos (Staff), or the same pair the other way round.
echo   Password for all three: Passw0rd!23
echo.
echo To stop: close the two minimized windows named
echo   "BlueWrite API" and "BlueWrite UI".
timeout /t 8 >nul
endlocal
