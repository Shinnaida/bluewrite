<?php
declare(strict_types=1);

namespace App\Core;

/**
 * The station's outbound mail: one message, over Gmail's SMTP, with no library.
 *
 * WHY HAND-WRITTEN AND NOT A DEPENDENCY. This project has no Composer and no
 * autoloader — every class is a `require` line in api/index.php — so a mailer
 * library would mean a vendor directory, a lock file and a build step brought in
 * to send one short message. What the job actually needs is small and fixed:
 * connect to smtp.gmail.com, authenticate, submit one message, close. That is
 * what lives here.
 *
 * TWO TRANSPORTS, and the second one is not a toy:
 *
 *   'smtp' — the real thing. Implicit TLS on 465 (what Gmail's smtp.gmail.com
 *            answers on) or STARTTLS on 587. Authenticates with AUTH LOGIN
 *            using a Gmail address and an App Password.
 *   'log'  — writes the message to config/mail.log and sends nothing. This is
 *            what a dev machine and the API test suite use, so a sign-in can be
 *            completed end to end without a Gmail account and without putting a
 *            real credential in a test. It never appears in a default config.
 *
 * FAILURE IS AN EXCEPTION, NEVER A SILENT DROP. `MailUnavailableException` is
 * what the AuthController turns into a 503 that says the code could not be sent;
 * an officer told "check your inbox" about a message that was never submitted is
 * the failure this class exists to make impossible.
 *
 * TWO BODIES, ONE MESSAGE. send() takes an HTML body beside the plain text and,
 * when it is given, submits the two as multipart/alternative and lets the client
 * choose. The plain part is never optional and never changes: every client can
 * read it, and it is the only place the sign-in code can be found at all.
 *
 * WHAT IS DELIBERATELY NOT HERE: no attachments, no queue, no retry and no
 * templating engine. A message is two strings built by the class that owns the
 * numbers (EmailOtp::loginMessage), because a mailer that renders markup is a
 * mailer that has to be kept safe against every value it interpolates.
 */
final class Mailer
{
    /**
     * The transport's name, for the Admin dashboard's sign-in-health card.
     *
     * Public where transport() below stays private: the dashboard needs to say
     * WHICH transport is in use — 'log' on a real station means the second factor
     * sends nothing at all — without exposing any of the mail settings themselves.
     */
    public static function transportName(): string
    {
        return self::transport();
    }

    /** How the message leaves the server: 'smtp' (default) or 'log'. */
    private static function transport(): string
    {
        $mail = Config::section('mail');
        $transport = strtolower(trim((string) ($mail['transport'] ?? 'smtp')));
        return $transport === 'log' ? 'log' : 'smtp';
    }

    /**
     * Whether this server can actually deliver mail.
     *
     * Asked by the gate BEFORE a code is generated, so the officer is told the
     * code could not be sent rather than being shown a code screen for a message
     * that was never going to arrive. A blank App Password is the common
     * misconfiguration — the sender is set but the credential is not — so that is
     * the case this catches.
     */
    public static function configured(): bool
    {
        if (self::transport() === 'log') {
            return true;
        }
        $mail = Config::section('mail');
        return trim((string) ($mail['host'] ?? '')) !== ''
            && trim((string) ($mail['username'] ?? '')) !== ''
            && trim((string) ($mail['app_password'] ?? '')) !== '';
    }

    /**
     * Submit one message.
     *
     * @param string      $body The plain-text body. Always required, always sent.
     * @param string|null $html An HTML body to offer beside it. Null sends the
     *                          plain text alone; given, the two go out as
     *                          multipart/alternative and the client picks.
     *
     * @throws MailUnavailableException when the server cannot send it at all.
     */
    public static function send(string $to, string $subject, string $body, ?string $html = null): void
    {
        $to = trim($to);
        if (filter_var($to, FILTER_VALIDATE_EMAIL) === false) {
            throw new MailUnavailableException('That account has no valid email address on file.');
        }

        if (self::transport() === 'log') {
            self::log($to, $subject, $body);
            return;
        }

        if (!self::configured()) {
            throw new MailUnavailableException(
                'This server cannot send email yet: set mail.username and mail.app_password in config/config.php.'
            );
        }

        $mail = Config::section('mail');
        $host = trim((string) $mail['host']);
        $port = (int) ($mail['port'] ?? 465);
        $secure = strtolower(trim((string) ($mail['secure'] ?? 'ssl')));
        $timeout = max(5, (int) ($mail['timeout'] ?? 15));
        $username = trim((string) $mail['username']);
        $password = (string) $mail['app_password'];
        $fromEmail = trim((string) ($mail['from_email'] ?? '')) ?: $username;
        $fromName = trim((string) ($mail['from_name'] ?? '')) ?: 'BlueWrite';

        $context = stream_context_create(['ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            // Gmail's certificate is fine; an SNI name is required for a vhost
            // mail host, and without it some servers answer with the wrong
            // certificate and the handshake fails for a reason that looks
            // nothing like the cause.
            'SNI_enabled' => true,
            'peer_name' => $host,
        ]]);

        $prefix = $secure === 'ssl' ? 'ssl://' : 'tcp://';
        $errno = 0;
        $errstr = '';
        $fp = @stream_socket_client(
            $prefix . $host . ':' . $port,
            $errno,
            $errstr,
            $timeout,
            STREAM_CLIENT_CONNECT,
            $context
        );
        if ($fp === false) {
            throw new MailUnavailableException(
                'Could not reach the mail server at ' . $host . ':' . $port . ' (' . ($errstr !== '' ? $errstr : 'connection failed') . ').'
            );
        }
        stream_set_timeout($fp, $timeout);

        try {
            self::expect($fp, ['220'], 'server greeting');

            // STARTTLS is a second handshake on the SAME socket, so it is done
            // after EHLO, exactly as the protocol requires.
            if ($secure === 'tls') {
                self::command($fp, 'EHLO ' . self::clientName(), ['250'], 'EHLO');
                self::command($fp, 'STARTTLS', ['220'], 'STARTTLS');
                if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new MailUnavailableException('The mail server refused to start TLS.');
                }
            }

            self::command($fp, 'EHLO ' . self::clientName(), ['250'], 'EHLO');
            self::command($fp, 'AUTH LOGIN', ['334'], 'AUTH LOGIN');
            self::command($fp, base64_encode($username), ['334'], 'AUTH username');
            self::command($fp, base64_encode($password), ['235'], 'AUTH password');

            self::command($fp, 'MAIL FROM:<' . $fromEmail . '>', ['250'], 'MAIL FROM');
            self::command($fp, 'RCPT TO:<' . $to . '>', ['250', '251'], 'RCPT TO');
            self::command($fp, 'DATA', ['354'], 'DATA');

            $data = self::message($fromEmail, $fromName, $to, $subject, $body, $html);
            fwrite($fp, $data);
            self::expect($fp, ['250'], 'message body');
            self::command($fp, 'QUIT', ['221'], 'QUIT');
        } finally {
            @fclose($fp);
        }
    }

    /**
     * The raw DATA payload, with the headers the message carries.
     *
     * TWO SHAPES. Without an HTML body this is one text/plain part, exactly as it
     * has always been. With one it is multipart/alternative: the plain text first
     * and the HTML second, and the ORDER is the part that matters — a client walks
     * the parts and keeps the LAST type it understands, so HTML-last is what makes
     * a client that renders HTML choose it while everything else still falls back
     * to the text.
     *
     * The HTML part is base64. It is markup crossing a line-oriented protocol:
     * base64 cannot contain a bare CR or LF, cannot grow a line past the 998-byte
     * limit however long the inline styles become, and cannot begin a line with a
     * full stop. The plain part stays 8bit and readable, because somebody reading
     * this message in the mail log should still see the sentence with the code in
     * it — that is how the test suite completes a sign-in.
     *
     * Dot-stuffing is done here rather than by the caller: a line in the body that
     * begins with a full stop would otherwise end the message early, and message
     * content is exactly the kind of thing that grows such a line by accident.
     */
    private static function message(
        string $fromEmail,
        string $fromName,
        string $to,
        string $subject,
        string $body,
        ?string $html = null
    ): string {
        $encodedName = @mb_encode_mimeheader($fromName, 'UTF-8', 'B') ?: $fromName;
        $encodedSubject = @mb_encode_mimeheader($subject, 'UTF-8', 'B') ?: $subject;
        $headers = [
            'Date: ' . date('r'),
            'From: ' . $encodedName . ' <' . $fromEmail . '>',
            'To: <' . $to . '>',
            'Subject: ' . $encodedSubject,
            'MIME-Version: 1.0',
        ];

        if ($html === null) {
            $headers[] = 'Content-Type: text/plain; charset=UTF-8';
            $headers[] = 'Content-Transfer-Encoding: 8bit';
            $payload = $body;
        } else {
            $boundary = 'bw-' . bin2hex(random_bytes(16));
            $headers[] = 'Content-Type: multipart/alternative; boundary="' . $boundary . '"';
            $payload = '--' . $boundary . "\r\n"
                . "Content-Type: text/plain; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: 8bit\r\n"
                . "\r\n"
                . $body . "\r\n"
                . '--' . $boundary . "\r\n"
                . "Content-Type: text/html; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: base64\r\n"
                . "\r\n"
                . chunk_split(base64_encode($html), 76, "\r\n")
                . '--' . $boundary . "--\r\n";
        }

        // The transport wants CRLF, not the local newline, and a local newline
        // left in place is the classic "bare line feed" rejection.
        $normalized = preg_replace("/\r\n|\r|\n/", "\r\n", $payload) ?? $payload;
        $stuffed = str_replace("\r\n.", "\r\n..", "\r\n" . $normalized);
        return implode("\r\n", $headers) . "\r\n\r\n" . $stuffed . "\r\n.\r\n";
    }

    /** The name this client announces in EHLO. Cosmetic, never an inbox gate. */
    private static function clientName(): string
    {
        return 'bluewrite.local';
    }

    /**
     * Write a command and require the reply to carry one of the accepted codes.
     */
    private static function command($fp, string $line, array $accept, string $context): void
    {
        $written = @fwrite($fp, $line . "\r\n");
        if ($written === false) {
            throw new MailUnavailableException('The mail server closed the connection during ' . $context . '.');
        }
        self::expect($fp, $accept, $context);
    }

    /**
     * Read one SMTP reply and check its status code.
     *
     * A reply may be several lines: continuation lines carry `250-` and the last
     * one carries `250 ` with a space. Reading until that space is what stops a
     * multi-line greeting from being read as three separate replies.
     */
    private static function expect($fp, array $accept, string $context): void
    {
        $code = '';
        $text = '';
        while (($line = fgets($fp, 1500)) !== false) {
            if ($code === '') {
                $code = substr($line, 0, 3);
            }
            $text = trim($line);
            if (strlen($line) < 4 || $line[3] === ' ') {
                break;
            }
        }

        if ($code === '' || !in_array($code, $accept, true)) {
            // The reply text is from the mail server, not from a credential, so
            // it is safe to carry into the message — and it is the only thing
            // that tells an administrator WHAT Gmail objected to.
            throw new MailUnavailableException(
                'The mail server refused at ' . $context . ' (' . ($text !== '' ? $text : 'no reply') . ').'
            );
        }
    }

    /**
     * The dev/test transport: keep the message on disk instead of sending it.
     *
     * config/mail.log, not the system log, because the test harness has to find
     * the code the server just generated, and "read the file next to config.php"
     * is a stable, obvious contract. The file is git-ignored.
     */
    private static function log(string $to, string $subject, string $body): void
    {
        $path = self::logPath();
        $entry = "===== " . date('c') . " =====\r\n"
            . 'To: ' . $to . "\r\n"
            . 'Subject: ' . $subject . "\r\n\r\n"
            . $body . "\r\n";
        if (@file_put_contents($path, $entry, FILE_APPEND | LOCK_EX) === false) {
            throw new MailUnavailableException('The server could not write to ' . $path . '.');
        }
    }

    /** Where the 'log' transport writes: beside the config, never committed. */
    public static function logPath(): string
    {
        return dirname(__DIR__, 2) . '/config/mail.log';
    }
}
