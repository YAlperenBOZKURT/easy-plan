-- Replace legacy opaque sessions with revocable JWT refresh sessions.
-- Existing sessions are intentionally invalidated during this security migration.

DROP TABLE sessions;

CREATE TABLE sessions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device             TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL,
  expires_at         TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

-- Recently consumed refresh tokens allow reuse detection. Reusing a rotated
-- token revokes the complete session instead of issuing another token pair.
CREATE TABLE session_refresh_history (
  token_hash  TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  consumed_at TEXT NOT NULL
);
CREATE INDEX idx_refresh_history_session ON session_refresh_history(session_id, consumed_at);
