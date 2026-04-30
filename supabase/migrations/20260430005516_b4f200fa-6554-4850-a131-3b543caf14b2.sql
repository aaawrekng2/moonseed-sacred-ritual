-- Phase 9.5b spec gap fill (Stamp AS/AU/AV)

-- 1) cards_photographed_count on custom_decks
ALTER TABLE public.custom_decks
  ADD COLUMN IF NOT EXISTS cards_photographed_count INTEGER NOT NULL DEFAULT 0;

-- Backfill from existing rows
UPDATE public.custom_decks d
SET cards_photographed_count = COALESCE(sub.c, 0)
FROM (
  SELECT deck_id, COUNT(*)::int AS c
  FROM public.custom_deck_cards
  GROUP BY deck_id
) sub
WHERE sub.deck_id = d.id;

-- Trigger to keep the count in sync
CREATE OR REPLACE FUNCTION public.sync_deck_card_count()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _deck UUID;
  _count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _deck := OLD.deck_id;
  ELSE
    _deck := NEW.deck_id;
  END IF;
  SELECT COUNT(*) INTO _count FROM public.custom_deck_cards WHERE deck_id = _deck;
  UPDATE public.custom_decks
    SET cards_photographed_count = _count,
        is_complete = (_count >= 78)
    WHERE id = _deck;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_deck_card_count ON public.custom_deck_cards;
CREATE TRIGGER trg_sync_deck_card_count
  AFTER INSERT OR DELETE ON public.custom_deck_cards
  FOR EACH ROW EXECUTE FUNCTION public.sync_deck_card_count();

-- 2) readings.entry_mode (Stamp AU)
ALTER TABLE public.readings
  ADD COLUMN IF NOT EXISTS entry_mode TEXT NOT NULL DEFAULT 'digital'
  CHECK (entry_mode IN ('digital','manual'));

-- 3) readings.deck_id — lock historical readings to their deck (Stamp AV)
ALTER TABLE public.readings
  ADD COLUMN IF NOT EXISTS deck_id UUID REFERENCES public.custom_decks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_readings_deck_id ON public.readings(deck_id);