<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\AvatarPhoto;
use App\Core\Database;
use App\Core\Response;
use PDO;

/**
 * Who is at a desk right now.
 *
 *   POST /presence/heartbeat   "still here" + the roster, in one round trip
 *
 * WHY ONE ROUTE AND NOT TWO. A roster read and a "still here" write happen on the
 * same beat, from the same client, and return the same list. Two endpoints would
 * mean two requests every thirty seconds per open workspace, and — worse — a
 * client that could read the roster without ever reporting itself, so the
 * station would show a crowd of officers who are all watching and never seen.
 *
 * WHY THE WRITE IS A WRITE. The client cannot be trusted to name who is online,
 * so the account comes from the SESSION and the timestamp from the DATABASE's own
 * clock (see the query below). The request body is ignored entirely: there is
 * nothing a caller can say that would make the answer more true.
 *
 * "ONLINE" IS A WINDOW, NOT A FLAG, and the window is this class's constant. A
 * flag would have to be cleared by the browser that has already gone away — the
 * laptop closed at five would still be on the roster at six. A window expires on
 * its own, and it is measured against the same clock that stamped the row.
 *
 * WHAT THE CLIENT IS TOLD. Not "these are online" alone, but HOW LONG AGO each
 * one was seen (`idle_seconds`) and what the window is (`window_seconds`). A
 * roster is a snapshot of a moving thing: a tab that loses the server must be
 * able to age the list it holds, and it cannot do that from a boolean. The
 * numbers come from the server because the server is the one clock in this
 * arrangement — a browser's clock on a station PC is whatever somebody set it
 * to.
 *
 * THE BEAT ALSO CARRIES THE UNREAD MESSAGE COUNTS, and that coupling is deliberate.
 * The rail marks a chathead with how many messages that colleague has sent that are
 * still unread, so the counts are ABOUT THE ROSTER — a second endpoint answering "who
 * has written to you" would let the two payloads disagree about who is on screen, and
 * would double the requests a LAN workstation makes per minute to say so. One beat,
 * one answer, and the marks cannot land on a face that is not there.
 *
 * Read from MessagesController rather than queried here, so "what counts as unread"
 * has exactly one author — the same rule the top bar's badge and the panel's own
 * clearing use.
 */
final class PresenceController
{
    /**
     * How long after the last heartbeat an account stops being "online".
     *
     * Two minutes against a thirty-second beat: four missed beats before a
     * colleague's chathead goes dark. Tighter (one beat) would make the roster
     * flicker whenever a poll is slow on a busy Wi-Fi; wider tells the station
     * somebody is at their desk a minute after they have left. Two minutes is
     * also short enough that the window itself is the answer to "are they still
     * here" rather than a number a reader has to interpret.
     */
    public const ONLINE_WINDOW_SECONDS = 120;

    /** The beat the client is expected to keep, echoed so the client need not own it. */
    public const HEARTBEAT_SECONDS = 30;

    public function heartbeat(): void
    {
        // ANY signed-in role. Presence is not a privilege: an officer needs to
        // know who else is on, and everybody on the roster is somebody the same
        // list already shows by name. The Admin-only screens are elsewhere.
        $me = Auth::requireUser();
        $pdo = Database::pdo();

        $pdo->prepare('UPDATE users SET last_seen_at = NOW() WHERE id = :id')
            ->execute([':id' => $me['id']]);

        $this->tally($pdo, (int) $me['id']);

        $messages = new MessagesController();

        Response::json(200, [
            // The window and the beat are the SERVER's, stated on every response
            // so the client's "fade a stale roster out" rule has real numbers to
            // use instead of its own guess at how long we wait.
            'window_seconds' => self::ONLINE_WINDOW_SECONDS,
            'heartbeat_seconds' => self::HEARTBEAT_SECONDS,
            'online' => $this->roster($pdo),
            // A LIST of {sender_id, count}, not an id-keyed object: see
            // MessagesController::unreadBySender on why one JSON shape is safer than
            // two possible ones.
            'message_unread' => $messages->unreadBySender(),
            'message_unread_total' => $messages->unreadTotalForSession(),
        ]);
    }

    /**
     * The roster: every active account seen inside the window, by name.
     *
     * ORDERED BY NAME, not by who was seen last. The circles sit in a column and
     * are read as a set; ordering by recency would re-shuffle that column every
     * time a colleague moved their mouse, and the one thing a reader learns from
     * a chathead — where it lives on the screen — would be the one thing that
     * changes. Name order is stable for as long as the same people are on.
     *
     * INACTIVE ACCOUNTS ARE EXCLUDED. A deactivated officer has no way to
     * heartbeat, so they would never appear anyway; the condition is here so that
     * the roster states the rule rather than relying on that.
     *
     * THE WINDOW IS INTERPOLATED as a literal. It is this class's own int
     * constant — never input — and the alternative, `INTERVAL ? SECOND`, is not
     * something MySQL accepts, while `TIMESTAMPDIFF(...) <= ?` would be
     * un-indexable. Written this way the predicate stays a range on
     * users.last_seen_at (migration 014's index) and NOW() is a constant for the
     * duration of the statement.
     */
    /**
     * Keep today's presence for this account — the same beat, remembered.
     *
     * WHY A SECOND WRITE ON A ROUTE THAT RUNS EVERY THIRTY SECONDS. `last_seen_at`
     * answers "are they here now" and is overwritten each time, so the account page's
     * attendance sheet had nothing to read: the trail knows when somebody signed in and
     * when they pressed Sign out, and nothing about the hours in between. This is that
     * beat kept as a history (migration 017), which is what makes "how long was this
     * officer at a desk on the 14th" a question the record can answer at all.
     *
     * WHAT IT ADDS, and the order matters. MySQL evaluates an `ON DUPLICATE KEY`
     * assignment list left to right and a later expression sees the value an earlier one
     * wrote — so `seconds` must be accumulated BEFORE `last_seen` moves, or the gap it
     * measures would be the one between this beat and itself. It reads `last_seen` from
     * the ROW (the previous beat) and adds the interval only when the two are close
     * enough to be one sitting; past that window the interval is a break, so nothing is
     * added and only `last_seen` moves forward.
     *
     * A ROW PER ACCOUNT PER DAY, not a row per beat: a beat is a liveness signal and not
     * an event worth 2,880 rows a day per officer, and the sheet asks a question about
     * days. The count of beats is kept because a day with ONE beat is a day somebody was
     * there, and a sum of intervals would call it zero.
     *
     * IT CANNOT FAIL THE BEAT. The roster is what a chathead rail draws and what the
     * unread counts ride on; a database that has not had migration 017 applied yet would
     * otherwise take the whole endpoint — and every officer's rail — down with it. So the
     * write is guarded: the beat is served either way, and the account page simply
     * estimates that day from the trail, exactly as it does for the days before the
     * table existed.
     */
    private function tally(PDO $pdo, int $userId): void
    {
        try {
            $stmt = $pdo->prepare(
                'INSERT INTO presence_days (user_id, day, first_seen, last_seen, seconds, beats)
                 VALUES (:uid, CURDATE(), NOW(), NOW(), 0, 1)
                 ON DUPLICATE KEY UPDATE
                   seconds = seconds + IF(TIMESTAMPDIFF(SECOND, last_seen, NOW()) <= :gap,
                                          TIMESTAMPDIFF(SECOND, last_seen, NOW()), 0),
                   last_seen = NOW(),
                   beats = beats + 1'
            );
            $stmt->execute([':uid' => $userId, ':gap' => self::ONLINE_WINDOW_SECONDS]);
        } catch (\Throwable $e) {
            error_log('presence tally skipped: ' . $e->getMessage());
        }
    }

    private function roster(PDO $pdo): array
    {
        $window = self::ONLINE_WINDOW_SECONDS;

        $rows = $pdo->query(
            "SELECT u.id, u.full_name, u.username, u.badge_number, u.photo_path, u.photo_updated_at,
                    r.name AS role,
                    TIMESTAMPDIFF(SECOND, u.last_seen_at, NOW()) AS idle_seconds,
                    TIMESTAMPDIFF(SECOND, u.last_login_at, NOW()) AS login_age_seconds
               FROM users u
               JOIN roles r ON r.id = u.role_id
              WHERE u.status = 'active'
                AND u.last_seen_at IS NOT NULL
                AND u.last_seen_at >= NOW() - INTERVAL {$window} SECOND
              ORDER BY u.full_name"
        )->fetchAll();

        return array_map([$this, 'present'], $rows);
    }

    /**
     * One roster entry, in the shape the client draws.
     *
     * `photo_url` is built here rather than in the browser for the same reason the
     * handshake's own URLs are: the cache key is users.photo_updated_at, and a
     * client that assembled the URL itself would have to be told the version too
     * — one fact in two places, and the one that goes stale is the one that keeps
     * showing a colleague's old photograph.
     */
    private function present(array $row): array
    {
        $id = (int) $row['id'];

        return [
            'id' => $id,
            'full_name' => (string) $row['full_name'],
            'username' => (string) $row['username'],
            'badge_number' => (string) $row['badge_number'],
            'role' => (string) $row['role'],
            'photo_url' => AvatarPhoto::url(
                $id,
                $row['photo_path'] === null ? null : (string) $row['photo_path'],
                $row['photo_updated_at'] === null ? null : (string) $row['photo_updated_at']
            ),
            // Never negative: a row stamped a fraction ahead of NOW() would
            // otherwise be reported as "seen -1 seconds ago", which the client
            // would print.
            'idle_seconds' => max(0, (int) $row['idle_seconds']),
            // How long ago this account signed in, as an AGE rather than as a
            // timestamp. The officer card says "signed in 2h ago", and an age
            // computed by the server needs no clock on the client at all — the
            // same reason idle_seconds is here instead of last_seen_at. NULL for
            // an account that has never signed in.
            'login_age_seconds' => $row['login_age_seconds'] === null
                ? null
                : max(0, (int) $row['login_age_seconds']),
        ];
    }
}
