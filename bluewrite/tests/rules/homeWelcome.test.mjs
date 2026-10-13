// BlueWrite — the officer's Home: the band, the action, the drafts, the reminder.
//
// WHY THIS IS A RENDER TEST rather than one of the source-reading tests beside
// it. Almost every test in this directory reads source as text, which is cheap
// and catches a class name, a copy string or the order of two statements. It
// cannot catch the failure this screen has actually shipped: a page that renders
// NOTHING, or renders the same thing twice, while every text assertion passes.
// Home was rebuilt as a drawing — a full-bleed band, two columns, rows of cards —
// and the first pass of that rebuild left the OLD masthead in the tree beside the
// new band, so the page opened with two clocks and every source assertion in this
// file would still have passed. The markup is what is read here.
//
// WHAT IT IS FOR, in the order the failures matter:
//
//   1. THE BAND. It holds the letterhead and the clock; the clock is INSIDE it,
//      there is exactly ONE of them, and the band comes before the body.
//   2. THE ACTION. One gold plate, drawn as Home's own `.ir-home-cta` carrying
//      the pen-and-report mark — not a `.ir-submit` bar wearing a Home class.
//   3. THE DRAFTS. DRAFTS ONLY (the head says so), one card each, each with its
//      number, its type, its date, the officer who recorded it, a way in and a
//      menu — and a row whose account is gone still renders without the second
//      meta line rather than an empty one.
//   4. THE REMINDER, with its three items and the office's own closing line.
//   5. THE SIGNATURE BAND, with both seals, read from lib/appInfo.
//   6. THE GRID IS GONE: Home no longer draws the animated backdrop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './renderHarness.mjs';
import { STATION } from '../../src/lib/appInfo.js';

const load = () => loadFixture('tests/fixtures/homeWelcome.jsx');

test('the page opens on the band, and the band carries the clock exactly once', async () => {
  const { renderHome, USER } = await load();
  const html = renderHome();

  // The band, and the letterhead in it.
  const bandAt = html.indexOf('ir-home-hero');
  assert.notEqual(bandAt, -1, 'the hero band is gone');
  for (const part of [
    'ir-home-hero-kicker',
    'ir-home-hero-wordmark',
    'ir-home-hero-mark',
    'ir-home-hero-sub',
    'ir-home-hero-scrim',
  ]) {
    assert.ok(html.includes(part), `${part} is missing from the band`);
  }
  assert.match(html, /Welcome to/, 'the band lost its kicker');
  assert.match(html, /BLUE<em>WRITE<\/em>/, 'the band lost the wordmark');
  assert.match(html, /AI-Assisted Police Incident Reporting/, 'the band lost the sub line');
  // The station's promise line was taken off the band (owner request): the band
  // must not carry it back.
  assert.doesNotMatch(html, /Smarter\. Faster\. More Reliable\./, "the band still carries the station's own line");

  // THE CLOCK IS ON THE BAND, IS NOT A LIVE REGION, AND THERE IS ONE OF IT. The
  // count is the assertion that matters: a rebuild that leaves the old masthead
  // beside the new band is a page with two clocks, and the second one is reading
  // a different second from the first.
  assert.equal(
    html.split('ir-hero-clock-time').length - 1,
    1,
    'Home draws more than one clock',
  );
  const clockAt = html.indexOf('ir-hero-clock-time');
  const bandEnd = html.indexOf('</section>', bandAt);
  assert.ok(clockAt > bandAt && clockAt < bandEnd, 'the clock is not inside the band');
  // The date and the zone are separate lines, so the zone can be read without
  // reading past the date. The gold mark is GONE (owner request, 2026-10-07):
  // the readout alone states the clock on the band.
  assert.ok(!html.includes('ir-hero-clock-mark'), 'the clock still draws its mark');
  assert.ok(html.includes('ir-hero-clock-zone'), 'the clock lost the zone line');
  assert.match(html, /Philippine Standard Time/, 'the zone is not stated');
  assert.doesNotMatch(html, /aria-live/, 'a ticking clock is not a live region');
  assert.ok(!html.includes('ir-hero-wordmark'), 'the OLD masthead is still in the tree');

  // The body follows the band.
  assert.ok(html.indexOf('ir-home-body') > bandEnd, 'the body does not follow the band');

  // And the band was NOT built from the officer's own name: the identity is in
  // the top bar and the profile menu, and the letterhead is the STATION's. The
  // fixture's drafts carry the same name, so this is asserted on the source
  // instead (homeClock.test.mjs), where the two can be told apart.
  assert.equal(USER.full_name, 'Shaine', 'the fixture no longer carries the officer other tests read');
});

test('the action is one gold plate, and it is Home’s own control', async () => {
  const { renderHome } = await load();
  const html = renderHome();

  assert.equal(html.split('ir-home-cta"').length - 1, 1, 'Home draws more or fewer than one action');
  // It is NOT a `.ir-submit` bar with a Home class on it any more: the submit bar
  // is a full-width commit control on the report screen, and Home's plate is its
  // own object with its own fill.
  assert.doesNotMatch(
    /class="[^"]*ir-home-cta[^"]*"/.exec(html)[0],
    /ir-submit/,
    'the action inherited the submit bar',
  );

  // The banner states it three times over — the register this reporting is in,
  // the act, and what the officer brings to it.
  for (const part of ['ir-home-banner-kicker', 'ir-home-banner-title', 'ir-home-banner-note']) {
    assert.ok(html.includes(part), `${part} is missing from the action banner`);
  }
  assert.match(html, /AI-Assisted Reporting/, 'the banner lost its kicker');
  assert.match(html, /Create a Report with AI Assist/, 'the banner lost its title');
  assert.match(html, /Describe the incident\. AI helps structure it\./, 'the banner lost its note');
  // …and the control names the act, not the tool it uses to do it.
  assert.match(html, /ir-home-cta-text">Start with AI</, 'the action lost its label');

  // The mark is the pen-and-report file-pen, inlined — and it is not the plain
  // page the app draws for a report that already exists.
  const actionAt = html.indexOf('class="ir-home-cta"');
  const action = html.slice(actionAt, html.indexOf('</button>', actionAt));
  assert.doesNotMatch(action, /<svg|<img|ir-home-cta-glyph|ir-home-cta-arrow/, 'Start with AI still draws icons');
  // EVERY MARK ON THIS PAGE IS DRAWN, with four exceptions, and all four are the
  // station's own artwork files: the two seals in the signature band, the office's
  // mark beside the wordmark, and the folder on the action banner. (MY
  // REGISTER's heading carries no mark any more — the reference card opens
  // straight on the tiles; see homeCta.test.mjs.) Nothing here is fetched from
  // anywhere, and nothing else may become an image unnoticed.
  const imgs = html.match(/<img[^>]*>/g) ?? [];
  assert.equal(imgs.length, 4, 'Home draws a different number of images');
  for (const img of imgs) {
    assert.match(
      img,
      /ir-home-footer-seal|ir-home-hero-mark|ir-home-banner-mark/,
      'Home draws an image that is not the station’s own artwork',
    );
  }
  const folder = imgs.filter((img) => img.includes('ir-home-banner-mark'));
  assert.equal(folder.length, 1, 'the action banner lost the office’s folder mark');
  assert.match(folder[0], /alt=""/, 'the banner’s mark is not stated as decorative');
  assert.doesNotMatch(folder[0], /<svg/, 'the banner’s mark is drawn rather than the office’s own file');
  // The reminder's heading no longer wears the shield (gone by request) — the
  // heading is the word alone, so no image may carry its class again.
  assert.equal(
    imgs.filter((img) => img.includes('ir-remember-title-mark-art')).length,
    0,
    'the reminder’s heading draws the shield again',
  );
  // The lockup's mark is the office's own logo, and it is DECORATIVE: it sits
  // beside the wordmark, which already says the name, so it takes an empty alt
  // rather than repeating it to a screen reader.
  const marks = imgs.filter((img) => img.includes('ir-home-hero-mark'));
  assert.equal(marks.length, 1, 'the band lost the office’s own mark');
  assert.match(marks[0], /alt=""/, 'the band’s mark is not stated as decorative');
  assert.doesNotMatch(marks[0], /<svg/, 'the band’s mark is drawn rather than the office’s own file');
});

test('the drafts section lists DRAFTS, as cards with a way in and a menu', async () => {
  const { renderHome, DRAFTS, MIXED } = await load();
  const html = renderHome();

  assert.match(html, /Recent drafts/, 'the section lost its head');
  assert.ok(html.includes('ir-home-drafts-all'), 'the way to the register is gone');
  assert.match(html, /View all/, 'the way out lost its label');

  // One card per draft, in the order the shell sent them.
  assert.equal(html.split('class="ir-draft-card').length - 1, DRAFTS.length, 'a draft is missing a card');
  const first = html.indexOf('BW-0324');
  const second = html.indexOf('BW-0323');
  assert.ok(first !== -1 && second !== -1, 'the record numbers are gone');
  assert.ok(first < second, 'the newest draft must lead');

  // Each card carries: the mark, the identity (number with its facts beside it),
  // what it is about, its whole-field way in, its menu and its progress strip.
  for (const part of [
    'draft-folder',
    'ir-draft-identity',
    'ir-draft-row',
    'ir-draft-no',
    'ir-draft-type',
    'ir-draft-meta',
    'ir-draft-kind',
    'ir-draft-face',
    'ir-draft-more',
    'ir-draft-progress',
  ]) {
    assert.ok(html.includes(part), `${part} is missing from the draft card`);
  }
  assert.equal(html.split('class="ir-draft-face"').length - 1, DRAFTS.length, 'a card lost its way in');
  assert.equal(html.split('class="ir-draft-more"').length - 1, DRAFTS.length, 'a card lost its menu');
  // The DRAFT badge above the ID is gone (owner request, 2026-10-06): the card
  // states its state no more, only its number, its facts and its type.
  assert.doesNotMatch(html, /class="badge draft">draft</, 'the card still draws the status pill');
  assert.match(html, /Rape \/ Sexual Assault/, 'the card lost the incident type');
  assert.match(html, /Sep 30, 2026/, 'the card lost the date');
  assert.match(html, /Shaine/, 'the card lost the officer who recorded it');

  // THE SENSITIVE PILL, on the card that has one: the sensitive types are the
  // station's own list (SENSITIVE_TYPES), and the second fixture draft is not one
  // — so exactly one pill is drawn, which is what keeps it a fact about the
  // record rather than a decoration on every card.
  assert.equal(html.split('ir-draft-sensitive').length - 1, 1, 'the sensitive card lost its pill');
  // …and on the RIGHT card: the first card's own slice holds it, and the second
  // card's does not. Asserted on the markup rather than on the count alone,
  // because one pill on the wrong record is the failure a count cannot see.
  const firstCardAt = html.indexOf('class="ir-draft-card');
  const secondCardAt = html.indexOf('class="ir-draft-card', firstCardAt + 1);
  const firstCard = html.slice(firstCardAt, secondCardAt);
  const secondCard = html.slice(secondCardAt);
  assert.ok(firstCard.includes('ir-draft-sensitive'), 'the sensitive pill is not on the sensitive record');
  assert.ok(firstCard.includes('BW-0324'), 'the cards are no longer in the order the shell sent them');
  assert.ok(!secondCard.includes('ir-draft-sensitive'), 'the pill is on a record whose type is not sensitive');

  // THE PROGRESS STRIP, in the API's words: the label, the count, and a bar
  // whose width IS the fraction of the count. Read from the fixtures' own tallies
  // (3 of 5 and 1 of 5), so a bar that stops following its number fails here.
  assert.match(html, />Draft progress</, 'the strip lost its label');
  assert.match(html, />3 of 5 sections</, 'the strip lost the tally the API derived');
  assert.match(html, /--ir-draft-fill:60%/, 'the bar is not the fraction of the tally');
  assert.match(html, /--ir-draft-fill:20%/, 'the second card’s bar is not its own tally');
  // The bar is decoration; the numbers are the fact (the strip's own comment in
  // the stylesheet says so). A `progressbar` role here would announce the same
  // number a second time.
  assert.equal(html.split('ir-draft-progress-track" aria-hidden="true"').length - 1, DRAFTS.length, 'the track is announced to a screen reader');

  // The kebab is the only unlabelled control on the page, so it carries its own
  // name — and it is a menu, not a link.
  assert.match(
    html,
    /class="ir-draft-more"[^>]*aria-label="Actions for report BW-0324"/,
    'the card menu has no accessible name',
  );

  // THE WHOLE CARD IS THE WAY IN (owner request, 2026-10-06): the Continue
  // button is gone and the card face is one button that opens the record.
  assert.doesNotMatch(html, /ir-draft-go/, 'the Continue button is still drawn');
  const mixed = renderHome({ reports: MIXED });
  assert.equal(
    mixed.split('class="ir-draft-card').length - 1,
    2,
    'the drafts section drew a report that is not a draft',
  );
  assert.ok(!mixed.includes('BW-0322') && !mixed.includes('BW-0321'), 'a non-draft reached the list');

  // A row whose account has gone renders WITHOUT the second meta line rather
  // than with an empty one.
  const orphan = renderHome({ reports: [{ ...DRAFTS[0], id: 325, created_by_name: null }] });
  assert.equal(
    orphan.split('ir-draft-meta-line').length - 1,
    1,
    'a missing officer renders an empty line instead of none',
  );
});

test('the reminder card is MY REGISTER: the totals and the type bars', async () => {
  const { renderHome } = await load();
  const html = renderHome();

  assert.ok(html.includes('ir-remember'), 'the reminder card is gone');
  // MY REGISTER (owner request, 2026-10-07): the advice list became the
  // officer's own numbers, and the title says so.
  assert.match(html, /My register/i, 'the card lost its title');
  assert.ok(!html.includes('ir-remember-title-mark'), 'the reminder heading drew a mark again');

  // THE TWO TILES, from the ONE tally: total reports, then the finalized count.
  // The fixture's TALLY holds 7 reports, 3 of them drafts — asserted here so a
  // computation that drifted from the tally cannot pass unseen.
  //
  // THE SECOND TILE IS THE SENT WORK (owner request, 2026-10-13: "change the
  // drafts to finalized"): it used to state the drafts, which made the card's
  // two numbers overlap, and it is now the complement of the total — so 7 and 4
  // here, and the pair always adds up.
  const statsAt = html.indexOf('ir-remember-stats');
  const stats = html.slice(statsAt, html.indexOf('</dl>', statsAt));
  assert.match(stats, /Total reports/, 'the card lost its total tile');
  assert.match(stats, /Finalized/, 'the card lost its finalized tile');
  assert.doesNotMatch(stats, /Drafts/, 'the card still states the drafts');
  assert.match(stats, /<dd class="ir-remember-stat-num">7<\/dd>/, 'the total is not the tally\'s sum');
  assert.match(
    stats,
    /<dd class="ir-remember-stat-num">4<\/dd>/,
    'the finalized count is not the tally\'s remainder (7 written, 3 still drafts)',
  );

  // THE BAR GRAPH: only the three largest types, largest first, each carrying
  // its count as the fact the bar decorates — no scroll, no "Other" row.
  const barsAt = html.indexOf('ir-remember-bars-list');
  const bars = html.slice(barsAt, html.indexOf('</ul>', barsAt));
  assert.match(html, /Incident Report Frequency/, 'the bar graph lost its label');
  assert.equal(bars.split('class="ir-remember-bar"').length - 1, 3, 'the graph is not the top three types');
  assert.match(bars, /Rape \/ Sexual Assault/, 'the graph lost a type');
  assert.match(bars, /Theft/, 'the graph lost a type');
  assert.ok(!bars.includes('Robbery'), 'the graph shows more than the top three types');
  for (const count of ['2', '1', '3']) {
    assert.match(bars, new RegExp(`ir-remember-bar-count">${count}</span>`), `the graph lost a count (${count})`);
  }
  // The bars' widths are the counts against the largest, set from the
  // component: the 3 is full, the 1s are a third.
  assert.match(bars, /--ir-remember-fill:100%/, 'the largest bar is not full');
  assert.match(bars, /--ir-remember-fill:33%/, 'a one-report bar is not a third of the largest');

  // THE TILES OPEN THE CARD AND THE GRAPH CLOSES IT (owner request,
  // 2026-10-08): the two numbers are the first thing in the card, and the
  // frequency panel stands under them.
  assert.ok(
    html.indexOf('ir-remember-stats') < html.indexOf('ir-remember-bars-list'),
    'the graph is drawn above the tiles again',
  );

  // The loading state renders dashes, not zeroes — a clock that has not read
  // yet is not a register with nothing in it.
  const loading = renderHome({ tally: null });
  assert.match(loading, /<dd class="ir-remember-stat-num">—<\/dd>/, 'loading does not render the em-dash state');
  assert.ok(!loading.includes('ir-remember-bars-list'), 'loading draws bars for a tally it does not have');

  // The office's closing line is GONE with the head band (owner request,
  // 2026-10-07): the reference card closes on its foot band, not on a sentence.
  assert.ok(!html.includes('Sa Bagong Pilipinas'), 'the reminder still carries the office’s closing line');

  // The reminder is the SECOND column of the body, after the work.
  assert.ok(
    html.indexOf('ir-remember') > html.indexOf('ir-home-main'),
    'the reminder is not in the body beside the work',
  );
});

test('the page closes on the signature band, and the grid backdrop is gone', async () => {
  const { renderHome } = await load();
  const html = renderHome();

  const footAt = html.indexOf('ir-home-footer');
  assert.notEqual(footAt, -1, 'the signature band is gone');
  assert.ok(footAt > html.indexOf('ir-remember'), 'the signature is not the last block');
  assert.equal(html.split('class="ir-home-footer-seal"').length - 1, 2, 'the band lost a seal');
  assert.match(html, /alt="PNP seal"/, 'the PNP seal has no alt text');
  assert.match(html, /alt="City of Naga Police Station seal"/, 'the city seal has no alt text');
  // The station is read from its one home, so the band cannot drift from it.
  assert.ok(
    html.includes(`${STATION} · BlueWrite`),
    'the signature line changed shape',
  );

  // NO GRID: Home's animated backdrop is no longer mounted. It is the one thing
  // this page could go on rendering without any other assertion noticing, and it
  // would sit behind a navy band and two white cards.
  assert.ok(!html.includes('home-grid'), 'Home still draws the grid backdrop');
  // The requested galaxy is local to the folder mark, not a page backdrop.
  assert.equal(html.split('<canvas').length - 1, 1, 'Home must draw only the folder galaxy canvas');
  assert.match(html, /class="ir-home-banner-icon"[^>]*>[\s\S]*?<span[^>]*class="ir-home-banner-galaxy"[^>]*aria-hidden="true"[^>]*>[\s\S]*?<canvas[^>]*class="spiral-galaxy-canvas"[^>]*>[\s\S]*?<img[^>]*class="ir-home-banner-mark"/, 'the galaxy is not behind the folder inside its circle');
});

test('a quiet week and a slow read both state themselves', async () => {
  const { renderHome, DRAFTS } = await load();

  // No drafts: the section says what it is, rather than "no reports" on a page
  // whose head is "Recent drafts".
  const empty = renderHome({ reports: [] });
  assert.match(empty, /No drafts right now/, 'the empty state does not name the section');
  assert.equal(empty.split('class="ir-draft-card').length - 1, 0, 'an empty list drew cards');
  assert.ok(!empty.includes('ir-draft-face'), 'an empty list drew a way in');

  // Loading: the list is not drawn at all, so nothing claims there are no drafts
  // while the answer is still in flight.
  const loading = renderHome({ loading: true, reports: [] });
  assert.match(loading, /Loading your reports/, 'the loading state says nothing');
  assert.equal(loading.split('class="ir-draft-card').length - 1, 0, 'the loading state drew cards');

  // A row with NO tally draws no strip, rather than a bar with no number behind
  // it — the shape a payload from a build that predates the read-out arrives in.
  const untallied = renderHome({ reports: [{ ...DRAFTS[0], progress: undefined }] });
  assert.ok(!untallied.includes('ir-draft-progress'), 'a card with no tally still drew a bar');
  assert.ok(untallied.includes('ir-draft-face'), 'the rest of the card was dropped with the strip');
});
