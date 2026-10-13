<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Auth;
use App\Core\Response;

/**
 * GET /api/v1/news/search?q=<words>
 *
 * A server-side proxy to the Webz.io News API, read by the dashboard's
 * "Search the news" panel. The API token lives in the WEBZ_API_TOKEN environment
 * variable and is never sent to the browser. With no token set, the endpoint
 * answers `configured: false` rather than an error, so the panel can say what is
 * missing instead of breaking the page.
 *
 * ADMIN-ONLY, like the dashboard it sits in (Auth::requireRole). The response is
 * a normalised list of article title, link, source, date and a short excerpt —
 * never the raw upstream payload.
 */
final class NewsController
{
    private const ENDPOINT = 'https://api.webz.io/newsApiLite';
    private const MAX_QUERY = 120;
    private const RESULTS = 10;
    private const EXCERPT = 240;
    private const TIMEOUT_SECONDS = 8;

    public function search(): void
    {
        Auth::requireRole('Admin');

        $q = trim((string) ($_GET['q'] ?? ''));
        if ($q === '') {
            Response::json(200, ['configured' => true, 'query' => '', 'articles' => []]);
        }
        if (mb_strlen($q) > self::MAX_QUERY) {
            Response::json(422, ['error' => 'Keep the search to ' . self::MAX_QUERY . ' characters.']);
        }

        $token = trim((string) getenv('WEBZ_API_TOKEN'));
        if ($token === '') {
            Response::json(200, ['configured' => false, 'query' => $q, 'articles' => []]);
        }

        $url = self::ENDPOINT . '?' . http_build_query([
            'token' => $token,
            'q' => $q,
            'size' => self::RESULTS,
        ]);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false || $status !== 200) {
            Response::json(502, ['error' => 'The news search is unavailable right now. Try again shortly.']);
        }

        $data = json_decode((string) $raw, true);
        if (!is_array($data)) {
            Response::json(502, ['error' => 'The news search returned an unreadable answer.']);
        }

        $articles = [];
        foreach ((array) ($data['posts'] ?? []) as $post) {
            if (!is_array($post)) {
                continue;
            }
            $link = (string) ($post['url'] ?? '');
            if (!preg_match('#^https?://#i', $link)) {
                continue; // only http(s) links are shown as links
            }
            $text = trim(preg_replace('/\s+/u', ' ', (string) ($post['text'] ?? '')) ?? '');
            $articles[] = [
                'title' => mb_substr(trim((string) ($post['title'] ?? 'Untitled')), 0, 200),
                'url' => $link,
                'site' => mb_substr((string) ($post['thread']['site'] ?? ''), 0, 120),
                'published' => (string) ($post['published'] ?? ''),
                'excerpt' => mb_substr($text, 0, self::EXCERPT),
            ];
        }

        Response::json(200, ['configured' => true, 'query' => $q, 'articles' => $articles]);
    }
}
