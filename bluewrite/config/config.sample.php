<?php
/**
 * BlueWrite configuration — copy to config/config.php and fill in real values.
 * config/config.php is git-ignored and must never be committed.
 * This file lives SERVER-SIDE ONLY. Never reference secrets from frontend code.
 */

return [
    'db' => [
        'host' => '127.0.0.1',
        'port' => '3306',
        'name' => 'bluewrite',
        'user' => 'bluewrite',
        'pass' => 'CHANGE_ME',
    ],

    'app' => [
        // LAN deployment: the server's static IP, e.g. 'http://192.168.1.10'
        // Dev with Laragon vhost: 'http://bluewrite.test'
        'base_url' => 'http://192.168.1.10',
        // The name the sign-in code email is signed with, and what the officer
        // should see on the mailbox. Plain text, not a domain.
        'system_name' => 'BlueWrite',
        // Session idle timeout in minutes (server-side enforcement).
        'session_idle_minutes' => 30,
        // Account lockout: N failed attempts locks the account for M minutes.
        // The same window applies to the email code's own counter
        // (email_otp_codes.failed_attempts).
        'lockout_attempts' => 5,
        'lockout_minutes' => 15,
    ],

    // ---- The second factor's mailer ------------------------------------------
    //
    // Where the six-digit sign-in code is SENT FROM. The code goes to each
    // account's own address (users.email, set in User Management); this block is
    // the station's sender, and it must be a Gmail account with a 16-character
    // App Password — a normal account password is refused by smtp.gmail.com.
    //
    // MAKE IT: enable 2-Step Verification on the sender account, then Google
    // Account → Security → App passwords → generate one for "Mail". Paste it
    // here with the spaces removed. It is a credential for the station's mailbox
    // and belongs in config.php only — never in the repository, never in the
    // database. See docs/EMAIL_OTP.md.
    //
    // 'transport' is 'smtp' on a real deployment, and 'log' on a dev machine: it
    // writes the message to config/mail.log instead of sending it, which is what
    // lets the test suite complete a sign-in without a Gmail account.
    'mail' => [
        'transport' => 'smtp',
        'host' => 'smtp.gmail.com',
        // 465 is implicit TLS (what this client opens) and 587 is STARTTLS.
        'port' => 465,
        'secure' => 'ssl',
        'username' => '',
        'app_password' => '',
        'from_name' => 'BlueWrite',
        // Blank sends as the username; set it only if the sender differs.
        'from_email' => '',
        'timeout' => 15,
    ],
];
