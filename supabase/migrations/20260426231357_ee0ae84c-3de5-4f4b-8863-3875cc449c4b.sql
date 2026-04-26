-- Phase 6 Journal: extend readings + new tables + storage bucket

alter table public.readings
  add column if not exists guide_id text,
  add column if not exists lens_id text,
  add column if not exists moon_phase text,
  add column if not exists note text,
  add column if not exists is_favorite boolean not null default false,
  add column if not exists tags text[] not null default '{}';

-- Allow users to UPDATE and DELETE their own readings (previously insert/select only)
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='readings' and policyname='Users can update own readings') then
    create policy "Users can update own readings"
      on public.readings for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='readings' and policyname='Users can delete own readings') then
    create policy "Users can delete own readings"
      on public.readings for delete
      to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

create index if not exists readings_user_created_idx on public.readings (user_id, created_at desc);
create index if not exists readings_user_fav_idx on public.readings (user_id, is_favorite) where is_favorite = true;

-- reading_photos
create table if not exists public.reading_photos (
  id uuid primary key default gen_random_uuid(),
  reading_id uuid not null references public.readings(id) on delete cascade,
  user_id uuid not null,
  storage_path text not null,
  caption text,
  created_at timestamptz not null default now()
);

alter table public.reading_photos enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reading_photos' and policyname='Users select own photos') then
    create policy "Users select own photos" on public.reading_photos
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reading_photos' and policyname='Users insert own photos') then
    create policy "Users insert own photos" on public.reading_photos
      for insert to authenticated with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reading_photos' and policyname='Users update own photos') then
    create policy "Users update own photos" on public.reading_photos
      for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='reading_photos' and policyname='Users delete own photos') then
    create policy "Users delete own photos" on public.reading_photos
      for delete to authenticated using (auth.uid() = user_id);
  end if;
end $$;

create index if not exists reading_photos_reading_idx on public.reading_photos (reading_id);
create index if not exists reading_photos_user_idx on public.reading_photos (user_id);

-- user_tags
create table if not exists public.user_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  usage_count integer not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.user_tags enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_tags' and policyname='Users select own tags') then
    create policy "Users select own tags" on public.user_tags
      for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_tags' and policyname='Users insert own tags') then
    create policy "Users insert own tags" on public.user_tags
      for insert to authenticated with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_tags' and policyname='Users update own tags') then
    create policy "Users update own tags" on public.user_tags
      for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_tags' and policyname='Users delete own tags') then
    create policy "Users delete own tags" on public.user_tags
      for delete to authenticated using (auth.uid() = user_id);
  end if;
end $$;

create index if not exists user_tags_user_count_idx on public.user_tags (user_id, usage_count desc);

-- Storage bucket for reading photos (private; users access only their own folder)
insert into storage.buckets (id, name, public)
values ('reading-photos', 'reading-photos', false)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Users read own reading photos') then
    create policy "Users read own reading photos" on storage.objects
      for select to authenticated
      using (bucket_id = 'reading-photos' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Users upload own reading photos') then
    create policy "Users upload own reading photos" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'reading-photos' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Users update own reading photos') then
    create policy "Users update own reading photos" on storage.objects
      for update to authenticated
      using (bucket_id = 'reading-photos' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Users delete own reading photos') then
    create policy "Users delete own reading photos" on storage.objects
      for delete to authenticated
      using (bucket_id = 'reading-photos' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
end $$;