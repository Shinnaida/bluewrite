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
import { APP_VERSION, STATION } from '../../src/lib/appInfo.js';

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
    'ir-home-hero-lead',
    'ir-home-hero-scrim',
  ]) {
    assert.ok(html.includes(part), `${part} is missing from the band`);
  }
  assert.match(html, /Welcome to/, 'the band lost its kicker');
  assert.match(html, /BLUE<em>WRITE<\/em>/, 'the band lost the wordmark');
  assert.match(html, /AI-Assisted Police Incident Reporting/, 'the band lost the sub line');
  assert.match(html, /Smarter\. Faster\. More Reliable\./, "the band lost the station's own line");

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
  // reading past the date; and the mark is the clock's own.
  assert.ok(html.includes('ir-hero-clock-mark'), 'the clock lost its mark');
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
  assert.match(html, /M12\.659 22H18a2 2 0 0 0 2-2V8/, 'the action lost its file-pen mark');
  // EVERY MARK ON THIS PAGE IS DRAWN, with three exceptions, and they are the
  // station's own artwork files: the two seals in the signature band, and the
  // office's mark beside the wordmark. Nothing here is fetched from anywhere, and
  // nothing else may become an image unnoticed.
  const imgs = html.match(/<img[^>]*>/g) ?? [];
  assert.equal(imgs.length, 3, 'Home draws a different number of images');
  for (const img of imgs) {
    assert.match(
      img,
      /ir-home-footer-seal|ir-home-hero-mark/,
      'Home draws an image that is not the station’s own artwork',
    );
  }
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
  assert.equal(html.split('class="ir-draft-row').length - 1, DRAFTS.length, 'a draft is missing a row');
  const first = html.indexOf('BW-0324');
  const second = html.indexOf('BW-0323');
  assert.ok(first !== -1 && second !== -1, 'the record numbers are gone');
  assert.ok(first < second, 'the newest draft must lead');

  // Each row carries: the mark, the state pill, the number, the type, when it
  // happened, who recorded it, a way in and a menu.
  for (const part of [
    'ir-draft-plate',
    'ir-draft-main',
    'ir-draft-no',
    'ir-draft-type',
    'ir-draft-meta',
    'ir-draft-go',
    'ir-draft-more',
  ]) {
    assert.ok(html.includes(part), `${part} is missing from the draft row`);
  }
  assert.equal(html.split('class="ir-draft-go"').length - 1, DRAFTS.length, 'a row lost its way in');
  assert.equal(html.split('class="ir-draft-more"').length - 1, DRAFTS.length, 'a row lost its menu');
  assert.match(html, /class="badge draft">draft</, 'the row lost the shared status pill');
  assert.match(html, /Rape \/ Sexual Assault/, 'the row lost the incident type');
  assert.match(html, /Sep 30, 2026/, 'the row lost the date');
  assert.match(html, /Shaine/, 'the row lost the officer who recorded it');

  // The kebab is the only unlabelled control on the page, so it carries its own
  // name — and it is a menu, not a link.
  assert.match(
    html,
    /class="ir-draft-more"[^>]*aria-label="Actions for report BW-0324"/,
    'the row menu has no accessible name',
  );

  // A DRAFT says Continue; anything else says Open. A button promising to
  // "continue" a submitted report would be promising an edit it cannot make.
  assert.match(html, /class="ir-draft-go">Continue/, 'a draft does not offer Continue');
  const mixed = renderHome({ reports: MIXED });
  assert.equal(
    mixed.split('class="ir-draft-row').length - 1,
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

test('the reminder is the aside, with its three items and the office’s line', async () => {
  const { renderHome } = await load();
  const html = renderHome();

  assert.ok(html.includes('ir-remember'), 'the reminder card is gone');
  assert.match(html, /Remember/i, 'the reminder lost its title');
  // The heading's own mark, on the gold tile the stylesheet gives it (see the
  // half of homeCta.test.mjs that owns the card's colours) — and it is not one of
  // the three items, which is why it is counted separately below.
  assert.ok(html.includes('ir-remember-title-mark'), 'the reminder heading lost its mark');
  assert.equal(html.split('ir-remember-mark').length - 1, 3, 'the reminder is not three items');
  // Three ITEMS — asserted inside the list itself, so a fourth line somewhere
  // else on the page cannot stand in for a missing one.
  const listAt = html.indexOf('ir-remember-list');
  const list = html.slice(listAt, html.indexOf('</ul>', listAt));
  assert.equal(list.split('<li>').length - 1, 3, 'the reminder list is the wrong length');
  // Each sentence carries the phrase it turns on in <strong> — the card's design
  // states what the officer is meant to carry away, and the text inside the
  // emphasis is asserted with the sentence rather than separately, so the two
  // cannot drift apart.
  assert.match(
    list,
    /Keep your information <strong>accurate and complete<\/strong>\./,
    'the reminder lost its first item',
  );
  assert.match(
    list,
    /Your report helps ensure a <strong>faster and safer response<\/strong>\./,
    'the reminder lost its second item',
  );
  assert.match(
    list,
    /contact your <strong>local police station<\/strong> immediately\./,
    'the reminder lost its third item',
  );
  // The office speaks last, and the line is the station's, not the system's.
  assert.match(
    html,
    /Sa Bagong Pilipinas, Mas Ligtas ang Bawat Isa\./,
    'the reminder lost the office’s closing line',
  );

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
  // Both facts are read from their one home, so the band cannot advertise a
  // version the system no longer is.
  assert.ok(
    html.includes(`${STATION} · BlueWrite v${APP_VERSION}`),
    'the signature line changed shape',
  );

  // NO GRID: Home's animated backdrop is no longer mounted. It is the one thing
  // this page could go on rendering without any other assertion noticing, and it
  // would sit behind a navy band and two white cards.
  assert.ok(!html.includes('home-grid'), 'Home still draws the grid backdrop');
  assert.ok(!html.includes('<canvas'), 'a canvas is still mounted on Home');
});

test('a quiet week and a slow read both state themselves', async () => {
  const { renderHome } = await load();

  // No drafts: the section says what it is, rather than "no reports" on a page
  // whose head is "Recent drafts".
  const empty = renderHome({ reports: [] });
  assert.match(empty, /No drafts right now/, 'the empty state does not name the section');
  assert.equal(empty.split('class="ir-draft-row').length - 1, 0, 'an empty list drew rows');
  assert.ok(!empty.includes('ir-draft-go'), 'an empty list drew a Continue button');

  // Loading: the list is not drawn at all, so nothing claims there are no drafts
  // while the answer is still in flight.
  const loading = renderHome({ loading: true, reports: [] });
  assert.match(loading, /Loading your reports/, 'the loading state says nothing');
  assert.equal(loading.split('class="ir-draft-row').length - 1, 0, 'the loading state drew rows');
});
