# Release preparation

The preparation branch is `fix/release-readiness`. Product name: **Easy Plan**.
Application ID stays `com.alperen.planner` so existing installations retain their
upgrade identity. Source and original brand assets use the [MIT license](../LICENSE).
Release notes are in [CHANGELOG.md](../CHANGELOG.md); they remain Unreleased
until a version and publication date are chosen.

## Android signing

Release builds use a release signing configuration and never fall back to the
debug signing key. Use your existing upload key for an existing distribution.
For a new distribution, generate an upload key interactively (passwords are
prompted rather than stored in shell history):

```powershell
keytool -genkeypair -v -keystore C:/private/easy-plan-upload.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias upload
Copy-Item mobile/android/key.properties.example mobile/android/key.properties
```

Create the private destination directory first. `keytool` is in your JDK's `bin`
directory if it is not on PATH. Fill in `storeFile`, `storePassword`, `keyAlias`
and `keyPassword` in `mobile/android/key.properties`. `storeFile` is absolute or
relative to `mobile/android`; use forward slashes on Windows. The properties
file and keystores are ignored by Git. Back up the upload key and passwords
privately; they are needed for future updates.

For a build service, use these environment variables instead (each takes
precedence over its corresponding file property):

| File property | Environment variable |
| --- | --- |
| storeFile | ANDROID_KEYSTORE_PATH |
| storePassword | ANDROID_KEYSTORE_PASSWORD |
| keyAlias | ANDROID_KEY_ALIAS |
| keyPassword | ANDROID_KEY_PASSWORD |

Build with an explicit HTTPS API origin and the release's version/build number:

```powershell
cd mobile
flutter build appbundle --release --dart-define=PLANNER_API_URL=https://your-api-host --build-name=1.0.0 --build-number=1
flutter build apk --release --dart-define=PLANNER_API_URL=https://your-api-host --build-name=1.0.0 --build-number=1
```

Use an origin without `/api/v1`, trailing slash, credentials, query or fragment.
Increase the build number relative to the last distributed build. The shown
version numbers are examples; this branch does not publish or bump a version.
Verify the signing certificate matches the expected upload/app signing workflow
before distribution. Production Android blocks cleartext HTTP; debug builds
permit development HTTP.

The automated configuration check needs Flutter, Android SDK and JDK (`JAVA_HOME`):

```powershell
npm run check:android-release
```

It checks rejected missing signing and HTTP origin, builds an AAB with a fresh
two-day **verification-only** key, verifies its signature, and removes that key
and test bundle. It never creates or validates your production upload identity.
Run actual release builds afterwards with your own key and API origin.
If an existing release AAB is present, the check stops; move that artifact to a
safe location first. The check does not overwrite or delete an existing release.

References: [Flutter Android release/signing](https://docs.flutter.dev/deployment/android),
[Android adaptive icons](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive).

## Product assets

`assets/branding/easy-plan.svg` is the source for web icons, legacy Android PNGs
and the Windows ICO. Run `npm run icons` after changing it. Android adaptive and
monochrome vector resources must be updated to match the source; they keep the
calendar/check glyph inside the launcher's safe zone. Inspect circular/squircle
and themed launcher rendering on a device before publication.

## Automated gate

```powershell
npm ci
npm run quality
npm audit --audit-level=high
npm run check:android-release
```

`quality` includes Node type checks, Flutter analysis, server/web/mobile tests,
web production build and `test:e2e`. The integration runner creates a temporary
database, two disposable users and a loopback HTTP server. The actual web API
module uses cookie sessions; the actual Flutter API/Store uses Bearer sessions
and SQLite. Only the browser cookie transport, offline network disconnection,
secure-storage platform channel and notification platform driver are adapted.
It checks shared-card version conflicts and explicit resolution, offline replay,
native image upload/web retrieval, delta archive/restore/delete, creator reminder
isolation and membership revocation. It uses no real account credentials and
cannot send SMTP/web push. This is API/Store integration; browser clicking and
physical notification delivery remain device checks.

## Final manual gate — pending

The user deferred physical-device checks until this final stage. These boxes
remain open until actual results are recorded; do not treat build success as
proof of installation, delivery or reboot behavior.

- [ ] Choose the real API origin, release version/build number and upload key.
- [ ] Install the signed APK on a clean test Android profile/device. Verify Easy
  Plan label/icon, login, calendar, image upload and notification permissions.
- [ ] On a separate profile/device, upgrade an earlier build signed by the same
  distribution key. Verify tokens, cached cards and pending writes survive the
  version 3 cache migration. A debug-signed install cannot be upgraded directly
  to a release signed with a different key; preserve data before uninstalling.
- [ ] Run every scenario in [native reminder verification](native-reminder-verification.md),
  including offline restart, reboot, app update, timezone, permissions and power modes.
- [ ] Repeat the integration scenario through the actual web UI and Android UI
  with owner/editor/viewer accounts; record offline recovery and revocation.
- [ ] Check the Windows release's clean install/startup, name/icon,
  secure-storage access and login to the real HTTPS API.
- [ ] Verify backup/restore and health checks for the deployed server, then record
  test device/OS, commit, signing certificate fingerprint and outcomes.
- [ ] Move Unreleased notes to the chosen version and review the final artifacts
  before creating a tag or uploading to a store.

No commit, push, PR, release tag or store upload is performed by these checks.

## Recorded automated verification — 2026-10-07

- `npm run quality`: Node type checks, Flutter analysis, 65 server tests, 54 web
  tests and 120 mobile tests passed; 2 credential-dependent smoke tests skipped.
  Web build and the new real HTTP cross-client scenario passed.
- `npm audit --audit-level=high`: zero vulnerabilities.
- Android debug APK built; compiled manifest identifies `com.alperen.planner`,
  Easy Plan and the adaptive launcher resources.
- Android signing check rejected missing credentials and an HTTP API origin;
  the verification-only release AAB built and passed `jarsigner -verify`.
  The temporary key and AAB were removed. No production key was generated.
- Windows release built; executable metadata reports Easy Plan for product name
  and file description. This does not verify a clean installation or real API login.
- CI jobs are configured; their first remote execution will occur on the PR.
