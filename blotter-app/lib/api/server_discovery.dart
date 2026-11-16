import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

/// Finding the station server without typing anything.
///
/// ORDER. The phone tries the address it already knows first — that is what
/// makes the app work off the station Wi-Fi too: from anywhere the server is
/// reachable (VPN, forwarded port, reverse proxy), the last good address is
/// verified with the same handshake the old Test-connection button ran. Only
/// when there is no stored address, or it stopped answering, does the phone
/// scan the Wi-Fi it is on for a BlueWrite server. Typing an address is the
/// last resort, not the first step.
///
/// HANDSHAKE. A candidate counts only if it speaks BlueWrite: the same
/// GET /api/v1/station probe PortalClient.testConnection runs, where a 401
/// IS a yes (the route is session-guarded in some builds — the proof we need
/// is "this origin speaks our API", not a session).
///
/// WHICH NETWORK. A phone can sit anywhere in the station's subnet and still
/// be in a different /24 from the server: the station Wi-Fi runs
/// 192.168.64.0/21 (mask 255.255.248.0), so a phone handed 192.168.71.23 is
/// on the SAME network as a server at 192.168.68.109, but the old /24-only
/// scan never looked at .68 and setup reported "could not reach the server".
/// The scan therefore learns the phone's real netmask — from Android's
/// ConnectivityManager over a platform channel (apps are denied
/// /proc/net/route on modern Android), or from /proc/net/route on a Linux
/// host — and knocks every /24 inside that subnet, nearest to the phone
/// first, capped so a /16 cannot turn setup into a minutes-long scan. When
/// no netmask can be read the scan falls back to the phone's own /24.
///
/// WHY TWO STAGES. The station runs PHP's built-in server (see
/// scripts/serve.cmd), which answers one request at a time. Hammering all
/// 254 hosts with parallel HTTP probes queues up on that one thread and
/// times out the real server. So the scan first TCP-knocks each host on
/// port 8099 (refused = instant, no server load), then handshakes ONLY the
/// handful of hosts with an open port, a few at a time.
///
/// No new dependencies: the scan is dart:io NetworkInterfaces + Sockets plus
/// the http package the app already carries.
class ServerDiscovery {
  static const int port = 8099;

  /// Android's real prefix lengths (see MainActivity); empty elsewhere.
  static const MethodChannel _networkChannel =
      MethodChannel('bluewrite/network');

  /// The most /24 blocks one subnet may contribute to a scan. A /21 is
  /// exactly eight; a wider subnet (a /16 campus network) is centred on the
  /// phone's own block and capped here, because every extra block is another
  /// 254 knocks before setup can give up.
  static const int _maxPrefixes = 8;

  /// The stored address, verified alive. Null when there is none or it
  /// stopped answering — the caller should scan, not fail.
  static Future<String?> verifyStored(String? baseUrl,
      {Duration timeout = const Duration(seconds: 4)}) async {
    final base = (baseUrl ?? '').trim();
    if (base.isEmpty) return null;
    return await _handshake(base, timeout) ? base : null;
  }

  /// Stricter than the setup screen's old Test-connection: a candidate
  /// counts only when it answers 200 or 401 with a JSON body — the shape the
  /// portal's own handshake has (see StationController/Auth). A hotspot
  /// login page or a router admin UI on the same port answers HTML or a bare
  /// 404, and must never read as "the server".
  static Future<bool> _handshake(String baseUrl, Duration timeout) async {
    try {
      final res =
          await http.get(Uri.parse('$baseUrl/api/v1/station')).timeout(timeout);
      if (res.statusCode != 200 && res.statusCode != 401) return false;
      final type = (res.headers['content-type'] ?? '').toLowerCase();
      if (!type.contains('application/json')) return false;
      return jsonDecode(res.body) is Map<String, dynamic>;
    } catch (_) {
      return false;
    }
  }

  /// Scan the subnet this phone sits on for a BlueWrite server.
  ///
  /// Returns the first address that handshakes, or null. Progress is the
  /// fraction of hosts knocked so far, for the setup screen's own words.
  /// Host order puts the likely server first: gateway (.1), neighbours of
  /// the phone's own address, then the rest — a server at .252 is found in
  /// the first seconds, not after scanning 1..251.
  static Future<String?> scanLan(
      {void Function(double progress)? onProgress}) async {
    final nets = await _lanNets();
    if (nets.isEmpty) {
      onProgress?.call(1);
      return null;
    }
    final total = nets.fold<int>(0, (n, net) => n + net.hosts.length);
    var done = 0;
    for (final net in nets) {
      final found = await _scanOnePrefix(
        net,
        onKnock: () {
          done++;
          onProgress?.call(done / total);
        },
      );
      if (found != null) return found;
    }
    return null;
  }

  /// Stored address first (works from anywhere reachable), then the LAN
  /// scan (works with no typing on the station Wi-Fi). Null only when both
  /// miss — that is when the setup screen offers the manual address.
  static Future<String?> autoConnect({
    required String? storedBaseUrl,
    void Function(double progress)? onProgress,
  }) async {
    final known = await verifyStored(storedBaseUrl);
    if (known != null) return known;
    return scanLan(onProgress: onProgress);
  }

  static Future<String?> _scanOnePrefix(
    _LanNet net, {
    required void Function() onKnock,
  }) async {
    // Stage 1: TCP knock — cheap, parallel, no load on the PHP thread.
    // Batch 24 at 400ms: refused hosts fail in milliseconds; a /24 knocks
    // through in a few seconds.
    const knockBatch = 24;
    const knockTimeout = Duration(milliseconds: 500);
    final open = <int>[];
    for (var i = 0; i < net.hosts.length; i += knockBatch) {
      final slice = net.hosts.sublist(
        i,
        (i + knockBatch).clamp(0, net.hosts.length),
      );
      final results = await Future.wait(
        slice.map((h) => _tcpOpen(net.prefix, h, port, knockTimeout)),
      );
      for (var k = 0; k < slice.length; k++) {
        onKnock();
        if (results[k]) open.add(slice[k]);
      }
      // Stage 2 interleaved: handshake anything open before knocking more —
      // the server is usually the first open port, so return without
      // scanning the rest of the subnet.
      for (final h in List<int>.from(open)) {
        if (await _handshake(
            'http://${net.prefix}.$h:$port', const Duration(seconds: 3))) {
          return 'http://${net.prefix}.$h:$port';
        }
        open.remove(h);
      }
    }
    return null;
  }

  static Future<bool> _tcpOpen(
      String prefix, int host, int port, Duration timeout) async {
    try {
      final socket = await Socket.connect(
        '$prefix.$host',
        port,
        timeout: timeout,
      );
      socket.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Every /24 this phone can reach on its own interfaces, gateway-first.
  ///
  /// Skips loopback, link-local (169.254.x.x = no DHCP), and .0 / .255. The
  /// phone's own /24 comes first; the other /24s of its subnet follow, with
  /// no mask assumed beyond what the kernel route table states (see the
  /// class doc).
  static Future<List<_LanNet>> _lanNets() async {
    final nets = <_LanNet>[];
    final seen = <String>{};
    final masks = await _routeMasks();
    final prefixes = await _androidPrefixes();
    try {
      final ifaces =
          await NetworkInterface.list(type: InternetAddressType.IPv4);
      for (final iface in ifaces) {
        for (final addr in iface.addresses) {
          if (addr.isLoopback) continue;
          final parts = addr.address.split('.');
          if (parts.length != 4) continue;
          if (parts[0] == '169' && parts[1] == '254') continue;
          final prefix = '${parts[0]}.${parts[1]}.${parts[2]}';
          final self = int.tryParse(parts[3]) ?? -1;
          if (seen.add(prefix)) {
            nets.add(_LanNet(prefix, _orderedHosts(self)));
          }
          final ownBits = prefixes[addr.address];
          final mask = ownBits != null
              ? _maskForPrefix(ownBits)
              : _bestMask(addr.address, masks[iface.name] ?? const []);
          for (final p in _prefixesIn(addr.address, mask, prefix)) {
            if (seen.add(p)) nets.add(_LanNet(p, _orderedHosts(-1)));
          }
        }
      }
    } catch (_) {
      // No interfaces: the scan simply finds nothing and the manual address
      // takes over.
    }
    return nets;
  }

  /// The netmask the kernel gave each interface, from `/proc/net/route`.
  ///
  /// This is the Linux fallback: modern Android denies the table to apps, so
  /// [_androidPrefixes] supplies the same information there. One line per
  /// route, e.g.
  ///
  ///     Iface Destination Gateway Flags RefCnt Use Metric Mask ...
  ///     wlan0 0000A8C0    00000000 0001  0      0   0      00FFFFFF
  ///
  /// with each field in little-endian hex. A mask of 0 is the default route,
  /// not a subnet, so it is ignored. Any failure (a future Android that
  /// closes /proc, or a non-Linux test host) returns an empty map and the
  /// scan keeps its old /24 behaviour.
  static Future<Map<String, List<int>>> _routeMasks() async {
    final out = <String, List<int>>{};
    try {
      final lines = await File('/proc/net/route').readAsLines();
      for (final line in lines.skip(1)) {
        final f = line.trim().split(RegExp(r'\s+'));
        if (f.length < 8) continue;
        final mask = _leHex(f[7]);
        if (mask == 0) continue;
        out.putIfAbsent(f[0], () => <int>[]).add(mask);
      }
    } catch (_) {
      // Not Linux, or not readable: no masks known.
    }
    return out;
  }

  /// IPv4 address -> prefix length, from Android's ConnectivityManager.
  ///
  /// /proc/net/route is empty on the very platform this scan ships to, so
  /// without this a /21 Wi-Fi would still be scanned as a single /24. The
  /// channel returns the prefix of each link address (192.168.64.81/21 ->
  /// 21); elsewhere the channel is missing and this returns an empty map.
  static Future<Map<String, int>> _androidPrefixes() async {
    try {
      final raw = await _networkChannel
          .invokeMethod<Map<dynamic, dynamic>>('ipv4Prefixes');
      if (raw == null) return const <String, int>{};
      return raw.map(
        (k, v) => MapEntry(k as String, (v as num).toInt()),
      );
    } catch (_) {
      return const <String, int>{};
    }
  }

  /// A prefix length as a 32-bit netmask (21 -> 255.255.248.0).
  static int _maskForPrefix(int bits) {
    if (bits <= 0) return 0;
    if (bits >= 32) return 0xFFFFFFFF;
    return (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF;
  }

  /// Little-endian hex from the route table, with the bytes read back to the
  /// network order everything else here speaks. `00FFFFFF` → 0xFFFFFF00.
  static int _leHex(String s) {
    final v = int.tryParse(s, radix: 16) ?? 0;
    return ((v & 0xFF) << 24) |
        ((v & 0xFF00) << 8) |
        ((v >> 8) & 0xFF00) |
        ((v >> 24) & 0xFF);
  }

  static int _ipInt(String address) {
    final p = address.split('.');
    if (p.length != 4) return 0;
    var v = 0;
    for (final part in p) {
      v = (v << 8) | (int.tryParse(part) ?? 0);
    }
    return v;
  }

  static int _popcount(int v) {
    var n = 0;
    while (v != 0) {
      v &= v - 1;
      n++;
    }
    return n;
  }

  /// The most specific mask whose network contains this address. Several
  /// routes can name one interface; the smallest subnet is the one the phone
  /// is actually a member of.
  static int? _bestMask(String address, List<int> masks) {
    if (masks.isEmpty) return null;
    final ip = _ipInt(address);
    int? best;
    var bestBits = -1;
    for (final m in masks) {
      if ((ip & m) == 0) continue;
      final bits = _popcount(m);
      if (bits > bestBits) {
        best = m;
        bestBits = bits;
      }
    }
    return best ?? masks.first;
  }

  /// Every /24 inside `address`'s subnet except its own, nearest first.
  ///
  /// A /21 yields seven neighbours; a /16 is a 256-block subnet, so only the
  /// eight around the phone's block are returned. The first two octets come
  /// from the address itself (the mask fixes them for any prefix ≥ /16, which
  /// is every LAN this app meets).
  static List<String> _prefixesIn(String address, int? mask, String ownPrefix) {
    if (mask == null || mask == 0) return const <String>[];
    final bits = _popcount(mask);
    if (bits >= 24) return const <String>[];
    final ip = _ipInt(address);
    final base3 = ((ip & mask) >> 8) & 0xFF;
    final own3 = (ip >> 8) & 0xFF;
    final fullBlocks = 1 << (24 - bits);
    var blocks = fullBlocks;
    var start3 = base3;
    if (blocks > _maxPrefixes) {
      // Centre on the phone, then clamp the window inside the subnet.
      blocks = _maxPrefixes;
      start3 = own3 - (blocks ~/ 2 - 1);
      final last = base3 + fullBlocks - blocks;
      if (start3 < base3) start3 = base3;
      if (start3 > last) start3 = last;
    }
    final parts = ownPrefix.split('.');
    final out = <String>[];
    for (var i = 0; i < blocks; i++) {
      final o3 = (start3 + i) & 0xFF;
      final p = '${parts[0]}.${parts[1]}.$o3';
      if (p != ownPrefix) out.add(p);
    }
    out.sort((a, b) => (int.tryParse(a.split('.')[2])! - own3)
        .abs()
        .compareTo((int.tryParse(b.split('.')[2])! - own3).abs()));
    return out;
  }

  /// .1 (gateway / likely server) first, then ±25 around the phone, then
  /// everything else ascending. Keeps 2..254 (skips .0 net and .255 bcast).
  static List<int> _orderedHosts(int self) {
    final first = <int>[1];
    if (self >= 2 && self <= 254 && self != 1) first.add(self);
    for (var d = 1; d <= 25; d++) {
      for (final h in [self - d, self + d]) {
        if (h >= 2 && h <= 254 && !first.contains(h)) first.add(h);
      }
    }
    for (var h = 2; h <= 254; h++) {
      if (!first.contains(h)) first.add(h);
    }
    return first;
  }
}

class _LanNet {
  _LanNet(this.prefix, this.hosts);
  final String prefix;
  final List<int> hosts;
}
