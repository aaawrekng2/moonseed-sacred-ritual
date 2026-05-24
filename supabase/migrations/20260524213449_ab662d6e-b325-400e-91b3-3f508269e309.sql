ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS reversal_chance_pct integer DEFAULT 50;