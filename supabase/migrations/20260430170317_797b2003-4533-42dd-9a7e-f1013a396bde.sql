
ALTER TABLE public.custom_deck_cards
ADD COLUMN source TEXT NOT NULL DEFAULT 'photographed'
CHECK (source IN ('photographed', 'imported', 'default')),
ADD COLUMN archived_at TIMESTAMPTZ;

ALTER TABLE public.custom_deck_cards
DROP CONSTRAINT custom_deck_cards_deck_id_card_id_key;

CREATE UNIQUE INDEX custom_deck_cards_active_unique
ON public.custom_deck_cards(deck_id, card_id)
WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.sync_deck_card_count()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _count INT; _deck UUID;
BEGIN
  _deck := COALESCE(NEW.deck_id, OLD.deck_id);
  SELECT COUNT(*) INTO _count FROM public.custom_deck_cards
    WHERE deck_id = _deck AND archived_at IS NULL AND source != 'default';
  UPDATE public.custom_decks
    SET cards_photographed_count = _count,
        is_complete = (_count >= 78)
    WHERE id = _deck;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_deck_card_count ON public.custom_deck_cards;
CREATE TRIGGER trg_sync_deck_card_count
AFTER INSERT OR UPDATE OR DELETE ON public.custom_deck_cards
FOR EACH ROW EXECUTE FUNCTION public.sync_deck_card_count();
