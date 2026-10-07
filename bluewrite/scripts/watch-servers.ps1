# =============================================================================
#  BlueWrite — keep the local stack answering, without anyone remembering to.
#
#  THE PROBLEM THIS SOLVES. The app reports "Connection to the BlueWrite server
#  was lost", or the browser shows ERR_CONNECTION_REFUSED, the moment the origin
#  the tab is open on stops answering: on 5180 the Vite dev server, on 8099 the
#  PHP API that also serves the built app. A server started by hand — from a
#  terminal, or from an AI session whose processes die with it — is a server that
#  is eventually gone, and every time it went, someone had to notice and start it
#  again. This script is that someone, and it does not need to be told.
#
#  WHAT IT DOES. Every minute (installed as a Windows scheduled task, see SETUP)
#  it asks each port whether it is still answering and starts only what is
#  missing. It NEVER stops, kills or restarts anything: a server that is up is
#  left exactly as it is, so this is safe to run as often as you like, alongside
#  scripts\serve.cmd and alongside a dev server you started yourself.
#
#  WHY A SCHEDULED TASK AND NOT A WINDOW. A process started from a terminal
#  belongs to that terminal; close it and the process goes with it. Task
#  Scheduler owns this script instead, so it survives closing windows, closing
#  editors, logout and reboot.
#
#  WHY THE SERVERS ARE SPAWNED THROUGH WMI. A process started normally by a task
#  is a CHILD of that task, and Task Scheduler may tear the child down when the
#  task instance ends. WMI's Win32_Process.Create makes the process a child of
#  WmiPrvSE instead, so the server outlives the check that started it.
#
#  THE LOG. Repairs only — a quiet file is a healthy machine.
#    %LOCALAPPDATA%\BlueWrite\watchdog.log
#
#  SETUP (once, from the repo root; no administrator needed):
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-servers.ps1 -Install
#
#  TAKE STOCK ANY TIME (what is up, and what the task is doing):
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-servers.ps1 -Status
#
#  REMOVE IT (the stack keeps running; it just stops healing itself):
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-servers.ps1 -Uninstall
#
#  ONE REPAIR PASS BY HAND (same work, prints what it found):
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-servers.ps1 -Verbose
# =============================================================================

[CmdletBinding()]
param(
  # The two origins the app can be opened on: the PHP API + built app (also the
  # durable one), and the Vite dev server the /api proxy points at.
  [int[]]  $ApiPort = 8099,
  [int[]]  $DevPort = 5180,
  [int]    $DbPort  = 3306,
  [string] $LogPath = (Join-Path $env:LOCALAPPDATA 'BlueWrite\watchdog.log'),
  # Register / inspect / remove the scheduled task instead of repairing.
  [switch] $Install,
  [switch] $Uninstall,
  [switch] $Status
)

$ErrorActionPreference = 'SilentlyContinue'
$TaskName = 'BlueWrite servers (watchdog)'

# scripts\ -> the repo root, which is also the working directory the servers need
# (`-t public router.php` and `node_modules\vite\bin\vite.js` are both relative).
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'router.php'))) {
  Write-Error "watch-servers.ps1 must live in <repo>\scripts (router.php not found in $root)"
  exit 1
}
$self = $PSCommandPath

function Test-Port {
  param([int] $Port)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    # Loopback only: connecting to a closed port on 127.0.0.1 fails at once, so
    # this costs a millisecond and never waits on a timeout.
    $client.Connect('127.0.0.1', $Port)
    $client.Close()
    return $true
  } catch {
    $client.Close()
    return $false
  }
}

function Write-Note {
  param([string] $Text)
  $dir = Split-Path -Parent $LogPath
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text
  Add-Content -Path $LogPath -Value $line
  Write-Host $line
  Write-Verbose $line
  # A repairs-only log still grows if something is killing a server on a loop;
  # keep the file readable rather than letting it become its own problem.
  $lines = @(Get-Content -Path $LogPath)
  if ($lines.Count -gt 2000) {
    $lines | Select-Object -Last 500 | Set-Content -Path $LogPath
  }
}

function Start-Detached {
  param([string] $CommandLine)
  # WmiPrvSE owns the process, so nothing about this script's own life can end it.
  return Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine      = $CommandLine
    CurrentDirectory = $root
  }
}

function Find-Php {
  # Laragon is where this machine's PHP lives (see README); the newest version
  # installed wins, and PATH is the fallback for anything else.
  $found = Get-ChildItem 'C:\laragon\bin\php' -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'php.exe' } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
  if ($found) { return $found }
  $onPath = Get-Command php -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  return $null
}

# ---- The API + the built app (http://127.0.0.1:8099/) ------------------------
# One PHP process, no node anywhere in the path: the origin that has proved
# durable here, and the one to hand someone with a browser open in front of them.
function Repair-Api {
  foreach ($port in $ApiPort) {
    if (Test-Port $port) { continue }
    $php = Find-Php
    if (-not $php) {
      Write-Note "api  $port DOWN - no php.exe found (looked in C:\laragon\bin\php and PATH)"
      continue
    }
    $res = Start-Detached ('"{0}" -S 127.0.0.1:{1} -t public router.php' -f $php, $port)
    Write-Note ('api  {0} DOWN -> started {1} (pid {2})' -f $port, $php, $res.ProcessId)
  }
}

# ---- The dev server (http://127.0.0.1:5180/) ---------------------------------
function Repair-Dev {
  foreach ($port in $DevPort) {
    if (Test-Port $port) { continue }
    $vite = Join-Path $root 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path $vite)) {
      Write-Note "dev  $port DOWN - no vite at node_modules\vite\bin\vite.js (run npm install)"
      continue
    }
    # cmd is the launcher: `cd /d` puts node in the repo root, where its config
    # and index.html are.
    $res = Start-Detached ('cmd.exe /c cd /d "{0}" && node "{1}" --port {2} --strictPort' -f $root, $vite, $port)
    Write-Note ('dev  {0} DOWN -> started vite (pid {1})' -f $port, $res.ProcessId)
  }
}

# ---- MySQL: looked at, never started -----------------------------------------
# The API answering on 8099 while 3306 is closed is the one stack failure this
# must not paper over: MySQL is a database, not a refreshable web server. Noting
# it in the log turns "sign-in is unavailable" into a one-line answer.
function Note-Db {
  if (-not (Test-Port $DbPort)) {
    Write-Note "db   $DbPort DOWN - start MySQL (Laragon) before reporting a login problem"
  }
}

function Repair-All {
  Repair-Api
  Repair-Dev
  Note-Db
}

# ---- The scheduled task ------------------------------------------------------
# schtasks rather than the ScheduledTasks cmdlets: they fail with "Access is
# denied" for a non-elevated user on this machine, and schtasks does not. The
# task is described as XML so the settings that decide whether it keeps working
# are visible and exact:
#   * Repetition with an Interval and NO Duration = repeat indefinitely. A
#     Duration is what would quietly stop the healing after an hour.
#   * DisallowStartIfOnBatteries / StopIfGoingOnBatteries false: a laptop on
#     battery must still be looked after.
#   * StartWhenAvailable true: a minute missed while the machine slept runs after
#     it wakes instead of being skipped.
#   * InteractiveToken + LeastPrivilege: runs as you, when you are logged on,
#     with no stored password and no elevation.
function Get-TaskXml {
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $start = (Get-Date -Format 'yyyy-MM-ddTHH:mm:00')
  # $taskArgs rather than $args: $args is PowerShell's own automatic variable for
  # unbound arguments, and overwriting it would be a very quiet trap.
  $taskArgs = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $self
  $description = 'Keeps the BlueWrite API (8099) and dev server (5180) answering: starts whichever is missing, once a minute.'
  @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>$description</Description>
    <URI>\$TaskName</URI>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>$start</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT1M</Interval>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$sid</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
    <Priority>7</Priority>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>$taskArgs</Arguments>
    </Exec>
  </Actions>
</Task>
"@
}

function Test-TaskStored {
  # Read the task back rather than trusting the write. Every setting checked here
  # is one whose absence turns a watchdog into a task that quietly stops healing:
  # a Repetition Duration would end the loop, and the two battery settings would
  # skip it entirely on an unplugged laptop.
  $xml = Export-ScheduledTask -TaskName $TaskName
  if (-not $xml) { Write-Host 'CHECK  cannot read the task back'; return 1 }
  $repetition = [regex]::Match($xml, '(?s)<Repetition>(.*?)</Repetition>')
  $checks = @(
    @{ Name = 'repeats every minute';        Pass = ($repetition.Success -and $repetition.Value -match '<Interval>PT1M</Interval>') },
    @{ Name = 'repeats indefinitely';        Pass = ($repetition.Success -and $repetition.Value -notmatch '<Duration>') },
    @{ Name = 'runs on battery';             Pass = ($xml -match '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>') },
    @{ Name = 'survives switching to battery'; Pass = ($xml -match '<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>') },
    @{ Name = 'catches up after sleep';      Pass = ($xml -match '<StartWhenAvailable>true</StartWhenAvailable>') },
    @{ Name = 'runs this script';            Pass = ($xml -match [regex]::Escape((Split-Path -Leaf $self))) }
  )
  $failed = 0
  foreach ($c in $checks) {
    Write-Host ('CHECK  {0,-32} {1}' -f $c.Name, $(if ($c.Pass) { 'ok' } else { 'FAILED' }))
    if (-not $c.Pass) { $failed++ }
  }
  return $failed
}

function Install-Task {
  $xmlPath = Join-Path $env:TEMP 'bluewrite-watchdog-task.xml'
  Get-TaskXml | Out-File -FilePath $xmlPath -Encoding Unicode
  $out = & schtasks /create /tn $TaskName /xml $xmlPath /f 2>&1
  $code = $LASTEXITCODE
  Remove-Item $xmlPath -Force -ErrorAction SilentlyContinue
  Write-Host ($out -join "`n")
  if ($code -ne 0) { return $code }
  if ((Test-TaskStored) -ne 0) { return 1 }
  return 0
}

function Show-Status {
  $task = Get-ScheduledTask -TaskName $TaskName
  if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host ('task   {0}: {1}' -f $TaskName, $task.State)
    Write-Host ('       last run {0}  result {1}  next run {2}' -f $info.LastRunTime, $info.LastTaskResult, $info.NextRunTime)
  } else {
    Write-Host ('task   {0}: NOT INSTALLED (run with -Install)' -f $TaskName)
  }
  foreach ($port in $ApiPort) {
    Write-Host ('api    http://127.0.0.1:{0}/  {1}' -f $port, $(if (Test-Port $port) { 'up' } else { 'DOWN' }))
  }
  foreach ($port in $DevPort) {
    Write-Host ('dev    http://127.0.0.1:{0}/  {1}' -f $port, $(if (Test-Port $port) { 'up' } else { 'DOWN' }))
  }
  Write-Host ('db     127.0.0.1:{0}  {1}' -f $DbPort, $(if (Test-Port $DbPort) { 'up' } else { 'DOWN' }))
  Write-Host ('log    {0}' -f $LogPath)
}

if ($Uninstall) {
  $out = & schtasks /delete /tn $TaskName /f 2>&1
  Write-Host ($out -join "`n")
  exit $LASTEXITCODE
}

if ($Status) {
  Show-Status
  exit 0
}

if ($Install) {
  $code = Install-Task
  if ($code -ne 0) { exit $code }
  # Installing should leave the machine working, not merely configured.
  Repair-All
  Show-Status
  exit 0
}

Repair-All
