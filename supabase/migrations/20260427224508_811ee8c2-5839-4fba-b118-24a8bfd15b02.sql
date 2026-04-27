-- Default tag seeding for new accounts.
-- Inserts a curated baseline tag set whenever a new auth.users row is created.
-- Existing users are also backfilled in a single one-time pass.

create or replace function public.seed_default_user_tags(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  default_tags text[] := array[
    'Love',
    'Career',
    'Guidance',
    'Shadow Work',
    'Dream',
    'Energy',
    'Relationships',
    'Clarity',
    'Fear',
    'Gratitude'
  ];
  t text;
begin
  foreach t in array default_tags loop
    insert into public.user_tags (user_id, name, usage_count)
    values (_user_id, t, 0)
    on conflict (user_id, name) do nothing;
  end loop;
end;
$$;

-- Trigger fires on every new auth user (including anonymous → upgrade
-- creates a fresh row with email/password too, but auth.users id stays
-- the same, so the on-conflict guard prevents duplicate tags).
create or replace function public.handle_new_user_default_tags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_user_tags(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_seed_tags on auth.users;
create trigger on_auth_user_created_seed_tags
  after insert on auth.users
  for each row execute function public.handle_new_user_default_tags();

-- Backfill: seed the defaults for every existing user that has no tags yet.
do $$
declare
  u record;
begin
  for u in
    select id from auth.users
    where not exists (select 1 from public.user_tags ut where ut.user_id = auth.users.id)
  loop
    perform public.seed_default_user_tags(u.id);
  end loop;
end $$;
