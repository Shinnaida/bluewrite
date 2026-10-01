// BlueWrite — THE OFFICER'S HOME SHOWS THE STATION'S WORKING TIME.
//
// An officer types the incident time off the clock in the room. The app records
// every time on Philippine Standard Time (the case bar's save stamp, the audit
// trail, the report's own date), so Home has to show that same clock — reading
// from `Asia/Manila` rather than from the workstation's own zone, which on a PC
// whose region was never set is some other hour entirely, and ticking, because
// the reading is acted on ("it is 12:35 now") and a clock frozen at page load is
// worse than no clock.
//
// These assert the three halves that can part company:
//
//   1. the FORMATTER — which zone it reads, and the exact shape it answers with
//      (12-hour with seconds, padded, a fixed zone name, and a date line);
//   2. the PLACE — the clock is IN the hero band and is the only one on the page.
//      Home used to draw it under a centred wordmark, then above one, then at the
//      band's far end opposite the letterhead; it now sits a letterhead's width
//      past the wordmark, inside the band's own measure (60rem), because the
//      station's photograph runs under the whole band and the building sits
//      centre-right in it. The failure
//      this guards is the one the rebuild actually produced: the old masthead left
//      in the tree beside the new band, so the page opened with TWO clocks reading
//      two different seconds;
//   3. the WIRING — that the one-second tick belongs to the READOUT rather than
//      to the page (a tick in ReportWelcome would redraw every draft row every
//      second), and that the timer is cleared when Home unmounts.
//
// Read from the source (like sectionPosition.test.mjs and reportTopBar.test.mjs):
// the drawing itself is guarded by homeWelcome.test.mjs, which renders Home.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PHILIPPINE_TIME_LABEL,
  PHILIPPINE_TIME_ZONE,
  readPhilippineClock,
} from '../../src/lib/philippineClock.js';

const REPORTS = readFileSync(new URL('../../src/components/Reports.jsx', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../../src/incident-report.css', import.meta.url), 'utf8');

/** Source with comments taken out — the prose in this file names every one of
 *  these identifiers, so a regex has to read code only. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SRC = code(REPORTS);
const SHEET = code(CSS);

test('the reading is the station\u2019s zone, not the workstation\u2019s', () => {
  // 17:30 UTC is 01:30 the NEXT DAY in Manila. A machine in any other zone
  // formats this instant differently, so this one assertion is what proves the
  // zone is pinned rather than inherited from the PC the app is running on — it
  // is the whole reason the module exists.
  const acrossMidnight = readPhilippineClock(new Date('2026-09-30T17:30:00Z'));
  assert.equal(acrossMidnight.time, '01:30:00 AM');
  assert.equal(acrossMidnight.date, 'Thursday, Oct 1, 2026');

  assert.equal(PHILIPPINE_TIME_ZONE, 'Asia/Manila', 'the station clock reads another zone');

  // And nothing in the module may fall back to the local zone by omitting it.
  const MODULE = readFileSync(new URL('../../src/lib/philippineClock.js', import.meta.url), 'utf8');
  const options = MODULE.match(/new Intl\.DateTimeFormat\([^)]*\)/g) ?? [];
  assert.equal(options.length, 2, 'the clock should build exactly the two formatters');
  for (const o of options) {
    assert.match(o, /timeZone:\s*PHILIPPINE_TIME_ZONE/, 'a formatter reads the local zone');
  }
});

test('the time is 12-hour with seconds, padded, and the caption names the day', () => {
  const noon = readPhilippineClock(new Date('2026-10-01T12:35:01+08:00'));
  assert.equal(noon.time, '12:35:01 PM');
  assert.equal(noon.date, 'Thursday, Oct 1, 2026');

  // 2-digit HOUR under 12-hour time: "09", not "9". The seconds tick, so an
  // unpadded hour would grow the line by a character at 9 o'clock and shuffle
  // the readout the officer is looking at.
  assert.equal(readPhilippineClock(new Date('2026-10-01T09:05:00+08:00')).time, '09:05:00 AM');
  // Midnight is 12 AM, not 0 AM.
  assert.equal(readPhilippineClock(new Date('2026-10-01T00:07:00+08:00')).time, '12:07:00 AM');
  assert.equal(readPhilippineClock(new Date('2026-10-01T23:59:59+08:00')).time, '11:59:59 PM');

  // The zone name is this product's FIXED wording. `Intl` would answer with the
  // engine's own wording for the zone ("Philippine Time", or "GMT+8" on a build
  // with a thinner ICU), which is a caption that changes per machine.
  assert.equal(PHILIPPINE_TIME_LABEL, 'Philippine Standard Time');
  assert.equal(noon.label, PHILIPPINE_TIME_LABEL);
});

test('an unreadable date yields an empty reading rather than an Invalid Date', () => {
  for (const bad of [new Date('nope'), new Date(Number.NaN)]) {
    const c = readPhilippineClock(bad);
    assert.equal(c.time, '', 'an invalid date must not reach the screen as a time');
    assert.equal(c.date, '');
    // The caption is not a reading: it is the same sentence on every machine.
    assert.equal(c.label, PHILIPPINE_TIME_LABEL);
  }
});

test('Home draws ONE clock, in the band beside the letterhead, and it owns its tick', () => {
  // The readout is its OWN component with its own state. The tick is what makes
  // this matter: a `now` kept in ReportWelcome would re-render every draft row
  // sixty times a minute.
  const clockAt = SRC.indexOf('function HomeClock');
  assert.notEqual(clockAt, -1, 'HomeClock is gone');
  const clock = SRC.slice(clockAt, SRC.indexOf('\n}', clockAt));
  assert.match(clock, /useState\(\(\) => new Date\(\)\)/, 'the reading is not held as state');
  assert.match(
    clock,
    /setInterval\(\(\) => setNow\(new Date\(\)\), PHILIPPINE_TICK_MS\)/,
    'the readout does not tick',
  );
  assert.match(clock, /clearInterval\(id\)/, 'the interval is never cleared');
  // ONE second: the readout shows seconds, so a slower tick would be a wrong
  // clock rather than a cheap one.
  assert.match(SRC, /const PHILIPPINE_TICK_MS = 1000;/, 'the tick is no longer one second');
  assert.ok(
    SRC.indexOf('const PHILIPPINE_TICK_MS') < clockAt,
    'the tick period is declared after the component that uses it',
  );

  // Drawn INSIDE the hero band, which is where the officer's eye already is when
  // the page opens — and it is the band's SECOND block, not its first. It follows
  // the letterhead and stays inside the band's measure: past that measure the
  // station's own building is under the veiled end of the picture (see the
  // stylesheet half of this file).
  const heroAt = SRC.indexOf('<section className="ir-home-hero">');
  assert.notEqual(heroAt, -1, 'the hero band is gone');
  const hero = SRC.slice(heroAt, SRC.indexOf('</section>', heroAt));
  assert.match(hero, /<HomeClock \/>/, 'the clock is not part of the band');
  assert.ok(hero.includes('ir-home-hero-brand'), 'that is not the hero band');
  assert.ok(
    hero.indexOf('ir-home-hero-brand') < hero.indexOf('<HomeClock />'),
    'the clock no longer follows the letterhead it is set opposite',
  );

  // EXACTLY ONE, and mounted once. This is the assertion the rebuild needed: the
  // old masthead was left in the tree beside the new band and Home rendered two
  // clocks, each reading its own second, while every other assertion here passed.
  assert.equal(SRC.split('<HomeClock />').length - 1, 1, 'Home mounts more than one clock');
  assert.equal(SRC.split('function HomeClock').length - 1, 1, 'HomeClock is defined more than once');
  // And the masthead it used to sit in is gone, not merely hidden.
  assert.ok(!SRC.includes('"ir-hero"'), 'the old masthead section is still in the tree');
  assert.ok(!SRC.includes('ir-hero-wordmark'), 'the old wordmark is still in the tree');

  // The three lines, and the live region it must NOT be: a readout announced every
  // second makes the page unusable with a screen reader.
  assert.match(clock, /className="ir-hero-clock-time"/, 'the time line is gone');
  // …and it renders the formatter's own reading, figure by figure (see the
  // slot invariant in the test below).
  assert.match(clock, /\{\[\.\.\.clock\.time\]\.map/, 'the time line no longer reads the formatter');
  assert.match(clock, /className="ir-hero-clock-date">\{clock\.date\}/, 'the date line is gone');
  assert.match(clock, /className="ir-hero-clock-zone">\{clock\.label\}/, 'the zone line is gone');
  assert.doesNotMatch(SRC, /aria-live/, 'a ticking clock is not a live region');
});

test('the readout holds still while it ticks, and it is stated for the navy band', () => {
  const rule = SHEET.match(/\.ir-hero-clock-time\s*\{[^}]*\}/);
  assert.ok(rule, '.ir-hero-clock-time is gone from the stylesheet');
  assert.match(rule[0], /font-variant-numeric:\s*tabular-nums/, 'the ticking digits can shuffle the line');

  // …AND THE FIGURES ARE SET IN SLOTS, because the assertion above is only as
  // good as the face it lands on. The app ships its own typeface (League Spartan
  // — the station's LAN cannot fetch another), and it has PROPORTIONAL figures
  // and no `tnum` feature, so `tabular-nums` alone moved nothing: measured in
  // the browser, one second's reading was 58px wider than another's, and since
  // the clock is anchored to the right end of the band's row, the hour, the
  // minute AND the date slid sideways on every tick. A figure in a slot of the
  // widest figure's own width holds on any face rather than on a promised one.
  const slot = SHEET.match(/\.ir-hero-clock-digit\s*\{[^}]*\}/);
  assert.ok(slot, '.ir-hero-clock-digit is gone from the stylesheet');
  assert.match(slot[0], /display:\s*inline-block/, 'a slot is not a box of its own');
  assert.match(slot[0], /width:\s*1ch/, 'the slot is not the width of a figure');
  // …and the readout is wired to it: a rule nothing renders is not an invariant.
  assert.match(SRC, /ir-hero-clock-digit/, 'the readout no longer sets its figures in slots');
  // White, because the band behind it is navy — and the clock is the second
  // loudest thing on that band, after the wordmark, which is what the size floor
  // below the band's own wordmark states.
  assert.match(rule[0], /color:\s*#fff/, 'the readout is not stated against the band it prints on');

  // The mark is the band's gold — the same accent the action plate and the WRITE
  // in the wordmark use, so the hero spends ONE accent and spends it three times.
  const mark = SHEET.match(/\.ir-hero-clock-mark\s*\{[^}]*\}/);
  assert.ok(mark, '.ir-hero-clock-mark is gone from the stylesheet');
  assert.match(mark[0], /color:\s*var\(--ir-gold\)/, 'the clock lost the band’s accent');

  // The band itself: navy, and bled past the page's gutters by NAME, so the
  // wordmark starts on the same left edge every card under it starts on.
  const band = SHEET.match(/\.ir-home-hero\s*\{[^}]*\}/);
  assert.ok(band, '.ir-home-hero is gone from the stylesheet');
  assert.match(band[0], /background:\s*var\(--ir-navy\)/, 'the band is not the station’s navy');
  assert.match(band[0], /margin:\s*calc\(-1 \* var\(--ir-gutter-top/, 'the band no longer bleeds to the page edges');

  // THE MEASURE, and the photograph it is a measure FOR. The letterhead and the
  // clock are not pushed to the band's two edges: held to a letterhead's worth of
  // room the clock lands a measure past the wordmark, clear of the bright middle
  // of the station's own building. Read the other way round, the two rules below
  // are one decision: a clock on the far edge would sit on the busiest part of the
  // picture. The 62% half of the `min()` is what keeps that true on a very wide
  // screen, where a fixed measure would leave the clock stranded mid-band.
  const inner = SHEET.match(/\.ir-home-hero-inner\s*\{[^}]*\}/);
  assert.ok(inner, '.ir-home-hero-inner is gone from the stylesheet');
  assert.match(inner[0], /max-width:\s*min\(60rem,\s*62%\)/, 'the band no longer keeps a measure');
  // …AND THE LETTERHEAD HAS A MEASURE OF ITS OWN, which is what keeps the clock
  // beside it. The band is a row of two blocks placed with `space-between`, so the
  // clock lands at the far end of that measure — and any line in the letterhead
  // wider than the room left for it pushes the WHOLE CLOCK, day and date with it,
  // onto a second row, under the wordmark. The lead copy is that line, and the one
  // that changes whenever the station rewrites it: reworded at the same measure it
  // took the row and the clock dropped. Capped, the sentence wraps inside the
  // measure instead, and nothing on the band moves.
  const lead = SHEET.match(/\.ir-home-hero-lead\s*\{[^}]*\}/);
  assert.ok(lead, '.ir-home-hero-lead is gone from the stylesheet');
  const leadMeasure = lead[0].match(/max-width:\s*([0-9.]+)rem/);
  assert.ok(leadMeasure, 'the lead copy has no measure: a longer sentence will push the clock onto its own row');
  assert.ok(
    Number(leadMeasure[1]) >= 20 && Number(leadMeasure[1]) <= 30,
    `the letterhead's measure is ${leadMeasure[1]}rem, which no longer sits inside the band's own 60rem`,
  );
  // THE PICTURE IS THE BAND'S RIGHT END, AND THE WHOLE FRAME IS ON IT. That second
  // half is what this block exists for now: the station asked for the photograph it
  // supplied rather than a window cut out of it, so the layer draws the whole 3:1
  // frame at the band's own height instead of cropping to fit a region that is a
  // different shape.
  const photo = SHEET.match(/\.ir-home-hero-photo\s*\{[^}]*\}/);
  assert.ok(photo, '.ir-home-hero-photo is gone from the stylesheet');
  assert.match(
    photo[0],
    /inset:\s*0 0 0 auto/,
    'the photograph is no longer anchored to the band\u2019s right end',
  );
  // THE BOX TAKES THE PICTURE'S OWN SHAPE, and that is what leaves nothing to
  // crop: the band's height plus the file's own three-to-one makes the width. This
  // is the one number in the rule that follows the FILE, so a station swapping in
  // a photograph of another shape changes it here.
  assert.match(photo[0], /aspect-ratio:\s*3\s*\/\s*1/, 'the photograph is no longer drawn at its own proportions');
  // The ceiling is only the guard for a band too narrow to hold that shape, and
  // the width is no longer a share of the band — a share is a crop waiting to
  // happen. `max-width` is not a `width`: the pattern has to say so, or the guard
  // would read as the very declaration it replaced.
  assert.match(photo[0], /max-width:\s*min\(58%,\s*46rem\)/, 'the photograph has lost its narrow-band guard');
  assert.doesNotMatch(photo[0], /[;{]\s*width:\s*min\(/, 'the photograph is a share of the band\u2019s width again');
  assert.doesNotMatch(photo[0], /[;{]\s*width:\s*100%/, 'the photograph is the band\u2019s field again, under every word');
  assert.match(photo[0], /height:\s*100%/, 'the photograph no longer fills the band\u2019s height');
  // CONTAIN, NOT COVER. `cover` fills its box by definition, so a box of any other
  // proportion CROPS the photograph — which is exactly the placed 62%-33% window
  // this replaced. `contain` is the whole frame, always: where the band is too
  // narrow for it, the picture gives way inside the band's own navy rather than
  // being cut.
  assert.match(photo[0], /object-fit:\s*contain/, 'the photograph is being cropped to its box again');
  assert.doesNotMatch(photo[0], /object-fit:\s*cover/, 'the photograph fills its box by cropping it again');
  assert.match(
    photo[0],
    /object-position:\s*100% 50%/,
    'the photograph is no longer flush with the band\u2019s right edge',
  );
  // MASKED ON ITS LEFT EDGE, which is the whole difference between a picture ON a
  // band and a picture PASTED on one: a straight cut here is a rectangle of
  // photograph with navy around it.
  assert.match(
    photo[0],
    /mask-image:\s*linear-gradient\(to right, transparent/,
    'the photograph has a hard left edge again, so the band ends in a rectangle',
  );
  // …and NOT ALSO dimmed: an `opacity` under 1 is a second wash on a picture that
  // already sits under the scrim, and two half-measures is how a band goes grey.
  assert.doesNotMatch(photo[0], /opacity:\s*0\./, 'the photograph is ghosted as well as masked');

  // AND NOTHING MOVES IT. The layer was briefly shifted a tenth of its width to
  // the left, and the band's navy closed along the photograph's right side — so
  // the picture read as though its right end had been cut off, which is the one
  // thing `contain` is there to guarantee it is not. No transform of any kind:
  // not a shift (that is the mistake above), not a scale (that is the zoom the
  // whole-frame rule exists to prevent), not a rotation.
  assert.doesNotMatch(photo[0], /transform:/, 'the photograph is being moved off the band\u2019s right edge again');
  assert.doesNotMatch(photo[0], /scale\(/, 'the photograph has been zoomed inside its own frame');
  assert.doesNotMatch(photo[0], /rotate|skew/, 'the photograph is being distorted');

  // The scrim is the band's navy laid over that picture as a VEIL, and its SHAPE
  // is the other half of the same decision: with the picture confined to the right
  // end the wash has one job left — keep the station behind the navy rather than
  // on it — so it is a gentle 0.92 to 0.70 rather than the 0.90-to-0.18 fall that
  // a full-bleed photograph needed to stay a picture at all. The two ends are the
  // two ways this goes wrong: a scrim that CLEARS is white type on a lit building,
  // and a scrim that only turns heavy past the words is a navy block with a
  // photograph pasted on its right end.
  const scrim = SHEET.match(/\.ir-home-hero-scrim\s*\{[^}]*\}/);
  assert.ok(scrim, '.ir-home-hero-scrim is gone from the stylesheet');
  assert.match(scrim[0], /rgba\(11, 37, 69, 0\.92\) 0%/, 'the scrim no longer holds the wordmark');
  assert.match(scrim[0], /rgba\(11, 37, 69, 0\.76\) 52%/, 'the scrim no longer holds the clock\u2019s column');
  assert.match(scrim[0], /rgba\(11, 37, 69, 0\.5\) 100%/, 'the veil lifts at the far edge');
  assert.doesNotMatch(scrim[0], /rgba\(11, 37, 69, 0\.0\d\)/, 'the scrim clears the picture again');
  // AND IT IS STILL A VEIL — half the picture and no more. The floor is 0.5 rather
  // than the 0.7 it was: the photograph is a whole frame at the band's own height
  // now and is meant to be SEEN, so what this guards is only that the band's navy
  // is still the surface on top of it. A ramp that reaches a light tint is the
  // full-bleed design coming back, where the picture was the page.
  for (const stop of scrim[0].matchAll(/rgba\(11, 37, 69, (0\.\d+)\)/g)) {
    const alpha = Number(stop[1]);
    assert.ok(alpha >= 0.5, `the veil drops to ${alpha} — the photograph is showing past the navy again`);
  }

  // The zone is its own line, in sentence case: the band's kicker already carries
  // the uppercase register, and a second shouted line under the time would read as
  // a third label rather than as the time's own caption.
  const zone = SHEET.match(/\.ir-hero-clock-zone\s*\{[^}]*\}/);
  assert.ok(zone, '.ir-hero-clock-zone is gone from the stylesheet');
  assert.doesNotMatch(zone[0], /text-transform:\s*uppercase/, 'the zone is a second label');
});
