<?php
declare(strict_types=1);

namespace App\Core;

/**
 * The password rule, in ONE place.
 *
 * WHY THIS CLASS EXISTS. The rule used to be the literal `strlen($password) < 10`
 * typed into TWO controllers — account creation and the admin's reset — with the
 * same sentence copy-pasted beside each. A third copy was about to be added for
 * the officer's own change-password form, and a rule with three homes gets three
 * answers: the moment one of them is tightened, the other two become the way
 * around it. So the rule moved here and every caller asks this class.
 *
 * WHAT IT REQUIRES, and why each one is here rather than something else:
 *
 *   LENGTH. Twelve characters, up from ten. Length is the only requirement that
 *     reliably costs an attacker work; every other rule below is about stopping
 *     a password that is long but GUESSABLE ABOUT THIS OFFICER.
 *
 *   NOT THE ACCOUNT'S OWN IDENTIFIERS. A password may not contain the account's
 *     username or badge number. This is the failure mode that actually happens:
 *     given a twelve-character minimum, the first thing a person reaches for is
 *     their own name and badge, and an attacker who has the username — which is
 *     also the thing written on the roster — then has the password too.
 *     Identifiers shorter than 4 characters are ignored: a two-letter username is
 *     a substring of almost every password, and refusing those would be a rule
 *     nobody could satisfy for no security at all.
 *
 *   NOT ONE CHARACTER REPEATED. "aaaaaaaaaaaa" clears a length minimum and is
 *     worth nothing. Cheap to state, and it needs no composition classes.
 *
 *   NOT A HANDFUL OF GUESSES. A short deny list of the passwords that appear at
 *     the top of every dump. It is a FLOOR, not a defence against a dictionary —
 *     say so plainly rather than implying the list is a guarantee.
 *
 * DELIBERATELY ABSENT: uppercase/digit/symbol composition rules. They do not add
 *   entropy, they push people to "Password123!", and they would make this the
 *   only rule in the app that has to be explained to an officer with an example.
 *   Length plus "not guessable about you" is the promise, and it is a promise the
 *   sign-in screen can state in one line (see hint()).
 *
 * NO DEPENDENCIES. No database, no Config, no Validator: a pure function of the
 * text and the account's identifiers, so it can be tested on its own and called
 * from anywhere. tests/PasswordPolicyTest.php is why that matters.
 *
 * THE CLIENT MIRRORS THIS, and the mirror is deliberate rather than a second
 * home: src/lib/passwordPolicy.js repeats the rules so the officer is told what
 * is wrong before the round trip, exactly as the client mirrors the server's
 * language and incident-type rules. THIS FILE IS AUTHORITATIVE — the server
 * refuses what this class refuses no matter what the client believes — and the
 * JS test reads MIN_LENGTH out of this file so the two cannot quietly disagree
 * about the number.
 */
final class PasswordPolicy
{
    /** Twelve, up from ten. See the class note. */
    public const MIN_LENGTH = 12;

    /**
     * The ceiling, and it is a BYTE count rather than a character one because it
     * is not a policy choice — it is bcrypt. `password_hash(..., PASSWORD_BCRYPT)`
     * silently ignores everything past 72 bytes, so without this rule two
     * different long passwords that share their first 72 bytes would both open
     * the same account, and an officer who meant to add a word to the end of a
     * long passphrase would have added nothing. PHP 8.3 raises no warning about
     * this, which is what makes it worth stating rather than leaving to be
     * discovered.
     *
     * Measured in bytes, so a password in a multi-byte script is refused sooner
     * than 72 visible characters — the conservative direction, and the only one
     * that matches what the hash actually does.
     */
    public const MAX_BYTES = 72;

    /**
     * Identifiers shorter than this are not searched for inside the password.
     * Four is the shortest length at which the check is about the account rather
     * than about the alphabet.
     */
    private const MIN_IDENTIFIER = 4;

    /**
     * The passwords that appear at the top of every credential dump, plus the
     * ones this app's own subject matter would suggest. Case-insensitive.
     *
     * A FLOOR, NOT A DICTIONARY. It exists so the most obvious twelve characters
     * a person could type — "password1234" — are refused. It is not a substitute
     * for length and it is not presented as one.
     *
     * @var string[]
     */
    private const COMMON = [
        'password', 'passw0rd', 'password1', 'password123', 'password1234',
        '123456789012', 'qwertyuiop12', 'letmein12345', 'iloveyou1234',
        'welcome12345', 'changeme1234', 'administrator', 'administrator1',
        'bluewrite', 'bluewrite123', 'incidentreport', 'officialreport',
        'policestation', 'pnp123456789', 'admin1234567',
    ];

    /**
     * The first problem with a password, or null if there is none.
     *
     * Returns a MESSAGE rather than a boolean because every caller has to show
     * one, and three callers inventing their own wording for the same rule is the
     * same drift this class was made to stop. The text is written to be read by
     * the officer, not by a developer.
     *
     * @param string      $password        the candidate
     * @param string      $username        the account's username ('' when unknown)
     * @param string      $badge           the account's badge number ('' when unknown)
     * @param string|null $currentPassword the account's CURRENT password, when the
     *                                     caller has it. Only the change form does;
     *                                     creation and reset pass null, because there
     *                                     is nothing to be the same as.
     */
    public static function check(
        string $password,
        string $username = '',
        string $badge = '',
        ?string $currentPassword = null
    ): ?string {
        if ($password === '') {
            return 'Enter a password.';
        }
        if (mb_strlen($password) < self::MIN_LENGTH) {
            return self::hint();
        }
        if (strlen($password) > self::MAX_BYTES) {
            // Refused rather than truncated. See MAX_BYTES.
            return 'Password must be at most ' . self::MAX_BYTES . ' characters.';
        }
        if (self::isOneRepeatedCharacter($password)) {
            return 'Password cannot be the same character repeated.';
        }
        if (self::holdsAnIdentifier($password, $username) || self::holdsAnIdentifier($password, $badge)) {
            return 'Password cannot contain your username or badge number.';
        }
        if (in_array(mb_strtolower($password), self::COMMON, true)) {
            return 'That password is too easy to guess. Choose a different one.';
        }
        if ($currentPassword !== null && $currentPassword !== '' && $password === $currentPassword) {
            return 'Choose a password different from your current one.';
        }
        return null;
    }

    /** The rule as one line, for a field hint under the field it applies to. */
    public static function hint(): string
    {
        return 'At least ' . self::MIN_LENGTH . ' characters.';
    }

    /**
     * True when every character is the same one. mb_strlen/mb_substr rather than
     * strlen/$password[0] so a multi-byte character is one character here, which
     * is what the person typing it would say it was.
     */
    private static function isOneRepeatedCharacter(string $password): bool
    {
        $first = mb_substr($password, 0, 1);
        // The repeated FIRST character compared against the whole password — not
        // the first character against the repetition, which is a one-character
        // string compared to a twelve-character one and is never equal.
        return str_repeat($first, mb_strlen($password)) === $password;
    }

    /**
     * True when the password contains this identifier, ignoring case and
     * surrounding space. Short identifiers are skipped — see MIN_IDENTIFIER.
     */
    private static function holdsAnIdentifier(string $password, string $identifier): bool
    {
        $needle = mb_strtolower(trim($identifier));
        if (mb_strlen($needle) < self::MIN_IDENTIFIER) {
            return false;
        }
        return mb_strpos(mb_strtolower($password), $needle) !== false;
    }
}
