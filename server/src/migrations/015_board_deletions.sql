-- Card tombstones belong to a board, not the member who hid/deleted the card.
-- Habit tombstones remain private and continue to use user_id.
ALTER TABLE deletions ADD COLUMN board_id TEXT REFERENCES boards(id) ON DELETE CASCADE;

-- Older restores by another member could leave a tombstone for an active card.
DELETE FROM deletions
WHERE entity = 'card' AND id IN (
  SELECT id FROM cards WHERE archived_at IS NULL AND trashed_at IS NULL
);

-- Recover the board of permanently deleted cards from activity history when
-- available. Pre-collaboration personal deletions retain their original scope.
UPDATE deletions
SET board_id = COALESCE(
  (SELECT board_id FROM cards WHERE cards.id = deletions.id),
  (SELECT board_id FROM card_activity WHERE card_id = deletions.id
   ORDER BY created_at DESC, id DESC LIMIT 1),
  (SELECT id FROM boards WHERE owner_id = deletions.user_id AND is_personal = 1)
), deleted_at = MAX(deleted_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE entity = 'card';

-- Re-emit hidden cards so members who already advanced their sync cursor can
-- remove stale cached copies after this migration, even if a record was absent.
INSERT INTO deletions (entity, id, user_id, deleted_at, board_id)
SELECT 'card', id, user_id,
       MAX(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), board_id
FROM cards WHERE archived_at IS NOT NULL OR trashed_at IS NOT NULL
ON CONFLICT(entity, id) DO UPDATE SET
  board_id = excluded.board_id,
  deleted_at = MAX(deletions.deleted_at, excluded.deleted_at);

CREATE INDEX idx_deletions_board ON deletions(board_id, deleted_at) WHERE entity = 'card';
