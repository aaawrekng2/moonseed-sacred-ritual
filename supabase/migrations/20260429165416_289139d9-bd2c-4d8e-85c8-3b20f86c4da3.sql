-- 1. Deduplicate existing weaves, keeping the earliest row per (user, pattern set).
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, (
        SELECT string_agg(p::text, '|' ORDER BY p::text)
        FROM unnest(pattern_ids) AS t(p)
      )
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.weaves
)
DELETE FROM public.weaves w
USING ranked r
WHERE w.id = r.id AND r.rn > 1;

-- 2. Canonical key helper.
CREATE OR REPLACE FUNCTION public.weave_pattern_key(_pattern_ids uuid[])
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (SELECT string_agg(p::text, '|' ORDER BY p::text) FROM unnest(_pattern_ids) AS t(p)),
    ''
  );
$$;

-- 3. Generated column + unique index per user.
ALTER TABLE public.weaves
  ADD COLUMN IF NOT EXISTS pattern_key text
  GENERATED ALWAYS AS (public.weave_pattern_key(pattern_ids)) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS weaves_user_pattern_key_unique
  ON public.weaves (user_id, pattern_key);

-- 4. Telemetry column.
ALTER TABLE public.detect_weaves_runs
  ADD COLUMN IF NOT EXISTS weaves_existing integer NOT NULL DEFAULT 0;