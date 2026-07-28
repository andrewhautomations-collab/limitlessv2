-- LIMITLESS · Supabase one-time setup
-- Run this whole file in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
--
-- Model: both phones sign into ONE shared household account (same email magic link).
-- The account owns a single row holding the shared couple doc:
--   { profiles: { "Andrew": {name,color,theme,data,updatedAt}, "Joselyn": {...} }, updatedAt }
-- Each phone only ever writes its OWN profile key (via the merge_profile function below,
-- which merges atomically server-side), so partners can never overwrite each other.

create table if not exists public.states (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.states enable row level security;

drop policy if exists "Users manage their own state" on public.states;
create policy "Users manage their own state" on public.states
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Atomic per-profile merge: writes only data.profiles[p_name], preserving every other
-- profile even if both phones push at the same moment.
create or replace function public.merge_profile(p_name text, p_profile jsonb)
returns void
language sql
security invoker
as $$
  insert into public.states (user_id, data, updated_at)
  values (
    auth.uid(),
    jsonb_build_object(
      'profiles', jsonb_build_object(p_name, p_profile),
      'updatedAt', (extract(epoch from now()) * 1000)::bigint
    ),
    now()
  )
  on conflict (user_id) do update set
    data = jsonb_set(
      jsonb_set(
        coalesce(states.data, '{}'::jsonb),
        '{profiles}',
        coalesce(states.data -> 'profiles', '{}'::jsonb) || jsonb_build_object(p_name, p_profile)
      ),
      '{updatedAt}',
      to_jsonb((extract(epoch from now()) * 1000)::bigint)
    ),
    updated_at = now();
$$;
