@echo off
REM BlueWrite — CLIENT launcher. Put this file on the client PC and double-click it.
REM It opens the main server in your browser. No install, no database, no key needed
REM on this PC: the server (laptop) holds every record and runs the Gemini AI for you.
REM If the server laptop ever gets a new IP, edit the address below to match its
REM config.php base_url, e.g. http://192.168.0.108:8099/
set "SERVER=http://192.168.0.107:8099/"
echo [bluewrite] opening %SERVER% ...
start "" "%SERVER%"
