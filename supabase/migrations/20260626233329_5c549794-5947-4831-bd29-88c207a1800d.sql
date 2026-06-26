create table if not exists public.reading_revisits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reading_id uuid not null references public.readings(id) on delete cascade,
  resurface_on date not null,
  prompt text,
  status text not null default 'pending',
  reflection text,
  reflected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.reading_revisits to authenticated;
grant all on public.reading_revisits to service_role;

create index if not exists reading_revisits_user_due_idx
  on public.reading_revisits (user_id, resurface_on)
  where status = 'pending';

create index if not exists reading_revisits_reading_id_idx
  on public.reading_revisits (reading_id);

create unique index if not exists reading_revisits_one_pending_per_reading
  on public.reading_revisits (reading_id)
  where status = 'pending';

alter table public.reading_revisits enable row level security;

drop policy if exists "Users can manage own reading_revisits" on public.reading_revisits;
create policy "Users can manage own reading_revisits"
  on public.reading_revisits for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);