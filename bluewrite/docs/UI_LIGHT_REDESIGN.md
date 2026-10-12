# UI Redesign — "Official Incident Reporting System" look, app-wide

**Status:** implemented (see §10 for what shipped and what is still open)
**Reference:** the `POLICE INCIDENT REPORT` screen (navy top bar, light gray
page, white bordered cards, uppercase small-caps labels, bold sans page title
— the page titles were a Georgia serif until the project dropped serifs)
**Related:** `docs/PHASE3_STATUS.md`, `docs/PHASE4_DASHBOARD.md`

---

## 1. Goal

Make the light, official-document look the look of the **whole application**,
not just the Write Report screen:

1. **Home** — light landing page with official-style cards.
2. **My Reports / All Reports** — light page, white toolbar card, document
   table.
3. **Dashboard, User Management, Audit Trail** — same treatment (admin scope
   now included).
4. **Write Report** — unchanged in layout, but it stops owning the only copy
   of the top bar.
5. **Logout leaves the nav.** A **Profile** control takes that slot; the
   sign-out action lives inside it.

## 2. Decisions (locked)

| Question | Decision |
| --- | --- |
| Who gets the light UI | Everyone — officers, staff **and** admins |
| Profile menu contents | Identity (name · badge · role) + divider + **Log out**, wired to the existing confirmation dialog. No placeholder items. |
| Officer Home content | Official landing cards: page title, primary "Start a new report" card, "Recent reports" card, identification line |
| AI narrative panel | Light variant on the light pages (behaviour unchanged) |

## 3. Where we are today

* `.ir-screen` (`src/incident-report.css`) = navy top bar (`.ir-nav`) + light
  gray page. `.ir-body` inverts the design tokens
  (`--void/--panel/--line/--paper/--cyan/--input-bg…`) to light values, so
  every descendant component (fields, `RepeatableGroup`, badges, alerts,
  buttons) goes light **without rewriting rules other screens still use**.
* `IrTopBar` is a private component inside `src/components/Reports.jsx`; its
  nav is hardcoded `Home / My Reports / Submit Report / Logout`.
* `Shell.jsx` renders the dark rail (`.sidebar`) + dark `.main` with the
  animated glitch backdrop, and hides the rail only while the editor is open
  (`.shell.is-focus`).
* Every screen except the editor is styled from `src/styles.css` dark tokens:
  `.welcome`, `.page-head`, `.reports-toolbar`, `.table-wrap`, `.dash*`,
  `.user-menu`, `.dialog`, `.toast`, `.ai-side-panel`.

So this is a **chrome + token-scope** job, not a redesign from scratch.

## 4. Approach — three moves

### Move 1: lift the token inversion from the editor to the app

Today the light tokens exist only under `.ir-body`. Promote them to the shell
root (`.shell.is-light`, defaulted on for every role) and keep `.ir-body` as
an alias so the editor keeps working. Every existing dark rule in
`styles.css` that paints a hardcoded colour (`#030712`, `rgba(10,17,32,…)`,
`var(--paper)` on a light background) must be re-expressed in tokens, or it
will still paint dark.

The animated glitch/grid/scanline backdrop retires for good — the light
document page is the app's atmosphere now.

> **Later change (see §"The sign-in gate").** "For good" did not hold for the
> gate specifically: the two sign-in screens were given a backdrop again. It is a
> different animal from the one retired here — a React Bits `GridScan`, drawn
> from the palette's own tokens, unlit (no bloom, no grain) and running even when
> the OS asks for less motion — but it is a reversal of this sentence, and this note
> is here so the record says so rather than reading as if the code drifted.
> (It was removed on 2026-09-27 and then re-applied the same day from a newer
> React Bits source — see the later change notes in §"The sign-in gate", which
> are now the authority on the gate's backdrop.)

### Move 2: one top bar, rendered once

New `src/components/AppTopBar.jsx`:

* Left: the shield brand lockup — `PUBLIC SAFETY DEPARTMENT` /
  `OFFICIAL INCIDENT REPORTING SYSTEM` (unchanged from the reference).
* Right: nav links with `aria-current="page"` (that is what draws the active
  underline in the reference), then the **Profile** control.
* Role-aware destinations:
  * Officer / Staff — `HOME · WRITE REPORT · MY REPORTS`
  * Admin — `DASHBOARD · ALL REPORTS · USER MANAGEMENT · AUDIT TRAIL`
* Profile = avatar chip (initials) + name, opening a light popover:
  identity block, divider, `Log out`. Sign-out flows through Shell's existing
  `confirmLogout` dialog, so there stays exactly one way out of the app.
* Home doubles as the brand: clicking the lockup goes to the role's home.

Delete `IrTopBar` from `Reports.jsx`; Shell owns the bar for every view and
passes `current`. `ReportEditor` keeps its API for isolation, but the nav
props become unused and should be dropped along with the `onHome` /
`onMyReports` / `onLogout` threading in `Shell.jsx`.

### Move 3: restyle the content screens

Same page grammar for all of them: `ir-title` bold heading + right-aligned
`ir-meta` line, then white `ir-card` panels with uppercase headers.

* **Home** (`ReportWelcome`) is the one exception — it carries **no page
  head**. Its `.ir-body` holds exactly two children: the BLUEWRITE brand hero
  (the old `HeroGlitchText`, now on the light surface — see below) and the
  `.ir-grid` of cards. The title, the `ir-status` line and the "stays a draft"
  note were removed by request: the top bar already carries the department
  lockup, the officer's identity lives in the profile menu, and the draft rule
  is enforced visibly by the status badges in My Reports and in the editor.
  Everything else (My Reports, Write Report, Users, Audits) keeps the full
  `ir-page-head` + `ir-status` grammar, so those styles are live, not dead.
  Home is also the only **centred** screen. The centring lives in a single
  `.ir-home` block in `incident-report.css` — the wrapper `ReportWelcome`
  renders — so it cannot reach the editor, the register, the admin screens or
  the print sheet. It centres the masthead, the card heads, the body copy and
  the action buttons, caps the card pair at 68rem and centres them as a unit,
  and gives centred prose a measure (34rem). Two things stay left-aligned on
  purpose: the Recent Reports rows (a record read across, not prose) and the
  existing narrow-width row wrap. Verified by measuring a 1366px clone: the
  grid is 1020px with 173px gutters per side and the wordmark, kicker, both
  card heads and the button row all centre on the page midpoint; My Reports
  measured `text-align: start` with no `.ir-home` in its tree.
* Home cards: card *Report Intake* → primary "Start a New Report" + "View All
  My Reports"; card *Recent Reports* → last five (BW no. · type · status ·
  date), drafts first; empty state for a new officer.
  The hero is `.ir-hero`: navy `BLUE` + blue `WRITE`, kicker "Incident
  documentation workspace", on a hairline rule above the cards. Its glitch
  burst keeps the component's stepped clip-path frames but swaps the login's
  neon cyan/magenta for the brand blues (`.ir-hero`-scoped overrides of the
  ghost colours and the two `hud-glitch-burst-*` animations), so it reads as
  ink misregistration on an official page. Login keeps its own neon burst —
  the overrides never leave `.ir-hero`.
* **My Reports / All Reports** (`ReportsTable`): title `MY REPORTS` /
  `ALL REPORTS` + count and date range in `ir-meta`; filters and the
  Show Archived / Export CSV row into a white toolbar card; the table becomes
  a card with a navy header row, zebra-free rows, and the existing status
  badges.
* **Dashboard**: KPI cards, panels, filters and the alert bar re-expressed in
  light tokens. Charts are hand-drawn SVG and take `currentColor`/tokens, so
  they follow automatically where they already use variables.
* **Users / Audits**: page head + white cards + light tables, matching the
  report table.
* **AI panel** (`.ai-side-panel`): light variant — white surface, light rail,
  navy accents. Everything else (pin/unpin, resize, rail collapse, Ctrl+J,
  accept/regenerate) is behaviour and stays untouched.
* **Chrome that floats above pages**: `.dialog` / `.dialog-overlay`,
  `.toast`, `.context-menu`, `.user-menu`. These sit over light pages, so
  they get light surfaces with a soft shadow. They stay **outside** any token
  scope used by the print sheet.

## 5. Work items, in order

1. `src/components/AppTopBar.jsx` — brand + role nav + Profile popover.
2. `src/styles.css` — shell-level light tokens; retire backdrop; light rail
   removal; dialog/toast/menu/table/toolbar/`.page-head`/`.welcome` rules.
3. `src/components/Shell.jsx` — render `AppTopBar` for every view; drop the
   sidebar for all roles (or keep an admin-only rail? see §6); single logout
   path via Profile; drop `IrTopBar` plumbing.
4. `src/components/Reports.jsx` — delete `IrTopBar`; rebuild `ReportWelcome`
   as the light landing; light-layout `ReportsTable`; strip the editor's nav
   props.
5. `src/incident-report.css` — keep `.ir-*` as the shared document stylesheet;
   add table/toolbar/profile-popover rules under `.ir-screen`.
6. `src/components/AiNarrativePanel.jsx` + AI CSS — light panel variant.
7. `Dashboard.jsx`, `Users.jsx`, `Audits.jsx` — page head + card + table
   conversion, no logic changes.
8. Full pass for dark leaks: loading states, skeletons, empty states, error
   alerts, connection banner, skeletons in `ConnectionNotice.jsx`.

## 6. The sidebar rail — decided: removed

The reference has **no sidebar rail** — navigation is entirely the top bar.
The rail is gone for every role, and with it the rail's report list, the
Ctrl+B / drag-resize collapse controls, and the right-click report menu. Every
action that menu offered (open, history, print, copy, archive, restore) lives
in the report register's row actions, so no capability was lost — only a
second way to reach it.

## 7. Risks

* **Hardcoded dark colours.** Any rule in `styles.css` painting a literal
  dark value inside a light page will read as a hole. Mitigation: grep for
  hex/rgba literals under `styles.css` and convert to tokens before styling
  screens.
* **Print must not drift.** `ReportPrint.jsx` and the print media rules stay
  outside every token scope. Verify a printed sheet after the token lift.
* **Scope creep in admin screens.** Dashboard/Users/Audits are converted for
  surface only — no data, sorting, filter or permission behaviour changes.

## 8. Verification

* `npm test` (reportRules, printActions, incidentReport rule suites).
* `npm run build` for a clean bundle.
* Manual pass at the dev server for each role: Home, My Reports, Submit
  Report, Dashboard, Users, Audits — at desktop, ~1000px and mobile widths;
  dialogs, toasts, context menu, AI panel open, print preview.
* Confirm the report print sheet is unaffected (the print path is the one
  regression that matters legally).

## 9. Out of scope

* ~~The login screen keeps its dark branded treatment (it is the entry gate,
  not a document workspace).~~ **Superseded** — see §11. The gate now wears this
  document language too.
* No API, database, validation or permission changes.

## 10. What shipped

**Palette.** `styles.css` `:root` now carries the document palette
(`void` = page, `panel` = card, `cyan` = primary blue, `paper` = primary text,
`steel` = secondary). Token *names* were kept from the dark theme, so every
rule that reads them followed the flip — including the Dashboard charts, which
were already token-driven. The document layer's `--ir-*` aliases moved from
`.ir-screen` to `:root` and now source their colours from that same palette.

**Chrome.** `AppTopBar.jsx` is the one bar, rendered by `Shell` for every view,
with role-aware destinations, an `aria-current` underline, and the Profile
control (identity + Log out, one confirmation dialog, one sign-out path).
`Shell` also lost the sidebar, the workspace backdrop, the hover/collapse rail
machinery and its user-menu popover.

The bar is pinned to the top of the window. `.shell` was a **row** flex
container (sidebar beside main) and became a **column**: the bar is `flex: none`
at the top, `.main` takes the rest with `min-height: 0` and scrolls internally,
so the window itself never scrolls. A pre-existing `@media (max-width: 720px)`
rule still set `.shell { flex-direction: column; height: auto; overflow:
visible }` to stack the old sidebar on phones — it was overriding the pinned
layout below 720px and was removed along with its sidebar-only siblings.

**Screens.** Home is now a document landing page (Report Intake + Recent
Reports cards). My Reports / All Reports is a page head + filter card + report
register card. The Write Report editor contributes only its content.
Users and Audits got the same page head and inherited the palette; auditing
them further is polish, not correctness.

**Typeface.** The app is League Spartan, self-hosted as a variable file
(100–900, 33 KB for both subsets) in `src/fonts/`, aliased from one
`--font-family` token in `:root`. Every family literal that used to name a
font the bundle never shipped is gone: `--font-body` / `--font-hud` said
`Inter` (falling back to Segoe UI on every station machine), the page titles
said Georgia, and the login said `Inter` too. The Georgia serif is retired,
so `ir-title` and the signature line are League Spartan 700. The swap from
Open Sans was the token plus the vendored files — nothing else, which is the
point of the token. Two families are pinned on purpose and must stay: the
print sheet's **Verdana** (the real station forms are Verdana-style) and the
login's **JetBrains Mono → system mono** accent.

**Verified.** 48 rule tests pass, `npm run build` is clean, and a DOM pass over
Home, My Reports, Write Report, Dashboard, Users and Audits found no dark
surface outside the navy bar and the intended blue accents. The font loads
from the bundle (never a CDN) and `document.fonts.check` passes at 400, 700
and 800, so bold is a real drawn weight. Fit was measured rather than
eyeballed at every swap, because both hand-tuned widths move with the face:
with League Spartan the top bar needs 757px of a 1306px content width (549px
slack) and the Reports filter row 901px of 1266px, both comfortable, and
nothing moved a breakpoint. The login (logged out and back in), Home, the
register and the Write Report editor were each swept for clipped text: zero
overflowing elements in all four. The Home hero's
burst was sampled frame-by-frame through the Web Animations API: ghost A is
`rgba(31,95,208,…)` and ghost B `rgba(26,43,74,…)` with the clipped band and
±16–22px offsets intact, i.e. the recolour took and the login's unmodified
burst is untouched. Re-checked after the Home header removal: `.ir-body`
contains only `ir-hero` and `ir-grid`, the masthead sits flush at the page
padding (no orphaned margin), and `ir-page-head` / `ir-status` / `ir-title` /
`ir-required-note` all still have live callers elsewhere. Dialogs, the
profile menu, toasts and the AI panel all render light. The print sheet is
untouched (hardcoded paper colours, outside every token scope).

## 11. The login gate joined the workspace (2026-09-17)

The login was the last dark screen. It now uses the same tokens as everything
else — `--void` page, `--ir-navy` bar, white cards over `--ir-border`, the blue
primary action, League Spartan — so the entry gate and the workspace read as one
product instead of two.

**What was removed, not just recoloured.** The tactical grid, the CRT scanline
overlay, the `LetterGlitch` backdrop, the HUD mono type (the login was the last
place naming `'JetBrains Mono'`, a family the bundle never shipped — it was
silently falling back to a system mono) and the neon cyan/magenta glitch. The
per-second clock glyph scramble went with them; the PHT clock itself stayed,
as plain tabular text, because the time an officer signs on is what the audit
trail records. `LetterGlitch.jsx` is now referenced by nothing and no longer
reaches the bundle — left in the tree rather than deleted.

**The sign-in gate got a backdrop again, and only it.** `GateGridScan.jsx`
wraps the React Bits `GridScan` (vendored unmodified as `GridScan.jsx`, the same
arrangement `HomeGrid.jsx` has with `ShapeGrid.jsx`) under both gate screens. It
reverses the "retires for good" note above, deliberately and for this one screen:
the gate is the only place in the app with nothing on it but a form, so a moving
surface costs no reading. What it is NOT is the retired backdrop coming back —
there are no scanlines, no glitch, no neon, and the colours are `--line-bright`
and `--cyan` read off the document at runtime rather than new literals.

Two costs were accepted with it, and both are worth knowing before the next
change here. It brings **three render engines into the bundle**: `three`,
`postprocessing` (installed but switched off — `enablePost={false}` is where the
"no glow" part of this screen's brief lives) and `face-api.js`, which carries
TensorFlow.js and takes the gate's JS from **491 kB to 1,728 kB** (154 → 463 kB
gzipped). `face-api.js` is there only for webcam face-tracking, which this screen
never enables, and its model-loading effect has no `enableWebcam` guard — so the
gate also makes one outbound request to `cdn.jsdelivr.net` per load. Measured
savings if that is ever reconsidered: stripping `face-api.js` alone removes
**639 kB** (157 kB gzipped) and stripping `postprocessing` a further **61 kB**
(14 kB gzipped). The component was left byte-faithful rather than patched so a
React Bits update can still be diffed against it, which means the one-line guard
is a decision to take deliberately, not a fix to make quietly.

It also **cannot take the pointer**. `GridScan`'s parallax skew is pointer-driven,
but the canvas sits under `.la-content`, a full-size scroll container at a higher
layer, and clearing that container would break wheel scrolling. The layer is
`pointer-events: none`, so the sweep and the grid's own drift carry the motion;
the skew never runs.

> **Later change (2026-09-27).** The backdrop above was removed on request, and
> with it everything it brought: `GateGridScan.jsx`, `GateGridScan.css` and the
> vendored `GridScan.jsx` / `GridScan.css` now live in
> `.design-backup/revert-landing-backdrop-2026-09-27/` rather than in `src/`. So
> the gate has no backdrop at all — the page's own `--void` fill is the
> atmosphere, exactly as it is in the workspace — and the costs listed above are
> gone with it: no `three`/`postprocessing`/`face-api.js` on this screen, no
> outbound request to `cdn.jsdelivr.net` per load, and the page-level
> `isolation: isolate` the light-mode blend needed (login-theme.css) is reverted
> too. The gate now states its own navy pair (`--la-navy` / `--la-navy-hi`, on
> `.la-page`, restated for dark in dark-theme.css) instead of reading the
> document layer's `--ir-navy`, so a restyle of the report sheet can never
> repaint the sign-in screen again.

> **Later change (2026-09-27, later the same day).** The backdrop came back, on
> request, rebuilt from a NEWER React Bits `GridScan` source than the one that
> was removed. That source adds `lightMode` (the gate already used it),
> `lineStyle`, `lineJitter`, `scanOnClick`, `scanGlow`, `scanSoftness`,
> `scanPhaseTaper`, an `enableGyro` option and a `showPreview` HUD — none of
> which the gate opts into. `isolation: isolate` is back on `.la-page` with it.
> One departure from a byte-faithful vendoring was taken deliberately this time:
> the model-loading effect now returns early when `enableWebcam` is false, so the
> gate no longer makes its per-load request to `cdn.jsdelivr.net` (documented at
> the top of `GridScan.jsx`, and the guard the previous note called "a decision
> to take deliberately"). `face-api.js` still reaches the bundle through the
> component's module-scope import, so the weight note above still stands — the
> guard removed the outbound request, not the dependency.
>
> It also **stopped standing down under `prefers-reduced-motion`**. The guard the
> other backdrops share was traced to a gate that read as broken rather than
> deliberately still on a workstation with OS animations switched off, so it was
> dropped for this one screen. The exception is scoped to the gate and argued in
> `GateGridScan.jsx`; Home's grid, the report sheet and the appearance switch
> still honour the preference.

> **Later change (2026-10-13): the grid came off the sign-in screen.** The owner
> asked for the animated square grid to go. It is the layer the two notes above
> argue over, and this time it is neither switched off nor hidden — it is out of
> the tree: `GateGridScan.jsx`, `GateGridScan.css` and the vendored
> `GridScan.jsx` / `GridScan.css` now live in
> `.design-backup/revert-gate-backdrop-2026-10-13/`, the arrangement the first
> removal used, so a third opinion on this layer costs a `mv` rather than a
> re-derivation. What sits behind the gate's words now is the page's own navy
> fill and the photograph.
>
> **Measured on the build rather than estimated:** the main chunk goes from
> 1,925.88 kB to 1,203.35 kB — **−722 kB minified, −179 kB gzipped** (527.05 →
> 348.04 kB gzipped). `postprocessing` and `face-api.js` leave with the layer,
> which is the weight this section's opening paragraph priced at ~700 kB.
> `three` stays: `AiOrbBackdrop.jsx`, the AI assistant's aura, imports it
> directly, and that is now the only reason the project depends on it. The
> `.la-page` `isolation: isolate` the light-mode blend needed went with the
> layer, and the reduced-motion exception described above is down to one
> surface — Home's grid. Both sign-in screens were re-rendered and probed after
> the removal: zero `<canvas>` elements, zero `.gate-gridscan` nodes, the same
> box geometry to the percent, and the same pixels in both themes.

**What was kept deliberately:** the two-column arrangement, the PHT clock, the
`SYS_STATUS` / `ENC_LEVEL` readout (an officer should see a connection problem
before typing credentials that cannot be checked), and the wordmark's
misregistration burst — now in brand blue and navy, via the same
`HeroGlitchText` Home uses.

**Two fixes found while doing it.**

* The navy mark is back on this screen: the knockout (white) variant the dark
  console needed was invisible on a light page, so the gate now shows the
  two-tone wordmark (BLUE navy / WRITE blue) over the navy master artwork,
  exactly as Home does.
* The burst offsets were in **pixels**, sized for a 38–46px word. The wordmark is
  fluid and drops to 1.5rem on a short viewport, where a 22px offset smears a
  24px word into an unreadable pile — visible immediately on the light page.
  They are in `em` now, so the misregistration scales with the type.

**Ordering.** Below the two-column breakpoint the spread stacks brand → the
panel → the two advisory cards, so the form is not pushed below two cards of
prose. Done with `display: contents` inside the `max-width: 1023px` query;
desktop is untouched.

**Still open**

* The sidebar/welcome/user-menu CSS is now dead (~400 lines) and should be
  deleted in a cleanup pass.
* Users and Audits still build their working surface from the generic `.page-*`
  styles rather than card panels.
* The registered `public/` bundle was rebuilt as part of verification.
* ~~`LetterGlitch` logs a `getBoundingClientRect` exception mid-unmount on the
  login screen — pre-existing, unrelated to this work.~~ **Moot** — the login no
  longer mounts `LetterGlitch` (see §11).

---

## 12. The gate became the department's front door (2026-10-12)

§11 brought the sign-in screen into the workspace's light document language. That
is **superseded by owner request**, from a reference the owner supplied: the gate
is a design of its own now, and it no longer follows the theme at all.

* **One fixed design, in both themes.** Deep navy (the `--la-*` pair on
  `.la-page`, plus the deeper plate under it), the station's photograph across
  the right of the page — the deployment's own `src/assets/home-hero.jpg`, the
  file Home's band shows — cut on a diagonal, with the office's mark and the
  wordmark in white and the department's gold over it, and the access card
  floating on the picture. `dark-theme.css` no longer restyles the gate: its two
  `:root[data-theme='dark'] .la-*` overrides are gone with the theme-following
  they served.
* **The appearance switch left the gate** with that theme-following. The choice
  still lives in Profile ▸ Preferences, and `index.html` still applies a stored
  preference before the bundle loads, so the workspace an officer signs into is
  the one they chose. `App.jsx` no longer passes `theme`/`onTheme` to `Login`.
* **The bar is the station's two seals** (PNP + City of Naga) with the readout at
  the other end: the PHT clock, the system status as a lit green/amber dot, and
  `v{APP_VERSION}`. `ENC_LEVEL` went — the second step states the encrypted
  connection anyway (`la-session-pill` and the verify card's facts).
* **The three feature cards are the reference's copy** — AI assistance, secure &
  reliable, safer communities. The writing-assistance advisory stayed on the page
  (spec §5 names this screen) as the column's fine print rather than as a fourth
  card.
* **The backdrop is gone** (owner request, 2026-10-13 — §11's last note): the
  arrangement, the copy and the geometry below are untouched, and what is behind
  them is the page's navy fill and the photograph. The token-reading wrapper
  this bullet used to describe (`GateGridScan`, which read its inks off the page
  that hosted it and ran the dark pass at half strength) and the vendored
  `GridScan` it wrapped are in
  `.design-backup/revert-gate-backdrop-2026-10-13/`.
* **The picture is a band across the top right, not a wall** (owner request,
  2026-10-13 — three readings of the comp in one day: "make the photo … small in
  the picture", then "… the size of the police station picture"). TWO NUMBERS
  decide it, and both were wrong the first two times:
  * **WHERE IT IS CUT.** 45% head / 3% foot, then 51% / 12%, now **46% at the
    head and 36% at the foot**. The first two fanned the picture out across the
    page's LOWER-LEFT, which is what put it under the signature, the third
    feature card and the corner wedge. Measured on the render, in the air the
    brand column keeps to the right of its own copy (x 300–660, y 110–430 of
    1500x850): the picture covered **20.3%** of it at 51/12 and covers **6.0%**
    at 46/36.
  * **WHERE IT ENDS.** The layer was `inset: 0`, and with a three-to-one frame
    (2172x724) in a page taller than one third of its width, `cover` scaled the
    picture to the page's HEIGHT — every pixel of the frame's height on one of
    the page's. The officer was shown the building blown up to the window and
    never the station. The layer is **55% of the page's height** now (the stacked
    page gives it the height back), which makes the box WIDER than the frame at
    every size the gate is used at, so the frame is scaled to the box's width and
    cropped top and bottom: the picture is drawn **0.59 of the page's height at
    the comp's 1674x940** and **0.73 at a 1366x623 workstation**, against 1.0
    before. The third wash gradient closes the band's own foot into the page's
    navy, which is what the picture's new bottom edge needs.

  Not a guess at the scale: rendering the gate at the comp's size and scoring the
  two edge maps over the region the comp leaves to the photograph (x 800–1660,
  y 60–290) puts the band **22% closer** to the comp than the full-height layer
  was — the frame's features only line up at the smaller scale. Pinned by
  `tests/rules/loginGate.test.mjs`, which holds the band's height, the three
  sides that must stay at 0 (an `inset` shorthand would silently make it the
  whole page again), both ends of the cut, the diagonal, the vertical lead and
  the wash that closes the foot.
* **The card comes first when the page stacks** (`display: contents` inside the
  `max-width: 1023px` query), and `.la-content` centres its child with an auto
  margin rather than `align-items: center` — the latter clipped the top of the
  brand column above the scroll origin on a 500x749 window.
* **The frame is the comp's, measured rather than approximated.** Read off the
  reference at 1500x850 and pinned by probes in headless Chrome: 63px of navy at
  each edge (4.2vw, capped), the card's column a **fixed 570px** (38rem at this
  app's 15px root) against whatever the brand column can take, the card's foot
  **on the signature's own line** (`align-items: end` — in the comp the plate and
  the underline share y=760) and a **bottom-weighted** vertical frame: 9vh above
  against 2vh below, because equal padding centres the spread 31px too high and
  the card's bottom edge shows it. The type scale came up with it — wordmark to
  86px against a 90px mark, the cards' titles and sentences to ~15px, which is
  what fills the comp's 210px cards. Two things had to change to make the numbers
  land: `.la-content-inner`'s `max-width` was 84rem (1260px, so the whole spread
  sat 57px in from each side) and the horizontal padding is now the comp's own.
* **The writing-assistance advisory moved above the signature.** It stays on the
  screen (spec §5) but the comp ends this column with the slogan and its swoosh,
  so the notice is now the last thing read *before* it rather than the last thing
  on the page.
