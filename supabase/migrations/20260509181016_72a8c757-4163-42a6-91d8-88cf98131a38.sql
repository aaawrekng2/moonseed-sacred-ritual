ALTER TABLE public.custom_decks
  ADD COLUMN IF NOT EXISTS source_zip_path text;