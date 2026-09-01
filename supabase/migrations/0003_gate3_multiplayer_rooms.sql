-- Gate 3 multiplayer rooms.
-- Browser roles continue to receive only player-safe route responses and the
-- tiny membership-scoped revision signal.

alter table public.games
  alter column engine_state drop not null,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

alter table public.games
  add constraint games_active_state_is_present
  check (status = 'waiting' or engine_state is not null) not valid;

create unique index if not exists game_players_one_human_seat
  on public.game_players (game_id, user_id)
  where user_id is not null;

create table if not exists public.game_operations (
  game_id uuid not null references public.games(id) on delete cascade,
  operation_key text not null,
  operation_kind text not null
    check (operation_kind in ('start', 'action', 'advance', 'restart')),
  actor_user_id uuid references auth.users(id) on delete set null,
  request_hash text not null,
  expected_revision bigint not null,
  status text not null default 'pending'
    check (status in ('pending', 'committed')),
  result_revision bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (game_id, operation_key),
  check (
    (status = 'pending' and result_revision is null)
    or (status = 'committed' and result_revision is not null)
  )
);

revoke all on public.game_operations from anon, authenticated;
alter table public.game_operations enable row level security;

grant select, insert, update, delete on public.game_players to service_role;
grant delete on public.games to service_role;
grant select, insert, update on public.game_revisions to service_role;
grant select, insert, update, delete on public.game_operations to service_role;

create or replace function public.pocket_room_payload(target_game_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'game_id', g.id,
    'room_code', g.room_code,
    'status', g.status,
    'engine_state', g.engine_state,
    'version', g.version,
    'owner_user_id', g.owner_user_id,
    'players', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', gp.id,
            'user_id', gp.user_id,
            'engine_player_id', gp.engine_player_id,
            'seat', gp.seat,
            'display_name', gp.display_name,
            'is_bot', gp.is_bot
          ) order by gp.seat
        )
        from public.game_players gp
        where gp.game_id = g.id
      ),
      '[]'::jsonb
    )
  )
  from public.games g
  where g.id = target_game_id;
$$;

revoke all on function public.pocket_room_payload(uuid) from public;
grant execute on function public.pocket_room_payload(uuid) to service_role;

create or replace function public.pocket_load_room(
  p_room_code text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.games%rowtype;
begin
  select * into target
  from public.games
  where room_code = upper(p_room_code);

  if not found then
    return jsonb_build_object('outcome', 'ROOM_NOT_FOUND');
  end if;

  if not exists (
    select 1 from public.game_players
    where game_id = target.id and user_id = p_user_id and not is_bot
  ) then
    return jsonb_build_object('outcome', 'NOT_ROOM_MEMBER');
  end if;

  return jsonb_build_object(
    'outcome', 'OK',
    'room', public.pocket_room_payload(target.id)
  );
end;
$$;

create or replace function public.pocket_create_room(
  p_game_id uuid,
  p_room_code text,
  p_owner_user_id uuid,
  p_owner_player_row_id uuid,
  p_owner_engine_player_id text,
  p_owner_display_name text,
  p_bot_row_ids uuid[],
  p_bot_engine_player_ids text[],
  p_bot_display_names text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if cardinality(p_bot_row_ids) <> 3
    or cardinality(p_bot_engine_player_ids) <> 3
    or cardinality(p_bot_display_names) <> 3 then
    raise exception 'Pocket room requires three bot placeholders';
  end if;

  insert into public.games (
    id, room_code, status, engine_state, version, owner_user_id
  ) values (
    p_game_id, upper(p_room_code), 'waiting', null, 1, p_owner_user_id
  );

  insert into public.game_players (
    id, game_id, user_id, engine_player_id, seat, display_name, is_bot
  ) values
    (
      p_owner_player_row_id, p_game_id, p_owner_user_id,
      p_owner_engine_player_id, 0, p_owner_display_name, false
    ),
    (
      p_bot_row_ids[1], p_game_id, null,
      p_bot_engine_player_ids[1], 1, p_bot_display_names[1], true
    ),
    (
      p_bot_row_ids[2], p_game_id, null,
      p_bot_engine_player_ids[2], 2, p_bot_display_names[2], true
    ),
    (
      p_bot_row_ids[3], p_game_id, null,
      p_bot_engine_player_ids[3], 3, p_bot_display_names[3], true
    );

  insert into public.game_revisions (game_id, version, updated_at)
  values (p_game_id, 1, now());

  return jsonb_build_object(
    'outcome', 'OK',
    'room', public.pocket_room_payload(p_game_id)
  );
end;
$$;

create or replace function public.pocket_join_room(
  p_room_code text,
  p_user_id uuid,
  p_engine_player_id text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.games%rowtype;
begin
  select * into target
  from public.games
  where room_code = upper(p_room_code)
  for update;

  if not found then
    return jsonb_build_object('outcome', 'ROOM_NOT_FOUND');
  end if;

  if exists (
    select 1 from public.game_players
    where game_id = target.id and user_id = p_user_id and not is_bot
  ) then
    return jsonb_build_object(
      'outcome', 'OK',
      'room', public.pocket_room_payload(target.id)
    );
  end if;

  if target.status <> 'waiting' then
    return jsonb_build_object('outcome', 'ROOM_ALREADY_STARTED');
  end if;

  if target.mutation_id is not null then
    return jsonb_build_object('outcome', 'ACTION_IN_PROGRESS');
  end if;

  if not exists (
    select 1 from public.game_players
    where game_id = target.id and seat = 2 and is_bot
  ) then
    return jsonb_build_object('outcome', 'ROOM_FULL');
  end if;

  update public.game_players
  set user_id = p_user_id,
      engine_player_id = p_engine_player_id,
      display_name = p_display_name,
      is_bot = false
  where game_id = target.id and seat = 2 and is_bot;

  update public.games
  set version = version + 1, updated_at = now()
  where id = target.id
  returning * into target;

  insert into public.game_revisions (game_id, version, updated_at)
  values (target.id, target.version, now())
  on conflict (game_id) do update
    set version = excluded.version, updated_at = excluded.updated_at;

  return jsonb_build_object(
    'outcome', 'OK',
    'room', public.pocket_room_payload(target.id)
  );
end;
$$;

create or replace function public.pocket_leave_room(
  p_room_code text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.games%rowtype;
begin
  select * into target
  from public.games
  where room_code = upper(p_room_code)
  for update;

  if not found then
    return jsonb_build_object('outcome', 'ROOM_NOT_FOUND');
  end if;
  if target.status <> 'waiting' then
    return jsonb_build_object('outcome', 'ROOM_NOT_WAITING');
  end if;
  if target.owner_user_id = p_user_id then
    return jsonb_build_object('outcome', 'NOT_ROOM_OWNER');
  end if;
  if not exists (
    select 1 from public.game_players
    where game_id = target.id and seat = 2 and user_id = p_user_id and not is_bot
  ) then
    return jsonb_build_object('outcome', 'NOT_ROOM_MEMBER');
  end if;

  update public.game_players
  set user_id = null,
      engine_player_id = 'bot-seat-2-' || target.id::text,
      display_name = 'June',
      is_bot = true
  where game_id = target.id and seat = 2;

  update public.games
  set version = version + 1, updated_at = now()
  where id = target.id
  returning * into target;

  insert into public.game_revisions (game_id, version, updated_at)
  values (target.id, target.version, now())
  on conflict (game_id) do update
    set version = excluded.version, updated_at = excluded.updated_at;

  return jsonb_build_object(
    'outcome', 'OK',
    'room', public.pocket_room_payload(target.id)
  );
end;
$$;

create or replace function public.pocket_claim_room_operation(
  p_room_code text,
  p_user_id uuid,
  p_expected_revision bigint,
  p_operation_key text,
  p_operation_kind text,
  p_request_hash text,
  p_claim_id uuid,
  p_claim_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.games%rowtype;
  prior public.game_operations%rowtype;
begin
  select * into target
  from public.games
  where room_code = upper(p_room_code)
  for update;

  if not found then
    return jsonb_build_object('outcome', 'ROOM_NOT_FOUND');
  end if;
  if not exists (
    select 1 from public.game_players
    where game_id = target.id and user_id = p_user_id and not is_bot
  ) then
    return jsonb_build_object('outcome', 'NOT_ROOM_MEMBER');
  end if;

  select * into prior
  from public.game_operations
  where game_id = target.id and operation_key = p_operation_key;

  if found then
    if prior.actor_user_id is distinct from p_user_id
      or prior.operation_kind <> p_operation_kind
      or prior.request_hash <> p_request_hash
      or prior.expected_revision <> p_expected_revision then
      return jsonb_build_object('outcome', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    if prior.status = 'committed' then
      return jsonb_build_object(
        'outcome', 'REPLAYED',
        'result_revision', prior.result_revision,
        'room', public.pocket_room_payload(target.id)
      );
    end if;
  end if;

  if target.version <> p_expected_revision then
    return jsonb_build_object('outcome', 'STALE_STATE');
  end if;

  if target.mutation_id is not null
    and target.mutation_expires_at > now() then
    return jsonb_build_object('outcome', 'ACTION_IN_PROGRESS');
  end if;

  insert into public.game_operations (
    game_id, operation_key, operation_kind, actor_user_id,
    request_hash, expected_revision, status, result_revision, updated_at
  ) values (
    target.id, p_operation_key, p_operation_kind, p_user_id,
    p_request_hash, p_expected_revision, 'pending', null, now()
  )
  on conflict (game_id, operation_key) do update
    set status = 'pending', result_revision = null, updated_at = now();

  update public.games
  set mutation_id = p_claim_id,
      mutation_expires_at = p_claim_expires_at
  where id = target.id;

  return jsonb_build_object(
    'outcome', 'CLAIMED',
    'room', public.pocket_room_payload(target.id)
  );
end;
$$;

create or replace function public.pocket_commit_room_operation(
  p_game_id uuid,
  p_expected_revision bigint,
  p_operation_key text,
  p_claim_id uuid,
  p_engine_state jsonb,
  p_status text,
  p_result_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.games%rowtype;
begin
  select * into target
  from public.games
  where id = p_game_id
  for update;

  if not found
    or target.version <> p_expected_revision
    or target.mutation_id is distinct from p_claim_id then
    return jsonb_build_object('outcome', 'COMMIT_FAILED');
  end if;

  update public.games
  set engine_state = p_engine_state,
      status = p_status,
      version = p_result_revision,
      mutation_id = null,
      mutation_expires_at = null,
      updated_at = now()
  where id = target.id;

  update public.game_operations
  set status = 'committed',
      result_revision = p_result_revision,
      updated_at = now()
  where game_id = target.id
    and operation_key = p_operation_key
    and status = 'pending';

  if not found then
    raise exception 'Pocket operation record is missing during commit';
  end if;

  insert into public.game_revisions (game_id, version, updated_at)
  values (target.id, p_result_revision, now())
  on conflict (game_id) do update
    set version = excluded.version, updated_at = excluded.updated_at;

  return jsonb_build_object(
    'outcome', 'OK',
    'room', public.pocket_room_payload(target.id)
  );
end;
$$;

create or replace function public.pocket_release_room_operation(
  p_game_id uuid,
  p_expected_revision bigint,
  p_operation_key text,
  p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.games
  set mutation_id = null, mutation_expires_at = null
  where id = p_game_id
    and version = p_expected_revision
    and mutation_id = p_claim_id;

  if not found then
    return false;
  end if;

  delete from public.game_operations
  where game_id = p_game_id
    and operation_key = p_operation_key
    and status = 'pending';
  return true;
end;
$$;

revoke all on function public.pocket_load_room(text, uuid) from public;
revoke all on function public.pocket_create_room(uuid, text, uuid, uuid, text, text, uuid[], text[], text[]) from public;
revoke all on function public.pocket_join_room(text, uuid, text, text) from public;
revoke all on function public.pocket_leave_room(text, uuid) from public;
revoke all on function public.pocket_claim_room_operation(text, uuid, bigint, text, text, text, uuid, timestamptz) from public;
revoke all on function public.pocket_commit_room_operation(uuid, bigint, text, uuid, jsonb, text, bigint) from public;
revoke all on function public.pocket_release_room_operation(uuid, bigint, text, uuid) from public;

grant execute on function public.pocket_load_room(text, uuid) to service_role;
grant execute on function public.pocket_create_room(uuid, text, uuid, uuid, text, text, uuid[], text[], text[]) to service_role;
grant execute on function public.pocket_join_room(text, uuid, text, text) to service_role;
grant execute on function public.pocket_leave_room(text, uuid) to service_role;
grant execute on function public.pocket_claim_room_operation(text, uuid, bigint, text, text, text, uuid, timestamptz) to service_role;
grant execute on function public.pocket_commit_room_operation(uuid, bigint, text, uuid, jsonb, text, bigint) to service_role;
grant execute on function public.pocket_release_room_operation(uuid, bigint, text, uuid) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_revisions'
  ) then
    alter publication supabase_realtime add table public.game_revisions;
  end if;
end;
$$;
