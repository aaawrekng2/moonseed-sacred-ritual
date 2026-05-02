ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS dismissed_hints jsonb NOT NULL DEFAULT '{}'::jsonb;