-- Gate 2 optimistic-concurrency claim.
-- The committed engine_state and version still change together in one row
-- update. A short claim prevents a losing concurrent request from running the
-- human transition or any bots before that atomic commit.

alter table public.games
  add column mutation_id uuid,
  add column mutation_expires_at timestamptz;

alter table public.games
  add constraint games_mutation_lease_is_complete
  check (
    (mutation_id is null and mutation_expires_at is null)
    or
    (mutation_id is not null and mutation_expires_at is not null)
  );

comment on column public.games.mutation_id is
  'Server-only short-lived claim for one optimistic authoritative mutation.';

comment on column public.games.mutation_expires_at is
  'Claim expiry so a failed server request cannot permanently lock a demo.';

-- RLS bypass does not replace PostgreSQL table privileges. The browser roles
-- remain revoked; only the trusted server client can persist the envelope.
grant select, insert, update on public.games to service_role;
