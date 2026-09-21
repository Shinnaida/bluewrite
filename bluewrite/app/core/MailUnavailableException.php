<?php
declare(strict_types=1);

namespace App\Core;

/**
 * "This server cannot send the code", as distinct from "that code is wrong".
 *
 * THE DISTINCTION IS THE WHOLE POINT, and it is the same one 012 drew for the
 * authenticator app. An officer typing a code that does not match needs to be
 * told about their typing; an officer whose code was never sent because the
 * mailer is unconfigured or Gmail refused the connection needs to be told
 * something else entirely, or they will sit at the screen retyping a code that
 * is not in their inbox because there is none.
 *
 * It is thrown by Mailer and by EmailOtp, and the API answers it as 503 with
 * `code: mfa_mail_failed` — never as 401, which would say the officer's code was
 * wrong about a code that was never issued.
 */
final class MailUnavailableException extends \RuntimeException
{
}
