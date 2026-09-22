-- Scrabble Mod online play: one table of games plus a private table of seats.
-- Run this in the SQL editor of the Supabase project (safe to rerun: it only
-- adds what is missing and replaces the functions), then keep the project URL
-- and the publishable (anon) key in window.SM_CONFIG in
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
-- A seat is held by a token (kept in the browser and in the private link) and,
-- when the player is signed in, by their account too, so the same games open
-- from any device. Signing in is optional: link play still works.
--
-- Nothing reads or writes the tables directly: RLS is on with no policies, and
-- every access goes through the security-definer functions below, so a game
-- can only be read by someone who knows its id or holds one of its seats.

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
  user_id uuid references auth.users(id) on delete set null,
  primary key (game_id, player)
);
alter table game_keys add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists game_keys_token on game_keys (game_id, token);
create index if not exists game_keys_user on game_keys (user_id);
alter table games add column if not exists next_game text;   -- the rematch, once one side starts it

-- One row per account: a display name and a friend code.
create table if not exists profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  handle       text unique not null,
  name         text not null,
  public_games boolean not null default false,   -- list games in progress on the profile for anyone to watch
  created_at   timestamptz not null default now()
);
alter table profiles add column if not exists public_games boolean not null default false;
-- Friendships are mutual: adding by code inserts both directions.
create table if not exists friends (
  user_id    uuid not null references auth.users(id) on delete cascade,
  friend_id  uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);
-- The outcome of a finished online game, reported by the first client to see
-- it end (the record is deterministic, so both sides compute the same thing).
-- stats: {"p0": {plays, points, bingos, brilliancies, best_word, best_score}, "p1": {...}}
create table if not exists game_results (
  game_id     text primary key references games(id) on delete cascade,
  p0_user     uuid,
  p1_user     uuid,
  p0_name     text,
  p1_name     text,
  p0_score    integer not null,
  p1_score    integer not null,
  winner      smallint not null,           -- 0, 1, or -1 for a tie
  end_reason  text,
  moves       integer not null,
  stats       jsonb not null,
  finished_at timestamptz not null default now()
);
create index if not exists game_results_p0 on game_results (p0_user);
create index if not exists game_results_p1 on game_results (p1_user);

alter table games enable row level security;
alter table game_keys enable row level security;
alter table profiles enable row level security;
alter table friends enable row level security;
alter table game_results enable row level security;
drop policy if exists "read games" on games;
revoke all on games from anon, authenticated;
revoke all on game_keys from anon, authenticated;
revoke all on profiles from anon, authenticated;
revoke all on friends from anon, authenticated;
revoke all on game_results from anon, authenticated;

-- The seat the caller holds in a game: by account when signed in, else by token.
create or replace function seat_of(p_code text, p_token text)
returns smallint language sql security definer set search_path = public stable as $$
  select player from game_keys
  where game_id = p_code
    and ((auth.uid() is not null and user_id = auth.uid()) or (p_token is not null and token = p_token))
  order by (user_id is not null and user_id = auth.uid()) desc
  limit 1;
$$;

-- The seat the caller holds, or null. Lets a page check a private link
-- before deciding whether the visitor is a player or a spectator.
create or replace function my_seat(p_code text, p_token text)
returns smallint language sql security definer set search_path = public stable as $$
  select seat_of(p_code, p_token);
$$;

-- A game is over when someone resigned, when the last four moves were all
-- passes, or when the bag ran out (plays carry their tile count in the
-- clear: 100 tiles, 14 dealt, so the bag is empty once 86 have been played)
-- and both players took their last turn after that. Null when it cannot be
-- told from the record (old games whose plays carry no count).
create or replace function game_over(p_moves jsonb)
returns boolean language plpgsql immutable as $$
declare
  n int := jsonb_array_length(p_moves);
  played int := 0;
  emptied int := null;
  i int;
  m jsonb;
begin
  if exists (select 1 from jsonb_array_elements(p_moves) x where x->>'t' = 'resign') then return true; end if;
  if n >= 4 and (select bool_and(x->>'t' = 'pass') from jsonb_array_elements(p_moves) with ordinality o(x, k) where k > n - 4) then return true; end if;
  for i in 0 .. n - 1 loop
    m := p_moves -> i;
    if m->>'t' = 'play' then
      if m->>'n' is null then return null; end if;
      played := played + (m->>'n')::int;
      if emptied is null and played >= 86 then emptied := i; end if;
    end if;
  end loop;
  if emptied is not null then return n >= emptied + 3; end if;
  return false;
end $$;

-- Everything a client needs to rebuild a game. Null when there is no such id.
create or replace function get_game(p_code text)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object('id', id, 'seed', seed, 'moves', moves, 'p1_name', p1_name, 'p2_name', p2_name, 'next_game', next_game,
                            'full', exists (select 1 from game_keys k where k.game_id = g.id and k.player = 1),
                            'seat', (select player from game_keys k where k.game_id = g.id and auth.uid() is not null and k.user_id = auth.uid() limit 1),
                            'handles', (select jsonb_object_agg(k.player, p.handle) from game_keys k join profiles p on p.user_id = k.user_id where k.game_id = g.id))
  from games g where id = p_code;
$$;

-- The signed-in caller's games, newest first. Empty when not signed in.
create or replace function my_games()
returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'seat', k.player, 'p1_name', g.p1_name, 'p2_name', g.p2_name,
                                               'moves', jsonb_array_length(g.moves),
                                               'resigned', exists (select 1 from jsonb_array_elements(g.moves) m where m->>'t' = 'resign'),
                                               'finished', exists (select 1 from game_results r where r.game_id = g.id) or coalesce(game_over(g.moves), false),
                                               'updated_at', g.updated_at) order by g.updated_at desc), '[]'::jsonb)
  from game_keys k join games g on g.id = k.game_id
  where auth.uid() is not null and k.user_id = auth.uid();
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
  insert into game_keys (game_id, player, token, user_id) values (p_code, 0, p_token, auth.uid());
  return p_code;
end $$;

-- Returns {player, token}: the seat (0 or 1) the caller holds and the token
-- that seat really carries (an account may hold a seat created with a token
-- this browser never saw), claiming seat 1 if it is free. A signed-in caller
-- opening a seat they held by link gets it attached to their account, so it
-- follows them to other devices. A finished game takes no new players.
drop function if exists join_game(text, text, text);   -- its return type changed from integer to jsonb
create or replace function join_game(p_code text, p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  existing smallint;
  g games%rowtype;
begin
  if p_token is null or length(p_token) < 16 then raise exception 'bad token'; end if;
  existing := seat_of(p_code, p_token);
  if existing is not null then
    if auth.uid() is not null then
      update game_keys set user_id = auth.uid() where game_id = p_code and player = existing and user_id is null;
    end if;
    return (select jsonb_build_object('player', player, 'token', token) from game_keys where game_id = p_code and player = existing);
  end if;
  select * into g from games where id = p_code;
  if g.id is null then raise exception 'no such game'; end if;
  if exists (select 1 from game_keys where game_id = p_code and player = 1) then
    raise exception 'this game already has two players';
  end if;
  if coalesce(game_over(g.moves), false) or exists (select 1 from game_results r where r.game_id = p_code) then
    raise exception 'this game is over';
  end if;
  if p_name is null or length(trim(p_name)) = 0 or length(p_name) > 24 then
    raise exception 'name must be 1-24 characters';
  end if;
  insert into game_keys (game_id, player, token, user_id) values (p_code, 1, p_token, auth.uid());
  update games set p2_name = trim(p_name), updated_at = now() where id = p_code;
  return jsonb_build_object('player', 1, 'token', p_token);
end $$;

-- Appends a move for the caller's seat. The seat to move is derived from the
-- server's own move count; p_index is only a concurrency check. The creator
-- may play the first word before anyone joins; turn order keeps them from
-- playing again until the second seat is taken.
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
  if kind = 'play' and ((p_move->>'n') is null or (p_move->>'n')::int < 1 or (p_move->>'n')::int > 7) then raise exception 'bad move'; end if;
  if length(p_move::text) > 4200 then raise exception 'move too large'; end if;
  who := seat_of(p_code, p_token);
  if who is null then raise exception 'not a player in this game'; end if;
  select moves into cur from games where id = p_code for update;
  if cur is null then raise exception 'no such game'; end if;
  n := jsonb_array_length(cur);
  if n >= 400 then raise exception 'game too long'; end if;
  if coalesce(game_over(cur), false) then raise exception 'the game is over'; end if;
  if n <> p_index then raise exception 'out of date: the game has moved on'; end if;
  if n % 2 <> who then raise exception 'not your turn'; end if;
  update games set moves = cur || jsonb_build_array(p_move), updated_at = now() where id = p_code;
  return cur || jsonb_build_array(p_move);
end $$;

-- ---- accounts: profiles, friends, results ----------------------------------

-- The caller's profile, created on first call. A friend code is six characters
-- from an alphabet without look-alikes.
create or replace function ensure_profile(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  code text;
  tries int := 0;
  nm text := coalesce(nullif(trim(coalesce(p_name, '')), ''), 'Player');
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if length(nm) > 24 then nm := left(nm, 24); end if;
  if not exists (select 1 from profiles where user_id = auth.uid()) then
    loop
      code := '';
      for i in 1..6 loop code := code || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1); end loop;
      exit when not exists (select 1 from profiles where handle = code);
      tries := tries + 1;
      if tries > 20 then raise exception 'could not allocate a code'; end if;
    end loop;
    insert into profiles (user_id, handle, name) values (auth.uid(), code, nm) on conflict (user_id) do nothing;
  end if;
  return (select jsonb_build_object('handle', handle, 'name', name) from profiles where user_id = auth.uid());
end $$;

create or replace function set_name(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if p_name is null or length(trim(p_name)) = 0 or length(p_name) > 24 then raise exception 'name must be 1-24 characters'; end if;
  update profiles set name = trim(p_name) where user_id = auth.uid();
  return (select jsonb_build_object('handle', handle, 'name', name) from profiles where user_id = auth.uid());
end $$;

-- A public profile: name, code, the results it took part in (for stats and
-- records), whether the caller is a friend, and, for the owner, the friend list.
create or replace function profile(p_handle text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  u uuid;
  h text;
  nm text;
begin
  select user_id, handle, name into u, h, nm from profiles where upper(handle) = upper(trim(p_handle));
  if u is null then return null; end if;
  return jsonb_build_object(
    'handle', h, 'name', nm, 'mine', auth.uid() = u,
    'public_games', (select public_games from profiles where user_id = u),
    -- games in progress, for watching: shown to the owner, and to everyone when the owner allows it
    'live', case when auth.uid() = u or (select public_games from profiles where user_id = u) then
      (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'p1_name', g.p1_name, 'p2_name', g.p2_name, 'moves', jsonb_array_length(g.moves), 'updated_at', g.updated_at) order by g.updated_at desc), '[]'::jsonb)
       from game_keys k join games g on g.id = k.game_id
       where k.user_id = u and g.p2_name is not null
         and not exists (select 1 from game_results r where r.game_id = g.id)
         and not coalesce(game_over(g.moves), false))
      else null end,
    'is_friend', exists (select 1 from friends f where f.user_id = auth.uid() and f.friend_id = u),
    'results', (select coalesce(jsonb_agg(jsonb_build_object(
        'game_id', r.game_id, 'seat', case when r.p0_user = u then 0 else 1 end,
        'my_score', case when r.p0_user = u then r.p0_score else r.p1_score end,
        'their_score', case when r.p0_user = u then r.p1_score else r.p0_score end,
        'their_name', case when r.p0_user = u then r.p1_name else r.p0_name end,
        'their_handle', (select handle from profiles where user_id = case when r.p0_user = u then r.p1_user else r.p0_user end),
        'won', case when r.winner = -1 then null else r.winner = (case when r.p0_user = u then 0 else 1 end) end,
        'end_reason', r.end_reason,
        'stats', r.stats -> (case when r.p0_user = u then 'p0' else 'p1' end),
        'finished_at', r.finished_at) order by r.finished_at desc), '[]'::jsonb)
      from (select * from game_results where p0_user = u or p1_user = u order by finished_at desc limit 500) r),
    'friends', case when auth.uid() = u then (select coalesce(jsonb_agg(jsonb_build_object('handle', p.handle, 'name', p.name) order by p.name), '[]'::jsonb)
                                              from friends f join profiles p on p.user_id = f.friend_id where f.user_id = u) else null end);
end $$;

create or replace function set_visibility(p_public boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  update profiles set public_games = coalesce(p_public, false) where user_id = auth.uid();
  return (select jsonb_build_object('handle', handle, 'public_games', public_games) from profiles where user_id = auth.uid());
end $$;

create or replace function add_friend(p_handle text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  other uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select user_id into other from profiles where upper(handle) = upper(trim(p_handle));
  if other is null then raise exception 'no player has that code'; end if;
  if other = auth.uid() then raise exception 'that is your own code'; end if;
  insert into friends (user_id, friend_id) values (auth.uid(), other), (other, auth.uid()) on conflict do nothing;
  return (select jsonb_build_object('handle', handle, 'name', name) from profiles where user_id = other);
end $$;

create or replace function remove_friend(p_handle text)
returns void language plpgsql security definer set search_path = public as $$
declare
  other uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select user_id into other from profiles where upper(handle) = upper(trim(p_handle));
  delete from friends where (user_id = auth.uid() and friend_id = other) or (user_id = other and friend_id = auth.uid());
end $$;

-- Records a finished game. Idempotent: the first report stands. The caller
-- must hold a seat, and the report must cover every move on the server.
create or replace function finish_game(p_code text, p_token text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  who smallint;
  g games%rowtype;
begin
  who := seat_of(p_code, p_token);
  if who is null then raise exception 'not a player in this game'; end if;
  if exists (select 1 from game_results where game_id = p_code) then
    return (select to_jsonb(r) from game_results r where game_id = p_code);
  end if;
  select * into g from games where id = p_code;
  if not exists (select 1 from game_keys where game_id = p_code and player = 1) then raise exception 'nobody joined this game'; end if;
  if (p_result->>'moves') is null or (p_result->>'moves')::int <> jsonb_array_length(g.moves) then raise exception 'the report does not match the game'; end if;
  if game_over(g.moves) is false then raise exception 'the game is not over'; end if;
  if length(p_result::text) > 4000 then raise exception 'report too large'; end if;
  insert into game_results (game_id, p0_user, p1_user, p0_name, p1_name, p0_score, p1_score, winner, end_reason, moves, stats)
  values (p_code,
          (select user_id from game_keys where game_id = p_code and player = 0),
          (select user_id from game_keys where game_id = p_code and player = 1),
          g.p1_name, g.p2_name,
          (p_result->>'p0_score')::int, (p_result->>'p1_score')::int, (p_result->>'winner')::smallint, p_result->>'end_reason',
          (p_result->>'moves')::int, coalesce(p_result->'stats', '{}'::jsonb))
  on conflict (game_id) do nothing;   -- two clients finishing at once: the first stands
  return (select to_jsonb(r) from game_results r where game_id = p_code);
end $$;

-- A rematch with the sides swapped: both seats (token and account) are
-- copied over, so each player opens the new game with what they already hold.
-- Idempotent: a second call returns the rematch already started.
create or replace function rematch(p_old text, p_token text, p_new text, p_seed text)
returns text language plpgsql security definer set search_path = public as $$
declare
  who smallint;
  g games%rowtype;
begin
  who := seat_of(p_old, p_token);
  if who is null then raise exception 'not a player in this game'; end if;
  select * into g from games where id = p_old for update;
  if g.next_game is not null then return g.next_game; end if;
  if not exists (select 1 from game_keys where game_id = p_old and player = 1) then raise exception 'nobody to rematch'; end if;
  if not coalesce(game_over(g.moves), false) and not exists (select 1 from game_results r where r.game_id = p_old) then raise exception 'the game is not over yet'; end if;
  if p_new is null or p_new !~ '^[a-z]+(-[a-z]+){2}$' or exists (select 1 from games where id = p_new) then raise exception 'that id is taken'; end if;
  if p_seed is null or length(p_seed) = 0 or length(p_seed) > 200 then raise exception 'bad seed'; end if;
  insert into games (id, seed, p1_name, p2_name) values (p_new, p_seed, g.p2_name, g.p1_name);
  insert into game_keys (game_id, player, token, user_id)
    select p_new, 1 - player, token, user_id from game_keys where game_id = p_old;
  update games set next_game = p_new where id = p_old;
  return p_new;
end $$;

-- A game against a friend, seated directly: the friend finds it in their
-- games list and plays second.
create or replace function challenge(p_code text, p_seed text, p_name text, p_token text, p_handle text)
returns text language plpgsql security definer set search_path = public as $$
declare
  other uuid;
  other_name text;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select user_id, name into other, other_name from profiles where upper(handle) = upper(trim(p_handle));
  if other is null then raise exception 'no player has that code'; end if;
  if other = auth.uid() then raise exception 'that is your own code'; end if;
  if not exists (select 1 from friends where user_id = auth.uid() and friend_id = other) then raise exception 'you can only challenge a friend'; end if;
  perform create_game(p_code, p_seed, p_name, p_token);
  insert into game_keys (game_id, player, token, user_id) values (p_code, 1, md5(random()::text || p_code), other);
  update games set p2_name = other_name, updated_at = now() where id = p_code;
  return p_code;
end $$;

revoke all on function seat_of(text, text) from public;
revoke all on function my_seat(text, text) from public;
revoke all on function game_over(jsonb) from public;
revoke all on function get_game(text) from public;
revoke all on function my_games() from public;
revoke all on function create_game(text, text, text, text) from public;
revoke all on function join_game(text, text, text) from public;
revoke all on function play_move(text, text, integer, jsonb) from public;
grant execute on function my_seat(text, text) to anon, authenticated;
grant execute on function get_game(text) to anon, authenticated;
grant execute on function my_games() to anon, authenticated;
grant execute on function create_game(text, text, text, text) to anon, authenticated;
grant execute on function join_game(text, text, text) to anon, authenticated;
grant execute on function play_move(text, text, integer, jsonb) to anon, authenticated;
revoke all on function ensure_profile(text) from public;
revoke all on function set_name(text) from public;
revoke all on function set_visibility(boolean) from public;
revoke all on function profile(text) from public;
revoke all on function add_friend(text) from public;
revoke all on function remove_friend(text) from public;
revoke all on function finish_game(text, text, jsonb) from public;
revoke all on function rematch(text, text, text, text) from public;
revoke all on function challenge(text, text, text, text, text) from public;
grant execute on function ensure_profile(text) to authenticated;
grant execute on function set_name(text) to authenticated;
grant execute on function set_visibility(boolean) to authenticated;
grant execute on function profile(text) to anon, authenticated;
grant execute on function add_friend(text) to authenticated;
grant execute on function remove_friend(text) to authenticated;
grant execute on function finish_game(text, text, jsonb) to anon, authenticated;
grant execute on function rematch(text, text, text, text) to anon, authenticated;
grant execute on function challenge(text, text, text, text, text) to authenticated;

-- Optional housekeeping: drop games nobody has touched for three months.
-- delete from games where updated_at < now() - interval '90 days';
