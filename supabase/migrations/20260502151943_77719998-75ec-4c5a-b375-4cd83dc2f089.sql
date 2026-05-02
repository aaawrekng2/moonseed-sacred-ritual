ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS moon_carousel_size text NOT NULL DEFAULT 'medium';

ALTER TABLE public.user_preferences
DROP CONSTRAINT IF EXISTS user_preferences_moon_carousel_size_check;

ALTER TABLE public.user_preferences
ADD CONSTRAINT user_preferences_moon_carousel_size_check
CHECK (moon_carousel_size IN ('small', 'medium', 'large'));

COMMENT ON COLUMN public.user_preferences.moon_carousel_size IS 'Preferred Moon carousel size: small, medium, or large.';