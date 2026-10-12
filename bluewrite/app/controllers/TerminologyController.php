<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Ai\TerminologyAssistant;
use App\Core\Audit;
use App\Core\Auth;
use App\Core\Response;

final class TerminologyController
{
    public function answer(): void
    {
        $user = Auth::requireUser();
        Auth::requireCsrf();
        $raw = file_get_contents('php://input', false, null, 0, 4097);
        if ($raw === false || strlen($raw) > 4096) { Response::json(413, ['error' => 'Question is too long.']); }
        $body = json_decode($raw, true);
        if (!is_array($body) || array_keys($body) !== ['message'] || !is_string($body['message'])) {
            Response::json(422, ['error' => 'Send only a message containing a police term or question.']);
        }
        $message = trim($body['message']);
        if ($message === '' || mb_strlen($message) > TerminologyAssistant::MAX_MESSAGE) {
            Response::json(422, ['error' => 'Enter a police term or question of up to 300 characters.']);
        }
        $now = time();
        $recent = array_values(array_filter($_SESSION['terminology_requests'] ?? [], static fn ($t) => $t > $now - 60));
        if (count($recent) >= 6) { Response::json(429, ['error' => 'Please wait a minute before asking another question.']); }
        $recent[] = $now;
        // Every question is recorded for the administrator, including refused ones.
        Audit::log((int) $user['id'], 'ai.terminology.ask', 'user', (string) $user['id'], $message);
        $_SESSION['terminology_requests'] = $recent;
        // Release the session while the provider answers; other app requests must not wait.
        session_write_close();
        try {
            $answer = (new TerminologyAssistant())->answer($message);
        } catch (\Throwable $e) {
            // Never log the provider payload, credentials, or the staff member's text.
            error_log('BlueWrite terminology provider unavailable: ' . get_class($e));
            Response::json(503, ['error' => 'The terminology chatbot is unavailable. Please try again later or ask the administrator to check AI settings.']);
        }
        if ($answer['refused']) { error_log('BlueWrite terminology request refused (scope or output check).'); }
        Response::json(200, $answer);
    }
}
