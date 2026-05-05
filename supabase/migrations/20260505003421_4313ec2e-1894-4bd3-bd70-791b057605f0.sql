-- FD-1 — per-card crop + radius + processing fields on custom_deck_cards
ALTER TABLE public.custom_deck_cards
  ADD COLUMN IF NOT EXISTS crop_coords jsonb,
  ADD COLUMN IF NOT EXISTS corner_radius_percent integer,
  ADD COLUMN IF NOT EXISTS processed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS original_path text;

-- Constrain processing_status to known values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'custom_deck_cards_processing_status_chk'
  ) THEN
    ALTER TABLE public.custom_deck_cards
      ADD CONSTRAINT custom_deck_cards_processing_status_chk
      CHECK (processing_status IN ('pending', 'saved', 'failed'));
  END IF;
END $$;

-- Helpful index for backfill / status queries.
CREATE INDEX IF NOT EXISTS custom_deck_cards_status_idx
  ON public.custom_deck_cards (deck_id, processing_status);