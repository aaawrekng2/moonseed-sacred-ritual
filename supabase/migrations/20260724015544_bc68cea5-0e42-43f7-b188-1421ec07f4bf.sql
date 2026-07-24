ALTER TABLE public.readings
  ADD COLUMN IF NOT EXISTS note_preview text
  GENERATED ALWAYS AS (left(note, 500)) STORED;