<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\AvatarPhoto;
use App\Core\Database;
use App\Core\Response;
use PDO;

/**
 * Messages between officers.
 *
 *   GET  /messages                the conversation list, newest first
 *   POST /messages                send one
 *   GET  /messages/contacts       every active account, for starting a new one
 *   GET  /messages/:id            the thread with one account
 *   POST /messages/:id/seen       mark what has been read
 *   POST /messages/:id/typing     "I am writing to you" — a latch, not a message
 *
 * ANY SIGNED-IN ROLE, and the scope is the session's own id on every route here.
 * There is no cross-account read: `WHERE sender_id = :me OR recipient_id = :me` is the
 * whole permission model, and it is applied in each query rather than checked once and
 * trusted afterwards. An administrator reading somebody else's messages is not a thing
 * this system can do, which is deliberate — see the note on the audit trail below.
 *
 * WHAT IS DELIBERATELY NOT WRITTEN DOWN. Sending a message does not touch
 * `audit_logs`, and that is a decision rather than an omission. The audit trail is
 * read by administrators — that is what it is for — so a log line carrying a private
 * message between two officers would be a silent disclosure of its contents into a
 * screen the sender never expected to be read on. The message row is the record.
 * (Compare AuthController::setPhoto, which DOES audit: a photograph is a change to an
 * account's record, which is an administrative event. A sentence to a colleague is
 * not.)
 *
 * "READ" IS A TIMESTAMP THE RECIPIENT'S OWN CLIENT SETS, with the newest id it
 * actually painted — not "now", and not on send. The notifications watermark made the
 * same choice for the same reason: an id that was never on screen must not be marked
 * read, and the recipient is the only party who knows which those were.
 *
 * THE CLOCK IS THE DATABASE'S. `created_at` is never supplied by a client, and every
 * age and label the panel prints is computed here — a station PC's clock is whatever
 * somebody set it to, and a thread that says "2 minutes ago" has to mean it.
 *
 * THE SENDER CAN NOW SEE THAT A MESSAGE WAS READ, and that reverses an earlier
 * decision on purpose rather than by drift. `read_at` was always on the wire (it is
 * the recipient's own unread predicate and the row carries it), and the panel used to
 * take it and draw nothing with it while this file's comment said the station did not
 * promise it back. Two accounts of one fact is one too many, and a double check beside
 * your own sentence is the thing that tells you whether the officer at the other end
 * has actually seen it — which on a station line is the difference between having
 * handed something over and having left it in a box. What did NOT change: the
 * recipient still marks it, only they can mark it, and it can never be forged from the
 * sender's side (`seen()` marks `WHERE recipient_id = :me` and nothing else).
 *
 * TYPING IS A LATCH IN ITS OWN TABLE AND NOT A COLUMN ON A MESSAGE, because it is not
 * about a message. Nothing has been sent yet — this is the one fact a station line
 * needs that cannot be derived from what has been said, and it is deliberately the
 * smallest thing that can carry it: a stamp, overwritten in place, aimed at exactly
 * one colleague. See migration 016 for why it is not a log, and `send()` for why the
 * stamp is cleared the moment the message it was announcing actually lands.
 */
final class MessagesController
{
    /** Longest message. A paragraph of handover notes, not a report. */
    public const MAX_BODY = 1000;

    /**
     * How many messages one thread read returns.
     *
     * Fifty, walked backwards with `?before=`. Not "all of them": a conversation that
     * has been running for a year is not something to serialise into one response on a
     * station PC, and the panel only ever shows the tail.
     */
    public const THREAD_PAGE = 50;

    /**
     * How long a typing stamp keeps meaning "and still is".
     *
     * SIX SECONDS against a client that re-stamps every 2.5 (see TYPING_PING_MS in
     * src/lib/messages.js): the gap is more than twice the beat, so one lost request on
     * a busy LAN does not blink the dots off and on, and the tail after somebody stops
     * is short enough to be read as "they paused" rather than as a stuck indicator.
     *
     * IT IS ALSO THE EXPIRY. Nothing deletes a stale row — a crash, a closed lid or a
     * session that never said goodbye leaves one behind, and age is what makes it
     * harmless (see migration 016). The number is asserted against the JS constant in
     * tests/rules/messages.test.mjs, because two copies of one window is exactly the
     * kind of pair that drifts.
     */
    public const TYPING_WINDOW = 6;

    /**
     * The least time between two writes of the same stamp.
     *
     * A courtesy to the database rather than a rule the client is trusted to follow: an
     * account typing "I will be there in ten minutes" at speed sends a request per
     * keystroke burst, and a fast typist would otherwise produce several writes a second
     * to say the same thing. At two seconds, a client that ignores every instruction to
     * slow down still cannot make this expensive, and a compliant one (2.5s) never sees
     * the guard fire at all.
     */
    public const TYPING_MIN_GAP = 2;

    /**
     * The conversation list, newest conversation first.
     *
     * ONE QUERY FOR THE AGGREGATES, two small ones to name what they point at. The
     * aggregate is per counterpart and carries the two things the list draws: the last
     * message's id, and how many of that counterpart's messages are unread. Doing it
     * with a join to "the newest row per peer" would be the same answer in one
     * statement and considerably harder to read; this is a station's message table.
     */
    public function index(): void
    {
        $me = Auth::requireUser();
        $pdo = Database::pdo();
        $uid = (int) $me['id'];

        // FOUR NAMES FOR ONE VALUE, and that is a PDO rule rather than a style choice:
        // this deployment prepares with EMULATE_PREPARES OFF (see Database::pdo), and a
        // native MySQL prepare binds a named marker EXACTLY ONCE — reusing `:me` here
        // fails with "Invalid parameter number" at execution, which looks like a server
        // fault rather than the one-line mistake it is. The alternative, positional
        // markers, would make this query unreadable for no gain.
        $rows = $pdo->prepare(
            "SELECT IF(sender_id = :me_if, recipient_id, sender_id) AS peer_id,
                    MAX(id) AS last_id,
                    SUM(CASE WHEN recipient_id = :me_case AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
               FROM messages
              WHERE sender_id = :me_sender OR recipient_id = :me_recipient
              GROUP BY peer_id
              ORDER BY last_id DESC"
        );
        $rows->execute([':me_if' => $uid, ':me_case' => $uid, ':me_sender' => $uid, ':me_recipient' => $uid]);
        $aggregates = $rows->fetchAll();

        if ($aggregates === []) {
            Response::json(200, ['unread_total' => 0, 'conversations' => []]);
        }

        $lastIds = array_map(static fn (array $r): int => (int) $r['last_id'], $aggregates);
        $lasts = $this->lastMessages($pdo, $lastIds);
        $peers = $this->identities($pdo, array_map(static fn (array $r): int => (int) $r['peer_id'], $aggregates));

        $conversations = [];
        $unreadTotal = 0;

        foreach ($aggregates as $row) {
            $peerId = (int) $row['peer_id'];
            $lastId = (int) $row['last_id'];

            // A row whose counterpart has since been deleted cannot be named or linked,
            // so it is left out rather than drawn as a blank face. Nothing in the app
            // deletes an account today, which is exactly why this has to be here: the
            // day it can, this is the line that stops the panel drawing a ghost.
            if (!isset($peers[$peerId], $lasts[$lastId])) {
                continue;
            }

            $unread = (int) $row['unread'];
            $unreadTotal += $unread;

            $conversations[] = [
                'peer' => $peers[$peerId],
                'last' => $this->message($lasts[$lastId], $uid),
                'unread' => $unread,
            ];
        }

        Response::json(200, ['unread_total' => $unreadTotal, 'conversations' => $conversations]);
    }

    /**
     * Every active account except the session's own, for starting a conversation with
     * somebody who is not on the roster right now.
     *
     * WHY THIS IS NOT `GET /users`. That route is admin-only and asserted as such
     * (tests/RbacTest.php), because it is the user ADMINISTRATION view: it carries
     * email, status, role assignment and the sign-in state of every account. This one
     * exists for one purpose — addressing a message — and carries the shortest list
     * that can do it: who they are, what they look like, what their role and badge
     * read as, and whether they are at a desk. No email, no status, no last sign-in,
     * and nothing about the second factor. A staff account may address a message to a
     * colleague without being able to administer them.
     *
     * `online` is computed here from the SAME window PresenceController defines, read
     * from that class rather than typed out again: the panel marks the colleagues it
     * could also have reached through the rail, and two copies of "two minutes" would
     * be two answers to one question.
     */
    public function contacts(): void
    {
        $me = Auth::requireUser();
        $pdo = Database::pdo();
        $window = PresenceController::ONLINE_WINDOW_SECONDS;

        $rows = $pdo->prepare(
            "SELECT u.id, u.full_name, u.username, u.badge_number,
                    u.photo_path, u.photo_updated_at, u.last_seen_at,
                    r.name AS role,
                    CASE WHEN u.last_seen_at IS NOT NULL
                          AND u.last_seen_at >= NOW() - INTERVAL {$window} SECOND
                         THEN 1 ELSE 0 END AS online
               FROM users u
               JOIN roles r ON r.id = u.role_id
              WHERE u.status = 'active' AND u.id <> :me
              ORDER BY u.full_name"
        );
        $rows->execute([':me' => (int) $me['id']]);

        $contacts = array_map(
            fn (array $row): array => $this->identity($row) + ['online' => (bool) $row['online']],
            $rows->fetchAll()
        );

        Response::json(200, ['contacts' => $contacts]);
    }

    /**
     * The thread with one account: both directions, oldest last, `?before=<id>` to walk
     * backwards.
     *
     * The counterpart is returned with it, because the panel draws a face and a name at
     * the top of the conversation and the rail it may have been opened from is not
     * necessarily on screen — for a message from somebody who has since gone offline,
     * it is the only place that name can come from.
     *
     * The unread count comes back with it so the panel can clear the mark it is looking
     * at without a second request, and so it can say how many are left further up.
     */
    public function thread(string $otherId): void
    {
        $me = Auth::requireUser();
        $pdo = Database::pdo();
        $uid = (int) $me['id'];
        $other = $this->requirePeer($pdo, $otherId, $uid);

        $before = isset($_GET['before']) ? (int) $_GET['before'] : 0;
        // One more than a page, so "is there anything older" is answered by the same
        // read rather than by a COUNT over the whole thread — and a thread of exactly
        // one page does not claim a page it does not have.
        $limit = self::THREAD_PAGE + 1;

        // Distinct names for the reused values, for the reason spelled out in index().
        $sql = "SELECT m.id, m.sender_id, m.recipient_id, m.body, m.created_at, m.read_at,
                       TIMESTAMPDIFF(SECOND, m.created_at, NOW()) AS age_seconds
                  FROM messages m
                 WHERE ((m.sender_id = :me_out AND m.recipient_id = :other_in)
                     OR (m.sender_id = :other_out AND m.recipient_id = :me_in))";
        $params = [':me_out' => $uid, ':other_in' => $other['id'], ':other_out' => $other['id'], ':me_in' => $uid];

        // `before` is an id, not an offset: a thread that receives a message while
        // somebody is reading it does not shift the page under them.
        if ($before > 0) {
            $sql .= ' AND m.id < :before';
            $params[':before'] = $before;
        }

        // Newest last within the page, which is the order the panel draws.
        $sql .= ' ORDER BY m.id DESC LIMIT ' . $limit;

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = array_reverse($stmt->fetchAll());

        $hasMore = count($rows) > self::THREAD_PAGE;
        if ($hasMore) {
            array_shift($rows); // drop the oldest: it belongs to the next page
        }

        Response::json(200, [
            'peer' => $other,
            'messages' => array_map(fn (array $row): array => $this->message($row, $uid), $rows),
            'has_more' => $hasMore,
            'unread' => $this->unreadFrom($pdo, $uid, $other['id']),
            // Whether THEY are writing to ME — never the other way round. It rides the
            // thread read rather than a route of its own because the only screen that
            // shows it is the thread, and it is answered by the poll that screen is
            // already making. Nothing here tells anybody whether they have been opened,
            // or how long a draft has been sitting there. See peerTyping().
            'peer_typing' => $this->peerTyping($pdo, $other['id'], $uid),
            'page_size' => self::THREAD_PAGE,
        ]);
    }

    /**
     * Send one. The recipient comes from the body and the SENDER FROM THE SESSION —
     * there is no field a caller could set to put words in somebody else's mouth.
     */
    public function send(): void
    {
        $me = Auth::requireUser();
        $pdo = Database::pdo();
        $uid = (int) $me['id'];
        $input = $this->jsonBody();

        $body = is_string($input['body'] ?? null) ? trim((string) $input['body']) : '';
        if ($body === '') {
            Response::json(422, ['error' => 'Write a message first.', 'fields' => ['body' => 'Write a message first.']]);
        }
        // Characters rather than bytes: 1000 is what the column holds, and mb_ keeps a
        // message of Filipino accented letters or emoji from being refused at half the
        // length it claims to allow.
        if (mb_strlen($body) > self::MAX_BODY) {
            $error = 'That message is too long (' . self::MAX_BODY . ' characters).';
            Response::json(422, ['error' => $error, 'fields' => ['body' => $error]]);
        }

        $recipientId = (int) ($input['recipient_id'] ?? 0);
        if ($recipientId === $uid) {
            Response::json(422, ['error' => 'You cannot send a message to yourself.', 'fields' => ['recipient_id' => 'You cannot send a message to yourself.']]);
        }

        $peer = $this->requirePeer($pdo, (string) $recipientId, $uid);

        $insert = $pdo->prepare(
            'INSERT INTO messages (sender_id, recipient_id, body) VALUES (:sender, :recipient, :body)'
        );
        $insert->execute([':sender' => $uid, ':recipient' => $peer['id'], ':body' => $body]);

        // THE ID IS READ FIRST AND THEN THE STAMP IS CLEARED, in that order and not the
        // other way round. `lastInsertId()` is a property of the connection's most recent
        // write, so running another statement between the INSERT and reading it hands
        // back the wrong id — which does not fail loudly, it fetches no row and the
        // response dies three lines later looking for a message that was just stored.
        $id = (int) $pdo->lastInsertId();

        // THE MESSAGE ARRIVING IS PROOF THE TYPING STOPPED, so the announcement is
        // cleared here rather than waiting to go stale. Without this the recipient reads
        // their reply with three dots pulsing underneath it for the rest of the window,
        // which is the indicator contradicting the thing it was announcing. Best-effort:
        // a failure here leaves a row that expires on its own, and losing a message
        // because its typing stamp could not be deleted would be an absurd trade.
        $clear = $pdo->prepare('DELETE FROM message_typing WHERE user_id = :me AND peer_id = :peer');
        $clear->execute([':me' => $uid, ':peer' => $peer['id']]);
        $row = $pdo->prepare(
            'SELECT id, sender_id, recipient_id, body, created_at, read_at,
                    TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds
               FROM messages WHERE id = :id'
        );
        $row->execute([':id' => $id]);

        // 201 with the message as the SERVER stored it, so the sender's thread appends
        // the real row — id, clock and all — instead of a client-side guess that would
        // then have to be reconciled when the thread is next read.
        Response::json(201, ['message' => $this->message($row->fetch(), $uid)]);
    }

    /**
     * Mark this account's unread messages from one counterpart as read, up to an id.
     *
     * `up_to` is the newest id that was ON SCREEN. Omitted, it means everything from
     * that counterpart, which is what a panel that has just loaded a whole thread can
     * honestly say; supplied, it is what stops a message that arrived mid-read from
     * being marked seen without ever having been displayed.
     *
     * `WHERE recipient_id = :me` is the permission: this can only ever mark the
     * session's OWN inbox, so there is no id a caller can pass that marks somebody
     * else's messages read. Sending is where that matters — a "read receipt" nobody
     * can forge is worth the one extra clause.
     */
    public function seen(string $otherId): void
    {
        $me = Auth::requireUser();
        $pdo = Database::pdo();
        $uid = (int) $me['id'];
        $peer = $this->requirePeer($pdo, $otherId, $uid);

        $upTo = (int) ($this->jsonBody()['up_to'] ?? 0);

        $sql = 'UPDATE messages SET read_at = NOW()
                 WHERE recipient_id = :me AND sender_id = :other AND read_at IS NULL';
        $params = [':me' => $uid, ':other' => $peer['id']];
        if ($upTo > 0) {
            $sql .= ' AND id <= :up';
            $params[':up'] = $upTo;
        }
        $pdo->prepare($sql)->execute($params);

        Response::json(200, [
            'ok' => true,
            'unread' => $this->unreadFrom($pdo, $uid, $peer['id']),
            'unread_total' => $this->unreadTotal($pdo, $uid),
        ]);
    }

    /**
     * Note that this account is writing to one counterpart.
     *
     * THE WRITER IS THE SESSION AND THE READER IS THE BODY, which is the opposite of
     * `seen()` and has to be: this route says something about the person making the
     * request ("I am typing"), so there is no id a caller could pass to put words — or
     * a draft — in somebody else's mouth. `requirePeer` is still the gate, so a
     * deactivated or nonexistent account is refused with the same 404 it gets anywhere
     * else rather than being told it is being written to.
     *
     * IT WRITES AT MOST ONE ROW and returns nothing an officer can read. The response is
     * a bare acknowledgement, because the client already knows what it just did — what
     * it cannot know is whether anybody else's poll will see it, and that is not
     * something a station needs to confirm.
     *
     * WRITING TO YOURSELF IS REFUSED WITH `send()`'s OWN SENTENCE, because it is the same
     * rule: the account at the other end has to be somebody else. `requirePeer` alone
     * would not catch it — it answers "may this account be messaged", and your own
     * account may — and the state it would allow is a stamp addressed to yourself that
     * only you can see, i.e. your own thread with yourself claiming you are typing to
     * yourself. Unreachable from the panel (the picker and the rail both exclude you),
     * which is exactly why it needs to be refused here rather than assumed away.
     */
    public function typing(string $otherId): void
    {
        $me = Auth::requireUser();
        $pdo = Database::pdo();
        $uid = (int) $me['id'];

        if ((int) $otherId === $uid) {
            Response::json(422, ['error' => 'You cannot send a message to yourself.']);
        }

        $peer = $this->requirePeer($pdo, $otherId, $uid);

        // ONE STATEMENT, INSERT OR REFRESH, WITH THE THROTTLE INSIDE IT. Reading the
        // existing stamp and deciding in PHP would be a race between two keystrokes and
        // would cost two round trips to write one second's worth of meaning. `IF(...)`
        // against the row's own column also means a slower client cannot be starved by a
        // faster one: the guard is per pair and per write, not per account.
        $stmt = $pdo->prepare(
            'INSERT INTO message_typing (user_id, peer_id, updated_at)
                  VALUES (:me, :peer, NOW())
             ON DUPLICATE KEY UPDATE updated_at =
                 IF(updated_at < NOW() - INTERVAL ' . self::TYPING_MIN_GAP . ' SECOND, NOW(), updated_at)'
        );
        $stmt->execute([':me' => $uid, ':peer' => $peer['id']]);

        Response::json(200, ['ok' => true]);
    }

    /**
     * Whether one account is writing to another, right now.
     *
     * THE DIRECTION IS THE WHOLE PERMISSION MODEL. `user_id = the peer` and
     * `peer_id = me` — so this can only ever answer "is that colleague typing to ME",
     * and a stamp aimed at somebody else is invisible from here. That is what keeps the
     * signal honest: a draft is the least public thing in this system, and the one
     * person who can see it is the one it is addressed to.
     *
     * STALENESS IS THE ONLY EXPIRY. There is no sweep and no heartbeat to keep it alive;
     * a stamp older than the window is simply not fresh, which is why a session that
     * died mid-sentence cannot leave a station showing dots forever.
     */
    private function peerTyping(PDO $pdo, int $peerId, int $uid): bool
    {
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) AS n FROM message_typing
              WHERE user_id = :peer AND peer_id = :me
                AND updated_at >= NOW() - INTERVAL ' . self::TYPING_WINDOW . ' SECOND'
        );
        $stmt->execute([':peer' => $peerId, ':me' => $uid]);

        return (int) $stmt->fetch()['n'] > 0;
    }

    // ---- shared ---------------------------------------------------------------

    /**
     * Unread counts per sender, for the presence heartbeat.
     *
     * A LIST OF PAIRS rather than an id-keyed map, because a JSON object keyed by
     * account id is one PHP array shape away from being encoded as a list — a map with
     * a single entry is `{"7":2}` and a map with consecutive keys from zero is `[2]`,
     * and a client cannot tell the difference between two shapes of thing it is asked
     * to read. The array shape is one shape.
     *
     * @return list<array{sender_id:int,count:int}>
     */
    public function unreadBySender(): array
    {
        $me = Auth::requireUser();
        $pdo = Database::pdo();

        $stmt = $pdo->prepare(
            'SELECT sender_id, COUNT(*) AS n FROM messages
              WHERE recipient_id = :me AND read_at IS NULL
              GROUP BY sender_id'
        );
        $stmt->execute([':me' => (int) $me['id']]);

        return array_map(
            static fn (array $row): array => ['sender_id' => (int) $row['sender_id'], 'count' => (int) $row['n']],
            $stmt->fetchAll()
        );
    }

    /** The total unread for this account, for the top bar's badge. */
    public function unreadTotalForSession(): int
    {
        $me = Auth::requireUser();

        return $this->unreadTotal(Database::pdo(), (int) $me['id']);
    }

    private function unreadTotal(PDO $pdo, int $uid): int
    {
        $stmt = $pdo->prepare('SELECT COUNT(*) AS n FROM messages WHERE recipient_id = :me AND read_at IS NULL');
        $stmt->execute([':me' => $uid]);

        return (int) $stmt->fetch()['n'];
    }

    private function unreadFrom(PDO $pdo, int $uid, int $peerId): int
    {
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) AS n FROM messages
              WHERE recipient_id = :me AND sender_id = :other AND read_at IS NULL'
        );
        $stmt->execute([':me' => $uid, ':other' => $peerId]);

        return (int) $stmt->fetch()['n'];
    }

    /**
     * An account that may be messaged, or a 404.
     *
     * INACTIVE ACCOUNTS ARE REFUSED, and a nonexistent one is refused with the same
     * sentence. A deactivated officer cannot sign in, so a message to one would sit in
     * a table nobody can read — and answering "that account does not exist" to a probe,
     * while "that account is inactive" to a real colleague, would be a way to
     * enumerate accounts. One sentence, both cases.
     *
     * IT RETURNS THE WHOLE IDENTITY, not just the id, because the thread has to draw a
     * face and a name at the top of the conversation — and for a message from somebody
     * who has since gone offline, the rail it was opened from cannot supply either. One
     * lookup, used by all three routes, so a thread opened from the panel and one
     * opened from a chathead name the same colleague the same way.
     *
     * @return array<string, mixed> the shape identity() returns, plus `id`
     */
    private function requirePeer(PDO $pdo, string $id, int $uid): array
    {
        $peerId = (int) $id;
        if ($peerId <= 0 || $peerId === $uid) {
            Response::json(404, ['error' => 'No such colleague.']);
        }

        $stmt = $pdo->prepare(
            "SELECT u.id, u.full_name, u.username, u.badge_number, u.photo_path, u.photo_updated_at,
                    r.name AS role
               FROM users u JOIN roles r ON r.id = u.role_id
              WHERE u.id = :id AND u.status = 'active'"
        );
        $stmt->execute([':id' => $peerId]);
        $row = $stmt->fetch();

        if ($row === false) {
            Response::json(404, ['error' => 'No such colleague.']);
        }

        return $this->identity($row);
    }

    /**
     * One message, in the shape the panel draws.
     *
     * `mine` is decided here rather than in the browser: the panel has to know which
     * side of the thread a message belongs on, and asking the client to compare ids it
     * was handed is a rule that has to be repeated in every view that shows one.
     *
     * The three label fields are the SERVER's clock, for the same reason the
     * notification feed's are: `sent_label` must not be a browser formatting the
     * database's own `Y-m-d H:i:s`, and `day_group` has to come from the calendar that
     * recorded the message — flooring an age into 24-hour buckets files a 23:50 message
     * from yesterday under "Today".
     */
    private function message(array $row, int $uid): array
    {
        $at = (string) $row['created_at'];
        $stamp = strtotime($at) ?: 0;

        return [
            'id' => (int) $row['id'],
            'body' => (string) $row['body'],
            'mine' => (int) $row['sender_id'] === $uid,
            'created_at' => $at,
            'age_seconds' => max(0, (int) $row['age_seconds']),
            'read_at' => $row['read_at'] === null ? null : (string) $row['read_at'],
            // Time of day, 24-hour, no AM/PM: a thread prints these down the side of
            // every bubble, and 14:41 is one unambiguous form for one station.
            'sent_label' => date('H:i', $stamp),
            'day_group' => $this->dayGroup($stamp),
            'day_label' => $this->dayLabel($stamp),
        ];
    }

    /**
     * An account as the message views draw it — the same four fields the presence
     * roster sends for a face, so the panel and the rail draw a colleague identically
     * from either source.
     */
    private function identity(array $row): array
    {
        $id = (int) $row['id'];

        return [
            'id' => $id,
            'full_name' => (string) $row['full_name'],
            'role' => (string) $row['role'],
            'badge_number' => (string) $row['badge_number'],
            'photo_url' => AvatarPhoto::url(
                $id,
                $row['photo_path'] === null ? null : (string) $row['photo_path'],
                $row['photo_updated_at'] === null ? null : (string) $row['photo_updated_at']
            ),
        ];
    }

    /**
     * @param list<int> $ids
     * @return array<int, array<string, mixed>>
     */
    private function identities(PDO $pdo, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $in = implode(',', array_map('intval', $ids));
        $rows = $pdo->query(
            "SELECT u.id, u.full_name, u.username, u.badge_number, u.photo_path, u.photo_updated_at,
                    r.name AS role
               FROM users u JOIN roles r ON r.id = u.role_id
              WHERE u.id IN ({$in})"
        )->fetchAll();

        $out = [];
        foreach ($rows as $row) {
            $out[(int) $row['id']] = $this->identity($row);
        }

        return $out;
    }

    /**
     * @param list<int> $ids
     * @return array<int, array<string, mixed>>
     */
    private function lastMessages(PDO $pdo, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $in = implode(',', array_map('intval', $ids));
        $rows = $pdo->query(
            "SELECT id, sender_id, recipient_id, body, created_at, read_at,
                    TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds
               FROM messages WHERE id IN ({$in})"
        )->fetchAll();

        $out = [];
        foreach ($rows as $row) {
            $out[(int) $row['id']] = $row;
        }

        return $out;
    }

    /** today / yesterday / earlier, from the DATABASE's calendar. */
    private function dayGroup(int $stamp): string
    {
        $today = strtotime(date('Y-m-d 00:00:00'));

        if ($stamp >= $today) {
            return 'today';
        }
        if ($stamp >= $today - 86400) {
            return 'yesterday';
        }

        return 'earlier';
    }

    /** The heading the panel prints above a day's messages: "Today", "Yesterday", "Sep 20, 2026". */
    private function dayLabel(int $stamp): string
    {
        return match ($this->dayGroup($stamp)) {
            'today' => 'Today',
            'yesterday' => 'Yesterday',
            // A date, spelled out. `M j` would be "Sep 20" in both years and the thread
            // is a record — one that has to be unambiguous when it is read back.
            default => date('M j, Y', $stamp),
        };
    }

    /** @return array<string, mixed> */
    private function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        $data = json_decode($raw, true);

        return is_array($data) ? $data : [];
    }
}
