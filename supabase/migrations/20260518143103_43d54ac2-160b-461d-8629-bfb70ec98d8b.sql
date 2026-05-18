ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS feedback_notifications_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS feedback_notification_email text,
  ADD COLUMN IF NOT EXISTS feedback_notification_frequency text NOT NULL DEFAULT 'instant';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_feedback_freq_check'
  ) THEN
    ALTER TABLE public.user_preferences
      ADD CONSTRAINT user_preferences_feedback_freq_check
      CHECK (feedback_notification_frequency IN ('instant','daily','weekly'));
  END IF;
END$$;