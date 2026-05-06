alter table public.custom_decks
  add column if not exists deck_type text not null default 'tarot'
  check (deck_type in ('tarot', 'oracle'));

alter table public.custom_deck_cards
  add column if not exists card_name text,
  add column if not exists card_description text;