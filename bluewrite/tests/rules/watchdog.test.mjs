// BlueWrite — the local stack has to come back on its own.
//
// WHY THIS FILE EXISTS. "Connection to the BlueWrite server was lost", and the
// browser's ERR_CONNECTION_REFUSED, are the same fact: nothing is listening on
// the origin the tab is open on. That is an operations fact, not a bug in the
// app — which is exactly why it kept coming back. Two things made it recur, and
// both are asserted here because neither throws, neither shows up in a diff, and
// both are invisible until a browser is already open:
//
//   1. THE DEV ORIGIN WAS NEVER PINNED. Vite's default is 5173 (then 5174…) and
//      nothing said otherwise, so `npm run dev` could serve a perfectly healthy
//      app at an address the open tab was not using.
//   2. NOTHING BROUGHT A DEAD SERVER BACK. A server started from a terminal dies
//      with the terminal, and the person who notices is the person trying to write
//      a report.
//
// scripts/watch-servers.ps1 answers the second; `port` in vite.config.js answers
// the first. This file keeps the pair honest, and keeps the three files that name
// those ports (the config, the launcher, the watchdog) from drifting apart — a
// drift whose only symptom is a refused connection in front of an officer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const CONFIG = read('vite.config.js');
const WATCHDOG = read('scripts/watch-servers.ps1');
const LAUNCHER = read('scripts/serve.cmd');
const README = read('README.md');

/** Comments stripped — all three files describe the ports in prose, and a check
 *  that read the prose would pass on a file whose code had been changed. */
const ps = WATCHDOG.replace(/^[ \t]*#.*$/gm, '');
const bat = LAUNCHER.replace(/^[ \t]*rem.*$/gim, '');

const devPort = Number((CONFIG.match(/\n\s*port:\s*(\d+)/) || [])[1]);
const apiPort = Number((CONFIG.match(/target:\s*'http:\/\/localhost:(\d+)'/) || [])[1]);

test('the dev origin is pinned, and the proxy still names the API', () => {
  // Without the pin, the answer to "which URL is the app on?" depends on what
  // else was running when the server started.
  assert.ok(Number.isInteger(devPort) && devPort > 0, 'vite.config.js no longer pins the dev port');
  assert.ok(Number.isInteger(apiPort) && apiPort > 0, 'the /api proxy no longer names the API port');
  assert.notEqual(devPort, apiPort, 'the dev server and the API cannot share a port');
});

test('the config, the launcher and the watchdog all name the same two ports', () => {
  // Read, not repeated: the numbers come from the config, and these three files
  // are checked against it, so changing the origin in one place fails here.
  assert.equal(
    Number((ps.match(/\$DevPort\s*=\s*(\d+)/) || [])[1]),
    devPort,
    'the watchdog watches a different dev port than vite.config.js pins',
  );
  assert.equal(
    Number((ps.match(/\$ApiPort\s*=\s*(\d+)/) || [])[1]),
    apiPort,
    'the watchdog watches a different API port than the proxy targets',
  );
  // scripts\serve.cmd: both directions — start it there, and only if that exact
  // port is free.
  assert.match(ps, /@\('-S', "127\.0\.0\.1:\$port", '-t', 'public', 'router\.php'\)/, 'the shared watchdog no longer starts the API on its configured port');
  // The API check matches any interface: the portal binds 0.0.0.0:8099 so the
  // phone app can reach it over the station LAN, and a loopback-only pattern
  // reports "down" while it is serving.
  assert.match(bat, new RegExp(`:${apiPort} .*LISTENING`), 'serve.cmd checks a different API port');
  assert.match(ps, /@\(\$vite, '--port', "\$port", '--strictPort'\)/, 'the shared watchdog no longer starts Vite on its configured port');
  assert.match(bat, /-File "%~dp0watch-servers\.ps1"/, 'serve.cmd must delegate startup to the shared watchdog');
  assert.match(bat, new RegExp(`127\\.0\\.0\\.1:${devPort} .*LISTENING`), 'serve.cmd checks a different dev port');
  // The README is what the next person follows; a wrong port in it costs an hour.
  assert.match(
    README,
    new RegExp(`php -S 127\\.0\\.0\\.1:${apiPort} -t public router\\.php`),
    'the README teaches a port the app does not use',
  );
});

test('the watchdog adds a server and never removes one', () => {
  // Every port is asked first: a server that is already answering is left exactly
  // as it is, which is what makes a once-a-minute repair safe.
  assert.match(ps, /if \(Test-Port \$port\) \{ continue \}/, 'the watchdog starts servers without asking whether one is there');
  // Nothing in it stops anything. A watchdog that restarts what is not broken is
  // a watchdog that causes the outage it was installed to prevent.
  for (const banned of ['Stop-Process', 'taskkill', 'Stop-Service', 'Restart-Service', 'Remove-Item -Recurse']) {
    assert.ok(!ps.includes(banned), `the watchdog must never run ${banned}`);
  }
  // The servers are started through WMI, so they are nobody's children: a process
  // started by the task is torn down with the task instance, and that is what made
  // every earlier "restart it" fix temporary.
  assert.match(
    ps,
    /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/,
    'the watchdog no longer starts servers outside its own process tree',
  );
  // Both origins, and both of the ways the app can be reached: the API (which also
  // serves the built app) and the dev server.
  assert.match(ps, /Repair-Api/, 'the watchdog no longer repairs the API');
  assert.match(ps, /Repair-Dev/, 'the watchdog no longer repairs the dev server');
  // ...and it says so in a file, because "it happened again" is answered by a log
  // line, not by a guess.
  assert.match(ps, /watchdog\.log/, 'the watchdog no longer records what it repaired');
});

test('the scheduled task is built to keep healing rather than to stop after a while', () => {
  const task = (WATCHDOG.match(/<Task version="1\.2"[\s\S]*?<\/Task>/) || [])[0];
  assert.ok(task, 'the watchdog no longer describes the task it installs');
  const repetition = (task.match(/<Repetition>[\s\S]*?<\/Repetition>/) || [])[0];
  assert.ok(repetition, 'the task no longer repeats');
  assert.match(repetition, /<Interval>PT1M<\/Interval>/, 'the task no longer runs once a minute');
  // NO <Duration>. With one, the repetition ENDS — an hour later the machine is
  // back to failing silently, which is the whole failure being fixed.
  assert.doesNotMatch(repetition, /<Duration>/, 'the repetition expires, so the healing stops on its own');
  // A laptop on battery is still a machine the app is used on.
  assert.match(task, /<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>/, 'the task refuses to run on battery');
  assert.match(task, /<StopIfGoingOnBatteries>false<\/StopIfGoingOnBatteries>/, 'the task stops as soon as the laptop is unplugged');
  // A minute missed while the machine slept runs after it wakes.
  assert.match(task, /<StartWhenAvailable>true<\/StartWhenAvailable>/, 'a missed run is skipped instead of caught up');
  // Runs as the signed-in user: no stored password, no elevation, no UAC prompt.
  assert.match(task, /<LogonType>InteractiveToken<\/LogonType>/, 'the task needs a stored password or elevation');
  assert.match(task, /<RunLevel>LeastPrivilege<\/RunLevel>/, 'the task asks for more rights than starting a server needs');
  // It runs THIS script, by path — so a moved checkout is fixed by re-running
  // -Install rather than by editing a task in the Task Scheduler UI.
  assert.match(task, /<Arguments>\$taskArgs<\/Arguments>/, 'the task no longer passes its arguments through');
  assert.match(ps, /-f \$hiddenRunner, \$self/, 'the task no longer points at the script that installs it');
});

test('background launches hide consoles before startup and serialize repairs', () => {
  assert.match(ps, /New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly/);
  assert.match(ps, /ShowWindow = \[uint16\] 0/);
  assert.match(ps, /ProcessStartupInformation = \$startup/);
  assert.match(ps, /\$mutex\.WaitOne\(0\)/);
  assert.match(ps, /\$mutex\.ReleaseMutex\(\)/);
  assert.match(ps, /<Command>wscript\.exe<\/Command>/);
  const hidden = read('scripts/run-hidden.vbs');
  assert.match(hidden, /shell\.Run\(command, 0, True\)/);
  assert.match(hidden, /WScript\.Quit/);
  const desktop = readFileSync(new URL('../../../Start BlueWrite.bat', import.meta.url), 'utf8');
  assert.match(desktop, /call scripts\\serve\.cmd/);
  assert.doesNotMatch(desktop, /start .*\/min/i);
});

test('the README says how to install, inspect and remove the watchdog', () => {
  for (const flag of ['-Install', '-Status', '-Uninstall']) {
    assert.match(README, new RegExp(`watch-servers\\.ps1 ${flag}`), `the README never mentions ${flag}`);
  }
});
