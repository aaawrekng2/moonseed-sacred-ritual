
ALTER TABLE public.readings ADD COLUMN IF NOT EXISTS import_batch_id UUID NULL;
CREATE INDEX IF NOT EXISTS idx_readings_import_batch_id ON public.readings(import_batch_id) WHERE import_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_format TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_batches_user ON public.import_batches(user_id, created_at DESC);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own import batches" ON public.import_batches;
CREATE POLICY "Users can read own import batches"
  ON public.import_batches FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own import batches" ON public.import_batches;
CREATE POLICY "Users can insert own import batches"
  ON public.import_batches FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own import batches" ON public.import_batches;
CREATE POLICY "Users can delete own import batches"
  ON public.import_batches FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
