# Changelog

## Unreleased

### Reliability

- Native card writes are persisted before sending and replayed in order after
  reconnecting. Failed writes and local drafts survive server/network errors.
- Concurrent web/native edits preserve both versions and require an explicit
  conflict decision instead of silently overwriting changes.
- Shared-board archive, trash, delete and restore changes reach all current
  members. Background reminders target each active card creator in their timezone;
  maintenance cleans personal and shared-board data consistently.
- Native reminders use the complete selected-board cache and reconcile the
  nearest 64 future alarms. Unchanged requests survive date navigation and app
  restarts; offline completion/deletion and account/board changes update alarms.

### Release preparation

- Android release builds require upload-key signing and an explicit HTTPS API
  origin. Debug builds keep development HTTP access.
- Easy Plan labels and calendar/check icons are shared across Android, web and
  Windows. Android includes adaptive and monochrome launcher icons.
- Added the MIT license and a release checklist with clean-install, upgrade and
  deferred real-device reminder checks.
- CI runs actual web API and Flutter Store/API integration against an isolated
  HTTP server: offline conflicts, completion, image upload, lifecycle and revocation.
- Updated vulnerable dependencies to compatible patched versions.

Release signing credentials, physical-device results and store publication are
not supplied by this preparation change. No public version/tag is created yet.
