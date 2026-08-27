ALTER TABLE cards
  ADD COLUMN template_id TEXT REFERENCES card_templates(id) ON DELETE SET NULL;

CREATE INDEX idx_cards_template ON cards(user_id, template_id);
