ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS track_reversals boolean NOT NULL DEFAULT true;