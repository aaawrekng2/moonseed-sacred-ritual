ALTER TABLE public.reading_photos
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS reading_photos_archived_idx
  ON public.reading_photos (user_id, archived_at)
  WHERE archived_at IS NOT NULL;