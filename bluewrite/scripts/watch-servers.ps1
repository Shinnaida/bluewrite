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
#  THE DATABASE IS THE THIRD PORT IT LOOKS AFTER. The API and the dev server were
#  the first two; MySQL was only ever written to the log, on the argument that a
#  database is not a refreshable web server. That argument is true and beside the
#  point: "Database connection failed. Contact the system administrator" is the
#  failure a person actually hits, it is the same shape as a refused connection,
#  and a line in a log only helps whoever opens the log. So MySQL is repaired
#  too, under exactly the same rule as the servers — ONLY WHEN 3306 IS FREE, so
#  nothing here can take a running database away. What it starts is the Laragon
#  instance (the one that holds the BlueWrite schema), hidden, owned by WmiPrvSE
#  rather than by a window somebody can close, and never when 3306 is already
#  answering but belongs to the OTHER MySQL on this machine — that case is named
#  in the log instead of papered over. See Repair-Db, and
#  docs\DEVELOPMENT_STARTUP.md on the two installations.
#
#  WHY A SCHEDULED TASK AND NOT A WINDOW. A process started from a terminal
#  belongs to that terminal; close it and the process goes with it. Task
#  Scheduler owns this script instead, so it survives closing windows, closing
#  editors, logout and reboot.
#
#  WHY THE SERVERS ARE SPAWNED THROUGH WMI, AND HIDDEN. A process started normally
#  by a task is a CHILD of that task, and Task Scheduler may tear the child down
#  when the task instance ends. WMI's Win32_Process.Create makes the process a
#  child of WmiPrvSE instead, so the server outlives the check that started it.
#
#  The HIDDEN half matters just as much: Win32_ProcessStartup.ShowWindow = 0
#  hides each server at creation; the task uses wscript.exe (a windowless host).
#  Earlier launchers used a hidden PowerShell wrapper, which could still flash.
#  Background on the original problem: a
#  console program handed to WMI into an interactive session is given its own
#  CONSOLE WINDOW, so every repair put a terminal on the desktop. That window is
#  also the one somebody closes — and closing it kills the dev server, so a minute
#  later the port was down again, the next check started another one, and another
#  window appeared. On a machine doing other work that is a window that keeps
#  coming back. See Start-Detached for creation-time hiding without a wrapper.
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
  # WHERE MySQL IS. Laragon's install and its data directory (the one with the
  # BlueWrite schema) — see docs\DEVELOPMENT_STARTUP.md. Kept as parameters so a
  # moved install is a one-line change rather than an edit to the code below.
  [string] $MySqlRoot = 'C:\laragon\bin\mysql',
  [string] $DbDataDir = 'C:\laragon\data\mysql',
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
  param(
    [Parameter(Mandatory = $true)][string]   $FilePath,
    [Parameter(Mandatory = $true)][string[]] $ArgumentList
  )
  # WmiPrvSE owns the process, so nothing about this script's own life can end it.
  #
  # Quote arguments containing spaces for the executable's Windows command-line
  # parser. In particular, the Vite path lives under a user profile with spaces.
  # There is no intermediate PowerShell or cmd process to flash a console.
  $argText = ($ArgumentList | ForEach-Object {
      $s = [string] $_
      if ($s -match '\s') { '"' + $s + '"' } else { $s }
    }) -join ' '
  # Hide the console at CREATION, before any executable code runs. A hidden
  # PowerShell wrapper can still flash while its console is being allocated.
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{
    ShowWindow = [uint16] 0
  }
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine        = ('"{0}" {1}' -f $FilePath, $argText)
    CurrentDirectory   = $root
    ProcessStartupInformation = $startup
  } -ErrorAction Stop
  if ($null -eq $result) { throw 'WMI did not return a process creation result.' }
  return $result
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

# Node is taken from PATH rather than from a fixed install: it is installed by an
# installer or a version manager, and both put it in a different place.
function Find-Node {
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  return $null
}

# MySQL, as Find-Php finds PHP: the newest version installed under Laragon's
# bin\mysql, with PATH as the fallback for an install somewhere else. It is
# deliberately NOT a search of the whole machine: this machine has a second MySQL
# under C:\Program Files (its Windows service, with a different data directory
# and no BlueWrite schema — see docs\DEVELOPMENT_STARTUP.md), and finding that one
# would repair the database into a server that cannot answer a login.
function Find-MySql {
  $found = Get-ChildItem (Join-Path $MySqlRoot '*') -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'bin\mysqld.exe' } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1
  if ($found) { return $found }
  $onPath = Get-Command mysqld -ErrorAction SilentlyContinue
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
    $res = Start-Detached -FilePath $php -ArgumentList @('-S', "127.0.0.1:$port", '-t', 'public', 'router.php')
    if ($res.ReturnValue -eq 0) {
      Write-Note ('api  {0} DOWN -> started {1} (hidden)' -f $port, $php)
    } else {
      Write-Note ('api  {0} DOWN - could not start it (WMI returned {1})' -f $port, $res.ReturnValue)
    }
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
    $node = Find-Node
    if (-not $node) {
      Write-Note "dev  $port DOWN - node is not on PATH (install Node.js)"
      continue
    }
    # node IS the server, with the repo root handed as its working directory —
    # which is what the old `cmd.exe /c cd /d ... && node ...` was there for, and
    # the reason a separate cmd (and the console window that came with it) is no
    # longer in the picture at all.
    $res = Start-Detached -FilePath $node -ArgumentList @($vite, '--port', "$port", '--strictPort')
    if ($res.ReturnValue -eq 0) {
      Write-Note ('dev  {0} DOWN -> started vite (hidden)' -f $port)
    } else {
      Write-Note ('dev  {0} DOWN - could not start it (WMI returned {1})' -f $port, $res.ReturnValue)
    }
  }
}

# ---- MySQL: repaired like the others, and only when the port is free --------
# WHICH PROGRAM HOLDS 3306, because on this machine that is not a detail. Two
# MySQL installations answer on the same port with the same protocol, so a TCP
# connect cannot tell them apart — but only one of them has the BlueWrite schema.
# netstat names the owning pid and WMI turns that into a path, which is the only
# honest way to tell them apart; the path is what the log gets to name.
function Get-DbOwner {
  $line = netstat -ano | Select-String (':{0}\s' -f $DbPort) |
    Where-Object { $_.Line -match 'LISTENING' } |
    Select-Object -First 1
  if (-not $line) { return $null }
  # $ownerPid, never $pid: $PID is PowerShell's own read-only variable for THIS
  # process, and assigning to it is an error rather than a quiet mistake.
  $ownerPid = ($line.Line -replace '\s+', ' ').Trim().Split(' ')[-1]
  $proc = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $ownerPid) -ErrorAction SilentlyContinue
  if ($proc) { return $proc.ExecutablePath }
  return $null
}

# THE DATABASE IS NOT A WEB SERVER, and this function is still the same rule as
# the two above: ASK FIRST, START ONLY WHAT IS MISSING. Nothing here stops,
# kills or restarts anything, so a running database — including one Laragon
# started, or one somebody started by hand — is left exactly as it is.
#
# WHAT IT FIXES. The database that is not running at all: 3306 refused, the API
# answering "Database connection failed", and a person deciding whether to open
# Laragon. The repair is the documented command (docs\DEVELOPMENT_STARTUP.md),
# and it is started the same hidden, WmiPrvSE-owned way as the servers — which
# matters more here than anywhere else, because a MySQL that is a CHILD OF A
# CONSOLE WINDOW is a MySQL that dies when somebody tidies the desktop.
function Repair-Db {
  if (Test-Port $DbPort) {
    # UP IS NOT THE SAME AS USABLE, and it is worth saying so once in the log: the
    # other MySQL on this machine answers on 3306 perfectly well and has no
    # BlueWrite schema, so every login fails while the port looks healthy. This is
    # a NOTE and never a repair — nothing may take a database, even a wrong one,
    # away from whoever is using it.
    $exe = Get-DbOwner
    if ($exe -and $exe -notlike (Join-Path $MySqlRoot '*')) {
      Write-Note ('db   {0} up - but held by the OTHER MySQL ({1}), which has no BlueWrite schema; login will fail' -f $DbPort, $exe)
    }
    return
  }

  $mysqld = Find-MySql
  if (-not $mysqld) {
    Write-Note "db   $DbPort DOWN - no mysqld.exe found (looked in $MySqlRoot and PATH)"
    return
  }
  if (-not (Test-Path $DbDataDir)) {
    Write-Note "db   $DbPort DOWN - no data directory at $DbDataDir (see docs\DEVELOPMENT_STARTUP.md)"
    return
  }

  # The same arguments the documented start uses, and the same ones this machine's
  # working instance was started with. --no-defaults on purpose: my.ini belongs to
  # the other installs, and this start names its data directory explicitly.
  $res = Start-Detached -FilePath $mysqld -ArgumentList @(
    '--no-defaults',
    ('--datadir=' + $DbDataDir),
    ('--port=' + $DbPort)
  )
  if ($res.ReturnValue -ne 0) {
    Write-Note ('db   {0} DOWN - could not start it (WMI returned {1})' -f $DbPort, $res.ReturnValue)
    return
  }

  # WAITED FOR, because "started" is not the fact that matters. InnoDB takes a
  # second or two to open the data directory, and the port answering is the only
  # proof that the database is actually up — the wrapper above exits at once by
  # design, so there is nobody else left to ask.
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Port $DbPort) {
      Write-Note ('db   {0} DOWN -> started {1} (hidden)' -f $DbPort, $mysqld)
      return
    }
  }
  Write-Note ('db   {0} DOWN - started {1} but it never answered on the port (read the .err file in {2})' -f $DbPort, $mysqld, $DbDataDir)
}

function Repair-All {
  # Startup and the scheduled check may overlap. Never launch two MySQLs (or
  # two servers) while the first is still opening its listening socket.
  $mutex = New-Object System.Threading.Mutex($false, 'Local\BlueWrite-stack-repair')
  $held = $false
  try {
    try { $held = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { return }
    Repair-Db
    Repair-Api
    Repair-Dev
  } finally {
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
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
  $hiddenRunner = Join-Path $PSScriptRoot 'run-hidden.vbs'
  $taskArgs = '//B //NoLogo "{0}" "{1}"' -f $hiddenRunner, $self
  $taskArgs = [System.Security.SecurityElement]::Escape($taskArgs)
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
      <Command>wscript.exe</Command>
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
    @{ Name = 'uses windowless host';           Pass = ($xml -match '<Command>wscript.exe</Command>' -and $xml -match 'run-hidden\.vbs') },
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
  # The database line names WHAT is answering, not merely that something is: on
  # this machine the two installations are indistinguishable by port alone, and
  # "up" from the wrong one is the failure this is here to stop hiding.
  if (Test-Port $DbPort) {
    $exe = Get-DbOwner
    $who = if (-not $exe) { '' } elseif ($exe -like (Join-Path $MySqlRoot '*')) { '  (Laragon)' } else { "  (NOT Laragon: $exe)" }
    Write-Host ('db     127.0.0.1:{0}  up{1}' -f $DbPort, $who)
  } else {
    Write-Host ('db     127.0.0.1:{0}  DOWN' -f $DbPort)
  }
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
