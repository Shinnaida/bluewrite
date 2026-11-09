@echo off
setlocal enableextensions

REM ============================================================================
REM  BlueWrite — uninstall / stop the local stack.
REM
REM  WHAT IT DOES (data is never touched):
REM    1. Deletes the scheduled watchdog task "BlueWrite servers (watchdog)",
REM       so nothing is started again once a minute.
REM    2. Stops the hidden API (8099) and dev server (5180) started by
REM       scripts\serve.cmd / scripts\watch-servers.ps1.
REM       MySQL on 3306 is LEFT RUNNING on purpose — stopping a database from
REM       a double-click is how records get half-written.
REM    3. Removes the Windows Firewall rule "BlueWrite LAN 8099" (best effort).
REM
REM  WHAT IT DOES NOT DO: it never deletes bluewrite\, config\config.php,
REM  uploads, or the MySQL data directory. To wipe the machine, delete the
REM  checkout folder by hand after running this.
REM
REM  SAFE TO RUN ANY NUMBER OF TIMES: missing task / stopped port / missing
REM  rule is reported and skipped, not an error.
REM ============================================================================

echo [bluewrite] removing the watchdog task ...
schtasks /delete /tn "BlueWrite servers (watchdog)" /f
if errorlevel 1 (
  echo [bluewrite] no watchdog task found, or it could not be deleted.
) else (
  echo [bluewrite] watchdog task removed.
)

echo [bluewrite] stopping the API on 8099 and dev server on 5180 ...
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ports = @(8099,5180); foreach ($p in $ports) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { try { $proc = Get-Process -Id $c.OwningProcess -ErrorAction Stop; Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop; Write-Host ('[bluewrite] port {0}: stopped {1} (pid {2})' -f $p, $proc.ProcessName, $c.OwningProcess) } catch { Write-Host ('[bluewrite] port {0}: found pid {1} but could not stop it' -f $p, $c.OwningProcess) } } else { Write-Host ('[bluewrite] port {0}: not listening, nothing to stop' -f $p) } }"
if errorlevel 1 echo [bluewrite] port check had warnings - see above.

echo [bluewrite] removing the firewall rule ...
netsh advfirewall firewall delete rule name="BlueWrite LAN 8099" >nul 2>&1
if errorlevel 1 (
  echo [bluewrite] firewall rule not present, or no rights to remove it.
) else (
  echo [bluewrite] firewall rule removed.
)

echo [bluewrite] MySQL on 3306 was left running. Stop it in Laragon if needed.
echo [bluewrite] uninstall done. Config and data were kept.
endlocal
