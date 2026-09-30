# Reliability improvement plan

Each step is a separate branch and pull request. Complete its regression tests
and relevant platform checks before moving to the next step.

1. **Offline write queue** — `fix/offline-write-queue`
   - Persist card mutations before attempting delivery.
   - Preserve failed requests, FIFO order, and the pending count on network,
     authentication, conflict, rate-limit, and server errors.
   - Prevent simultaneous replay and server refreshes overwriting pending edits.
   - Verify recovery, ambiguous successful requests, and concurrent sync calls.
2. **Concurrent edits and conflict resolution**
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

Current scope: step 1 only. Retained rejected requests are surfaced as a blocked
queue; resolution controls belong to step 2. PR creation follows user review.
