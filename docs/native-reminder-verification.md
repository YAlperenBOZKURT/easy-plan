# Android reminder verification

Status: automated scheduling/store regression tests cover the logic. Physical
delivery, permissions, reboot and OEM power-management behavior must be checked
on a real Android phone; do not mark this complete based on an emulator or unit
test alone.
These checks are deferred to the final release-readiness stage at the user's
request and remain pending until recorded on a device.

## Setup

Connect a phone with USB debugging enabled. Confirm it appears in `flutter devices`.
Start the API reachable from the phone and build/run from the mobile directory:

```powershell
flutter run -d <device-id> --dart-define=PLANNER_API_URL=https://your-test-api.example
```

Use a test account. Grant Android's notification permission. Set the test
account's timezone to the expected IANA zone through `PATCH /api/v1/me`; the
device timezone may differ. Make a card with a start time 61–65 minutes in the
future in the account's timezone and choose the 1-hour reminder. Inexact alarms
can be delayed, so record the actual arrival time and phone power settings.

## Scenarios

1. Verify delivery with the app foregrounded, then backgrounded. Repeat with
   the app dismissed from recent apps (do not use Android's Force stop).
2. Schedule a reminder, navigate to an empty week/month, and verify that its
   alarm still exists. Inspect package alarms when needed:

   ```powershell
   adb shell dumpsys alarm | Select-String 'com.alperen.planner' -Context 2,8
   ```

3. Complete, archive, trash or delete a card before the due time, including with
   the phone offline. Its reminder must not fire. An offline time edit must
   replace the original alarm. Cancel a pending edit through the queue UI and
   verify that the restored card's reminder is used.
4. Switch boards and sign out before the due time. The previous board/account's
   reminders must not fire. Sign into another account and verify isolation.
5. On a shared board, create cards as two different members. Each phone must
   schedule only its signed-in creator's cards. Remove a member, refresh that
   phone online, and verify cancellation. Revocation cannot reach an offline
   phone until it reconnects.
6. Restart the app offline. Existing alarms should survive with stable IDs and
   retain unseen dates. Reboot the device and verify both pending alarms and
   actual delivery. Update the installed app and repeat.
7. Change the account timezone, refresh online and inspect the new due instants.
   Change the device timezone independently; reminders continue to use the
   account timezone. Verify an untimed card uses the server's DEFAULT_CARD_TIME.
8. Deny permission, then grant it in Android settings and return to the app.
   Recheck delivery. Repeat under battery-saving modes relevant to the phone.
9. Seed more than 64 future reminders. The nearest 64 should be pending. After
   the first ones expire, reopen/refresh and confirm that later reminders enter
   the schedule.

Record device/model, Android version, app commit, account timezone, scenario,
expected/actual time and outcome. Never record passwords or JWTs. Track failures
before calling step 5 physically verified.

Reference: [flutter_local_notifications Android scheduling and reboot setup](https://pub.dev/packages/flutter_local_notifications).
