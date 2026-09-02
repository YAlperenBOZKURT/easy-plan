CREATE TABLE card_activity (
  id            TEXT PRIMARY KEY,
  board_id      TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  card_id       TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL CHECK(action IN (
                  'created', 'updated', 'moved', 'completed', 'reopened',
                  'archived', 'trashed', 'restored', 'deleted', 'duplicated'
                )),
  card_title    TEXT NOT NULL DEFAULT '',
  details_json  TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_card_activity_board_created
  ON card_activity(board_id, created_at DESC, id DESC);
CREATE INDEX idx_card_activity_card_created
  ON card_activity(card_id, created_at DESC, id DESC);
