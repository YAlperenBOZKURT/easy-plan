# Reliability improvement plan

Each step is a separate branch and pull request. Complete its regression tests
and relevant platform checks before moving to the next step.

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
5. **Native reminder scheduling**
   - Schedule upcoming reminders independently of the visible date range.
   - Handle completion, deletion, account/board changes, timezone, and restart.
   - Verify scheduling on a real Android device.
6. **Release readiness**
   - Configure production Android signing and finalize product labels/icons.
   - Decide on licensing, add release notes, and verify a clean installation.
   - Add cross-client end-to-end scenarios and run the complete quality gate.

Steps 1 and 2 are merged. Step 3 is implemented on
`fix/shared-board-deletion-sync` and awaits user review. Card tombstones are
board-scoped and visible to current members, including viewers. Restores clear
the board's tombstone even when a different member restores the card; lifecycle
changes and tombstone writes commit together. Habit tombstones remain private.
Migration 015 repairs old hidden/restored records, recovers deleted-card boards
from activity history, and re-emits tombstones for existing sync cursors.

Step 3 is preserved in local commit `c399778`. Step 4 is implemented on
`fix/shared-board-background-jobs`, branched from step 3, and awaits user review.
Reminder delivery resolves the card's actual board and targets its active,
current-member creator using that creator's timezone. Cleanup covers personal
and shared cards, including inactive/departed creators, counts actual deletions,
and preserves images referenced by another member's card or template. Scheduler
ticks are sequential and concurrent reminder runs share one delivery.
Regression tests cover recipient isolation, membership revocation, rescheduling,
channel failures, batch starvation, cleanup counts, image retention, and stop.

Merge step 3 before step 4 (or initially target the step 4 PR at step 3's branch).
Next scope after those reviews: step 5, native reminder scheduling. Real Android
device verification remains outstanding and is not claimed by server tests.
PR creation follows user review.
