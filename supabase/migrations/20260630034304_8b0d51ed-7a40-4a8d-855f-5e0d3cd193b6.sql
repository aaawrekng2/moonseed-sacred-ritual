update public.admin_settings set value = '5'::jsonb, updated_at = now() where key = 'max_custom_decks';
insert into public.admin_settings (key, value, description)
  select 'max_custom_decks', '5'::jsonb, 'Maximum number of custom decks per user.'
  where not exists (select 1 from public.admin_settings where key = 'max_custom_decks');