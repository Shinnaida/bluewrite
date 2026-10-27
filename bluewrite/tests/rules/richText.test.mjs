// BlueWrite — the letter's Word-like layer (src/lib/richText.js).
//
// The narrative stores a SMALL html subset (bold, italic, underline, lists,
// paragraph alignment) so the sheet carries emphasis like a Word document,
// while every reader of
// the record (rules, language detection, AI, print) keeps working on words.
// These are the guarantees that subset must hold: an allowlist that cannot
// be smuggled past, a plain-text reading that never loses a word, and a tag
// detector that decides the sheet's render path (html as-is vs cased text).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeRichHtml,
  sanitizeLetterHtml,
  richTextToPlain,
  containsRichTags,
} from '../../src/lib/richText.js';

test('only the subset survives, bare and attribute-free', () => {
  assert.equal(sanitizeRichHtml('<b>bold</b> <i>it</i> <u>un</u>'), '<b>bold</b> <i>it</i> <u>un</u>');
  assert.equal(sanitizeRichHtml('<strong>s</strong> <em>e</em>'), '<strong>s</strong> <em>e</em>');
  assert.equal(sanitizeRichHtml('<ul><li>one</li><li>two</li></ul>'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(sanitizeRichHtml('a<br>b'), 'a<br>b');
  assert.equal(sanitizeRichHtml('a<br/>b'), 'a<br>b');
  assert.equal(sanitizeRichHtml('<p>plain block</p>'), '<p>plain block</p>');
  assert.equal(sanitizeRichHtml('<div>plain division</div>'), '<div>plain division</div>');
});

test('attributes, scripts, styles and comments never reach the record', () => {
  assert.equal(
    sanitizeRichHtml('<b class="x" style="color:red" onclick="y()">hi</b>'),
    '<b>hi</b>',
  );
  assert.equal(sanitizeRichHtml('<script>alert(1)</script>'), 'alert(1)');
  assert.equal(sanitizeRichHtml('<style>p{color:red}</style>'), 'p{color:red}');
  assert.equal(sanitizeRichHtml('a<!-- hidden -->b'), 'ab');
  assert.equal(sanitizeRichHtml('<div><span>words stay</span></div>'), '<div>words stay</div>');
  assert.equal(sanitizeRichHtml('<a href="http://x">link words stay</a>'), 'link words stay');
});

test('only a strict text-align survives, normalized onto p and div', () => {
  // The ribbon's alignment buttons, and nothing else: Word values only, on
  // blocks only, re-emitted as align="…" whatever shape carried them in.
  assert.equal(sanitizeRichHtml('<p style="text-align: center">x</p>'), '<p align="center">x</p>');
  assert.equal(sanitizeRichHtml('<div style="text-align:right">x</div>'), '<div align="right">x</div>');
  assert.equal(sanitizeRichHtml('<p align=center>x</p>'), '<p align="center">x</p>');
  assert.equal(sanitizeRichHtml('<p style="text-align: justify">x</p>'), '<p align="justify">x</p>');
  assert.equal(sanitizeRichHtml('<div style="text-align: justify">x</div>'), '<div align="justify">x</div>');
  assert.equal(sanitizeRichHtml('<p align="justify">x</p>'), '<p align="justify">x</p>');
  assert.equal(sanitizeRichHtml('<P STYLE="TEXT-ALIGN: JUSTIFY">x</P>'), '<p align="justify">x</p>');
  assert.equal(
    sanitizeRichHtml('<p style="text-align: justify; color: red">x</p>'),
    '<p align="justify">x</p>',
  );
  assert.equal(sanitizeRichHtml('<p style="text-align:left">x</p>'), '<p align="left">x</p>');
  assert.equal(sanitizeRichHtml('<div align="left">x</div>'), '<div align="left">x</div>');
  assert.equal(
    sanitizeRichHtml('<p style="text-align: center; color: red; font-size: 99pt">x</p>'),
    '<p align="center">x</p>',
  );
  // Anything else with the same name shape is still dropped: bad values,
  // alignment on inline tags, and every other style or attribute.
  assert.equal(sanitizeRichHtml('<p style="text-align: top">x</p>'), '<p>x</p>');
  assert.equal(sanitizeRichHtml('<p style="color: red">x</p>'), '<p>x</p>');
  assert.equal(sanitizeRichHtml('<p align="justify middle">x</p>'), '<p>x</p>');
  assert.equal(sanitizeRichHtml('<b style="text-align:center">x</b>'), '<b>x</b>');
  assert.equal(sanitizeRichHtml('<span style="text-align:center">x</span>'), 'x');
  assert.equal(sanitizeRichHtml('<font face="arial">x</font>'), 'x');
});

test('stray angle brackets and ampersands degrade to text, never markup', () => {
  assert.equal(sanitizeRichHtml('5 < 7 & counting'), '5 &lt; 7 &amp; counting');
  assert.equal(sanitizeRichHtml('a < b'), 'a &lt; b');
});

test('the plain reading keeps every word with its breaks', () => {
  assert.equal(richTextToPlain('<p>One <b>two</b></p><p>three</p>'), 'One two\nthree');
  assert.equal(richTextToPlain('<ul><li>a</li><li>b</li></ul>'), 'a\nb');
  assert.equal(richTextToPlain('line one<br>line two'), 'line one\nline two');
  assert.equal(richTextToPlain('plain text, no tags'), 'plain text, no tags');
  assert.equal(richTextToPlain('<b>Ana &amp; Maria</b>&nbsp;left'), 'Ana & Maria left');
});

test('the freed letter keeps its paper structure and hooks', () => {
  // The letter subset is the prose subset plus the sheet's own blocks — so a
  // freed letter round-trips the layout the canvas was seeded from. Mirrors
  // RichText::sanitizeLetter on the server; the pair must agree tag for tag.
  assert.equal(sanitizeLetterHtml('<div class="pr-facts"><p>Hi</p></div>'), '<div class="pr-facts"><p>Hi</p></div>');
  assert.equal(sanitizeLetterHtml('<h1 class="pr-title">T</h1>'), '<h1 class="pr-title">T</h1>');
  assert.equal(sanitizeLetterHtml('<span class="a b-c_d">x</span>'), '<span class="a b-c_d">x</span>');
  assert.equal(sanitizeLetterHtml('<ul><li>one</li><li>two</li></ul>'), '<ul><li>one</li><li>two</li></ul>');
  assert.equal(sanitizeLetterHtml('<p style="text-align:center">x</p>'), '<p align="center">x</p>');
  assert.equal(sanitizeLetterHtml('<b>bold</b> <i>it</i>'), '<b>bold</b> <i>it</i>');
});

test('the freed letter drops everything that is not ink and hooks', () => {
  assert.equal(sanitizeLetterHtml('<b onclick="y()" style="color:red">hi</b>'), '<b>hi</b>');
  assert.equal(sanitizeLetterHtml('<span class="pr-word" onclick="x()">yo</span>'), '<span class="pr-word">yo</span>');
  assert.equal(sanitizeLetterHtml('<span class="a;b">x</span>'), '<span>x</span>');
  assert.equal(sanitizeLetterHtml('<div id="paper" data-x="1">x</div>'), '<div>x</div>');
  assert.equal(sanitizeLetterHtml('<script>alert(1)</script>'), 'alert(1)');
  assert.equal(sanitizeLetterHtml('<div><section><p>deep</p></section></div>'), '<div><p>deep</p></div>');
  assert.equal(sanitizeLetterHtml('<div><img src=x></div>'), '<div></div>');
  assert.equal(sanitizeLetterHtml('a<!-- hidden -->b'), 'ab');
});

test('the detector only answers the subset', () => {
  assert.equal(containsRichTags('plain words'), false);
  assert.equal(containsRichTags('a <b>b</b>'), true);
  assert.equal(containsRichTags('<ul><li>x</li></ul>'), true);
  assert.equal(containsRichTags('<div align="center">x</div>'), true);
  assert.equal(containsRichTags('<p align="justify">x</p>'), true);
  assert.equal(containsRichTags('5 < 7'), false);
  assert.equal(containsRichTags('<script>x</script>'), false);
  assert.equal(containsRichTags(''), false);
  assert.equal(containsRichTags(null), false);
});
