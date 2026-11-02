// BlueWrite — the dashboard's station identity band, RENDERED.
//
// The page opens on whose house it is: the PNP seal in a gold ring, then the
// force, the station and the system. A band that renders as an empty plate
// passes every source-reading test, so the fixture renders it and the markup
// is read here — the same arrangement the KPI furniture already uses (see
// adminDashboard.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './renderHarness.mjs';

const load = () => loadFixture('tests/fixtures/adminDashboard.jsx');

test('the dashboard opens on the police: seal, force, station, system', async () => {
  const { renderBanner } = await load();
  const html = renderBanner();

  // The PNP seal draws as an image, decorative beside the words that name it:
  // a reader that heard the seal announced before the words would be read a
  // picture of the sentence it is about to get.
  assert.match(html, /<img[^>]+src="data:image\/png;base64,/);
  assert.match(html, /aria-hidden="true"/);
  assert.ok(html.includes('Philippine National Police'), 'the force is not named');
  assert.ok(html.includes('Naga City Police Station'), 'the station is not named');
  assert.ok(html.includes('Official Incident Reporting System'), 'the system is not named');
});

test('without a letterhead yet, the band falls back to the built-in station', async () => {
  const { renderBanner } = await load();
  const html = renderBanner({ stationName: null });

  // Shell's letterhead read lands after the first paint; the band must never
  // show a blank where the station goes.
  assert.ok(html.includes('City of Naga Police Station'), 'the band has no fallback station');
});
