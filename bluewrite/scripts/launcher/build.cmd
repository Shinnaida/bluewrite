@echo off
setlocal enableextensions

REM ============================================================================
REM  BlueWrite — build the launcher (BlueWrite.exe).
REM
REM  Run this from anywhere: `bluewrite\scripts\launcher\build.cmd` writes
REM  BlueWrite.exe into the folder that holds the bluewrite folder, which is where
REM  it has to sit — it finds the application from its own location.
REM
REM  WHY IT IS A BUILD STEP AT ALL, rather than a checked-in binary nobody can
REM  re-derive. The .exe is a compiled artifact like public\assets: the sources in
REM  this folder are what is maintained, and this is how the artifact is made
REM  again. It is small (a few KB) and IS checked in, so a workstation that has
REM  only cloned the repository can double-click it without a compiler.
REM
REM  THE COMPILER IS MICROSOFT'S OWN, already inside Windows: the .NET Framework
REM  C# compiler at %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe (the
REM  Framework folder, not a separate SDK). Nothing is downloaded and nothing has
REM  to be installed on the station. It is C# 5, which is why BlueWrite.cs stays
REM  inside that language version — see the note at the top of that file.
REM ============================================================================

set "HERE=%~dp0"
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo [bluewrite] No C# compiler found. Expected the .NET Framework 4 one at:
  echo [bluewrite]   %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
  echo [bluewrite] Windows Repairs, or installing .NET Framework 4.8, restores it.
  exit /b 1
)

REM BlueWrite.exe goes beside the bluewrite folder: launcher\ -> scripts\ -> bluewrite\ -> checkout root.
set "OUT=%HERE%..\..\..\BlueWrite.exe"

echo [bluewrite] compiling the launcher ...
"%CSC%" /nologo /target:exe /platform:anycpu /optimize+ /out:"%OUT%" "%HERE%BlueWrite.cs"
if errorlevel 1 (
  echo [bluewrite] the launcher did not compile - see the errors above.
  exit /b 1
)

for %%f in ("%OUT%") do echo [bluewrite] built %%~ff  (%%~zf bytes)
echo [bluewrite] double-click it, or run it with --no-open to start the stack only.
endlocal
