CREATE TABLE boards (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_personal INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_boards_personal_owner
  ON boards(owner_id) WHERE is_personal = 1;

CREATE TABLE board_members (
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'viewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (board_id, user_id)
);

CREATE INDEX idx_board_members_user ON board_members(user_id, updated_at DESC);

INSERT INTO boards (id, owner_id, name, is_personal, created_at, updated_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
       substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' ||
       lower(hex(randomblob(6))), id, 'Kişisel', 1, created_at, updated_at
FROM users;

INSERT INTO board_members (board_id, user_id, role, created_at, updated_at)
SELECT id, owner_id, 'owner', created_at, updated_at FROM boards;

ALTER TABLE cards ADD COLUMN board_id TEXT REFERENCES boards(id) ON DELETE CASCADE;

UPDATE cards
SET board_id = (SELECT id FROM boards WHERE boards.owner_id = cards.user_id AND is_personal = 1);

CREATE INDEX idx_cards_board_day ON cards(board_id, day);
CREATE INDEX idx_cards_board_updated ON cards(board_id, updated_at);
