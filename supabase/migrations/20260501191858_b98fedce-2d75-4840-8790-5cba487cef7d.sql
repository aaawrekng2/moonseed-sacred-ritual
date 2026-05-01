-- CT — One-time backfill: sync tags from readings.tags into user_tags
-- for theresetgirlmail@gmail.com. The CS importer wrote tags only to
-- the readings array and skipped the normalized user_tags table, so
-- her imported tags don't appear in the Filters drawer.
-- Safe to re-run: only inserts names not already present.

WITH target_user AS (
  SELECT id AS user_id
  FROM auth.users
  WHERE email = 'theresetgirlmail@gmail.com'
  LIMIT 1
),
distinct_tags AS (
  SELECT DISTINCT
    target_user.user_id,
    TRIM(tag) AS tag_name
  FROM target_user
  JOIN public.readings r ON r.user_id = target_user.user_id
  CROSS JOIN LATERAL UNNEST(r.tags) AS tag
  WHERE TRIM(tag) <> ''
),
existing_tags AS (
  SELECT user_id, LOWER(name) AS lowered_name
  FROM public.user_tags
  WHERE user_id = (SELECT user_id FROM target_user)
),
tags_to_insert AS (
  SELECT
    dt.user_id,
    dt.tag_name AS name,
    1 AS usage_count
  FROM distinct_tags dt
  LEFT JOIN existing_tags et
    ON et.user_id = dt.user_id
   AND et.lowered_name = LOWER(dt.tag_name)
  WHERE et.lowered_name IS NULL
)
INSERT INTO public.user_tags (user_id, name, usage_count)
SELECT user_id, name, usage_count
FROM tags_to_insert;
