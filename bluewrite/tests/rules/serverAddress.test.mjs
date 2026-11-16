// BlueWrite — the server's address is MEASURED, not remembered.
//
// THE PROBLEM IT REPLACES. The server PC moves networks, DHCP hands it a new
// address, and the old story was a hand-edit of config.php `app.base_url` plus
// every officer typing the new IP from memory. A moved server serves fine on
// its new address while every bookmark, sign-in email and memory still points
// at the old one — which is exactly the "client cannot open it" the station
// saw going 172.16.x → 192.168.x.
//
// THE CONTRACT, in the order the code states it:
//   1. ServerAddress detects this machine's LAN IPv4s per request, dropping
//      loopback (this machine only) and APIPA (DHCP failed), site-local first.
//   2. GET /server/address serves primary + urls + port to any signed-in role
//      (the officer at the desk is often not an Admin; a LAN IP is not a secret).
//   3. The sign-in email prints the measured address when no override is set.
//   4. The dashboard shows it with a Copy button, so the desk copies it onto
//      the client instead of reciting digits.
//
// renderToString never runs an effect, so the live behaviour is asserted
// against the source; detection itself runs on the server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ROOT as root } from './renderHarness.mjs';

const readSrc = (p) => readFile(path.join(root, p), 'utf8');

test('the address is detected per request, never typed per move', async () => {
  const core = await readSrc('app/core/ServerAddress.php');
  // Detection, in order: hostname resolution, then ipconfig / hostname -I.
  assert.match(core, /lanIpv4/);
  assert.match(core, /ipconfig/);
  assert.match(core, /hostname -I/);
  // Only an adapter's own line counts. ipconfig prints the subnet mask and the
  // default gateway as lines that also end in a dotted quad, so reading "any
  // quad at the end" offered 255.255.255.0 and the router as client addresses.
  assert.match(core, /ipconfigAddresses/);
  assert.match(core, /stripos\(\$line, 'IPv4'\)/);
  assert.match(core, /looksLikeNetmask/);
  // Loopback is this machine only, link-local means no DHCP lease, 0.0.0.0 is
  // a bind address — none of them is an address a client can type.
  assert.match(core, /127\./);
  assert.match(core, /169\.254/);
  assert.match(core, /0\.0\.0\.0/);
  // Site-local first: the primary must be routable, not a VPN adapter that
  // happened to list first.
  assert.match(core, /isSiteLocal/);
  assert.match(core, /192\.168/);
  // Port and scheme come from the request itself, with a sane fallback.
  assert.match(core, /SERVER_PORT/);
  assert.match(core, /FALLBACK_PORT = 8099/);
  // Never hand a client a loopback port: the dev server is 127.0.0.1:5180
  // only, so an address built on it times out on every other PC. A loopback
  // origin answers with the app's own LAN port instead.
  assert.match(core, /requestedHostIsLoopback/);
  // Detection never throws: an address reader must not 500 the response.
  assert.match(core, /catch \(\\Throwable\)/);
});

test('the override still wins, but nothing requires it', async () => {
  const core = await readSrc('app/core/ServerAddress.php');
  assert.match(core, /publicBaseUrl/);
  assert.match(core, /base_url/);
  // The mail body reads the measured address, not the config section.
  const otp = await readSrc('app/core/EmailOtp.php');
  assert.match(otp, /ServerAddress::publicBaseUrl/);
  assert.doesNotMatch(otp, /Config::section\('app'\)\['base_url'\]/);
});

test('the endpoint serves it to whoever is at the desk', async () => {
  const ctrl = await readSrc('app/controllers/DashboardController.php');
  assert.match(ctrl, /function address/);
  // Any signed-in role — the officer showing a client in is often not an Admin.
  assert.match(ctrl, /function address[\s\S]{0,400}requireUser/);
  assert.match(ctrl, /ServerAddress::urls/);
  const api = await readSrc('api/index.php');
  assert.match(api, /server.*address/);
  assert.match(api, /ServerAddress\.php/);
});

test('the dashboard shows it with a copy button', async () => {
  const dash = await readSrc('src/components/Dashboard.jsx');
  assert.match(dash, /ClientAccess/);
  assert.match(dash, /\/server\/address/);
  assert.match(dash, /Client access/);
  assert.match(dash, /same Wi-Fi/);
  assert.match(dash, /clipboard/);
  // A failure omits the card, never the page — same rule as the requests card.
  assert.match(dash, /if \(!addr \|\| urls\.length === 0\) return null/);
  const css = await readSrc('src/styles.css');
  assert.match(css, /\.dash-access/);
  assert.match(css, /\.dash-access__copy/);
});
