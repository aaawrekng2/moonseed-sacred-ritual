ALTER TABLE public.symbolic_threads
    ADD COLUMN IF NOT EXISTS evidence_prose text NULL,
    ADD COLUMN IF NOT EXISTS evidence_prose_version int DEFAULT 1,
    ADD COLUMN IF NOT EXISTS evidence_prose_layers jsonb DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS evidence_prose_generated_at timestamptz NULL,
    ADD COLUMN IF NOT EXISTS evidence_prose_reading_count int DEFAULT 0;