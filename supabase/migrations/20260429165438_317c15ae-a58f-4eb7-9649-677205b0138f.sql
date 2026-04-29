CREATE OR REPLACE FUNCTION public.weave_pattern_key(_pattern_ids uuid[])
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT string_agg(p::text, '|' ORDER BY p::text) FROM unnest(_pattern_ids) AS t(p)),
    ''
  );
$$;