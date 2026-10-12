@echo off
setlocal
cd /d "%~dp0bluewrite"
rem All servers, including the correct Laragon MySQL, start without windows.
call scripts\serve.cmd
if errorlevel 1 exit /b 1
rem Only an explicit double-click opens the app; background checks never do.
start "" http://localhost:5180
endlocal
