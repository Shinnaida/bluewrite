# Blotter Capture (phone app)

Photograph the written blotter, read it through the portal's own OCR, and
file photo plus reviewed text into a Write Report draft. Checking happens in
the portal's draft sheet, where each photo sits beside the narrative it
produced. Full operator guide: `bluewrite/docs/MOBILE_APP.md`.

## Build

Needs the toolchain this PC now carries: Flutter stable in
`%USERPROFILE%\flutter`, JDK 17, and the Android SDK in
`%LOCALAPPDATA%\Android\Sdk` (platform-34, build-tools 34). VS Code has the
Flutter + Dart extensions.

```bat
cd blotter-app
flutter pub get
flutter analyze        :: must say "No issues found!"
flutter build apk --debug
```

The APK lands in `build\app\outputs\flutter-apk\app-debug.apk`. Install it
on the officer's phone (USB or file transfer) — the emulator proves nothing
here, because it has no real blotter to photograph.

SPACE IN THE WINDOWS USERNAME — READ THIS. This PC signs in as
`Shaine Jayme`, and the space breaks the Flutter Gradle plugin's output
validation (`Cannot create parent directories that are existing as file`
under `blotter-app\build`), so `flutter build` FAILS inside the repo.
Build from a space-free staging copy instead — `C:\bw-app` already holds
one, and it is the only copy that is ever built:

```bat
robocopy blotter-app C:\bw-app /MIR /XD build .dart_tool
cd C:\bw-app
flutter build apk --debug
copy C:\bw-app\build\app\outputs\flutter-apk\app-debug.apk blotter-app\build\app\outputs\flutter-apk\
```

`C:\bw-app\build` is scratch (git-ignored here via `blotter-app/.gitignore`);
`blotter-app/` stays the source of truth — never edit the staging copy.

## Verify on the real path (station Wi-Fi)

1. The portal API answers on the LAN (`http://<pc-lan-ip>:8099/`, firewall
   rule "BlueWrite LAN 8099" in place).
2. App: it finds the server itself (last address first, then a Wi-Fi scan) →
   full sign-in with the emailed code → set the app PIN. Type an address
   only if the scan finds nothing.
3. Capture a blotter page → correct the server's reading → pick the type,
   name the place → file.
4. On the portal: the Write Report sheet shows the text in the narrative and
   the photo under "Captured blotter photos". Check image against text.

## What the app never does

- No on-device OCR (the portal's engines cannot move to Flutter).
- No password on the phone; the PIN never leaves the phone.
- No writes without review: a reading is a proposal until the officer files it.
- Cleartext HTTP is the station LAN's plain HTTP only (see
  `android/app/src/main/AndroidManifest.xml`); HTTPS terminates at a reverse
  proxy when the station has one.
