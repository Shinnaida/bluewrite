@echo off
setlocal enableextensions
REM BlueWrite — build the one-package portable zip.
REM Run: bluewrite\scripts\launcher\package.cmd
REM Output: BlueWrite-Portable.zip beside BlueWrite.exe (repo root).
REM Contains: both exes + Start bat + bluewrite/ code WITH built public/assets,
REM minus node_modules/.git/uploads/logs. PHP/MySQL/Node still come from
REM winget on first Setup run (they cannot fit in a GitHub file).

set "HERE=%~dp0"
set "ROOT=%HERE%..\..\.."
set "SRC=%HERE%..\..\..\\bluewrite"
set "OUT=%HERE%..\..\..\BlueWrite-Portable.zip"
set "STAGE=%TEMP%\bluewrite-portable-stage"

if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%\package\bluewrite" >nul 2>&1

echo [bluewrite] staging app files ...
REM NEVER SHIP SECRETS: config.php (db+gmail), app ai.php (gemini key),
REM mfa.key stay on the server only. Setup recreates config.php from sample.
robocopy "%SRC%" "%STAGE%\package\bluewrite" /MIR /NFL /NDL /NJH /NJS /XD node_modules .git .sheet-revert-backup storage offline-copy public\handwriting public\ocr docs tests /XF *.log phpunit.phar .phpunit.result.cache *.onnx *.bin .tmp-* eng.traineddata config.php ai.php mfa.key  >nul
if errorlevel 8 (
  echo [bluewrite] stage failed.
  exit /b 1
)

del /q "%STAGE%\package\bluewrite\.tmp-*" >nul 2>&1
del /q "%STAGE%\package\bluewrite\eng.traineddata" "%STAGE%\package\bluewrite\phpunit.phar" "%STAGE%\package\bluewrite\.phpunit.result.cache" >nul 2>&1
del /q "%STAGE%\package\bluewrite\*.png" "%STAGE%\package\bluewrite\*.jpg" "%STAGE%\package\bluewrite\n364.txt" "%STAGE%\package\bluewrite\dashboard-improved.html" "%STAGE%\package\bluewrite\dev-server.log" >nul 2>&1
copy "%ROOT%\BlueWrite.exe" "%STAGE%\package\" >nul
copy "%ROOT%\BlueWrite-Setup.exe" "%STAGE%\package\" >nul
copy "%ROOT%\Start BlueWrite.bat" "%STAGE%\package\" >nul
copy "%ROOT%\Uninstall BlueWrite.bat" "%STAGE%\package\" >nul
copy "%SRC%\README.md" "%STAGE%\package\README-PC.txt" >nul

echo [bluewrite] zipping ...
powershell -NoProfile -NonInteractive -Command "Compress-Archive -Force '%STAGE%\package\*' '%OUT%'"
if errorlevel 1 (
  echo [bluewrite] zip failed.
  exit /b 1
)

for %%f in ("%OUT%") do echo [bluewrite] built %%~ff (%%~zf bytes)
rmdir /s /q "%STAGE%"
echo [bluewrite] copy this one zip to the other PC, extract, run BlueWrite-Setup.exe.
endlocal
