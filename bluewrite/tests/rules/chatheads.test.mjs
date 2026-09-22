// BlueWrite — the presence rail, rendered for real.
//
// THE ONE TEST IN tests/rules THAT RUNS THE COMPONENT. The rest of them read source
// as text, which is a real method with a real blind spot: a component that throws
// while painting, or paints the wrong shape, passes all of them. That blind spot has
// already cost this project two shipping bugs in the categories panel.
//
// So this file bundles tests/fixtures/chatheadRender.jsx with esbuild — the bundler
// Vite already ships — and renders ChatheadRail through react-dom/server, then reads
// the markup. No browser, no jsdom, no new dependency: react-dom and esbuild are both
// already installed.
//
// WHAT IT CANNOT CHECK, stated plainly: effects. renderToString does not run them, so
// the heartbeat, the ticker and the dismissal listeners are invisible here. Those
// live in the Chatheads wrapper, and the rules they apply (ageRoster, chatheadTitle,
// onDutyLabel, isSelf) are covered by presence.test.mjs. This file covers the drawing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { ROOT as root, loadFixture } from './renderHarness.mjs';

/** The rail's render fixture — see renderHarness.mjs for why it has to be bundled. */
const loadRail = () => loadFixture('tests/fixtures/chatheadRender.jsx');

test('the rail paints every colleague it is handed, and never the session itself', async () => {
  const { renderRail } = await loadRail();
  const html = renderRail();

  // THREE accounts in the roster, TWO circles out. The third is the session's own
  // account, which the server correctly reports and the rail correctly does not
  // draw: an officer's own face in their own rail is a circle that can never be
  // acted on, sitting in the slot nearest the corner.
  assert.equal((html.match(/class="dash-chathead"/g) || []).length, 2);
  assert.doesNotMatch(html, /Maria Santos/);
  // Not even as initials — that is what a rail drawing the wrong list would print.
  assert.doesNotMatch(html, />MS</);

  // The group's accessible name states the count, since the circles do not.
  assert.match(html, /aria-label="2 colleagues online"/);
  // One dot per face, and never announced: the dot is decoration over a fact that
  // is already in the button's label.
  assert.equal((html.match(/dash-chathead__dot/g) || []).length, 2);
  assert.equal((html.match(/dash-chathead__dot" aria-hidden="true"/g) || []).length, 2);
});

test('a station with one officer signed in draws no rail at all', async () => {
  const { renderRail } = await loadRail();

  // The common case, and the one that used to look wrong: everybody but you is
  // nobody, so there is nothing to draw. It is filtered BEFORE the empty check, so
  // the rail does not hand the officer their own face back as a consolation.
  assert.equal(renderRail({ online: [{ id: 7, full_name: 'Maria Santos', role: 'Admin' }] }), '');
});

test('somebody else\u2019s face is drawn whether or not this account can be matched', async () => {
  const { renderRail } = await loadRail();

  // `withoutSelf` can only identify self by id. With no id to compare against it
  // filters nobody rather than filtering by accident — a roster that over-shows a
  // colleague is the right way round, and a rail that emptied itself because the
  // session was shaped unexpectedly would be the wrong one.
  assert.match(renderRail({ online: [{ id: 11, full_name: 'Elena Ramos', role: 'Officer' }] }), /Elena Ramos/);
});

test('a photograph is an image with only that face, not the initials too', async () => {
  const { renderRail } = await loadRail();
  const html = renderRail();

  // Exactly one colleague has a photograph, so exactly one <img> — and it is marked
  // decorative, because the button already carries the name.
  assert.equal((html.match(/<img/g) || []).length, 1);
  assert.match(html, /src="\/api\/v1\/users\/9\/photo\?v=9"/);
  assert.match(html, /alt=""/);
  // And no initials beside it: a face is one or the other, never both.
  assert.doesNotMatch(html, />JD</);

  // The officer with no photo gets initials — "ER" for Elena Ramos, not the whole
  // name collapsed into one glyph.
  assert.match(html, />ER</);
});

test('every circle announces who it is, and is a control that opens a conversation', async () => {
  const { renderRail } = await loadRail();
  const html = renderRail();

  // The accessible name is the same sentence as the tooltip: who, what, and how
  // long since they were last seen.
  const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labels.includes('Juan Dela Cruz — Senior Officer · active 2m ago'), labels.join(' | '));
  assert.ok(labels.includes('Elena Ramos — Officer · active just now'), labels.join(' | '));

  // EVERY CIRCLE IS A BUTTON, and a button is what makes the rail a doorway rather
  // than a display: two colleagues on the roster, two controls. The session's own
  // account is not one of them, because it is not drawn.
  assert.equal((html.match(/<button type="button" class="dash-chathead"/g) || []).length, 2);
});

test('there is no officer card left to open, and no state that could expand one', async () => {
  const { renderRail } = await loadRail();
  const src = await readFile(path.join(root, 'src/components/Chatheads.jsx'), 'utf8');

  // The card was two clicks to reach the conversation: press the face, read a panel
  // of facts, press Message. Everything it carried is in the thread head the press
  // now leads to, in the circle's own tooltip, or in its accessible name — so the
  // card, its markup and the state that opened it are all gone rather than left
  // behind as a second way in.
  const html = renderRail();
  assert.doesNotMatch(html, /dash-chathead__card/);
  assert.doesNotMatch(html, /dash-chathead__message/);
  assert.doesNotMatch(html, /aria-expanded/); // …except the overflow chip, below
  assert.doesNotMatch(html, /aria-controls/);

  // The rail holds no open/closed state for a circle: nothing is passed in and
  // nothing is remembered here, so there is no way for a card to come back as a
  // decoration on top of the conversation it opens.
  assert.doesNotMatch(src, /openId/);
  assert.doesNotMatch(src, /onToggle/);
  assert.doesNotMatch(src, /__card/);
  // And with the card gone, the rail no longer needs a clock of its own for it: the
  // age of a colleague is stated in the tooltip by chatheadTitle, which is the rule
  // already covered in presence.test.mjs. Checked on the IMPORTS rather than the whole
  // file, because the file's own comments name both of those functions while explaining
  // why they are not needed here.
  assert.doesNotMatch(src, /import \{\s*relativeAge\s*\} from '\.\.\/lib\/notifications\.js';/);
  assert.doesNotMatch(src, /^\s*onDutyLabel,$/m);
  assert.doesNotMatch(src, /^\s*relativeAge,$/m);
});

test('the whole dossier is in the accessible name, since there is no card to read', async () => {
  const { renderRail } = await loadRail();
  const html = renderRail();

  // With the card gone, the LABEL is the only place a colleague's facts live before
  // the press — name, role, how long since they moved, how long since they signed in
  // — and chartheadTitle builds it from the same rules presence.test.mjs covers.
  const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labels.includes('Juan Dela Cruz — Senior Officer · active 2m ago'), labels.join(' | '));
  assert.ok(labels.includes('Elena Ramos — Officer · active just now'), labels.join(' | '));
  // The same sentence is the tooltip, so the pointer and the screen reader are told
  // the same thing rather than one getting more than the other.
  assert.equal((html.match(/title="Elena Ramos — Officer · active just now"/g) || []).length, 1);
});

test('an account with no age still gets a circle rather than being dropped', async () => {
  const { renderRail } = await loadRail();
  const html = renderRail();

  // Elena Ramos arrives with no idle_seconds and no login_age_seconds. The roster
  // rules in lib/presence.js keep her, and the label has to answer without the two
  // clauses it would normally print — a "signed in" age, and any duty line.
  assert.match(html, /Elena Ramos/);
  assert.match(html, /title="Elena Ramos — Officer · active just now"/);
  // No dangling separator where a fact is missing, and no stray clause either.
  assert.doesNotMatch(html, /Officer · active just now[^"]*·/);
  assert.doesNotMatch(html, /"[^"]*·\s*"/);
});

test('an empty roster draws nothing at all', async () => {
  const { renderEmpty } = await loadRail();

  // Not an empty shell — nothing. A floating sliver on the screen edge for a
  // station that is empty would be a permanent occupant of the workspace.
  assert.equal(renderEmpty(), '');
});

test('the design preview draws the invented roster, and says that it has', async () => {
  const { renderRail } = await loadRail();
  const html = renderRail({ preview: true, online: [], expanded: true });
  const cssInStyles = await readFile(path.join(root, 'src/styles.css'), 'utf8');

  // The preview ignores the live roster entirely (it is handed an empty one here) and
  // draws the cast in src/mock-chatheads.js instead — otherwise it could only ever be
  // seen on a station with a full shift signed in, which is what it exists to avoid.
  // Expanded, so this is all twelve; the collapsed rail is five plus a chip, below.
  assert.equal((html.match(/class="dash-chathead"/g) || []).length, 12);
  // A MOCK CIRCLE IS A REAL CONTROL, and it announces itself like one. It opens a
  // preview conversation (see mock-chatheads.js), so the name, the role and the age
  // are as useful to a screen reader here as they are on the live rail — a circle that
  // announced nothing would be a press with no stated destination.
  assert.match(html, /aria-label="Maria Santos — Officer · active just now"/);
  assert.equal((html.match(/<button type="button" class="dash-chathead"/g) || []).length, 12);
  // One of them has a photograph, the rest fall back to initials.
  assert.equal((html.match(/<img/g) || []).length, 1);
  assert.equal((html.match(/dash-chathead__face/g) || []).length, 12);

  // MARKED, WITHOUT A CAPTION. There used to be one above the circles and it has been
  // removed — but the marking itself is not gone, and that has to stay true: a mock that
  // looks exactly like the product is a screenshot somebody later believes, of officers
  // who do not exist. Two markers carry it now, and they are the two that survive the
  // ways a rail gets looked at — one cropped, one read aloud.
  assert.match(html, /class="dash-chatheads is-preview"/);
  // 1. The dashed ring on every face, asserted as the CLASS that draws it: this is the
  //    one that survives a crop, because it is in the image rather than beside it.
  assert.match(cssInStyles, /\.dash-chatheads\.is-preview \.dash-chathead \{ border-style: dashed; \}/);
  // 2. The group's own name, for anybody not looking at it.
  assert.match(html, /aria-label="Preview: 12 mock colleagues, not real presence"/);
  // And nothing else: the caption is gone from the markup and its rules are gone from
  // the stylesheet, so it cannot come back as dead CSS that a later edit re-attaches.
  assert.doesNotMatch(html, /dash-chatheads__preview/);
  assert.doesNotMatch(cssInStyles, /dash-chatheads__preview/);
});

test('the rail stops at five and offers the rest with a count', async () => {
  const { renderRail } = await loadRail();
  const html = renderRail();

  // Two colleagues on this roster, so no chip: the cap only speaks when it bites.
  assert.equal((html.match(/\+\d/g) || []).length, 0);

  const twelve = renderRail({ preview: true, online: [] });
  // TWELVE COLLEAGUES, FIVE CIRCLES, and one chip that says so. This replaced a
  // layout that drew all twelve by wrapping into a second column: the rail ran from
  // the corner to the middle of the dashboard, and NOTHING on screen said the list
  // had more in it. A cap that announces itself is honest about the truncation.
  assert.equal((twelve.match(/class="dash-chathead"/g) || []).length, 5);
  assert.equal((twelve.match(/dash-chathead__face/g) || []).length, 5);
  assert.match(twelve, /dash-chathead--more/);
  assert.match(twelve, /dash-chathead__more">\+7</);
  // It is a control, not a decoration: "there are more" is useless without "show me
  // them". Its label says the number out loud, because "+7" is not a word.
  assert.match(twelve, /aria-label="Show 7 more colleagues"/);
  assert.match(twelve, /aria-expanded="false"/);
  assert.match(twelve, /title="7 more online"/);

  // NOT A PERSON, and the markup has to keep saying so: no photograph, no initials,
  // no presence dot, and the count in the hint's own class.
  const chip = twelve.slice(twelve.indexOf('dash-chathead--more'));
  assert.equal((chip.match(/<img/g) || []).length, 0);
  assert.equal((chip.match(/dash-chathead__dot/g) || []).length, 0);
  assert.doesNotMatch(chip, /dash-chathead__face/);

  // THE BOUNDARY IS THE CAP, not one past it: a roster of exactly five is five
  // circles and no chip, because there is nothing being held back to announce.
  const five = renderRail({ online: [1, 2, 3, 4, 5].map((n) => ({ id: 900 + n, full_name: `Officer ${n}`, role: 'Officer' })) });
  assert.equal((five.match(/class="dash-chathead"/g) || []).length, 5);
  assert.doesNotMatch(five, /dash-chathead--more/);
});

test('pressing the chip unfolds the rest, and the control that opened it closes it', async () => {
  const { renderRail } = await loadRail();
  const html = renderRail({ preview: true, online: [], expanded: true });

  // Expanded, everybody is drawn and there is no "+N" left to press — the number
  // cannot outlive the truncation it was describing.
  assert.equal((html.match(/class="dash-chathead"/g) || []).length, 12);
  assert.doesNotMatch(html, />\+\d</);

  // The way back is a chip in the SAME place — the end of the drawn list — so the
  // control that opened the rail is the one that closes it and nothing moves.
  assert.match(html, /dash-chathead--more/);
  assert.match(html, /aria-label="Show fewer colleagues"/);
  assert.match(html, /aria-expanded="true"/);
  // It has no readable text of its own, which is why the label carries the meaning.
  assert.match(html, /dash-chathead__more" aria-hidden="true">/);
});

test('the preview roster is shaped like the payload it stands in for', async () => {
  const { MOCK_CHATHEADS } = await import('../../src/mock-chatheads.js');

  // A preview drawn from shapes the server cannot send is a design for a state this
  // system has no way to produce. The roles table holds three rows, and that is all.
  const roles = new Set(MOCK_CHATHEADS.map((p) => p.role));
  for (const role of roles) assert.ok(['Admin', 'Officer', 'Staff'].includes(role), role);
  assert.equal(roles.size, 3, 'every role should appear, so the card is seen at its longest');

  // users.badge_number is NOT NULL UNIQUE, so every real roster entry has one.
  for (const person of MOCK_CHATHEADS) {
    assert.ok(String(person.badge_number ?? '').length > 0, person.full_name);
    assert.ok(String(person.full_name ?? '').length > 0, 'a face with no name');
  }

  // Ids far above AUTO_INCREMENT, so a mock can never be mistaken for a real account
  // and `withoutSelf` filters none of them.
  assert.equal(new Set(MOCK_CHATHEADS.map((p) => p.id)).size, MOCK_CHATHEADS.length, 'duplicate id');
  assert.ok(MOCK_CHATHEADS.every((p) => p.id >= 9000), 'a mock id is in the range real accounts use');

  // More circles than `max-height` holds, so the preview shows the second column too.
  assert.ok(MOCK_CHATHEADS.length >= 11, 'too few to wrap');

  // The two states that are easy to forget while designing, and which the set exists
  // to keep visible: a photograph, and a row the server sent no ages for at all.
  assert.equal(MOCK_CHATHEADS.filter((p) => p.photo_url).length, 1);
  const ageless = MOCK_CHATHEADS.filter((p) => p.idle_seconds === undefined);
  assert.equal(ageless.length, 1);
  assert.equal(ageless[0].login_age_seconds, undefined);

  // A range of ages, so "just now" and a half-hour-old reading both appear — and a
  // name long enough to take the card's 232px onto a second line.
  const ages = MOCK_CHATHEADS.filter((p) => p.idle_seconds !== undefined).map((p) => p.idle_seconds);
  assert.ok(Math.min(...ages) < 45, 'nothing reads as "just now"');
  assert.ok(Math.max(...ages) > 1500, 'nothing reads as long enough ago to be interesting');
  assert.ok(MOCK_CHATHEADS.some((p) => p.full_name.length > 22), 'nothing long enough to wrap the card');
});

test('the preview cannot be reached from a built bundle', async () => {
  const chatheads = await readFile(path.join(root, 'src/components/Shell.jsx'), 'utf8');

  // THE PERMISSION, in one expression: a dev build AND a URL that has not said `off`.
  // `import.meta.env.DEV` is replaced with `false` by Vite at build time, so the mock
  // is unreachable in a shipped bundle whatever the query string says — whether the
  // default is on (dev) or not.
  assert.match(chatheads, /import\.meta\.env\.DEV && chatheadPreview\(window\.location\.search\)/);

  // THE GUARD IS NOT IN THE RAIL, and that is deliberate: the rail is rendered by a
  // test harness that has no Vite, so an `import.meta.env` read in it would crash
  // there — and the preview state would stop being checkable at all. It is now read a
  // level higher still, in Shell, because it decides the messages panel as well.
  const railSrc = await readFile(path.join(root, 'src/components/Chatheads.jsx'), 'utf8');
  const rail = railSrc.slice(railSrc.indexOf('export function ChatheadRail'), railSrc.indexOf('export default function Chatheads'));
  assert.doesNotMatch(rail, /import\.meta/);
  // The rail takes the flag as a prop instead.
  assert.match(rail, /preview = false,/);

  // And the mock data is imported in exactly one place in src/, so no screen can
  // start drawing invented officers by accident. Matching the QUOTED module path
  // rather than the bare word: prose that mentions the file — the note in
  // lib/presence.js, this test — is not an importer.
  const files = await readdir(path.join(root, 'src'), { recursive: true });
  const importers = [];
  for (const file of files) {
    if (!/\.(jsx?|mjs)$/.test(file)) continue;
    const source = await readFile(path.join(root, 'src', file), 'utf8');
    if (/mock-chatheads\.js['"]/.test(source)) importers.push(String(file).replace(/\\/g, '/'));
  }
  // EXACTLY TWO, and both are surfaces the preview flag governs: the rail draws the
  // invented roster, and the messages panel draws the invented conversations those
  // circles open. A third importer is how an invented officer ends up on a screen
  // nobody was thinking about — the dashboard, a report — so the list is asserted
  // rather than counted.
  assert.deepEqual(importers, ['components/Chatheads.jsx', 'components/MessagesPanel.jsx']);
});

test('the rail and the chatbox share one corner, at the theme\u2019s ink', async () => {
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
  const rule = css.slice(css.indexOf('.dash-chatheads {')).split('}')[0];
  const dock = css.slice(css.indexOf('.dash-dock {')).split('}')[0];

  // THE CORNER MOVED OFF THE RAIL, and that is the point of this test now. The corner
  // is owned by .dash-dock, which holds the rail AND the chatbox as one flex row with
  // the rail last — so the box is beside the rail whatever width the rail takes when it
  // wraps into a second column. The alternative was arithmetic on the rail's width, and
  // a number can only ever describe one of the rail's states.
  assert.match(dock, /position: fixed/);
  assert.match(dock, /right: 18px/);
  assert.match(dock, /bottom: 18px/);
  assert.match(dock, /flex-direction: row/);
  assert.match(dock, /align-items: flex-end/);
  // z-index 40 is the deliberate middle: above the workspace and its own chrome, below
  // the docked panels (the AI panel at 95, the profile panel at 96).
  assert.match(dock, /z-index: 40/);
  // The bottom anchor is the point: both hang UPWARD from the corner, so the thing
  // nearest it never moves as colleagues come and go. A `top: 50%` centring would drift
  // by half a circle every time somebody signed in.
  assert.doesNotMatch(dock, /top:/);

  // And the rail itself no longer positions anything: a second element anchoring itself
  // at the same corner would be two answers to one question.
  assert.match(rule, /position: relative/);
  assert.doesNotMatch(rule, /position: fixed/);
  assert.doesNotMatch(rule, /right:/);
  assert.doesNotMatch(rule, /bottom:/);

  // NO `overflow` ON THE RAIL, and it is a rule about the CAP rather than about a card
  // that used to hang off it: `overflow` would turn the five-circle cap into a
  // scrollbar, and the whole point of the cap is that a colleague is never scrolled off
  // the edge. There is still no `transform` either — a transformed ancestor is the
  // containing block for positioned descendants, which is what would trap the preview
  // caption pinned above the rail.
  assert.doesNotMatch(rule, /overflow/);
  assert.doesNotMatch(rule, /transform/);
  // The height is capped on the LIST instead, where `max-height` can never clip.
  const list = css.slice(css.indexOf('.dash-chatheads__list {')).split('}')[0];
  assert.match(list, /max-height: min\(72vh, 540px\)/);
  // Out of height means a second column to the left, not a hidden tail.
  assert.match(list, /flex-wrap: wrap-reverse/);
  assert.doesNotMatch(list, /overflow/);

  // THE RAIL HARD-CODES NO COLOUR AT ALL, which is one step further than it used to go.
  // It previously allowed itself a white literal for the initials on the navy face; the
  // face no longer paints itself, because it takes the same gradient the top bar, the
  // message list and the profile panel take (see .bw-avatar), and that pair is measured
  // against white in both themes. So the rule is now simply: every ink in the rail comes
  // from a token, and the ONE exception this test used to carve out is gone rather than
  // widened. A literal here would look right in the theme it was written in and vanish in
  // the other — which is exactly the bug this rail was built to avoid.
  const railCss = css.slice(css.indexOf('.dash-chatheads {'), css.indexOf('.dash-chathead--more {'));
  const literals = railCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(literals, [], 'the rail may hard-code no colour at all');
  assert.doesNotMatch(railCss, /\brgba?\(/);
  // And the face is sized here and coloured nowhere: painting it in this file is what
  // would let one rail's officer have different initials to the same officer in the bar.
  const face = css.slice(css.indexOf('.dash-chathead__face {')).split('}')[0];
  assert.doesNotMatch(face, /background/, 'the face takes its gradient from .bw-avatar');
  assert.doesNotMatch(face, /color:/);
  assert.match(face, /width: 44px/);

  // THE CIRCLES ARE MADE OF THE BOX'S OWN SURFACES, which is the other half of "one
  // corner". In light both are the same white and the same hairline they always were; in
  // dark the window is a navy tint, and a circle cut out of the page's graphite beside it
  // is a second surface that merely happens to be adjacent. The dot's ring is the same
  // token as the plate for a related reason — a ring a shade off the plate behind it draws
  // a visible seam around the presence dot.
  const circle = css.slice(css.indexOf('.dash-chathead {')).split('}')[0];
  assert.match(circle, /border: 2px solid var\(--msg-line\)/);
  assert.match(circle, /background: var\(--msg-surface\)/);
  const dot = css.slice(css.indexOf('.dash-chathead__dot {')).split('}')[0];
  assert.match(dot, /border: 2px solid var\(--msg-surface\)/);
});

test('the rail shifts clear of both docked panels, and yields on a narrow screen', async () => {
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');

  // The two docked panels reserve the right edge with their own width variables; the
  // CORNER reads the SAME variables, so the two cannot disagree about where the right
  // edge is and end up with a circle on a form.
  assert.match(css, /body\.profile-panel-open \.dash-dock \{ right: calc\(18px \+ var\(--profile-panel-w\)\); \}/);
  assert.match(css, /body\.ai-panel-open \.dash-dock \{ right: calc\(18px \+ min\(var\(--ai-panel-w, 420px\), 92vw\)\); \}/);
  // Below 900px a dock becomes a drawer OVER the workspace, so a corner shifted left of
  // one would sit on top of the form it just uncovered. The RAIL goes — and the chatbox
  // does not, which is the one place the two are deliberately separated: hiding a
  // half-written message because the window got narrow would be losing work to a
  // breakpoint. That is also why the corner's `right` comes back to 18px at this width
  // rather than staying shifted.
  assert.match(css, /body\.profile-panel-open \.dash-chatheads,\s*\n\s*body\.ai-panel-open \.dash-chatheads \{ display: none; \}/);
  assert.match(css, /body\.profile-panel-open \.dash-dock,\s*\n\s*body\.ai-panel-open \.dash-dock \{ right: 18px; \}/);
  // THE CHATBOX IS NOT ONE OF THEM. It used to be — a third dock that took the right
  // edge and pushed the rail left of itself — and there is no rule left for it at all
  // now, because it is inside the corner rather than beside it. Asserted as an ABSENCE:
  // a stray line is exactly how a dock comes back by accident.
  assert.doesNotMatch(css, /messages-panel-open/);
  assert.doesNotMatch(css, /--messages-panel-w/);

  // A phone has no right edge to give away, and a print-out has no colleagues.
  assert.match(css, /\.dash-chatheads \{ display: none; \}/);
});

test('an unread mark lands on the colleague who wrote, and never on you', async () => {
  const { renderRail, UNREAD } = await loadRail();
  const html = renderRail({ unread: UNREAD });

  // The fixture's UNREAD list is a LIST OF PAIRS, as the endpoint sends it, and it
  // includes the session's own id (7) with five waiting. A rail that read this as an
  // id-keyed object, or that forgot to filter self, would draw a mark for Maria —
  // whose circle is not even drawn. So: two circles, two marks, no "5" anywhere.
  assert.equal((html.match(/dash-chathead__unread/g) || []).length, 2);
  assert.doesNotMatch(html, />5</);
  // Juan has three, Elena one.
  assert.equal((html.match(/dash-chathead__unread" aria-hidden="true">3</g) || []).length, 1);
  assert.equal((html.match(/dash-chathead__unread" aria-hidden="true">1</g) || []).length, 1);

  // The mark also rides the circle's ring, so it is still visible on a face whose
  // corner is overlapped by the next circle in a tight column. Both of these colleagues
  // have written, so both rings are lit — and the second render below is the one that
  // proves the lit ring is derived from the count rather than drawn for everybody.
  assert.equal((html.match(/class="dash-chathead has-unread"/g) || []).length, 2);
});

test('the colleague you are talking to steps OUT of the rail, and only that one', async () => {
  const { renderRail, UNREAD } = await loadRail();

  // Juan (9) and Elena (11) are both on the rail. With Elena's conversation open, her
  // circle is GONE — not merely unmarked — and Juan's is untouched, mark and all. This
  // is the rule the whole corner is built around: a face you are already talking to is
  // not somebody you are still looking for.
  const open = renderRail({ unread: UNREAD, openPeerId: 11 });
  assert.equal((open.match(/dash-chathead__face/g) || []).length, 1);
  assert.doesNotMatch(open, /Elena Ramos/);
  assert.doesNotMatch(open, />ER</);
  assert.match(open, /aria-label="Juan Dela Cruz — Senior Officer · active 2m ago — 3 unread messages"/);
  // Her mark leaves with her circle, so the count cannot outlive the face.
  assert.equal((open.match(/dash-chathead__unread/g) || []).length, 1);

  // The group's count is what is DRAWN, so it agrees with the circles under it.
  assert.match(open, /aria-label="1 colleague online"/);
  assert.match(renderRail({ unread: UNREAD }), /aria-label="2 colleagues online"/);

  // With NO conversation open, nobody is hidden — which is what proves this reads the
  // id rather than dropping faces generally.
  assert.equal((renderRail({ unread: UNREAD }).match(/dash-chathead__face/g) || []).length, 2);

  // An id that is not on the rail changes nothing, and a junk value hides nobody
  // rather than somebody by accident — a bare `Number(null)` is 0, which WOULD match an
  // account whose id is 0 if the check were written loosely.
  for (const id of [4242, 7, 'nonsense', null, undefined]) {
    assert.equal(
      (renderRail({ unread: UNREAD, openPeerId: id }).match(/dash-chathead__face/g) || []).length,
      2,
      `openPeerId=${id} should hide nobody`
    );
  }
});

test('hiding the open colleague frees a slot rather than leaving a hole', async () => {
  const { renderRail } = await loadRail();

  // THE ROSTER IS FILTERED BEFORE THE CAP, and this is the case that proves it. Six
  // colleagues: the rail draws five and a `+1` chip. Open a conversation with one of
  // them and there are five left — so the rail draws five circles and NO CHIP, which is
  // only possible because the hidden colleague left before the cap was applied.
  //
  // Filter afterwards and the arithmetic goes the other way: five drawn, one hidden
  // behind a chip whose whole job is reporting a truncation that no longer exists.
  const six = [1, 2, 3, 4, 5, 6].map((n) => ({ id: 900 + n, full_name: `Officer ${n}`, role: 'Officer' }));

  const all = renderRail({ online: six });
  assert.equal((all.match(/dash-chathead__face/g) || []).length, 5);
  assert.match(all, /aria-label="Show 1 more colleague"/);

  const talking = renderRail({ online: six, openPeerId: 903 });
  assert.equal((talking.match(/dash-chathead__face/g) || []).length, 5);
  assert.doesNotMatch(talking, /dash-chathead--more/);
  // The colleague whose conversation is open is the one missing, and the one the chip
  // had been holding back has taken the free slot.
  assert.doesNotMatch(talking, /Officer 3/);
  assert.match(talking, /aria-label="Officer 6 —/);
});

test('a rail with nothing left to draw is not there at all', async () => {
  const { renderRail } = await loadRail();

  // A two-officer station with the other one's conversation open: the rail is not an
  // empty frame beside the box, it simply goes. Same rule as the one-officer station
  // above, reached from the other direction.
  assert.equal(renderRail({ online: [{ id: 7, full_name: 'Maria Santos' }, { id: 9, full_name: 'Juan Dela Cruz', role: 'Officer' }], openPeerId: 9 }), '');
});

test('the unread mark is in the label too, so the reason to press is announced', async () => {
  const { renderRail, UNREAD } = await loadRail();

  // The badge is aria-hidden decoration, and it is the only visible sign that a press
  // will lead to something waiting. Both halves matter, and the label is where a screen
  // reader gets it.
  const html = renderRail({ unread: UNREAD });
  assert.match(html, /aria-label="Juan Dela Cruz — Senior Officer · active 2m ago — 3 unread messages"/);
  assert.match(html, /— 1 unread message"/);
});

test('nothing waiting means no mark, and a count nobody can read is capped', async () => {
  const { renderRail, NOTHING_UNREAD } = await loadRail();

  const quiet = renderRail({ unread: NOTHING_UNREAD });
  assert.doesNotMatch(quiet, /dash-chathead__unread/);
  assert.doesNotMatch(quiet, /has-unread/);

  // Forty-seven is a hint, not a ledger: an exact count in an 18px circle is
  // unreadable at the size it is drawn, so it is capped the way the bell's is.
  const many = renderRail({ unread: [{ sender_id: 9, count: 47 }] });
  assert.match(many, /dash-chathead__unread" aria-hidden="true">9\+</);

  // A malformed entry is ignored rather than drawn as "NaN" — the count is the one
  // number on this rail that comes from somewhere the rail does not control.
  const junk = renderRail({ unread: [{ sender_id: 9, count: 'lots' }, { nope: true }, null] });
  assert.doesNotMatch(junk, /dash-chathead__unread/);
});

test('a mock circle is a control that leads to a preview conversation', async () => {
  const { renderRail } = await loadRail();
  // Expanded, so the count below is the whole cast rather than the five the collapsed
  // rail draws plus its chip.
  const preview = renderRail({ preview: true, expanded: true });

  // THE SAME AFFORDANCE AS THE LIVE RAIL, because it does the same thing: it opens a
  // conversation. An earlier version drew these as plain marks — not controls — on the
  // theory that a mock cannot be messaged, and the cost was that the primary
  // interaction of the whole feature could not be exercised on the machine it is most
  // often looked at from. What makes the press honest is the DESTINATION, not the
  // absence of one: see the panel's preview note and mockThreadFor.
  assert.match(preview, /is-preview/);
  assert.equal((preview.match(/<button type="button" class="dash-chathead"/g) || []).length, 12);
  // No leftover from the inert version: no card, no Message button, and no second
  // element type for the same circle.
  assert.doesNotMatch(preview, /dash-chathead__message/);
  assert.doesNotMatch(preview, /dash-chathead__card/);

  // No caption above the circles and no query-string hint beside them — the on-screen
  // instructions for reaching the live rail are gone with it, which is a real cost and
  // recorded in docs/PRESENCE.md rather than replaced by something the design did not
  // ask for. What marks these faces is the dashed ring and the group's name.
  assert.doesNotMatch(preview, /dash-chatheads__preview/);
  assert.doesNotMatch(preview, /chatheads=off/);
  assert.match(preview, /aria-label="Preview: 12 mock colleagues, not real presence"/);
});

test('the preview flag is read once, by Shell, and handed to both surfaces', async () => {
  const railSrc = await readFile(path.join(root, 'src/components/Chatheads.jsx'), 'utf8');
  const shellSrc = await readFile(path.join(root, 'src/components/Shell.jsx'), 'utf8');

  // It has to be read ABOVE both surfaces. It now decides the rail's roster AND what
  // the messages panel does with the id a circle hands over, and a flag read separately
  // in each is how an invented officer ends up on a rail whose panel refuses their id
  // — or, worse, the other way round.
  assert.match(
    shellSrc,
    /const \[preview\] = useState\(\s*\n\s*\(\) => import\.meta\.env\.DEV && chatheadPreview\(window\.location\.search\)\s*\n\s*\);/
  );
  // …to the rail…
  assert.match(shellSrc, /<Chatheads\s*\n\s*user=\{user\}\s*\n\s*preview=\{preview\}/);
  // …and to the panel.
  assert.match(shellSrc, /<MessagesPanel\s*\n\s*preview=\{preview\}/);

  // The rail takes it as a prop and does NOT read the environment: it is rendered by
  // the test harness, which has no Vite, so a module-scope env read anywhere reachable
  // from it would crash the very tests that check the preview.
  assert.match(railSrc, /export default function Chatheads\(\{ user, preview = false,/);
  assert.match(railSrc, /export function ChatheadRail\(\{[\s\S]{0,120}preview = false,/);
  const rail = railSrc.slice(railSrc.indexOf('export function ChatheadRail'), railSrc.indexOf('export default function Chatheads'));
  assert.doesNotMatch(rail, /import\.meta\.env/);
  // The expression, not the phrase: this file's own comments explain where the flag is
  // read now, and naming it in prose must not read as reading it.
  assert.doesNotMatch(railSrc, /import\.meta\.env\.DEV &&/);
});

test('the drawing is split out of the fetching, which is what makes any of this testable', async () => {
  const src = await readFile(path.join(root, 'src/components/Chatheads.jsx'), 'utf8');

  // ChatheadRail must be a named export taking its roster as a prop, and it must not
  // fetch: a component that beats cannot be rendered by renderToString, and every
  // assertion above would silently become a test of the empty state.
  assert.match(src, /export function ChatheadRail\(\{\s*\n\s*user,\s*\n\s*online,/);
  // The rail hides the session's own account, through the tested rule rather than a
  // second copy of the comparison. A `(you)` marker used to live here; it cannot
  // come back as a way of showing self again without failing this.
  assert.match(src, /const others = withoutSelf\(preview \? MOCK_CHATHEADS : online, user\);/);
  assert.doesNotMatch(src, /isSelf\(/);
  const rail = src.slice(src.indexOf('export function ChatheadRail'), src.indexOf('export default function Chatheads'));
  assert.doesNotMatch(rail, /\bapi\(/);
  assert.doesNotMatch(rail, /HEARTBEAT_MS/);
  assert.doesNotMatch(rail, /Date\.now\(\)/);

  // And the wrapper must still be the only thing that beats, so the split cannot
  // drift into two places that both think they own presence.
  const wrapper = src.slice(src.indexOf('export default function Chatheads'));
  assert.match(wrapper, /api\('\/presence\/heartbeat'/);
});
