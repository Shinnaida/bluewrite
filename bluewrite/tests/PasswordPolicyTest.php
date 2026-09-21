<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Core\PasswordPolicy;
use PHPUnit\Framework\TestCase;

// No autoloader in this project: the pure tests require what they use.
require_once __DIR__ . '/../app/core/PasswordPolicy.php';

/**
 * The password rule, on its own.
 *
 * This is the rule three callers now share (account creation, an admin's reset,
 * and an officer changing their own), and it is the only place a weak password
 * can be stopped — the sign-in screen cannot help, because an account that
 * already exists has whatever password it was given. So the cases below are not
 * decoration: each one is a way an officer's password has actually been weak.
 *
 * No database and no HTTP: the class is a pure function of the text and the
 * account's identifiers, which is exactly why it was built that way.
 */
final class PasswordPolicyTest extends TestCase
{
    // --- length, the one requirement that costs an attacker work --------------

    public function testTheMinimumIsTwelveAndTenIsNoLongerEnough(): void
    {
        // The old rule, stated as a case: a ten-character password used to be
        // accepted here and is not any more. This is the assertion that would
        // fail if somebody quietly lowered the bar back.
        $this->assertSame(12, PasswordPolicy::MIN_LENGTH);
        $this->assertNotNull(PasswordPolicy::check('Abcdefghij'));
        $this->assertNull(PasswordPolicy::check('Abcdefghijkl'));
    }

    public function testAnEmptyPasswordIsRefused(): void
    {
        $this->assertSame('Enter a password.', PasswordPolicy::check(''));
    }

    public function testTheLengthMessageStatesTheNumberRatherThanRepeatingIt(): void
    {
        // The rule's number lives in ONE constant: the hint, the refusal and this
        // class's own constant cannot drift apart, because the sentence is built
        // from the constant.
        $this->assertSame(PasswordPolicy::hint(), PasswordPolicy::check('short'));
        $this->assertStringContainsString('12', PasswordPolicy::hint());
    }

    public function testTheByteCeilingIsEnforcedRatherThanTruncated(): void
    {
        // Not a policy preference: bcrypt ignores everything past 72 bytes, so a
        // longer password would have its tail quietly discarded — two different
        // long passwords sharing a first 72 bytes would open the same account.
        $this->assertSame(72, PasswordPolicy::MAX_BYTES);
        // Mixed characters on purpose: a run of ONE character is refused earlier
        // by its own rule, so a single-letter fixture would be testing the wrong
        // refusal (this is exactly what the first version of this test did).
        $this->assertNull(PasswordPolicy::check(str_repeat('abc', 20)), '60 bytes');
        // Exactly at the ceiling, which is ALLOWED — 72 bytes is what bcrypt can
        // see in full, so refusing it would be refusing a password that works.
        $atCeiling = str_repeat('abc', 24); // 24 x 3 = 72 bytes
        $this->assertNull(PasswordPolicy::check($atCeiling), 'exactly 72 bytes');
        $this->assertSame(
            'Password must be at most 72 characters.',
            PasswordPolicy::check($atCeiling . 'd'),
            '73 bytes: the tail would be ignored by the hash'
        );
        // BYTES, not characters: a multi-byte string hits the ceiling sooner,
        // which is the conservative direction and matches strlen in the hash.
        $this->assertSame(
            'Password must be at most 72 characters.',
            PasswordPolicy::check(str_repeat('จก', 15)),
            '30 Thai characters is 90 bytes'
        );
    }

    // --- long but guessable ABOUT THIS OFFICER --------------------------------

    public function testAPasswordContainingTheUsernameIsRefused(): void
    {
        // The failure this rule exists for: given a length minimum, the first
        // thing a person reaches for is their own name — and the username is
        // written on the roster an attacker already has.
        $this->assertNotNull(PasswordPolicy::check('jdelacruz2026!', 'jdelacruz', '1234'));
        $this->assertNotNull(PasswordPolicy::check('xJDelacruz2026x', 'jdelacruz', '1234'), 'ignoring case');
        $this->assertNotNull(PasswordPolicy::check('jdelacruzx2026!', '  jdelacruz  ', '1234'), 'ignoring padding');
    }

    public function testAPasswordContainingTheBadgeNumberIsRefused(): void
    {
        $this->assertNotNull(PasswordPolicy::check('patrol-car-4417', 'jdelacruz', '4417'));
    }

    public function testAShortIdentifierIsNotSearchedFor(): void
    {
        // A two-letter username is a substring of nearly every password, so
        // refusing those would be a rule nobody could satisfy and no security.
        // Four characters is the threshold (PasswordPolicy::MIN_IDENTIFIER).
        $this->assertNull(PasswordPolicy::check('sunflower-quiet-77', 'jd', '12'));
        // ...and four is searched for.
        $this->assertNotNull(PasswordPolicy::check('sunflower-4417-quiet', 'jd', '4417'));
    }

    public function testAnUnknownIdentifierIsNotTreatedAsAnEmptyMatch(): void
    {
        // Creation and reset both call this without a current password and, on
        // paths where the account is not yet loaded, without identifiers at all.
        // '' must never be "contained in" a password.
        $this->assertNull(PasswordPolicy::check('sunflower-quiet-77'));
        $this->assertNull(PasswordPolicy::check('sunflower-quiet-77', '', '', null));
    }

    // --- long and identity-free, but still worth nothing ----------------------

    public function testOneCharacterRepeatedIsRefused(): void
    {
        $this->assertNotNull(PasswordPolicy::check(str_repeat('a', 12)));
        $this->assertNotNull(PasswordPolicy::check(str_repeat('7', 20)));
        // Two different characters is not a repeated character, however weak; the
        // deny list and the length rule are what catch the rest.
        $this->assertNull(PasswordPolicy::check('abababababab'));
    }

    public function testTheObviousTwelveCharactersAreRefused(): void
    {
        // The list is a FLOOR, not a dictionary — this test says which floor.
        $this->assertNotNull(PasswordPolicy::check('password1234'));
        $this->assertNotNull(PasswordPolicy::check('PASSWORD1234'), 'case-insensitive');
        $this->assertNotNull(PasswordPolicy::check('bluewrite123'));
        $this->assertNotNull(PasswordPolicy::check('policestation'));
        // A password that merely CONTAINS one is not refused: substring-matching
        // the word "password" would fail far more real passwords than it saves.
        $this->assertNull(PasswordPolicy::check('passwordish-not-really'));
    }

    // --- reusing the current password -----------------------------------------

    public function testTheCurrentPasswordIsOnlyRefusedWhenTheCallerHasIt(): void
    {
        // Creation and reset pass null — there is nothing for the new password to
        // be the same as (and on creation there is no old password at all).
        $this->assertNull(PasswordPolicy::check('sunflower-quiet-77', '', '', null));
        // The change form passes it, and reusing it is refused: otherwise
        // "change your password" can be satisfied without changing anything.
        $this->assertSame(
            'Choose a password different from your current one.',
            PasswordPolicy::check('sunflower-quiet-77', '', '', 'sunflower-quiet-77')
        );
        $this->assertNull(PasswordPolicy::check('sunflower-quiet-78', '', '', 'sunflower-quiet-77'));
    }

    // --- the order the rules are reported in ----------------------------------

    public function testTheFirstProblemIsTheOneReported(): void
    {
        // Order matters because only one message is shown. Too short AND
        // identity-bearing says "too short" — the officer fixes the length and is
        // then told about the username, rather than being told about the username
        // and then, having fixed that, being told it is too short anyway.
        $this->assertSame(PasswordPolicy::hint(), PasswordPolicy::check('jdelacruz', 'jdelacruz', '1234'));
        // Past the length, the identity rule is reported before the deny list.
        $this->assertStringContainsString(
            'username or badge number',
            (string) PasswordPolicy::check('password1234', 'password1234', '')
        );
    }

    public function testAStrongPasswordIsAccepted(): void
    {
        // The rule has to be satisfiable by a person under pressure, in one try,
        // without a composition rule to reason about: a phrase works.
        $this->assertNull(PasswordPolicy::check('quiet-harbour-72', 'jdelacruz', '4417'));
        $this->assertNull(PasswordPolicy::check('noon shift, rainy', 'jdelacruz', '4417'));
        $this->assertNull(PasswordPolicy::check('নিরাপদ-গোপন-৭৭৭', 'jdelacruz', '4417'), 'length is counted in characters, not bytes');
    }
}
