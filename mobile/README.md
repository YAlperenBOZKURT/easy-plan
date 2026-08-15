# Planner Native Client

This directory contains the shared Flutter client for Planner's mobile and desktop targets. Android and Windows are the currently configured platforms; the application architecture is also suitable for additional Flutter targets.

See the [project README](../README.md) for the product overview, backend setup, deployment instructions, security model, and complete environment reference.

## Capabilities

- Responsive rolling-calendar interface for phone and desktop layouts
- Short-lived Bearer access JWTs and rotating refresh JWTs in secure platform storage
- Drag-and-drop card ordering across days
- Card editing, reminders, image capture, and image upload
- Local notifications on supported mobile platforms
- Offline SQLite cache and ordered write queue
- Delta synchronization with server-side tombstones
- Automatic token rotation and one-time retry after an expired access JWT
- Structured logging and application-level error handling

## Requirements

- Flutter stable with Dart 3.12 or later
- A running Planner API
- Android SDK for Android development
- Visual Studio with Desktop development with C++ for Windows development

## Setup

```bash
flutter pub get
flutter devices
```

Run the Windows application:

```bash
flutter run -d windows
```

Run on a connected Android target:

```bash
flutter run -d <device-id> --dart-define=PLANNER_API_URL=http://10.0.2.2:3000
```

The API origin is fixed at build/run time and is not editable on the login screen. It defaults to `http://localhost:3000`. Set another origin with `--dart-define=PLANNER_API_URL=...`; physical devices need a reachable LAN or HTTPS address, while Android emulators normally use `http://10.0.2.2:3000`.

## Verification

```bash
flutter analyze
flutter test
flutter test --coverage
```

Live API smoke tests require credentials supplied through the process environment:

```text
PLANNER_URL
PLANNER_EMAIL
PLANNER_PASSWORD
```

The smoke tests are skipped when these values are absent; unit, widget, offline, mobile-interaction, and desktop-layout tests still run.

## Production builds

Android application bundle:

```bash
flutter build appbundle --release --dart-define=PLANNER_API_URL=https://planner.example.com
```

Windows application:

```bash
flutter build windows --release --dart-define=PLANNER_API_URL=https://planner.example.com
```

Production clients should use an HTTPS API URL with a valid certificate.
