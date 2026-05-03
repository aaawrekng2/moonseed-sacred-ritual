ALTER TABLE public.custom_decks
ADD COLUMN IF NOT EXISTS corner_radius_px integer NULL DEFAULT NULL
CHECK (corner_radius_px IS NULL OR (corner_radius_px >= 0 AND corner_radius_px <= 60));