ALTER TABLE cards ADD COLUMN priority TEXT NOT NULL DEFAULT 'none'
  CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent'));
