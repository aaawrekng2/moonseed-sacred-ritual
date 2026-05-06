alter table public.custom_deck_cards
  add column if not exists radius_overridden boolean not null default false;