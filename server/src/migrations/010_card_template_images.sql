CREATE TABLE card_template_images (
  id          TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES card_templates(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file        TEXT NOT NULL,
  thumb       TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  width       INTEGER NOT NULL DEFAULT 0,
  height      INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE(template_id, file)
);

CREATE INDEX idx_template_images_template ON card_template_images(template_id);
CREATE INDEX idx_template_images_user_file ON card_template_images(user_id, file);
