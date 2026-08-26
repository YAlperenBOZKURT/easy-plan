-- Kartlar normal silmede hemen yok edilmez. Arşiv ve çöp kutusu durumları
-- aynı satırda tutulur; yalnız kalıcı silme ilişkili görselleri de kaldırır.
ALTER TABLE cards ADD COLUMN archived_at TEXT;
ALTER TABLE cards ADD COLUMN trashed_at TEXT;

CREATE INDEX idx_cards_user_archived ON cards(user_id, archived_at);
CREATE INDEX idx_cards_user_trashed ON cards(user_id, trashed_at);
