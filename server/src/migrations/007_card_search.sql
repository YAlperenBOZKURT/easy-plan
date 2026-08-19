-- Kullanıcıya ait kart başlığı ve notlarında hızlı, Unicode uyumlu tam metin arama.
CREATE VIRTUAL TABLE card_search USING fts5(
  card_id UNINDEXED,
  user_id UNINDEXED,
  title,
  note,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO card_search (card_id, user_id, title, note)
SELECT id, user_id, title, note FROM cards;

CREATE TRIGGER card_search_after_insert
AFTER INSERT ON cards BEGIN
  INSERT INTO card_search (card_id, user_id, title, note)
  VALUES (new.id, new.user_id, new.title, new.note);
END;

CREATE TRIGGER card_search_after_update
AFTER UPDATE OF title, note, user_id ON cards BEGIN
  DELETE FROM card_search WHERE card_id = old.id;
  INSERT INTO card_search (card_id, user_id, title, note)
  VALUES (new.id, new.user_id, new.title, new.note);
END;

CREATE TRIGGER card_search_after_delete
AFTER DELETE ON cards BEGIN
  DELETE FROM card_search WHERE card_id = old.id;
END;
