alter table public.user_preferences
  add column if not exists reading_font_size integer not null default 15;