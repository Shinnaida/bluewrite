// BlueWrite — the incident-category rank chart, as a component.
//
// The arithmetic behind the picture is tested on its own (categoryRank.test.mjs). This
// file is about the panel: the two ways to interrogate it (pick a type, read a slice),
// the one sentence it prints, and the states every one of those has to share.
//
// It replaced a list of bars. The list answered "how much of each type is there", which
// the counts above it already said; the chart answers "which type is getting higher",
// which is a question about RANK over time — and that has its own ways to be wrong:
//
//   - A RANK WITH NO MAGNITUDE IN SIGHT. A line can sit at the top of the chart on four
//     reports. Every label and every reading therefore prints a count beside the
//     position, and the info card says so out loud.
//   - A LABEL THAT DOES NOT MATCH ITS LINE. The type list IS the legend: its colours have
//     to come from the same ramp index the lines are drawn with, or the panel names one
//     line with another's ink and nothing on screen looks broken.
//   - ONE PIECE OF STATE FOR TWO QUESTIONS. "Is this type climbing?" and "what happened
//     that slice?" are different questions with different answers; collapsing them would
//     make hovering a slice silently drop the picked type.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const component = readFileSync(new URL('../../src/components/Dashboard.jsx', import.meta.url), 'utf8');
const dark = readFileSync(new URL('../../src/dark-theme.css', import.meta.url), 'utf8');

/** Every declaration made under one selector, joined. */
function rule(selector) {
  const target = selector.replace(/\s+/g, ' ').trim();
  const found = [];
  for (const [, sel, body] of styles.matchAll(/([^{]+)\{([^{}]*)\}/g)) {
    if (sel.replace(/\s+/g, ' ').trim() === target) found.push(body);
  }
  assert.ok(found.length >= 1, `${selector} is not declared at all`);
  return found.join('; ');
}

const chart = component.slice(
  component.indexOf('// ---- Incident categories over time'),
  // The pie is the next section, and it is a component with its own state and its own
  // focusable SVG: slicing past it would count its controls as this chart's.
  component.indexOf('// ---- Status pie'),
);
const lib = readFileSync(new URL('../../src/lib/categoryRank.js', import.meta.url), 'utf8');

test('the panel drew the rank chart, and owes its rules to the module that owns them', () => {
  assert.ok(chart.length > 500, 'could not find CategoryRank in Dashboard.jsx');
  assert.match(component, /<Panel title="Incident categories" info=\{<PanelInfo \{\.\.\.PANEL_INFO\.categories\} \/>\}>/);
  assert.match(component, /<CategoryRank\n\s+series=\{data\?\.seriesOverTime \?\? \[\]\}/);
  // The rank chart is the ONLY consumer of the ranked payload: the old bar list is gone,
  // and with it the panel's use of the top-8 breakdown.
  assert.ok(!component.includes('function BarRows('), 'the category bar list has been replaced, not kept alongside');
  assert.ok(!chart.includes('categoryBreakdown'), 'the chart ranks the full per-type series, not the top-8 list');
  // Every rule the picture depends on is the lib's, not re-derived here.
  for (const name of ['bucketize', 'rankByBucket', 'chooseDrawn', 'rankGeometry', 'axisTicks', 'rankHeadline', 'typeReading']) {
    assert.match(chart, new RegExp(`${name}\\(`), `${name} must come from src/lib/categoryRank.js`);
  }
});

test('the legend rows come out of the chart itself, never from a second read of it', () => {
  // A memo of its own would have to read `chart` — a `const` whose initialiser is the very
  // useMemo that would produce it — and a const read in its own initialisation is the
  // temporal dead zone: React throws on the first frame and the panel never paints. Every
  // other test in this file reads text rather than running the component, so it would sail
  // straight past a blank panel and a `Cannot access 'chart' before initialization`.
  assert.match(chart, /legend: legendRows\(geometry\)/, 'the legend is built inside the chart memo');
  assert.ok(!chart.includes('labelRows'), 'not a second hook over `chart`');
  const helper = component.indexOf('function legendRows(geometry) {');
  assert.ok(helper > 0, 'legendRows is missing');
  assert.ok(helper < component.indexOf('function CategoryRank('), 'and is defined outside the component');
  // The empty-state guard still comes after the chart it guards.
  assert.ok(chart.indexOf('const chart = useMemo') < chart.indexOf('if (!chart) {'));
});

test('picking a type and reading a slice are two pieces of state, not one', () => {
  assert.equal((chart.match(/useState\(/g) ?? []).length, 3, 'focused, the slice being read, and the measured width');
  assert.match(chart, /const \[focused, setFocused\] = useState\(null\)/);
  assert.match(chart, /const \[read, setRead\] = useState\(null\)/);
  // A pointer crossing the plot may not drop the type the reader picked out.
  assert.ok(
    !/setRead\([^)]*\)[\s\S]{0,40}setFocused\(null\)/.test(chart),
    'reading a slice must not clear the picked type',
  );
});

test('the type list is the legend AND the control, in the lines own ink', () => {
  // One expression, used twice: the line's stroke and the label's swatch. Two copies of
  // the colour rule is how a panel ends up naming one line with another's colour.
  const colour = chart.match(/rampColor\(Math\.max\(0, byType\.findIndex\(\(x\) => x\.type === t\.type\)\)\)/g) ?? [];
  assert.equal(colour.length, 2, 'the lines and the labels must take their colour from the same place');
  assert.match(lib, /export function rankGeometry/);
  // Real buttons, so the chart has a keyboard route that names a type instead of
  // simulating a click on a 2px stroke.
  assert.match(chart, /<button\n\s+type="button"\n\s+className=\{`dash-rank__label/);
  assert.match(chart, /onClick=\{\(\) => onOpenReports\?\.\(\{ date_from: from, date_to: to, type: t\.type \}\)\}/);
  // Hovering, focusing and leaving are all wired — a button that only lights on click
  // would leave the keyboard user with no way to pick a line out.
  for (const handler of ['onMouseEnter', 'onMouseLeave', 'onFocus', 'onBlur']) {
    assert.match(chart, new RegExp(`${handler}:`), `${handler} must be wired on the type labels`);
  }
  // Leaving one label for the next fires the leave AFTER the next enter, so the clear
  // must be conditional or the highlight blinks off mid-move.
  assert.match(chart, /setFocused\(\(cur\) => \(cur === type \? null : cur\)\)/);
});

test('the plot walks slices on the arrow keys, stopping at both ends', () => {
  assert.equal((chart.match(/tabIndex=\{/g) ?? []).length, 1, 'one tab stop for the plot');
  assert.match(chart, /e\.key !== 'ArrowLeft' && e\.key !== 'ArrowRight'/);
  assert.match(chart, /Math\.min\(last, Math\.max\(0, /, 'the walk stops at both ends of the range');
  assert.ok(!chart.includes('% buckets.length'), 'a range is not a cycle: the walk must not wrap');
  assert.match(chart, /if \(e\.key === 'Escape'\)/);
  // The slice is found by the slice it IS rather than by a position, and each hit target
  // carries its own index for that reason.
  assert.match(chart, /data-bucket=\{i\}/);
  assert.match(chart, /querySelector\(`\[data-bucket="\$\{next\}"\]`\)/);
  // The hit target covers the whole column, so the plot answers from anywhere in it.
  assert.match(chart, /className="dash-rank__hit"\n\s+x=\{column\(i\)\.x\}\n\s+y=\{0\}\n\s+width=\{column\(i\)\.width\}\n\s+height=\{RANK_H\}/);
  assert.match(rule('.dash-rank__hit'), /fill:\s*transparent/, 'a fill of `none` would take no pointer events');
});

test('the sentence and its footnote sit UNDER the chart, not inside its two-column grid', () => {
  // Both used to be children of `.dash-rank__body` — a `1fr 176px` grid — so the sentence
  // the panel exists to say took the left column while the caveat about what is drawn was
  // squeezed into the 176px legend column beside it, wrapped over two lines. Between the
  // grid's opening tag and the sentence there must be TWO closes: the measured cell's and
  // the grid's own.
  const between = chart.slice(
    chart.indexOf('<div className="dash-rank__body">'),
    chart.indexOf('className="dash-rank__note"'),
  );
  assert.ok(between.length > 0, 'could not find the sentence');
  assert.ok(
    (between.match(/<\/div>/g) ?? []).length >= 2,
    'the grid (and the measured cell) must close before the sentence',
  );
  // …and the footnote comes after the sentence, not beside it.
  assert.ok(chart.indexOf('className="dash-rank__omitted"') > chart.indexOf('className="dash-rank__note"'));
});

test('the sentence is a callout, and it names no colour of its own', () => {
  // It was footnote-weight before: 12.5px in --steel, the same as the axis labels it sits
  // under, so the panel's answer was the least visible thing in it.
  const note = rule('.dash-rank__note');
  assert.match(note, /font-size:\s*14px/);
  assert.match(note, /color:\s*var\(--paper\)/);
  assert.match(note, /background:\s*var\(--panel-raised\)/);
  assert.match(note, /min-height:/);
  // The footnote is a step down from the sentence, but not the smallest text in the panel.
  assert.match(rule('.dash-rank__omitted'), /font-size:\s*12\.5px/);
  // EVERY ink it wears comes from the theme, and the theme overrides every one of them —
  // which is the whole of "works in light and dark": a literal colour here would be right
  // in one mode and invisible in the other, and nothing else in this file would notice.
  assert.ok(!/#|rgb\(|hsl\(/.test(note), 'the callout must not hard-code a colour');
  for (const [, name] of note.matchAll(/var\((--[a-z-]+)\)/g)) {
    assert.match(dark, new RegExp(`${name}:`), `${name} is not set for dark mode`);
  }
});

test('the sentence under the chart is computed, and it swaps rather than stacking', () => {
  // At rest: the headline the lib computed (who climbed, or who leads the latest slice).
  assert.match(chart, /\{reading \? \(/);
  assert.match(chart, /\n\s+headline\.text\n/);
  // Picked: that type's reading — count, share, movement, and how often it ranked at all.
  assert.match(chart, /<strong>\{reading\.type\}<\/strong> — \{fmt\.format\(reading\.total\)\} report/);
  assert.match(chart, /\{reading\.share != null && <> · \{reading\.share\}% of the range<\/>\}/);
  assert.match(chart, /ranked in \{reading\.rankedIn\} of \{reading\.bucketCount\}/);
  // A null comparison says nothing rather than saying "0%".
  assert.match(chart, /\{reading\.deltaPct != null && reading\.deltaPct !== 0 && \(/);
  // One line, whose height is reserved: swapping sentences must not move the panel.
  assert.match(rule('.dash-rank__note'), /min-height:/);
});

test('the cut the chart applied is stated under it, not implied', () => {
  // The panel head used to say "Top 8 of 11" for the bar list. The chart decides this
  // cut itself, so it says so itself — and it owns the number, computed from the ranked
  // payload rather than from the top-8 breakdown.
  assert.match(chart, /const \{ drawn, omitted \} = chooseDrawn\(perType\)/);
  assert.match(chart, /\{omitted > 0 && \(/);
  assert.match(chart, /more type\{omitted === 1 \? '' : 's'\} had reports here, too few to rank across the range/);
  // The panel head has no aside about it any more.
  assert.match(component, /<Panel title="Incident categories" info=\{<PanelInfo \{\.\.\.PANEL_INFO\.categories\} \/>\}>/);
});

test('the plot says it is a rank chart, in its own aria-label', () => {
  // The picture is unreadable to a screen reader without this: six lines and an inverted
  // axis have to be described, including which way up it is and what the arrows do.
  assert.match(chart, /role="img"/);
  assert.match(chart, /aria-label=\{`Incident type by rank per \$\{bucketNoun\(chart\.size, 2\)\}/);
  assert.match(chart, /the top \$\{drawn\.length\} drawn/);
  assert.match(chart, /Arrow keys read a \$\{bucketNoun\(chart\.size, 1\)\} at a time/);
  // No data is a note, not an empty axis with six legends under it.
  assert.match(chart, /No incidents in this range yet\./);
  assert.match(chart, /if \(!chart\) \{/);
});

test('picking a line out is a state, and its motion is optional', () => {
  const focused = rule('.dash-rank__line.is-focused');
  const muted = rule('.dash-rank__line.is-muted');
  assert.match(focused, /stroke-width:\s*[\d.]+/, 'width is what separates the chosen line — six strokes at 0.4 still read as six');
  assert.match(muted, /opacity:\s*0\.4/, 'the dashboard recession value, not a new one');
  // EVERY no-preference block, not only the first: this sheet carries more than
  // one (the assistant's Generate pill has its own motion), and the fact being
  // asserted is that the rank lines' transition lives INSIDE such a block — not
  // that no other one was written before it.
  const blocks = [...styles.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  assert.ok(blocks.length > 0, 'the sheet states no reduced-motion branch at all');
  const block = blocks.find((b) => b.includes('.dash-rank__line')) ?? '';
  assert.match(block, /\.dash-rank__line \{ transition:/);
  // The recession survives without motion: it is a state, so it lives outside the query.
  assert.ok(
    styles.split('prefers-reduced-motion').some((part) => part.includes('opacity: 0.4')),
    'the recession must be reachable without motion',
  );
  // The rank lanes are the axis, and the slices being read are a band — the same device
  // the other panels use for "this is the column in question".
  assert.match(rule('.dash-rank__lane'), /stroke:/);
  assert.match(rule('.dash-rank__band'), /fill:\s*var\(--cyan-bg\)/);
});
