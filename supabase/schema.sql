-- Tab Deck Supabase schema for v0.2.0-alpha.
-- Run this in the Supabase SQL Editor for your project.

create table if not exists public.tab_deck_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_space_id text,
  theme text not null default 'system',
  recently_deleted jsonb not null default '[]'::jsonb,
  tombstones jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tab_deck_user_settings
  add column if not exists theme text not null default 'system';

alter table public.tab_deck_user_settings
  add column if not exists recently_deleted jsonb not null default '[]'::jsonb;

alter table public.tab_deck_user_settings
  add column if not exists tombstones jsonb not null default '[]'::jsonb;

create table if not exists public.tab_deck_spaces (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.tab_deck_collections (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id text not null references public.tab_deck_spaces(id) on delete cascade,
  name text not null,
  notes text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.tab_deck_links (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id text not null references public.tab_deck_collections(id) on delete cascade,
  title text not null,
  url text not null,
  fav_icon_url text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.tab_deck_user_settings enable row level security;
alter table public.tab_deck_spaces enable row level security;
alter table public.tab_deck_collections enable row level security;
alter table public.tab_deck_links enable row level security;

drop policy if exists "tab deck users can manage own settings" on public.tab_deck_user_settings;
drop policy if exists "tab deck users can manage own spaces" on public.tab_deck_spaces;
drop policy if exists "tab deck users can manage own collections" on public.tab_deck_collections;
drop policy if exists "tab deck users can manage own links" on public.tab_deck_links;

create policy "tab deck users can manage own settings"
on public.tab_deck_user_settings
for all
to authenticated
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

create policy "tab deck users can manage own spaces"
on public.tab_deck_spaces
for all
to authenticated
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

create policy "tab deck users can manage own collections"
on public.tab_deck_collections
for all
to authenticated
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

create policy "tab deck users can manage own links"
on public.tab_deck_links
for all
to authenticated
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

create index if not exists tab_deck_spaces_user_order_idx
on public.tab_deck_spaces(user_id, sort_order)
where deleted_at is null;

create index if not exists tab_deck_collections_user_space_order_idx
on public.tab_deck_collections(user_id, space_id, sort_order)
where deleted_at is null;

create index if not exists tab_deck_links_user_collection_order_idx
on public.tab_deck_links(user_id, collection_id, sort_order)
where deleted_at is null;
