<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Ai\AiProviderException;
use App\Ai\AiUnavailableException;
use App\Ai\NarrativeService;
use App\Core\Audit;
use App\Core\Auth;
use App\Core\Response;

/**
 * POST /ocr/read — the online photo reader (owner request).
 *
 * Reads a blotter photo with the station's Gemini vision model first (the
 * GEMINI_API_KEY the narrative features already run on — no new key, no new
 * billing), then the imagetotext.info image-to-text API, and returns the
 * recognised text. Keys live in server environment variables and are never
 * sent to the browser — the client talks to this endpoint, never upstream.
 *
 * ONLINE-FIRST, LOCAL FALLBACK by design (owner decision): with no key set
 * anywhere the endpoint answers `configured: false` rather than an error,
 * and on any upstream failure it answers 502 — in both cases the client
 * reads the photo with the on-device engines instead (see
 * src/lib/ocrBlotter.js and src/lib/ocrHandwriting.js). On the station LAN,
 * where there is no internet, the forwards fail fast and the local engines
 * carry the read.
 *
 * Data consent (owner decision, recorded): every photo read this way is
 * uploaded to an off-station service — blotter pages carry names, addresses
 * and allegations, and the authority to send them off-station was given
 * before this route was built.
 *
 * Nothing is written here. The answer goes back to the capture dialog,
 * where the officer reviews and corrects it before Insert — the same gate
 * every other reading passes through.
 */
final class OcrController
{
    private const ENDPOINT = 'https://www.imagetotext.info/api/imageToText';
    private const TIMEOUT_SECONDS = 60;
    private const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    private const ALLOWED_MIME = [
        'image/jpeg' => true,
        'image/png' => true,
        'image/webp' => true,
        'image/gif' => true,
    ];

    public function read(): void
    {
        $user = Auth::requireUser();

        $body = self::jsonBody();
        $image = trim((string) ($body['image'] ?? ''));
        if ($image === '') {
            Response::json(422, ['error' => 'No photo was sent with the request.']);
        }
        // A data URI is ~4/3 the decoded size: refuse the obviously huge
        // before decoding, so a hostile body cannot inflate memory.
        if (strlen($image) > (int) (self::MAX_IMAGE_BYTES * 1.5)) {
            Response::json(422, ['error' => 'That photo is larger than the online reader accepts.']);
        }

        // A data URI names its own kind; raw base64 is sniffed after decode.
        $declaredMime = '';
        if (preg_match('#^data:(image/[a-zA-Z0-9.+-]+);base64,#', $image, $m) === 1) {
            $declaredMime = strtolower($m[1]);
            $image = substr($image, strlen($m[0]));
        }
        $bytes = base64_decode($image, true);
        if ($bytes === false || $bytes === '') {
            Response::json(422, ['error' => 'That photo could not be decoded.']);
        }
        if (strlen($bytes) > self::MAX_IMAGE_BYTES) {
            Response::json(422, ['error' => 'That photo is larger than the online reader accepts.']);
        }
        $sniffed = '';
        if (function_exists('finfo_open')) {
            $info = finfo_open(FILEINFO_MIME_TYPE);
            if ($info !== false) {
                $sniffed = strtolower((string) finfo_buffer($info, $bytes));
                finfo_close($info);
            }
        }
        $mime = $sniffed !== '' ? $sniffed : $declaredMime;
        if (!isset(self::ALLOWED_MIME[$mime])) {
            Response::json(422, ['error' => 'That file is not a photo the online reader accepts (JPEG, PNG, WebP or GIF).']);
        }

        // Gemini first: the station's own key reads the photo, and an empty
        // transcription is a miss, not an answer — the next engine gets it.
        // Any provider failure (no key, offline cable, refusal, throttle)
        // falls through the same way, never as an officer-facing error.
        try {
            $gemini = (new NarrativeService())->transcribePhoto($bytes, $mime);
            if (trim($gemini) !== '') {
                self::answer((int) $user['id'], 'gemini', $gemini);
            }
        } catch (AiUnavailableException | AiProviderException) {
            // The next engine below gets the photo.
        }

        $key = trim((string) getenv('IMAGETOTEXT_API_KEY'));
        if ($key === '') {
            // Keyless by owner decision: not an error, but the client must
            // know to read locally instead of showing a failure.
            Response::json(200, ['configured' => false]);
        }

        $payload = json_encode(['base64' => 'data:' . $mime . ';base64,' . base64_encode($bytes)]);
        if ($payload === false) {
            Response::json(502, ['error' => 'The online reader could not take that photo right now.']);
        }

        $ch = curl_init(self::ENDPOINT);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $key,
            ],
            CURLOPT_POSTFIELDS => $payload,
        ]);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false) {
            // The station LAN with no internet lands here: unreachable, not
            // broken — the client falls back to the local engines.
            Response::json(502, ['error' => 'The online reader could not be reached. The photo can still be read on this computer.']);
        }

        $data = json_decode((string) $raw, true);
        if (!is_array($data)) {
            Response::json(502, ['error' => 'The online reader returned an unreadable answer.']);
        }
        if (($data['error'] ?? true) !== false) {
            $message = strtolower((string) ($data['message'] ?? ''));
            if (str_contains($message, 'unauthorize') || str_contains($message, 'premium') || str_contains($message, 'incorrect api key')) {
                Response::json(502, ['error' => 'The online reader rejected this station’s key. Tell an administrator — the photo can still be read on this computer.']);
            }
            if (str_contains($message, 'blocked')) {
                Response::json(503, ['error' => 'The online reader is busy right now. Wait a while and try again, or read the photo on this computer.']);
            }
            Response::json(502, ['error' => 'The online reader could not read that photo. The photo can still be read on this computer.']);
        }
        // An upstream non-200 with a JSON body but no error flag is still a
        // refusal, not an answer — never treat it as text.
        if ($status !== 200) {
            Response::json(502, ['error' => 'The online reader could not read that photo. The photo can still be read on this computer.']);
        }

        $text = trim((string) ($data['result'] ?? ''));
        self::answer((int) $user['id'], 'imagetotext', $text);
    }

    /** Log the read and answer it: one shape whichever engine produced it. */
    private static function answer(int $userId, string $engine, string $text): void
    {
        Audit::log($userId, 'ocr.read', 'report', null, sprintf(
            'engine: %s, characters: %d',
            $engine,
            mb_strlen($text)
        ));
        Response::json(200, ['configured' => true, 'engine' => $engine, 'text' => $text]);
    }

    /** @return array<string,mixed> */
    private static function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}
