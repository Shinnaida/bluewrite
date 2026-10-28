import 'dart:convert';
import 'dart:io';

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

  /// The stored address, verified alive. Null when there is none or it
  /// stopped answering — the caller should scan, not fail.
  static Future<String?> verifyStored(String? baseUrl, {Duration timeout = const Duration(seconds: 4)}) async {
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
      final res = await http
          .get(Uri.parse('$baseUrl/api/v1/station'))
          .timeout(timeout);
      if (res.statusCode != 200 && res.statusCode != 401) return false;
      final type = (res.headers['content-type'] ?? '').toLowerCase();
      if (!type.contains('application/json')) return false;
      return jsonDecode(res.body) is Map<String, dynamic>;
    } catch (_) {
      return false;
    }
  }

  /// Scan every IPv4 /24 this phone sits on for a BlueWrite server.
  ///
  /// Returns the first address that handshakes, or null. Progress is the
  /// fraction of hosts knocked so far, for the setup screen's own words.
  /// Host order puts the likely server first: gateway (.1), neighbours of
  /// the phone's own address, then the rest — a server at .252 is found in
  /// the first seconds, not after scanning 1..251.
  static Future<String?> scanLan({void Function(double progress)? onProgress}) async {
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
        if (await _handshake('http://${net.prefix}.$h:$port', const Duration(seconds: 3))) {
          return 'http://${net.prefix}.$h:$port';
        }
        open.remove(h);
      }
    }
    return null;
  }

  static Future<bool> _tcpOpen(String prefix, int host, int port, Duration timeout) async {
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

  /// Every /24 this phone sits on, with hosts ordered gateway-first, then
  /// neighbours of the phone's own address, then the rest. Skips loopback,
  /// link-local (169.254.x.x = no DHCP) and network (.0) / broadcast (.255).
  static Future<List<_LanNet>> _lanNets() async {
    final nets = <_LanNet>[];
    try {
      final ifaces = await NetworkInterface.list(type: InternetAddressType.IPv4);
      for (final iface in ifaces) {
        for (final addr in iface.addresses) {
          if (addr.isLoopback) continue;
          final parts = addr.address.split('.');
          if (parts.length != 4) continue;
          if (parts[0] == '169' && parts[1] == '254') continue;
          final prefix = '${parts[0]}.${parts[1]}.${parts[2]}';
          final self = int.tryParse(parts[3]) ?? -1;
          if (nets.any((n) => n.prefix == prefix)) continue;
          nets.add(_LanNet(prefix, _orderedHosts(self)));
        }
      }
    } catch (_) {
      // No interfaces: the scan simply finds nothing and the manual address
      // takes over.
    }
    return nets;
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
