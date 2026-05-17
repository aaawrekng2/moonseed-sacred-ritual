ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS birth_latitude double precision,
ADD COLUMN IF NOT EXISTS birth_longitude double precision;