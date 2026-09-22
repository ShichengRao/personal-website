# shichengrao.com

Personal website of Shicheng Rao, built with [Hugo](https://gohugo.io/) and the
[Ananke](https://github.com/theNewDynamic/gohugo-theme-ananke) theme (vendored as a
git submodule), deployed on Netlify.

## Local development

```sh
git clone --recurse-submodules git@github.com:ShichengRao/personal-website.git
cd personal-website
hugo server
```

If you cloned without submodules, run `git submodule update --init` first.
`hugo server` serves the site at http://localhost:1313 with live reload. No npm
install is needed to build or serve the site.

## Repo layout

| Path | Purpose |
| --- | --- |
| `content/` | Page content and front matter (homepage project cards live in `content/_index.md`) |
| `layouts/` | Custom templates: homepage projects grid, the self-contained Hangul practice app, the Blunder Drill page, the Long Game hub and game pages, the Scrabble Mod page, favicon partial |
| `static/` | Files copied verbatim into the site: resume PDF, favicons, the Blunder Drill data, the Long Game scripts (`static/games/`), the Scrabble Mod engine and word list (`static/scrabble-mod/`) |
| `config.toml` | Site config, nav menu, SEO settings |
| `netlify.toml` | Build command, pinned Hugo version, redirects, security headers |
| `themes/ananke/` | Theme submodule — don't edit; override in `layouts/` instead |
| `plans/` | Product notes for side projects, and the Supabase schema for Scrabble Mod's online games |
| `tools/` | `scrabble-mod-lab.mjs`: self-play across the cores to measure the Scrabble Mod bot (arena between two bot profiles, leave-value fitting, a benchmark); `scrabble-mod-vs-magpie.mjs`: how often our top play is MAGPIE's, given a local MAGPIE build with our board, tiles and word list |
| `tests/` | Node tests (`npm test`): repo smoke check, game scripts parse, Crux walls solve and the rules hold, replays round-trip, Scrabble Mod scoring, endings and move generation. New test files must be added to the `test` script in `package.json` |

`public/` and `resources/` are Hugo build output and are not tracked.

## The Long Game

`/long-game/` hosts three small canvas games (Bulwark, Slipstream, Crux) built as
plain scripts with no build step. Each page is a `content/long-game/<game>.md` whose
`layout` front matter picks `layouts/long-game/<game>.html`; the shared chrome lives
in `layouts/partials/long-game/style.html` and `static/games/common.js`. Every game
exposes a `window.__lg.<game>` handle (state, `update(dt)`, `reset(seed)`) so it can
be stepped headlessly from the console for tuning.

Crux's rules live in `static/games/crux-core.js` with no DOM in them: the seeded
wall generator, the plan evaluator and the solver that computes par. It loads in
Node as well as the browser, which is how the tests check every set wall and how
new set walls get picked (generate a few hundred per tier, keep the ones where the
best plan has to work around a hazard, bake the seeds into `WALLS` in `crux.js`).

The design bar for these games is a delay test: replay a good run with every
input shifted five seconds later. A game whose outcome is decided by planning
should mostly survive that; one decided by reflexes dies. Bulwark and Crux are
built to pass it; Slipstream currently does not.

Every run is recorded as a **replay**: the seed plus the input at every fixed
step, run-length encoded (`LG.Tape` in `common.js`). The games are deterministic on
that input, so a replay reproduces a run exactly. Each page has Download / Copy /
Load / Paste controls; Copy produces a pasteable `LGR1:` string (gzip + base64,
roughly 10 KB per minute of play). Each game carries a `VERSION`; bump it when
tuning changes enough that old replays would no longer match. A replay can also be
stepped headlessly: `watch(rec)` on the game's handle, then `loop.step()`.

## CI and deployment

- Every push to `main` deploys via Netlify: it runs `hugo` and publishes `public/`.
- GitHub Actions (`.github/workflows/ci.yml`) builds the site on PRs and pushes to
  `main`, using the same Hugo version Netlify pins.
- The Hugo version is pinned in two places — `netlify.toml` and `ci.yml` — keep them
  in sync when upgrading.
- Old URLs (`/church/`, `/vine/`, `/deskbooks/`, `/livestream/`, the dated resume
  filename) are 301-redirected in `netlify.toml`; add a redirect there before
  removing or renaming any public path.

## Scrabble Mod

`/scrabble-mod/` is a two-player word game with the board, tile values and
ending of the New York Times' Crossplay, none of its branding, and the
public-domain ENABLE word list (`static/scrabble-mod/words.txt`, one word per
line; swap the file to change lists). `static/scrabble-mod/core.js` holds the
rules with no DOM in them: the layout, the seeded bag, placement checks,
scoring, a trie over the word list, an Appel–Jacobson move generator and a
rack-leave heuristic that turns raw scores into equity. The hard bot and the
review both pick by equity. It loads in Node, which is how the tests check it.
`app.js` is the page: board and rack (typing, clicking or dragging), the bot,
pass-and-play, online games, and a move-by-move review with the top plays for
every position. Stored games are replayed without the word list, so swapping
the list never makes an old game unreadable.

The hard bot plays by equity (score plus leave), and once the bag is empty it
searches the last turns exactly, since the opponent's rack is then known. It
also exchanges when the kept rack is worth more than any play. The easy and
medium bots are limited to `static/scrabble-mod/common.txt`, the ENABLE words
that appear among the 50,000 most frequent English words in
[hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
(OpenSubtitles 2018, MIT licence), about 32,500 words; the review rates a
move against the best play made of those common words and reports a better
rare-word play separately, so an ordinary vocabulary is not marked down. The
leave values (singles and pair synergies in `core.js`) were fitted to a leave
file that MAGPIE's leavegen produced for this board and tile set; the fit is
`tools/scrabble-mod-lab.mjs fitklv` and its output is `tools/leaves-gen3.json`.
With it, our top play is MAGPIE's static top play on 85% of sampled positions
and in its top three on 97%.
`node tools/scrabble-mod-lab.mjs arena hard hard:score 400` pits two bot
profiles against each other over 400 games on all but two cores and reports the
win rate; `leaves` fits a leave table from self-play; `bench` times the
generator. Changes to the bot should come with an arena result.
`tools/scrabble-mod-vs-magpie.mjs` compares our top play with MAGPIE's static
ranking and Monte Carlo sim on positions sampled from self-play; its header
says what MAGPIE needs (a layout file for this board, a letter distribution
for these tiles, a KWG built from words.txt, and `-bb 40`).

A game is its seed plus its move list; `core.replay` rebuilds everything else,
so online play only stores those two things. Every game has a three-word id
(`otter-slate-plum`) that is also its address, `/scrabble-mod/<id>`; the
`netlify.toml` rewrite serves the page for any such path, and under `hugo
server` the same game is `/scrabble-mod/?g=<id>`. To turn online play on, create a
Supabase project, run `plans/scrabble-mod-supabase.sql` in its SQL editor and
put the project URL and publishable key into `window.SM_CONFIG` in
`layouts/scrabble-mod/list.html`. Until then the page offers the bot and
pass-and-play only.
