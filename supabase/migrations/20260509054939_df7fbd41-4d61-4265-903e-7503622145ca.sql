-- Q3: Per-card source deck tracking + cascade delete for cards.
-- 1. Add card_deck_ids uuid[] to readings, parallel to card_ids.
ALTER TABLE public.readings
  ADD COLUMN IF NOT EXISTS card_deck_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- 2. Add primary_deck_id summary header (nullable; no FK so deleted decks
--    don't NULL-cascade unexpectedly — readings.deck_id already exists for
--    that purpose).

-- 3. Add ON DELETE CASCADE FK on custom_deck_cards.deck_id so hard-deleting
--    a deck removes its cards atomically.
ALTER TABLE public.custom_deck_cards
  DROP CONSTRAINT IF EXISTS custom_deck_cards_deck_id_fkey;
ALTER TABLE public.custom_deck_cards
  ADD CONSTRAINT custom_deck_cards_deck_id_fkey
    FOREIGN KEY (deck_id)
    REFERENCES public.custom_decks(id)
    ON DELETE CASCADE;