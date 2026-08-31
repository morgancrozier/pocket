-- Pocket starter schema.
-- The raw engine state is server-only. Clients receive player-safe projections
-- through authenticated Next.js route handlers.

create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  status text not null default 'waiting'
    check (status in ('waiting', 'active', 'complete')),
  engine_state jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Never grant raw game-state access to browser roles.
revoke all on public.games from anon, authenticated;
alter table public.games enable row level security;

create table if not exists public.game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  engine_player_id text not null,
  seat smallint not null check (seat between 0 and 8),
  display_name text not null,
  is_bot boolean not null default false,
  created_at timestamptz not null default now(),
  unique (game_id, seat),
  unique (game_id, engine_player_id)
);

-- Membership is checked server-side. Browser clients do not query this table.
revoke all on public.game_players from anon, authenticated;
alter table public.game_players enable row level security;

create table if not exists public.game_revisions (
  game_id uuid primary key references public.games(id) on delete cascade,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

grant select on public.game_revisions to authenticated;
alter table public.game_revisions enable row level security;

create or replace function public.is_game_member(target_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.game_players gp
    where gp.game_id = target_game_id
      and gp.user_id = auth.uid()
  );
$$;

revoke all on function public.is_game_member(uuid) from public;
grant execute on function public.is_game_member(uuid) to authenticated;

create policy "members can observe their game revision"
on public.game_revisions
for select
to authenticated
using (public.is_game_member(game_id));

-- Optional public hand/action log. Do not put hidden cards here.
create table if not exists public.hand_events (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  hand_number integer not null,
  sequence integer not null,
  street text not null,
  engine_player_id text,
  display_name text,
  action text not null,
  amount numeric,
  created_at timestamptz not null default now(),
  unique (game_id, hand_number, sequence)
);

revoke all on public.hand_events from anon, authenticated;
alter table public.hand_events enable row level security;

-- All writes occur through trusted server routes using the Supabase secret key.
-- The secret key must never be exposed through NEXT_PUBLIC_* variables.
