' Use a GUI-subsystem host: PowerShell -WindowStyle Hidden alone can flash
' a console before PowerShell has a chance to hide it.
Option Explicit
Dim shell, script, command
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
script = WScript.Arguments(0)
Set shell = CreateObject("WScript.Shell")
command = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & script & """"
WScript.Quit shell.Run(command, 0, True)
