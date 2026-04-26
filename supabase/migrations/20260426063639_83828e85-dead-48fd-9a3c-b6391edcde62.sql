-- Phase 5: Guides system

-- B1: extend user_preferences with active guide selection
alter table public.user_preferences
  add column if not exists active_guide_id text default 'moon-oracle',
  add column if not exists guide_lens text default 'deeper-threads',
  add column if not exists guide_facets text[] default '{}';

-- B1: custom guides table
create table if not exists public.custom_guides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  base_guide_id text not null,
  voice_overrides jsonb default '{}'::jsonb,
  facets text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.custom_guides enable row level security;

drop policy if exists "Users can manage own guides" on public.custom_guides;
create policy "Users can manage own guides"
  on public.custom_guides for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- updated_at trigger reusing the existing helper if present, else inline
create or replace function public.touch_custom_guides_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_custom_guides_updated_at on public.custom_guides;
create trigger trg_custom_guides_updated_at
before update on public.custom_guides
for each row execute function public.touch_custom_guides_updated_at();

create index if not exists idx_custom_guides_user_id
  on public.custom_guides(user_id);
