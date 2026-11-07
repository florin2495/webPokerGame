-- Poker (Texas Hold'em) multiplayer - Supabase schema
-- Every object is prefixed with poker_ because the Supabase project is shared by all hailatat.icu
-- mini-games. Keep the prefix on anything new: tables, constraints, indexes.
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It is idempotent; re-running drops nothing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- poker_rooms: one row per room. The whole running tournament (deck and hole cards included)
-- lives in `game` as jsonb and is only ever read by the server. `version` is an optimistic lock:
-- every write is "update ... where version = <read value>", so two actions at once cannot both apply.
-- ---------------------------------------------------------------------------
create table if not exists public.poker_rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null
                   constraint poker_rooms_code_key unique
                   constraint poker_rooms_code_check check (code ~ '^[A-Z2-9]{6}$'),
  name             text not null constraint poker_rooms_name_check check (char_length(name) between 1 and 40),
  password_hash    text,                                     -- scrypt hash, null = no password
  status           text not null default 'lobby'
                   constraint poker_rooms_status_check check (status in ('lobby', 'playing', 'finished')),
  round            integer not null default 1 constraint poker_rooms_round_check check (round >= 1),  -- tournament number in this room
  host_player_id   uuid,
  settings         jsonb not null default '{}'::jsonb,       -- buy-in, blinds, blind schedule, turn timer
  game             jsonb,                                    -- null in the lobby
  version          integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()        -- idle rooms are deleted lazily
);
create index if not exists poker_rooms_status_activity_idx on public.poker_rooms (status, last_activity_at);

-- ---------------------------------------------------------------------------
-- poker_players: members of a room, players (max 16) and observers (max 16).
-- Identity = random token kept by the browser, only its SHA-256 hash is stored.
-- ---------------------------------------------------------------------------
create table if not exists public.poker_players (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null constraint poker_players_room_id_fkey references public.poker_rooms (id) on delete cascade,
  nickname   text not null constraint poker_players_nickname_check check (char_length(nickname) between 1 and 20),
  token_hash text not null constraint poker_players_token_hash_key unique,
  is_host    boolean not null default false,
  role       text not null default 'player' constraint poker_players_role_check check (role in ('player', 'observer')),
  joined_at  timestamptz not null default now()
);
create unique index if not exists poker_players_room_nickname_uq on public.poker_players (room_id, lower(nickname));
create index if not exists poker_players_room_idx on public.poker_players (room_id);

do $$ begin
  alter table public.poker_rooms
    add constraint poker_rooms_host_fk foreign key (host_player_id) references public.poker_players (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Security: RLS on, NO policies -> anon / authenticated can read or write nothing.
-- Only the service role (the Next.js Route Handlers) touches these tables.
-- ---------------------------------------------------------------------------
alter table public.poker_rooms   enable row level security;
alter table public.poker_players enable row level security;

revoke all on public.poker_rooms, public.poker_players from anon, authenticated;

-- Let the Data API (PostgREST) see the new tables immediately.
notify pgrst, 'reload schema';

-- Check: should list the 2 poker_ tables, both with rowsecurity = true.
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename like 'poker\_%' order by 1;
