# Seven Tiles: group mode

Name: **Same Rack**.

Status: built and tested, on the real Supabase project too. There is one mode, a room on the server that keeps going on each phone without signal, and the host can add bots. The engine, the page and the server functions are done, and the rooms schema is on the Supabase project (applied 2026-11-12). Stats are not built. It shipped in PR #34 (merged 2026-11-12). A second pass after a review (one Finish round button, live dots, the top plays of each round) followed on 2026-11-14, then a third (fresh racks as a setting, 5-round games, removing bots), whose schema change is on the Supabase project (applied 2026-11-14). A fourth, a vote to end the game early, needs one more schema change, not applied yet.

## How it plays

- **Starting.** The menu's "Same Rack" card takes your name and either starts a room or joins one by its three words. A room lives at `/seven-tiles/room/<words>`, apart from the two-player games. Starting or joining needs signal once.
- **Lobby.** The room's words in large type, a copy link, a share button on phones, a QR code, and the players as they join. The host picks the rounds (5, 10, 15 or the whole bag), the time per round (1, 1.5, 2 or 3 minutes, or no clock) and the racks (keep leftovers, or fresh each round), can add and remove bots, and presses Start.
- **Bots.** The host adds them in the lobby at a level from casual to full strength (20 to 100 on the 1v1 dial), and can remove them there. A new bot takes the lowest free number, so removing Bot 1 and adding another gives a new Bot 1. The host's page plays for them. A bot plays a few seconds into a round (at most about half a minute), or at once when everyone else is done, and is ready for the next round straight away, so it never holds the room up. It plays only while the host has the room open, and rounds it missed go in when the host is back.
- **A round, with signal.** Everyone plays the same rack on their own copy of the board, on the server's clock. The message line shows the clock, a time bar and "3 of 5 done". The best legal play you lay out is saved as you go ("Saved: SHANTY for 32 points.") and sent, so it stands even if your phone drops out. Finish round ends your round with the better of the saved play and the one on the board, and asks first if there is neither. Time running out does the same without asking. The round closes at the deadline or once everyone has finished.
- **The board play.** Each round the best play made of everyday words goes on the board, worked out by the engine from the common word list. Your own play scores for you and never goes on the board.
- **Players.** The side panel lists everyone by total, with a dot for how each is playing: green with the room, amber catching up on their own clock ("on round 5"), and hollow when not heard from in 20 seconds ("offline"). The lobby shows the same dots.
- **Round card.** When a round closes, a card lists the plays placed third or better (more than three when there are ties), and yours below them when it isn't among them, with a star for each that matched or beat the best play. Players who haven't finished the round are named under it ("Bo is still playing."). It names the play that goes on the board and, when it was higher, the top play of all ("The top play was SHANTY for 62."). The next round opens after 15 seconds, or sooner once everyone has pressed "Next round". The rounds list in the side panel shows the same top plays under each round's board play, and tapping a round shows its card again.
- **Ending early.** Once round 1 has closed, End game (where 1v1 has Resign) is a vote to end the game now. It turns into Keep playing, which takes the vote back. The message line shows "2 of 4 want to end", and the side panel marks each player who does. The game ends once every player wants it to, with the last round the room closed, so a round under way doesn't count. The host's bots go along with the host, so a game of one player and bots ends at once. The vote that would end it asks first ("End the game now? This round won’t count.").
- **End.** Standings with % of best and total, then your own game: points, % of the best plays, best plays found, top word, and a colored square per round. One button shares the standings and your squares.

## Without signal

- A phone that loses signal keeps going. The round under way finishes on the clock it had, and the next ones start with "Start round N" and run on the phone's own clock.
- Plays are saved on the phone and sent, oldest first, once there is signal. A reload with no signal reopens the game from the saved copy, with a round under way and its deadline intact.
- You see the other plays of a round only once you have finished it yourself and the room has closed it. So a late play could not have used them, and the server can accept it like any other. Late plays show up for everyone who has finished that round, and the standings fill in.
- Back with signal, a player who fell behind sees "The room is on round 7." with two buttons, "Start round 5" to catch up on their own clock and "Skip to round 7". Skipping marks the missed rounds as no play.
- A player who is behind or away never holds up the room. A player who played ahead offline counts as done and ready for those rounds, so the room runs straight through rounds everyone has played. The room never opens a round while nobody is there to play it.

**Why the board play is the best everyday play.** When the best submitted play went on the board, the next rack depended on everyone's plays, and a phone without signal could not deal it. With the board play worked out from the seed alone, every phone can deal every rack by itself.

**Why "everyday" words.** In 1,200 rounds of 10-round games, the top play needed a word outside the common list 60% of the time, and the best everyday play averaged 79% of its score. Bots at the app's dial levels found the top play rarely:

| Bot level | Finds the top play | Finds the best everyday play | Points, against the best everyday play |
|---|---|---|---|
| 20 | 3% | 10% | 57% |
| 40 ("club player") | 5% | 16% | 72% |
| 60 | 11% | 26% | 91% |
| 80 | 24% | 45% | 108% |

So scores are measured against the best everyday play. It is the same list the 1v1 review rates against. A play can beat it with a rarer word, which shows as more than 100%.

## Rules

- **Scoring.** Each player scores their own play. No play, or a play that turns out to be invalid, scores 0. The highest total wins, and equal totals share the win.
- **Racks.** The next rack is the tiles the board play left behind, filled from the bag to seven. A rack needs at least two vowels and two consonants in rounds 1 to 15, and at least one of each after that. A blank counts as either, and Y counts as a consonant. A rack that fails this, or that has no legal play, goes back into the bag and seven fresh tiles are drawn (about 9% of rounds). Every shuffle comes from the seed.
- **Fresh racks.** A room setting. The board play's leftovers go back in the bag too, and every round starts from seven new tiles, under the same rule. Nobody chooses the leftovers, and the top play tends to spend the good consonants and keep vowels and repeats, so with leftovers kept clunky racks pile up. Over 150 ten-round games with the engine's board play, a rack had three of one letter or five vowels 18% of the time with leftovers kept, in runs of up to 8 rounds, and 13% with fresh racks, in runs of up to 4. The best play averaged 32 and 33 points.
- **End.** After the set number of rounds, when the bag can no longer make a rack, or when every player votes to end it. A full bag lasts 17 to 27 rounds. Players who are behind can still finish their rounds after the room is over.
- **Players.** Up to 12. Signing in is optional. A player who joins while a round is open can play it, and during a reveal they start with the next round. Their % of best counts from the round they joined.

## Engine (`static/seven-tiles/core.js`)

A "group play" section at the end of the file.

- `newGroup(seed, opts, dict, common)` deals the first rack. Given the common list, `state.best` is the best play made only of everyday words and `state.top` is the best play of all. Without it they are the same.
- `resolveRound(state, subs, dict, common)` settles a round and deals the next. With `board: 'engine'` (what rooms use) the board play is `state.best` whatever the submissions, so the page passes none and scores plays itself. Each round is kept as `{ rack, redraws, plays, board, best, top }`.
- `GROUP_VERSION` (2 since fresh racks) is raised whenever a change would settle a game differently. A room stores it with the sizes of both word lists, and a page whose copy differs (an old cached version after an update, say) asks for a reload instead of playing on with different boards.
- The `'player'` board option (the best submitted play goes on) is still there and tested, but rooms don't use it.
- Ties between the engine's own plays are settled by the play's squares and letters in plain string order, never `localeCompare`, so every phone agrees whatever its language.
- Tests in `tests/seven-tiles-group.test.mjs` (part of `npm test`, 66 tests passing) cover determinism, the board-play rules, illegal plays, the rack rule, fresh racks, both endings, locale independence, standings, rack order, and the everyday-words best and top plays.

## Server (`plans/seven-tiles-supabase.sql`, "Same Rack: rooms")

RLS on, no policies, everything through security-definer functions. `room_seat` and `room_tick` are revoked from `anon` and `authenticated` by name, since Supabase grants new functions to them directly.

- **Tables.** `rooms` (seed, settings, phase, the room's round and clock), `room_players` (seat, name, token, account, the round they joined at, ready, last seen, wants to end), `room_plays` (one row per player per round: the packed play, and whether they are done).
- **`get_room(code, token)`** returns the settings, the clock with the server's time, the players with how many rounds each has finished, the caller's own plays, and everyone's finished plays for each round the room has closed and the caller has finished. Calling it counts as being here.
- **`submit_play(code, token, round, play, done)`** files a play for any round from the one the caller joined at, the open one or one played offline, until they are done with it. The clock is the pages' to keep.
- **`room_tick`** closes the open round at its deadline (plus three seconds) or once everyone here and keeping up is done, and opens the next when the reveal ends or everyone here and keeping up is ready. "Here" is seen in the last 20 seconds. "Keeping up" is done with every earlier round. It repeats until nothing changes.
- **Also:** `create_room` (rate-limited like new games), `join_room`, `start_room` (host only, sets the settings, with `p_fresh` for fresh racks), `leave_room` (a seat leaves the lobby, never the host's, which the host's page uses with a bot's token to remove it), `room_ready`, `end_room` (a page reports the bag is spent, accepted once the room has closed that round and not before round 12), and `vote_end` (a player wants the game to end now, or no longer does). Once all do, the room is over with the last round it closed, as `end_reason` 'vote', and plays for later rounds are dropped. `submit_play` refuses rounds past the end of any finished room.

**Applying it.** Run the section from `-- ---- Same Rack: rooms` to the end in one transaction, after a check in a rolled-back one. It is on the Supabase project as of 2026-11-12. That version replaced the first one's functions and dropped its `get_room(text, text, integer)`, and the tables were unchanged. The third pass adds `rooms.fresh_racks`, replaces `get_room`, drops the four-argument `start_room` for one with `p_fresh` (default false, so old pages still start rooms), and adds `leave_room`. That migration was checked locally on the schema as it was live, with a room in its lobby, then run on the Supabase project on 2026-11-14 after a rolled-back check. The fourth pass adds `room_players.wants_end` and `vote_end`, and replaces `get_room` and `submit_play`. Its migration was checked locally on the schema as it is live, with a room mid-game, and left the functions identical to a fresh load of the file. Old pages ignore the new field.

## Page (`static/seven-tiles/app.js`, `layouts/seven-tiles/list.html`)

`G.kind === 'room'`, in the "Same Rack" section of `app.js`.

- **The game.** Worked out from the seed as far as needed (`states[i]` is the game after i rounds). Plays are scored against the board before their round, so they can arrive in any order.
- **Phases.** `lobby`, `play`, `wait` (you're done and the room is still playing your round), `reveal`, `ready` (your next round waits for you to start it on your own clock), `over`, and `watch` for someone without a seat.
- **Sync.** Every answer carries the server's time, and the page counts down in server time. It asks every 2 to 3 seconds with signal, right after a deadline or reveal ends, and every 6 seconds without signal. A request that gets no answer in 12 seconds counts as no signal. Unsent plays go first.
- **Saved copy.** The game record keeps the server's last answer, your plays (sent or not), the round under way and the host's bots, so it opens without signal.
- **Bots.** A bot is a seat like any other, joined with its own token. Its calls go straight to the REST API with the site's key alone (`Net.anon`), never with the host's account, since a signed-in host's account would otherwise claim the bot's seat. After each answer from the server the host's page makes one pass over its bots: each votes to end as the host has, sends the rounds it owes, says it is ready, or checks in every 8 seconds so it counts as here. Its play comes from `botMoveAt` on the round's board, seeded by its seat and the round, so it is the same however often it is worked out. No server change was needed.

## Testing

- **Server.** 8 checks against a throwaway local Postgres (with stand-ins for Supabase's `auth.uid()` and roles), as the `anon` role: the lobby, hidden plays, late plays and who sees them, falling behind and catching up, running through rounds played offline, the room not running on without players, stragglers after the end, late joiners and the cap, ending on the bag, account seats, and the closed tables and functions.
- **Page.** Played in the browser pane through a local proxy that answered the page's calls from that database, with three players on three origins (`localhost`, `127.0.0.1`, `[::1]`, which keep separate storage). The proxy could cut one origin's connection to stand in for losing signal. Covered:
  - a 10-round game where one player lost signal twice
  - playing rounds offline, reloading mid-round offline, and sending those rounds on reconnect
  - catching up, and skipping ahead to the room's round
  - a whole-bag game that ended on the bag
  - all three pages agreeing on the final standings
- **On Supabase.** The same kind of check, in a transaction that was rolled back: a three-player room where one player was away, played a round ahead offline and sent a round after the end, with who sees which plays at each step, the errors for a missing round, a finished round and joining a finished game, and the closed tables and functions. Then, over the public REST API with the page's key, `get_room` answers and `room_tick`, `room_seat` and the tables refuse.
- **Three players on the real project.** One page held three players side by side, each on its own origin, through a proxy that passed their calls to Supabase and could cut each one's signal. The page itself, since background tabs in the browser pane are throttled. An autopilot in each played like a person: it picked a play with the engine, typed it onto the board, submitted it and pressed Done. Ten rounds, a minute each:
  - Ann had signal throughout. The room never waited for the other two when they had none: each round closed when Ann (and Cy, when she had signal) pressed Done.
  - Bo lost signal three seconds into round 1 and played all ten rounds on his own clock in two and a half minutes, with every play queued. When his signal came back after the game, the ten rounds went in, oldest first, within a second and a half.
  - Cy had a 6-second blip in round 2 (nothing changed), lost signal for 100 seconds in round 3 and played rounds 3 to 5 on her own clock, then came back just as the room opened round 6 and joined it, with her three rounds sent. A 6-second blip during a reveal made her Next fail once, and she pressed it again when back. She lost signal again for 90 seconds in round 7, played 7 and 8 on her own clock, came back with the room on round 10, and skipped round 9.
  - All three pages ended on the same standings: Ann 356 (100% of the best), Bo 327 (92%), Cy 294 (83%). No page errors.
- **Bots on the real project.** From the plain preview (so the bots' calls went to Supabase across origins): a room with two bots, both played within 8 seconds, the round closed 0.3 seconds after the host pressed Done, and the next round opened 0.2 seconds after Next. Locally, bots also played through the host losing signal: the room waited, and the bots sent the rounds they owed when the host was back.
- **Finish round, dots and top plays, locally.** Ann, two bots and Bo on two origins through the local proxy. Ann's best play saved and reached the server before she finished, and a worse one laid out after it didn't replace it. Finish round sent the saved one. Finishing with nothing on the board asked first. With Bo's signal cut, Ann's panel showed him offline after 20 seconds, and the round closed without him. Back with signal and a round behind, he showed amber "on round 2" to Ann, and green once he caught up. His late play moved into round 1's top three, and in round 2 Ann was fourth and listed under the top three. The phone layout fit, and the 1v1 game still has its Pass button.
- **Ending early, locally.** The server checks: no vote in the lobby or while round 1 is on, votes taken back, the end during a reveal (that round counts) and mid-round (it doesn't, and its plays are gone), plays after the end refused. In the browser, a host and two bots ended mid-round 2 with one tap and the confirm: three votes, game over after round 1, and a reload showed the same. With a second player on another origin, her vote showed "1 of 3 wants to end" to both, and the host's vote then asked first and ended it on both pages.
- **Not tested yet.** Real phones, and a dozen players.

## Page text

As little as possible. The page doesn't warn ahead of time about limits or what happens without signal. It says what's going on when it happens ("No signal.", "The room is on round 7.") and why something didn't work ("This room is full (12 players). You’re watching."). A call that never reaches the server reads as "no signal". The how-to-play card has one short paragraph on Same Rack.

## Not built

- Stats, kept separate from 1v1: reports when a game ends, settled when two agree, and a profile section with games, wins, average % of best, best-play rounds, bingos and best word.
- Rooms from other devices in the menu (`my_rooms`), changing the settings after Start, and leaving a room for good.
- Removing a bot after Start, and bots added after Start. Bots run only on the device that added them.
- A phone that loses signal in the lobby, before it has seen the game start, can't play until it's back, since it doesn't know the settings.
- Tapping a play on a round card to see where it went on the board.

## Decided

1. One mode, a live room. A phone without signal keeps playing and fills in later. (This replaced building separate live and offline versions.)
2. The best play made of everyday words goes on the board, so a phone without signal can keep dealing racks. (This replaced the best player's play.)
3. Scores are measured against that play, not the top play of all.
4. One button, Finish round. The best legal play you lay out is saved as you go, so there is nothing to submit. (This replaced Submit and Done, which left players unsure whether they had played or were holding the room up.) The round closes early once everyone has finished.
5. Up to 12 players.
6. Stats count, in their own section, apart from 1v1.
7. The mode is called Same Rack, and games last 10 rounds by default.
8. Leftovers carry over by default, as in duplicate. Fresh racks are a setting, not a replacement.
9. Ending early takes every player, a player who has left included. A round under way when it ends doesn't count.
