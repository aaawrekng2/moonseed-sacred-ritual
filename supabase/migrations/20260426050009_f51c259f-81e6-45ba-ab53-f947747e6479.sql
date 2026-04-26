ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS ui_density smallint NOT NULL DEFAULT 1
CHECK (ui_density IN (1, 2, 3));