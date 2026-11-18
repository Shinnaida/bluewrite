<?php
declare(strict_types=1);

namespace App\Core;

/**
 * BlueWrite — the server half of the letter's Word-like layer.
 *
 * The prose fields (narrative, action_taken, type_specific.notable_findings)
 * store a SMALL html subset — b/i/u/strong/em/ul/ol/li/p/br — so the sheet
 * can carry emphasis the way a Word document does. Everything else is
 * stripped on save: the record keeps ink, never markup, scripts or styles.
 * Mirrors src/lib/richText.js; legacy plain-text rows (no tags) pass through
 * byte-identical, so no data migration is needed.
 */
final class RichText
{
    /** Tags the record may keep. Attributes never survive (see sanitize()),
     *  except the two formatting utilities in PROSE_CLASS. */
    private const ALLOWED = ['b', 'i', 'u', 'strong', 'em', 'ul', 'ol', 'li', 'span', 'p', 'br'];

    /** Font size and line spacing (owner request, 2026-11-17) — the same
     *  class-based utilities as the letterhead ink, so the record carries no
     *  arbitrary CSS. Mirrors PROSE_CLASS in src/lib/richText.js: a value
     *  here has a rule in styles.css, and nothing else survives. */
    private const PROSE_CLASS =
        '/^lh-(?:s-(?:10|11|12|13|14|15|16|18|20|22)|lh-(?:100|115|150|200|250|300))$/';

    /** The strip's free-entry size and spacing (owner request, 2026-11-17):
     *  any 8–72 px and 0.3–3.0, carried as two STRICT inline properties and
     *  nothing else. Mirrors PROSE_SIZE / PROSE_SPACING in src/lib/richText.js;
     *  the spacing floor is 0.3 (owner request, 2026-11-18: 0.3, 0.5 and 0.8
     *  are now offered beside Word's own 1.0-and-up ladder). */
    private const PROSE_SIZE = '/^(?:[89]|[1-6]\d|7[0-2])(?:\.\d)?px$/i';
    private const PROSE_SPACING = '/^(?:0\.[3-9]\d?|[12](?:\.\d{1,2})?|3(?:\.0{1,2})?)$/';

    /**
     * Allowlisted HTML. Unknown tags are unwrapped (their words kept),
     * comments and doctypes dropped, and every attribute stripped — only
     * bare <b>… shapes are re-emitted. Malformed input degrades to its
     * words, never to markup.
     */
    public static function sanitize(mixed $html): string
    {
        $src = (string) ($html ?? '');
        if ($src === '') {
            return '';
        }
        $out = '';
        $offset = 0;
        $pattern = '/<!--[\\s\\S]*?-->|<!doctype[^>]*>|<\\/?[a-zA-Z][a-zA-Z0-9]*(?:"[^"]*"|\'[^\']*\'|[^>"\'])*\\/?>|<[^>]*>/i';
        if (preg_match_all($pattern, $src, $matches, PREG_OFFSET_CAPTURE) !== false) {
            foreach ($matches[0] as $match) {
                [$token, $at] = $match;
                $out .= self::escapeText(substr($src, $offset, $at - $offset));
                $offset = $at + strlen($token);
                if (str_starts_with($token, '<!--') || str_starts_with($token, '<!')) {
                    continue;
                }
                if (preg_match('/^<\\/?([a-zA-Z][a-zA-Z0-9]*)/', $token, $nm) !== 1) {
                    continue;
                }
                $name = strtolower($nm[1]);
                if (!in_array($name, self::ALLOWED, true)) {
                    continue; // unwrap: words stay
                }
                if ($name === 'br') {
                    $out .= '<br>';
                    continue;
                }
                if (str_starts_with($token, '</')) {
                    $out .= "</{$name}>";
                    continue;
                }
                $attrs = '';
                if (preg_match('/\\bclass\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))/i', $token, $cm) === 1) {
                    $raw = trim((string) ($cm[2] ?? ($cm[3] ?? ($cm[4] ?? ''))));
                    $kept = [];
                    foreach (preg_split('/\\s+/', $raw) ?: [] as $one) {
                        if ($one !== '' && preg_match(self::PROSE_CLASS, $one) === 1 && !in_array($one, $kept, true)) {
                            $kept[] = $one;
                        }
                    }
                    if ($kept !== []) {
                        $attrs .= ' class="' . implode(' ', $kept) . '"';
                    }
                }
                $style = '';
                if (preg_match('/\\bstyle\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))/i', $token, $sm) === 1) {
                    $raw = (string) ($sm[2] ?? ($sm[3] ?? ($sm[4] ?? '')));
                    $keptStyle = [];
                    if (preg_match('/\\bfont-size\\s*:\s*([^;]+)/i', $raw, $zm) === 1) {
                        $v = strtolower((string) preg_replace('/\\s+/', '', trim($zm[1])));
                        if (preg_match(self::PROSE_SIZE, $v) === 1) {
                            $keptStyle[] = 'font-size:' . $v;
                        }
                    }
                    if (preg_match('/\\bline-height\\s*:\s*([^;]+)/i', $raw, $lm) === 1) {
                        $v = (string) preg_replace('/\\s+/', '', trim($lm[1]));
                        if (preg_match(self::PROSE_SPACING, $v) === 1) {
                            $keptStyle[] = 'line-height:' . $v;
                        }
                    }
                    if ($keptStyle !== []) {
                        $style = ' style="' . implode(';', $keptStyle) . '"';
                    }
                }
                $out .= "<{$name}{$attrs}{$style}>";
            }
        }
        $out .= self::escapeText(substr($src, $offset));
        return $out;
    }

    /** Tags a freed letter may keep: the prose subset plus the sheet's own
     * structure, so the letter round-trips its paper layout. */
    private const LETTER_TAGS = [
        'div', 'span', 'p', 'h1', 'h2', 'h3',
        'ul', 'ol', 'li', 'br',
        'b', 'i', 'u', 'strong', 'em',
    ];

    /**
     * Allowlisted HTML for a freed letter (see sanitizeLetterHtml in
     * src/lib/richText.js — the two must agree tag for tag). Unknown tags
     * are unwrapped, every attribute is stripped except a strict class
     * (word characters, dashes, spaces — the sheet's own hooks) and a
     * text-align on p/div, so the letter keeps its layout and nothing else.
     */
    public static function sanitizeLetter(mixed $html): string
    {
        $src = (string) ($html ?? '');
        if ($src === '') {
            return '';
        }
        $out = '';
        $offset = 0;
        $pattern = '/<!--[\\s\\S]*?-->|<!doctype[^>]*>|<\\/?[a-zA-Z][a-zA-Z0-9]*(?:"[^"]*"|\'[^\']*\'|[^>"\'])*\\/?>|<[^>]*>/i';
        if (preg_match_all($pattern, $src, $matches, PREG_OFFSET_CAPTURE) !== false) {
            foreach ($matches[0] as $match) {
                [$token, $at] = $match;
                $out .= self::escapeText(substr($src, $offset, $at - $offset));
                $offset = $at + strlen($token);
                if (str_starts_with($token, '<!--') || str_starts_with($token, '<!')) {
                    continue;
                }
                if (preg_match('/^<\\/?([a-zA-Z][a-zA-Z0-9]*)/', $token, $nm) !== 1) {
                    continue;
                }
                $name = strtolower($nm[1]);
                if (!in_array($name, self::LETTER_TAGS, true)) {
                    continue; // unwrap: words stay
                }
                if ($name === 'br') {
                    $out .= '<br>';
                    continue;
                }
                if (str_starts_with($token, '</')) {
                    $out .= "</{$name}>";
                    continue;
                }
                $attrs = '';
                if (preg_match('/\\bclass\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))/i', $token, $cm) === 1) {
                    $raw = (string) ($cm[2] ?? '');
                    if (trim($raw) === '') {
                        $raw = (string) ($cm[3] ?? '');
                    }
                    if (trim($raw) === '') {
                        $raw = (string) ($cm[4] ?? '');
                    }
                    $raw = (string) preg_replace('/\\s+/', ' ', trim($raw));
                    if ($raw !== '' && strlen($raw) <= 200 && preg_match('/^[A-Za-z0-9 _-]+$/', $raw) === 1) {
                        $attrs .= ' class="' . $raw . '"';
                    }
                }
                if (($name === 'p' || $name === 'div')
                    && preg_match('/\\btext-align\\s*:\\s*([a-zA-Z]+)|\\balign\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))/i', $token, $am) === 1) {
                    $word = strtolower(trim((string) ($am[3] ?? ($am[4] ?? ($am[5] ?? ($am[1] ?? ''))))));
                    if (in_array($word, ['left', 'center', 'right', 'justify'], true)) {
                        $attrs .= ' align="' . $word . '"';
                    }
                }
                $out .= "<{$name}{$attrs}>";
            }
        }
        $out .= self::escapeText(substr($src, $offset));
        // Whitespace BETWEEN blocks is never ink, and the letter draws
        // `pre-wrap` so an officer's typed indentation survives (see
        // `.pr-letter-html` in styles.css). A newline sitting between two block
        // tags would paint as a blank line there, so it is dropped once, here —
        // spaces INSIDE a block are the officer's and stay. Mirrors
        // sanitizeLetterHtml in src/lib/richText.js.
        return (string) preg_replace('/(<\\/(?:p|div|li|ul|ol|h[1-3])>|<br>)[ \\t]*\\R[ \\t\\n]*(?=<)/i', '$1', $out);
    }

    /**
     * The record's words without its ink: what length rules, the language
     * detector and the AI prompts read. Block breaks become newlines, every
     * tag is dropped, entities decoded, whitespace collapsed.
     */
    public static function plain(mixed $html): string
    {
        $src = (string) ($html ?? '');
        if ($src === '') {
            return '';
        }
        $withBreaks = preg_replace('/<(br|p|li|ul|ol|tr)\\b[^>]*>/i', "\n", $src) ?? '';
        $withBreaks = preg_replace('/<\\/(p|li|ul|ol|div|h[1-6]|tr|table)>/i', "\n", $withBreaks) ?? '';
        $noTags = preg_replace('/<[^>]*>/', '', $withBreaks) ?? '';
        $text = html_entity_decode($noTags, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        // &nbsp; decodes to U+00A0, which the whitespace collapse below would
        // not fold: normalize it to a plain space first (mirrors richText.js).
        $text = str_replace("\u{00A0}", ' ', $text);
        $lines = explode("\n", $text);
        $kept = [];
        foreach ($lines as $line) {
            $line = trim((string) preg_replace('/[ \\t]+/', ' ', $line));
            if ($line !== '') {
                $kept[] = $line;
            }
        }
        return implode("\n", $kept);
    }

    /** True when the value carries any of the subset's tags. */
    public static function containsTags(mixed $value): bool
    {
        return preg_match('/<(b|i|u|strong|em|ul|ol|li|p|br)\\b/i', (string) ($value ?? '')) === 1;
    }

    private static function escapeText(string $s): string
    {
        // Entity-aware escaper (mirrors escapeText in src/lib/richText.js):
        // the editor serializes NBSP as `&nbsp;`, so a naive `&` → `&amp;`
        // pass doubles it on every save (`&nbsp;` → `&amp;nbsp;` →
        // `&amp;amp;nbsp;`). Decoding to a fixpoint first keeps stored
        // entities stable across round trips.
        $prev = $s;
        for ($i = 0; $i < 3; $i++) {
            $next = html_entity_decode($prev, ENT_QUOTES | ENT_HTML5, 'UTF-8');
            if ($next === $prev) {
                break;
            }
            $prev = $next;
        }
        $out = str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $prev);
        return str_replace("\u{00A0}", '&nbsp;', $out);
    }
}
