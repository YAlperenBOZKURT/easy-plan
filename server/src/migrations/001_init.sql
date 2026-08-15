-- Planner ilk şema. Her veri satırı bir kullanıcıya aittir; sorgular repo katmanından
-- geçtiği için user_id filtresi tek bir yerde garanti altına alınır (bkz. src/repo.ts).

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL DEFAULT '',
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'user',        -- 'admin' | 'user'
  timezone       TEXT NOT NULL DEFAULT 'Europe/Istanbul',
  daily_summary  INTEGER NOT NULL DEFAULT 1,          -- sabah 08:00 özeti isteniyor mu
  last_summary_day TEXT,                              -- aynı gün iki kez özet gitmesin
  active         INTEGER NOT NULL DEFAULT 1,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE cards (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,                          -- 'YYYY-MM-DD' (kullanıcının saat dilimine göre)
  title       TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  start_time  TEXT,                                   -- 'HH:MM' | NULL
  end_time    TEXT,                                   -- 'HH:MM' | NULL
  color       TEXT NOT NULL DEFAULT 'red',
  done        INTEGER NOT NULL DEFAULT 0,
  sort_index  REAL NOT NULL,
  manual_sort INTEGER NOT NULL DEFAULT 0,             -- 1 ise saat değişse de sıra korunur
  habit_id    TEXT,                                   -- yalnızca köken bilgisi, bağ yok
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_cards_user_day ON cards(user_id, day);
CREATE INDEX idx_cards_user_updated ON cards(user_id, updated_at);
CREATE INDEX idx_cards_habit ON cards(habit_id);

CREATE TABLE card_images (
  id       TEXT PRIMARY KEY,
  card_id  TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file     TEXT NOT NULL,                             -- uploads köküne göre yol
  thumb    TEXT NOT NULL,
  bytes    INTEGER NOT NULL DEFAULT 0,
  width    INTEGER NOT NULL DEFAULT 0,
  height   INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_images_card ON card_images(card_id);
CREATE INDEX idx_images_user ON card_images(user_id);

CREATE TABLE habits (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              TEXT NOT NULL DEFAULT '',
  note               TEXT NOT NULL DEFAULT '',
  start_time         TEXT,
  end_time           TEXT,
  color              TEXT NOT NULL DEFAULT 'red',
  weekdays           TEXT NOT NULL DEFAULT '',        -- '1,3,5' (1=Pzt … 7=Paz)
  reminders          TEXT NOT NULL DEFAULT '',        -- '1440,60' → üretilen karta kopyalanır
  active             INTEGER NOT NULL DEFAULT 1,
  materialized_until TEXT,                            -- bu güne kadar kart üretildi
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_habits_user ON habits(user_id);

CREATE TABLE card_reminders (
  id             TEXT PRIMARY KEY,
  card_id        TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offset_minutes INTEGER NOT NULL,                    -- 1440 | 720 | 360 | 180 | 60
  fire_at        TEXT NOT NULL,                       -- UTC ISO
  sent_at        TEXT,                                -- NULL = bekliyor
  status         TEXT,                                -- 'sent' | 'skipped' | 'missed' | 'error'
  UNIQUE(card_id, offset_minutes)
);
CREATE INDEX idx_reminders_pending ON card_reminders(fire_at) WHERE sent_at IS NULL;

CREATE TABLE mail_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  kind       TEXT NOT NULL,                           -- reminder | daily | test | invite | reset
  card_id    TEXT,
  to_addr    TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL,                           -- ok | error | disabled
  error      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_mail_log_created ON mail_log(created_at);
CREATE INDEX idx_mail_log_user ON mail_log(user_id, created_at);

-- Mobil istemcinin neyin silindiğini öğrenmesi için mezar taşı kayıtları
CREATE TABLE deletions (
  entity     TEXT NOT NULL,                           -- 'card' | 'habit'
  id         TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (entity, id)
);
CREATE INDEX idx_deletions_user ON deletions(user_id, deleted_at);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
