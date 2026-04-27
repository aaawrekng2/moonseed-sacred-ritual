WITH pairs AS (
  SELECT json_row.id AS json_id
  FROM public.readings json_row
  JOIN public.readings text_row
    ON text_row.user_id = json_row.user_id
   AND text_row.spread_type = json_row.spread_type
   AND text_row.card_ids = json_row.card_ids
   AND text_row.id <> json_row.id
   AND text_row.created_at >= json_row.created_at
   AND text_row.created_at <= json_row.created_at + interval '10 seconds'
  WHERE json_row.interpretation LIKE '{%'
    AND text_row.interpretation NOT LIKE '{%'
)
DELETE FROM public.readings
WHERE id IN (SELECT json_id FROM pairs);