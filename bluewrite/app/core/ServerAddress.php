<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Where THIS server lives on the LAN, measured at request time — never typed
 * into config on every move.
 *
 * The station's old story was `config.php → app.base_url`, hand-edited each
 * time the server PC changed networks (172.16.x → 192.168.x), with the clients
 * then typing the new address from memory. That edit is what kept breaking:
 * a moved server serves fine on its new address while every bookmark, every
 * sign-in email and every officer's memory still points at the old one.
 *
 * The config value stays as an OVERRIDE (an https reverse proxy, a pinned
 * hostname), but when it is empty the server reports what its own interfaces
 * say. Detection is best-effort and loopback/APIPA addresses are dropped:
 * 127.x is this machine only and 169.254.x is DHCP having failed.
 */
final class ServerAddress
{
    /**
     * The port Apache serves the app on for clients (scripts\serve.cmd binds
     * 0.0.0.0:8099 and opens it in Windows Firewall). Used when nothing else
     * names a usable port — and for every request that arrived on a loopback
     * origin, whose port no other machine can reach; see port().
     */
    private const FALLBACK_PORT = 8099;

    /** @var list<string>|null Per-request cache; detection shells out. */
    private static ?array $lanIps = null;

    /**
     * This machine's LAN IPv4s, site-local first, loopback/APIPA excluded.
     *
     * Windows runs `ipconfig` and reads the IPv4 lines; anything else tries
     * `hostname -I`, then the hostname's own resolution. Every step is guarded
     * — exec disabled, a moved machine, an odd locale — because an address
     * reader must never be what 500s the response it rides on.
     *
     * @return list<string>
     */
    public static function lanIpv4(): array
    {
        if (self::$lanIps !== null) {
            return self::$lanIps;
        }
        $found = [];
        foreach (self::candidates() as $ip) {
            if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                continue;
            }
            // Loopback is this machine only; link-local means no DHCP lease;
            // 0.0.0.0 is a bind address, not a destination.
            if (
                str_starts_with($ip, '127.')
                || str_starts_with($ip, '169.254.')
                || $ip === '0.0.0.0'
            ) {
                continue;
            }
            if (!in_array($ip, $found, true)) {
                $found[] = $ip;
            }
        }
        // Site-local first so the primary is the address a client can route
        // to, not a VPN or virtual adapter that happened to list first.
        usort($found, static fn (string $a, string $b): int => (self::isSiteLocal($b) ? 1 : 0) <=> (self::isSiteLocal($a) ? 1 : 0));
        self::$lanIps = $found;
        return $found;
    }

    /**
     * Port a CLIENT must type — not simply the port this request arrived on.
     *
     * The Admin often reads this card from the Vite dev server, which listens
     * on 127.0.0.1:5180 ONLY (scripts\serve.cmd; docs\LAN_SETUP.md says not to
     * open it). That port is this machine's private view of the app, so an
     * address built on it is dead on every other PC — the client copies it and
     * gets ERR_CONNECTION_TIMED_OUT. So a request that arrived on a loopback
     * origin is answered with the app's own LAN port (Apache on 8099), which
     * is the port the address is meant to be typed on.
     */
    public static function port(): int
    {
        if (self::requestedHostIsLoopback()) {
            return self::FALLBACK_PORT;
        }
        $port = (int) ($_SERVER['SERVER_PORT'] ?? 0);
        return $port > 0 ? $port : self::FALLBACK_PORT;
    }

    /**
     * True when the browser reached the app as this machine itself — a
     * loopback name (localhost, 127.x, ::1), which another PC cannot resolve
     * back to this server. Such an origin is never a client address.
     */
    private static function requestedHostIsLoopback(): bool
    {
        $host = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
        if ($host === '') {
            return false;
        }
        $parts = preg_split('/:\d+$/', $host);
        $host = trim((string) ($parts[0] ?? $host), '[]');
        return $host === 'localhost'
            || $host === '::1'
            || str_ends_with($host, '.localhost')
            || str_starts_with($host, '127.');
    }

    /** http unless the request itself arrived over TLS. */
    public static function scheme(): string
    {
        $https = $_SERVER['HTTPS'] ?? '';
        if (is_string($https) && strtolower($https) !== '' && strtolower($https) !== 'off') {
            return 'https';
        }
        return self::port() === 443 ? 'https' : 'http';
    }

    /**
     * Every address clients can type, primary first, no trailing slash (the
     * config value's own shape, so the two are interchangeable).
     *
     * @return list<string>
     */
    public static function urls(): array
    {
        $scheme = self::scheme();
        $port = self::port();
        $suffix = ':' . $port;
        $out = [];
        foreach (self::lanIpv4() as $ip) {
            $out[] = "{$scheme}://{$ip}{$suffix}";
        }
        // The name the browser used still works when DNS says so (a pinned
        // hostname, a proxy) — offered last, never as the primary. A loopback
        // name is left out: it only resolves on this machine, so it is not an
        // address a client could type.
        $host = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
        if ($host !== '' && !self::requestedHostIsLoopback() && !in_array("{$scheme}://{$host}", $out, true)) {
            $out[] = "{$scheme}://{$host}";
        }
        return $out;
    }

    /** The first URL, or '' when this machine has no LAN address to give. */
    public static function primaryUrl(): string
    {
        return self::urls()[0] ?? '';
    }

    /**
     * The address printed where an address is needed (sign-in emails): the
     * configured override when one is set, otherwise what the interfaces say.
     * Either way no hand-edit follows a move.
     */
    public static function publicBaseUrl(): string
    {
        $configured = trim((string) (Config::section('app')['base_url'] ?? ''));
        if ($configured !== '') {
            return rtrim($configured, '/');
        }
        return self::primaryUrl();
    }

    /** Raw candidates in discovery order, before filtering. */
    private static function candidates(): array
    {
        $out = [];
        // The hostname's own resolution is cheap and never shells out.
        try {
            $name = @gethostname();
            if (is_string($name) && $name !== '') {
                $resolved = @gethostbyname($name);
                if (is_string($resolved) && $resolved !== $name) {
                    $out[] = $resolved;
                }
            }
        } catch (\Throwable) {
            // Detection is advisory; a failed lookup is an empty list.
        }
        if (DIRECTORY_SEPARATOR === '\\') {
            // Windows: read ipconfig's adapter lines (see ipconfigAddresses).
            try {
                $lines = [];
                @exec('ipconfig', $lines);
                foreach (self::ipconfigAddresses(is_array($lines) ? $lines : []) as $ip) {
                    $out[] = $ip;
                }
            } catch (\Throwable) {
                // exec disabled — the hostname candidate above still stands.
            }
        } else {
            try {
                $raw = [];
                @exec('hostname -I 2>/dev/null', $raw);
                foreach (preg_split('/\s+/', implode(' ', (array) $raw)) ?: [] as $part) {
                    if ($part !== '') {
                        $out[] = $part;
                    }
                }
            } catch (\Throwable) {
                // Same rule: detection never throws.
            }
        }
        return $out;
    }

    /**
     * This machine's addresses from `ipconfig` output — the ADAPTER lines only.
     *
     * `ipconfig` prints the subnet mask, the default gateway, and the DHCP and
     * DNS servers as lines of their own, and each of those ends in a dotted
     * quad too:
     *
     *     IPv4 Address. . . . . . . . . . . : 192.168.100.6
     *     Subnet Mask . . . . . . . . . . . : 255.255.255.0
     *     Default Gateway . . . . . . . . . : 192.168.100.1
     *
     * Reading "a dotted quad at the end of the line" therefore took the mask
     * and the router as if they were this PC's own addresses, and the Client
     * access card offered them as client addresses. The label is what tells
     * them apart: an adapter's own address is the line labelled IPv4, and
     * "IPv4" rides every Windows translation (IPv4-Adresse, Adresse IPv4, …)
     * while the mask, gateway, DHCP and DNS lines never carry it.
     *
     * Pure, so it can be read against real ipconfig output rather than only
     * through the machine it happens to run on.
     *
     * @param list<string> $lines
     * @return list<string>
     */
    private static function ipconfigAddresses(array $lines): array
    {
        $out = [];
        foreach ($lines as $line) {
            if (!is_string($line) || stripos($line, 'IPv4') === false) {
                continue;
            }
            // The label carries dots (locale-dependent), so the address is
            // whatever follows the last colon on the line.
            $colon = strrpos($line, ':');
            $value = $colon === false ? $line : substr($line, $colon + 1);
            if (preg_match('/(\d{1,3}(?:\.\d{1,3}){3})/', $value, $m) !== 1) {
                continue;
            }
            // A dotted quad can still be a mask or a broadcast; no adapter
            // holds one of those as its own address.
            if (self::looksLikeNetmask($m[1])) {
                continue;
            }
            $out[] = $m[1];
        }
        return $out;
    }

    /**
     * True for subnet masks and broadcast-style quads: 255.x and 0.x, and any
     * contiguous run of 1-bits followed by 0-bits (255.255.255.0,
     * 255.255.0.0, 255.255.254.0). A real adapter address is neither.
     */
    private static function looksLikeNetmask(string $ip): bool
    {
        $parts = explode('.', $ip);
        if (count($parts) !== 4) {
            return true;
        }
        $octets = array_map(static fn (string $p): int => (int) $p, $parts);
        if ($octets[0] === 255 || $octets[0] === 0) {
            return true;
        }
        $long = ($octets[0] << 24) | ($octets[1] << 16) | ($octets[2] << 8) | $octets[3];
        $inverted = ~$long & 0xFFFFFFFF;
        return $inverted !== 0xFFFFFFFF && ($inverted & ($inverted + 1)) === 0;
    }

    private static function isSiteLocal(string $ip): bool
    {
        if (str_starts_with($ip, '10.') || str_starts_with($ip, '192.168.')) {
            return true;
        }
        if (str_starts_with($ip, '172.')) {
            $second = (int) explode('.', $ip)[1];
            return $second >= 16 && $second <= 31;
        }
        return false;
    }
}
