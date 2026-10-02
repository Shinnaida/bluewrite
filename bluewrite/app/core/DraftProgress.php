<?php
declare(strict_types=1);

namespace App\Core;

/**
 * HOW FAR ALONG A DRAFT IS — the read-out every draft card on Home wears.
 *
 * WHY IT IS DERIVED HERE rather than stored. The number changes on every
 * keystroke of the writer, and the writer is not the only client: the value has
 * to be right for a draft saved by the form, by curl, or by an older build, and
 * a column that only the current client knows to update is a number that goes
 * stale the first time anything else writes the row. So it is computed from the
 * row at the moment the list is read, exactly as the verification status beside
 * it is (see ReportVerification), and the list then DROPS the columns it was
 * read from (see ReportsController::index) — the register still carries no
 * narrative, no per-type blob and no reporting-party detail.
 *
 * WHAT IT COUNTS, and what it deliberately does not. A section counts when it
 * HOLDS SOMETHING — the same signal the writer's own section chips read
 * (`sectionHasContent` in src/components/Reports.jsx). It is NOT the writer's
 * "no finalize problem" state (`computeStepProgress`), for a reason that is
 * worth stating: the API's mirror of the finalize rules is deliberately more
 * permissive than the browser's — Action Taken and the Investigator-on-case are
 * optional to the validator, because drafting a report is exactly the state in
 * which stopping half-way has to be allowed — so a COMPLETE tally computed here
 * could call a section finished that the dots in the writer say is not. A count
 * of what is on the page makes no claim about the rules, so it cannot disagree
 * with anything.
 *
 * The five sections are the writer's own, in reading order. Their paths are the
 * mirror of STEPPER_STEPS in src/components/Reports.jsx, and
 * tests/rules/draftProgress.test.mjs fails if the two lists drift apart: a new
 * section in the writer with no line here would show up as a card that never
 * reaches its own total.
 */
final class DraftProgress
{
    /**
     * One entry per section, holding the fields that mean the section has been
     * worked on. Empty means "read it another way" — the polymorphic section has
     * no fixed path, so its content lives in the per-type blob (below).
     */
    private const SECTIONS = [
        // I. Reporting party
        ['reporter_name', 'reporter_contact', 'reporter_address'],
        // II. Incident details
        ['incident_type', 'incident_datetime', 'location'],
        // Narrative — the account itself, which is a section of its own in the
        // writer and carries no numeral (it is the text the numbered forms sit
        // around).
        ['narrative'],
        // III. Parties Involved — the polymorphic section: any per-type scalar
        // plus the rows of whichever repeatable groups that type has.
        [],
        // IV. Action taken
        ['action_taken', 'ioc_name'],
    ];

    /** Which of the entries above is the polymorphic one. */
    private const TYPE_SPECIFIC_SECTION = 3;

    /**
     * @param array<string, mixed> $row a `reports` row carrying the columns the
     *   list selects for this read-out: the section fields, `narrative`, and
     *   `type_specific` (raw JSON or already decoded).
     * @return array{done: int, total: int}
     */
    public static function forRow(array $row): array
    {
        $done = 0;

        foreach (self::SECTIONS as $index => $paths) {
            if ($index === self::TYPE_SPECIFIC_SECTION) {
                if (self::typeSpecificHasContent($row['type_specific'] ?? null)) {
                    $done++;
                }
                continue;
            }
            foreach ($paths as $path) {
                if (self::filled($row[$path] ?? null)) {
                    $done++;
                    break;
                }
            }
        }

        return ['done' => $done, 'total' => count(self::SECTIONS)];
    }

    /** Has anything been typed into this field? The writer's `anyFilled`. */
    private static function filled(mixed $value): bool
    {
        return trim((string) ($value ?? '')) !== '';
    }

    /**
     * Any value at all in the per-type blob — a scalar (Notable findings) or a
     * non-blank row of one of the type's groups. Mirrors `typeSpecificHasContent`
     * in src/components/Reports.jsx, which reads the same blob in the writer: one
     * meaning, two languages, and the same depth of nesting (a group is a list of
     * rows, and a row is a bag of scalars — nothing deeper exists).
     */
    private static function typeSpecificHasContent(mixed $raw): bool
    {
        $blob = is_string($raw) ? json_decode($raw, true) : $raw;
        if (!is_array($blob)) {
            return false;
        }

        foreach ($blob as $value) {
            if (!is_array($value)) {
                if (self::filled($value)) {
                    return true;
                }
                continue;
            }
            foreach ($value as $row) {
                if (!is_array($row)) {
                    if (self::filled($row)) {
                        return true;
                    }
                    continue;
                }
                foreach ($row as $cell) {
                    if (self::filled($cell)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }
}
