-- Q16 Fix 3: strip the legacy "{spread} — Moonseed reading" prefix
-- from existing readings whose interpretation body still contains it.
UPDATE public.readings
SET interpretation = regexp_replace(
  interpretation,
  '^[A-Za-z]+(\s+[A-Za-z]+)?\s+—\s+Moonseed reading\s*\n+',
  '',
  'i'
)
WHERE interpretation IS NOT NULL
  AND interpretation ~* '^[A-Za-z]+(\s+[A-Za-z]+)?\s+—\s+Moonseed reading';
