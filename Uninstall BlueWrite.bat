@echo off
setlocal
cd /d "%~dp0bluewrite"
rem Stop the watchdog task and the hidden servers. Data and config are kept.
call scripts\uninstall.cmd
if errorlevel 1 echo [bluewrite] uninstall finished with warnings - see above.
pause
endlocal
