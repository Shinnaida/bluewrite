<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Controllers\NarrativeController;
use PHPUnit\Framework\TestCase;

/**
 * The editor sends the officer's CURRENT Notable Findings and Action Taken /
 * Status text with a generate request. Autosave ticks only every 30 seconds,
 * so without those live values the AI would formalise the STALE saved text and
 * the draft would then overwrite the note the officer had just typed.
 *
 * The stored value still wins when the client sends nothing (older client),
 * and a deliberately CLEARED field is honoured (the AI simply has no
 * disposition to restate).
 *
 * Pure logic tests: no HTTP, no database, no API key.
 */
final class NarrativeLiveFieldsTest extends TestCase
{
    protected function setUp(): void
    {
        require_once __DIR__ . '/../app/controllers/NarrativeController.php';
    }

    public function testLiveTextIsTrimmedAndCapped(): void
    {
        $this->assertSame(
            'case is to be investigated',
            NarrativeController::liveText(['action_taken' => "  case is to be investigated\n"], 'action_taken', 4000)
        );
        $this->assertSame(
            'abcd',
            NarrativeController::liveText(['notable_findings' => 'abcdef'], 'notable_findings', 4)
        );
    }

    public function testAbsentOrNonStringFieldFallsBackToTheStoredValue(): void
    {
        // null → the controller keeps whatever the report row holds.
        $this->assertNull(NarrativeController::liveText([], 'action_taken', 4000));
        $this->assertNull(NarrativeController::liveText(['notes' => 'x'], 'action_taken', 4000));
        $this->assertNull(NarrativeController::liveText(['action_taken' => ['nope']], 'action_taken', 4000));
        $this->assertNull(NarrativeController::liveText(['action_taken' => 42], 'action_taken', 4000));
    }

    public function testAClearedFieldIsHonoured(): void
    {
        // Empty means "the officer cleared it": the AI must not be handed the
        // stale saved text (which it would then restate as the disposition).
        $this->assertSame('', NarrativeController::liveText(['action_taken' => ''], 'action_taken', 4000));
        $this->assertSame('', NarrativeController::liveText(['notable_findings' => "  \n "], 'notable_findings', 2000));
    }
}
