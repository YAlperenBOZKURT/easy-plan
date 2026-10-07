# Reliability improvement plan

Each step is a separate branch and pull request. Complete its regression tests
and relevant platform checks before moving to the next step.
At the user's request, physical Android checks for step 5 are deferred to the
final release-readiness stage; implementation and automated checks can proceed.

1. **Offline write queue** — `fix/offline-write-queue`
   - Persist card mutations before attempting delivery.
   - Preserve failed requests, FIFO order, and the pending count on network,
     authentication, conflict, rate-limit, and server errors.
   - Prevent simultaneous replay and server refreshes overwriting pending edits.
   - Verify recovery, ambiguous successful requests, and concurrent sync calls.
2. **Concurrent edits and conflict resolution** — `fix/card-conflict-resolution`
   - Send the original server version with web and native edits.
   - Preserve the server record and local draft when a stale write is rejected.
   - Offer retry, discard, and explicit conflict-resolution controls.
   - Test two devices editing the same card and sequential offline edits.
3. **Shared-board deletion synchronization**
   - Scope card tombstones to the board and its authorized members.
   - Ensure restore clears the relevant deletion record for every member.
   - Test archive, trash, permanent deletion, restore, and membership changes.
4. **Shared-board background jobs**
   - Resolve reminders and trash cleanup using each card's board.
   - Count actual deletions and define reminder recipients explicitly.
   - Test personal/shared boards and owner/editor-created cards.
5. **Native reminder scheduling** — `fix/native-reminder-scheduling`
   - Schedule upcoming reminders independently of the visible date range.
   - Handle completion, deletion, account/board changes, timezone, and restart.
   - Verify scheduling on a real Android device.
6. **Release readiness**
   - Configure production Android signing and finalize product labels/icons.
   - Decide on licensing, add release notes, and verify a clean installation.
   - Add cross-client end-to-end scenarios and run the complete quality gate.

Steps 1–4 are merged into main. Card tombstones are
board-scoped and visible to current members, including viewers. Restores clear
the board's tombstone even when a different member restores the card; lifecycle
changes and tombstone writes commit together. Habit tombstones remain private.
Migration 015 repairs old hidden/restored records, recovers deleted-card boards
from activity history, and re-emits tombstones for existing sync cursors.

Reminder delivery resolves the card's actual board and targets its active,
current-member creator using that creator's timezone. Cleanup covers personal
and shared cards, including inactive/departed creators, counts actual deletions,
and preserves images referenced by another member's card or template. Scheduler
ticks are sequential and concurrent reminder runs share one delivery.
Regression tests cover recipient isolation, membership revocation, rescheduling,
channel failures, batch starvation, cleanup counts, image retention, and stop.

Step 5 is implemented on `fix/native-reminder-scheduling`, based on merged main.
Native scheduling uses the entire selected-board cache, its authenticated
recipient, creator IDs, and server-provided timezone/default time. It reconciles
the nearest 64 future alarms with durable OS requests and preserves unchanged
alarms across viewport navigation and process restarts. Optimistic local edits,
delta deletions, account/board transitions, authorization failures, language
changes and foreground refresh update the schedule; scheduling and cancellation
are serialized. Cache version 3 resets the sync cursor to refetch creator IDs
and settings without discarding pending writes. Android receivers restore alarms
after reboot/app updates.

Automated verification on 2026-10-07: Node type checks and Flutter analysis pass;
65 server, 54 web and 120 mobile tests pass (2 credential-dependent API smoke
tests are skipped). Web production and Android debug APK builds pass. Compatible
lockfile updates for busboy, sharp, shell-quote and source-map-js resolve the
audit findings; `npm audit --audit-level=high` reports zero vulnerabilities.

Real Android delivery/reboot verification is deferred to step 6 at the user's
request. Follow `docs/native-reminder-verification.md` when a device is available;
unit tests and APK builds do not claim physical-device delivery. Include these
checks in the final release gate. PR creation follows user review.
