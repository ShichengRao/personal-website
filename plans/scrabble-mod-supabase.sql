-- Scrabble Mod online play: one table of games plus a private table of player
-- tokens. Run this in the SQL editor of a fresh Supabase project, then put the
-- project URL and the publishable (anon) key into window.SM_CONFIG in
-- layouts/scrabble-mod/list.html.
--
-- The page reconstructs every game from its seed and move list (core.js is
-- deterministic), so the server only stores those and enforces turn order and
-- identity. Word legality is checked by the clients, which share a word list.
-- The seed and each move's details are scrambled with a key derived from the
-- game id and base64'd by the page (core.pack), so they are not readable at a
-- glance; each move keeps its kind (play/swap/pass/resign) in the clear so
-- the server can still refuse moves after a resignation. A determined player
-- could still decode the record and work out the opponent's rack; this is a
-- game between friends, not a tournament.
--
-- Nothing reads or writes the tables directly: RLS is on with no policies, and
-- every access goes through the security-definer functions below, so a game
-- can only be read by someone who knows its id.

create table if not exists games (
  id         text primary key,
  seed       text not null,                  -- packed by the page
  moves      jsonb not null default '[]'::jsonb,
  p1_name    text,
  p2_name    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists game_keys (
  game_id text not null references games(id) on delete cascade,
  player  smallint not null check (player in (0, 1)),
  token   text not null,
  primary key (game_id, player)
);
create index if not exists game_keys_token on game_keys (game_id, token);

alter table games enable row level security;
alter table game_keys enable row level security;
drop policy if exists "read games" on games;
revoke all on games from anon, authenticated;
revoke all on game_keys from anon, authenticated;

-- Everything a client needs to rebuild a game. Null when there is no such id.
create or replace function get_game(p_code text)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object('id', id, 'seed', seed, 'moves', moves, 'p1_name', p1_name, 'p2_name', p2_name,
                            'full', exists (select 1 from game_keys k where k.game_id = g.id and k.player = 1))
  from games g where id = p_code;
$$;

create or replace function create_game(p_code text, p_seed text, p_name text, p_token text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if p_code is null or p_code !~ '^[a-z]+(-[a-z]+){2}$' or length(p_code) > 40 then
    raise exception 'bad game id';
  end if;
  if p_seed is null or length(p_seed) = 0 or length(p_seed) > 200 then raise exception 'bad seed'; end if;
  if p_name is null or length(trim(p_name)) = 0 or length(p_name) > 24 then
    raise exception 'name must be 1-24 characters';
  end if;
  if p_token is null or length(p_token) < 16 then raise exception 'bad token'; end if;
  if exists (select 1 from games where id = p_code) then raise exception 'that id is taken'; end if;
  insert into games (id, seed, p1_name) values (p_code, p_seed, trim(p_name));
  insert into game_keys (game_id, player, token) values (p_code, 0, p_token);
  return p_code;
end $$;

-- Returns the seat (0 or 1) this token holds, claiming seat 1 if it is free.
create or replace function join_game(p_code text, p_name text, p_token text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  existing smallint;
begin
  if p_token is null or length(p_token) < 16 then raise exception 'bad token'; end if;
  select player into existing from game_keys where game_id = p_code and token = p_token;
  if existing is not null then return existing; end if;
  if not exists (select 1 from games where id = p_code) then raise exception 'no such game'; end if;
  if exists (select 1 from game_keys where game_id = p_code and player = 1) then
    raise exception 'this game already has two players';
  end if;
  if p_name is null or length(trim(p_name)) = 0 or length(p_name) > 24 then
    raise exception 'name must be 1-24 characters';
  end if;
  insert into game_keys (game_id, player, token) values (p_code, 1, p_token);
  update games set p2_name = trim(p_name), updated_at = now() where id = p_code;
  return 1;
end $$;

-- Appends a move for the seat that owns p_token. The seat to move is derived
-- from the server's own move count; p_index is only a concurrency check.
create or replace function play_move(p_code text, p_token text, p_index integer, p_move jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  who smallint;
  cur jsonb;
  n integer;
  kind text;
begin
  if p_index is null or p_move is null or jsonb_typeof(p_move) <> 'object' then
    raise exception 'bad move';
  end if;
  kind := p_move->>'t';
  if kind is null or kind not in ('play', 'swap', 'pass', 'resign') then raise exception 'bad move'; end if;
  if p_move->>'d' is null or length(p_move->>'d') > 4000 then raise exception 'bad move'; end if;
  if length(p_move::text) > 4200 then raise exception 'move too large'; end if;
  select player into who from game_keys where game_id = p_code and token = p_token;
  if who is null then raise exception 'not a player in this game'; end if;
  if not exists (select 1 from game_keys where game_id = p_code and player = 1) then
    raise exception 'waiting for a second player';
  end if;
  select moves into cur from games where id = p_code for update;
  if cur is null then raise exception 'no such game'; end if;
  n := jsonb_array_length(cur);
  if n >= 400 then raise exception 'game too long'; end if;
  if exists (select 1 from jsonb_array_elements(cur) m where m->>'t' = 'resign') then
    raise exception 'the game is over';
  end if;
  if n <> p_index then raise exception 'out of date: the game has moved on'; end if;
  if n % 2 <> who then raise exception 'not your turn'; end if;
  update games set moves = cur || jsonb_build_array(p_move), updated_at = now() where id = p_code;
  return cur || jsonb_build_array(p_move);
end $$;

revoke all on function get_game(text) from public;
revoke all on function create_game(text, text, text, text) from public;
revoke all on function join_game(text, text, text) from public;
revoke all on function play_move(text, text, integer, jsonb) from public;
grant execute on function get_game(text) to anon, authenticated;
grant execute on function create_game(text, text, text, text) to anon, authenticated;
grant execute on function join_game(text, text, text) to anon, authenticated;
grant execute on function play_move(text, text, integer, jsonb) to anon, authenticated;

-- Optional housekeeping: drop games nobody has touched for three months.
-- delete from games where updated_at < now() - interval '90 days';
