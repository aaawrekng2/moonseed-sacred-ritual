CREATE TABLE IF NOT EXISTS public.data_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_email text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_method text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  error_message text,
  client_ip text,
  user_agent text
);

ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS data_deletion_requests_requested_at_idx
  ON public.data_deletion_requests (requested_at DESC);

CREATE INDEX IF NOT EXISTS data_deletion_requests_user_id_idx
  ON public.data_deletion_requests (user_id);