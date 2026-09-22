-- Scrabble Mod online play: one table of games plus a private table of player
-- tokens. Run this in the SQL editor of a fresh Supabase project, then put the
-- project URL and the publishable (anon) key into window.SM_CONFIG in
-- layouts/scrabble-mod/list.html.
--
-- The page reconstructs every game from its seed and move list (core.js is
-- deterministic), so the server only stores those and enforces turn order and
-- identity. Word legality is checked by the clients, which share a word list.
-- A determined player could read the seed and work out the opponent's rack;
-- this is a game between friends, not a tournament.

create table if not exists games (
  id         text primary key,
  seed       integer not null,
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

alter table games enable row level security;
alter table game_keys enable row level security;

-- Anyone with the link can read a game; nobody can read the keys or write
-- either table directly. All writes go through the functions below.
drop policy if exists "read games" on games;
create policy "read games" on games for select to anon, authenticated using (true);

create or replace function create_game(p_seed integer, p_name text, p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  code text;
  tries int := 0;
begin
  if p_name is null or length(trim(p_name)) = 0 or length(p_name) > 24 then
    raise exception 'name must be 1-24 characters';
  end if;
  if p_token is null or length(p_token) < 16 then
    raise exception 'bad token';
  end if;
  loop
    -- six letters, skipping the ones that read ambiguously
    code := '';
    for i in 1..6 loop
      code := code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1);
    end loop;
    exit when not exists (select 1 from games where id = code);
    tries := tries + 1;
    if tries > 20 then raise exception 'could not allocate a code'; end if;
  end loop;
  insert into games (id, seed, p1_name) values (code, p_seed, trim(p_name));
  insert into game_keys (game_id, player, token) values (code, 0, p_token);
  return code;
end $$;

create or replace function join_game(p_code text, p_name text, p_token text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  existing smallint;
begin
  if p_name is null or length(trim(p_name)) = 0 or length(p_name) > 24 then
    raise exception 'name must be 1-24 characters';
  end if;
  select player into existing from game_keys where game_id = p_code and token = p_token;
  if existing is not null then return existing; end if;
  if not exists (select 1 from games where id = p_code) then
    raise exception 'no such game';
  end if;
  if exists (select 1 from game_keys where game_id = p_code and player = 1) then
    raise exception 'this game already has two players';
  end if;
  insert into game_keys (game_id, player, token) values (p_code, 1, p_token);
  update games set p2_name = trim(p_name), updated_at = now() where id = p_code;
  return 1;
end $$;

create or replace function play_move(p_code text, p_token text, p_index integer, p_move jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  who smallint;
  cur jsonb;
  kind text;
begin
  select player into who from game_keys where game_id = p_code and token = p_token;
  if who is null then raise exception 'not a player in this game'; end if;
  if not exists (select 1 from game_keys where game_id = p_code and player = 1) then
    raise exception 'waiting for a second player';
  end if;
  select moves into cur from games where id = p_code for update;
  if cur is null then raise exception 'no such game'; end if;
  if jsonb_array_length(cur) <> p_index then raise exception 'out of date: the game has moved on'; end if;
  if p_index % 2 <> who then raise exception 'not your turn'; end if;
  kind := p_move->>'t';
  if kind not in ('play', 'swap', 'pass') then raise exception 'bad move'; end if;
  if jsonb_array_length(cur) > 400 then raise exception 'game too long'; end if;
  if length(p_move::text) > 2000 then raise exception 'move too large'; end if;
  update games set moves = cur || jsonb_build_array(p_move), updated_at = now() where id = p_code;
  return cur || jsonb_build_array(p_move);
end $$;

revoke all on function create_game(integer, text, text) from public;
revoke all on function join_game(text, text, text) from public;
revoke all on function play_move(text, text, integer, jsonb) from public;
grant execute on function create_game(integer, text, text) to anon, authenticated;
grant execute on function join_game(text, text, text) to anon, authenticated;
grant execute on function play_move(text, text, integer, jsonb) to anon, authenticated;

-- Optional housekeeping: drop games nobody has touched for three months.
-- delete from games where updated_at < now() - interval '90 days';
