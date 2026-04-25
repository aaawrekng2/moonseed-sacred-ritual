-- Settings port: extend user_preferences with profile, blueprint, reading defaults,
-- moon features, theme, saved themes, and premium fields. All additive; safe defaults.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS display_name        text,
  ADD COLUMN IF NOT EXISTS initial_intention   text,
  ADD COLUMN IF NOT EXISTS birth_date          date,
  ADD COLUMN IF NOT EXISTS birth_time          time,
  ADD COLUMN IF NOT EXISTS birth_place         text,
  ADD COLUMN IF NOT EXISTS sun_sign            text,
  ADD COLUMN IF NOT EXISTS rising_sign         text,
  ADD COLUMN IF NOT EXISTS default_spread      text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS default_life_area   text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS show_reversals      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS outcome_reminders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS outcome_reminder_days     integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS moon_features_enabled     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS moon_show_carousel        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS moon_ai_phase             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS moon_ai_sign              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS moon_void_warning         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS accent_color        text,
  ADD COLUMN IF NOT EXISTS bg_gradient_from    text,
  ADD COLUMN IF NOT EXISTS bg_gradient_to      text,
  ADD COLUMN IF NOT EXISTS heading_font        text,
  ADD COLUMN IF NOT EXISTS heading_font_size   integer,
  ADD COLUMN IF NOT EXISTS saved_themes        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS active_theme_slot   integer,
  ADD COLUMN IF NOT EXISTS is_premium          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS premium_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS premium_since       timestamptz,
  ADD COLUMN IF NOT EXISTS premium_tier        text,
  ADD COLUMN IF NOT EXISTS premium_months_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_warning_sent_at timestamptz;

-- Add mode column to readings so the source's per-mode queries continue to work.
ALTER TABLE public.readings
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'personal';

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_readings_user_mode ON public.readings (user_id, mode);
