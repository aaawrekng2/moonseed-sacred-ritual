ALTER TABLE public.readings ADD COLUMN IF NOT EXISTS source text DEFAULT 'native';
CREATE INDEX IF NOT EXISTS readings_user_created_idx ON public.readings (user_id, created_at);
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS tarotpulse_import_done boolean NOT NULL DEFAULT false;