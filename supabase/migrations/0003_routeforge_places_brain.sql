-- The RouteForge "brain": every destination researched once is stored
-- forever and served instantly to everyone. Public read (it's a public
-- library of storybook pages); insert-only writes with size/shape caps;
-- rows are immutable (no update/delete policies).
--
-- Applied to project lamdouidiiuqtplqhsdz on 2026-07-14, then seeded with
-- six destination storybooks (Lake Tahoe, Yellowstone, Grand Canyon,
-- Yosemite, Badlands, Glacier).
create table if not exists public.routeforge_places (
  key text primary key,
  name text not null,
  area text not null default '',
  data jsonb not null,
  created_at timestamptz not null default now(),
  constraint routeforge_places_key_shape check (
    key = lower(key) and char_length(key) between 2 and 240
  ),
  constraint routeforge_places_name_len check (char_length(name) between 1 and 160),
  constraint routeforge_places_area_len check (char_length(area) <= 160)
);

create index if not exists routeforge_places_created_at_idx
  on public.routeforge_places (created_at desc);

alter table public.routeforge_places enable row level security;

create policy anyone_can_read_places on public.routeforge_places
  for select to anon, authenticated using (true);

create policy anyone_can_teach_places on public.routeforge_places
  for insert to anon, authenticated
  with check (pg_column_size(data) between 2 and 200000);
