CREATE TABLE card_templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  start_time TEXT,
  end_time TEXT,
  color TEXT NOT NULL DEFAULT 'blue',
  checklist_json TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'none',
  tags_json TEXT NOT NULL DEFAULT '[]',
  reminders TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_card_templates_user_updated
  ON card_templates(user_id, updated_at DESC);
