-- Shared trips: anyone can publish a trip under a fresh RF- code;
-- reads go through a code-lookup RPC only, so the table can never be
-- listed or scraped with the publishable key.
--
-- Applied to project lamdouidiiuqtplqhsdz on 2026-07-14.
create table if not exists public.routeforge_trips (
  code text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint routeforge_trips_code_format check (code ~ '^RF-[A-Z0-9]{4,8}$')
);

alter table public.routeforge_trips enable row level security;

-- Insert-only for anon; size-capped to keep abuse cheap. No select/update/
-- delete policies: codes are immutable and unlistable.
create policy anon_can_share on public.routeforge_trips
  for insert to anon
  with check (
    code ~ '^RF-[A-Z0-9]{4,8}$'
    and pg_column_size(data) between 2 and 100000
  );

-- Single-trip lookup by exact code (security definer bypasses RLS for the
-- one row requested; search_path pinned).
create or replace function public.routeforge_get_trip(share_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select data from public.routeforge_trips
  where code = upper(trim(share_code))
  limit 1;
$$;

revoke all on function public.routeforge_get_trip(text) from public;
grant execute on function public.routeforge_get_trip(text) to anon, authenticated;
