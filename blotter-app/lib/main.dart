import 'package:flutter/material.dart';

import 'api/portal_client.dart';
import 'api/server_discovery.dart';
import 'screens/capture_screen.dart';
import 'screens/login_screen.dart';
import 'screens/pin_screen.dart';
import 'screens/setup_screen.dart';
import 'storage/secure_store.dart';

/// Blotter capture: photograph the written blotter, read it through the
/// portal's own OCR, and file photo plus reviewed text into a Write Report
/// draft — appearing in the draft sheet exactly as an Upload / drag-drop
/// capture does on the web (see BlotterCapture.jsx).
///
/// Daily unlock is a local app PIN (see SecureStore): the password is never
/// on the phone, and the PIN never leaves it.
void main() => runApp(const BlotterApp());

class BlotterApp extends StatelessWidget {
  const BlotterApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BlueWrite',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: const Color(0xFF0C1B33)),
      home: const _Gate(),
    );
  }
}

class _Gate extends StatefulWidget {
  const _Gate();

  @override
  State<_Gate> createState() => _GateState();
}

class _GateState extends State<_Gate> {
  final _store = SecureStore();
  String? _route; // 'setup' | 'pin' | 'app' | 'checking' | 'refind'

  @override
  void initState() {
    super.initState();
    _decide();
  }

  /// Reopen rule: a stored token plus a stored PIN means the PIN screen
  /// only — never setup, never login, never a server check first. The
  /// server is verified silently after unlock, in _openApp.
  Future<void> _decide() async {
    final hasSetup = await _store.hasSetup();
    if (!mounted) return;
    if (!hasSetup) {
      setState(() => _route = 'setup');
      return;
    }
    final hasPin = await _store.hasPin();
    if (!mounted) return;
    setState(() => _route = hasPin ? 'pin' : 'setup');
  }

  @override
  Widget build(BuildContext context) {
    switch (_route) {
      case 'pin':
        return PinScreen(
          onUnlocked: _openApp,
          onReset: () => setState(() => _route = 'setup'),
        );
      case 'app':
        return const CaptureScreen();
      case 'refind':
        // Signed in already — find the server again, then walk straight in.
        return ServerSetupScreen(onConnected: (_) => _openApp());
      case 'setup':
        return SetupScreen(onDone: _openApp);
      default:
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
  }

  Future<void> _openApp() async {
    // Held before the first await: pushing through a saved handle is the
    // honest way to cross the async gaps below.
    final navigator = Navigator.of(context);
    final baseUrl = await _store.baseUrl();
    final token = await _store.token();
    if (!mounted) return;
    if (baseUrl == null || token == null) {
      setState(() => _route = 'setup');
      return;
    }
    // The server may have moved since setup (new DHCP lease, new PC):
    // verified silently first, then a quiet LAN scan — the sign-in on the
    // phone stays untouched either way. Only when both miss does the
    // phone show the setup screen's manual fallback.
    setState(() => _route = 'checking');
    final found = await ServerDiscovery.autoConnect(storedBaseUrl: baseUrl);
    if (!mounted) return;
    if (found == null) {
      setState(() => _route = 'refind');
      return;
    }
    if (found != baseUrl) await _store.saveBaseUrl(found);
    navigator.pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) => CaptureScreen(client: PortalClient(found), bearer: token),
      ),
      (_) => false,
    );
  }
}

/// The one-time setup flow is embedded in the gate: server address first,
/// then the full portal sign-in, then a local PIN. LoginScreen reports back
/// here when the device token is stored.
class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key, required this.onDone});
  final Future<void> Function() onDone;

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  String? _baseUrl;

  @override
  Widget build(BuildContext context) {
    if (_baseUrl == null) {
      return ServerSetupScreen(
        onConnected: (baseUrl) => setState(() => _baseUrl = baseUrl),
      );
    }
    return LoginScreen(baseUrl: _baseUrl!, onDone: widget.onDone);
  }
}
