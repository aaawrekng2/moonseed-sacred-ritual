DELETE FROM public.custom_deck_cards
WHERE deck_id NOT IN (SELECT id FROM public.custom_decks);