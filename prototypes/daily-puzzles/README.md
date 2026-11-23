# Daily puzzles (prototype)

Five logic games with a new puzzle every day, Monday (easiest) to Sunday (hardest).
This is a local prototype. It sits outside Hugo's folders, so it isn't deployed.

| Game | Genre | Difficulty settings |
|---|---|---|
| Seating Chart | Star Battle | `DAYS` in `games/seating-chart/generate.js` |
| Two Tone | Takuzu with = and × signs | `DAY_PLAN` in `games/two-tone/generate.js` |
| Paper Route | Numbered path through every cell | `DAY_PLAN` in `games/paper-route/generate.js` |
| Zoning | Shikaku | `DAY_SETTINGS` in `games/zoning/generate.js` |
| 6×6 Sudoku | Sudoku, 2×3 boxes | `WEEK` in `games/sudoku6/generate.js` |

## Play

```bash
python3 -m http.server 8765 -d prototypes/daily-puzzles
```

Open http://localhost:8765. It opens on today. The arrows step back through earlier weeks, and later days stay locked until they come.
Each board stays hidden until you press Play.
The clock runs from Play to solve and pauses while the tab is hidden. Reset clears the board but keeps the clock running.
Red marks a rule break between placed pieces once it has stood untouched for two seconds (`lib/grace.js`), so tapping through one piece on the way to another never flashes red.
In 6×6 Sudoku, a row, column or box flashes bold and green when your digit completes it correctly.
Undo (or Ctrl/Cmd+Z) takes back one tap, drag or stroke.
Hint points out a mistake first, if there is one. Otherwise it highlights the next logical step and explains it.
Only your first attempt at a puzzle is recorded: the solve time or how long you played before showing the solution, plus how many hints you used.
Records are tied to the puzzle itself, so a day whose generator changed starts fresh.
The feedback box and the 1–5 rating are saved in the browser.
"Copy all feedback" lists each puzzle's size, the grader's score and hardest step, your time, your rating and your note.

## Where puzzles come from

There's no list of puzzles. The page makes each one in the browser from the game and the date (`lib/daily.js`), so everyone gets the same puzzle on the same day.
The weekday sets the difficulty. Each game gets its own worker (`worker.js`), so a slow puzzle never holds up the page or another game.
A bar shows while a puzzle is being made. Most take a few milliseconds, and the slowest (midweek Sudoku) take up to about 10 seconds on a laptop.
On opening, the page starts making today's puzzle for all five games.
Made puzzles are kept in localStorage, so a day opens instantly the second time. Unplayed ones are dropped after two weeks.

After changing a game's generator, bump its `v` in `games/index.js`. Browsers then drop the puzzles they kept and make them again.

## Icon

`icon.svg` is the rounded icon for browsers and desktop installs. `icon-square.svg` is full-bleed for iPhones, which round it themselves. `icon-maskable.svg` keeps the pieces inside Android's safe zone.
After changing them, render the PNGs again:

```bash
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 180 -h 180 icon-square.svg -o icon-180.png
rsvg-convert -w 512 -h 512 icon-maskable.svg -o icon-maskable-512.png
```

## Check

`generate.mjs` makes the same puzzles the page makes for a run of dates and writes `data/` for the checks. The page doesn't read `data/`, and git ignores it.
From this folder:

```bash
node generate.mjs                          # all games, 3 weeks from this Monday
node generate.mjs --from 2027-01-04 --weeks 5
node generate.mjs --game zoning --days 6,7 --dry   # only some weekdays, write nothing
node games/zoning/check.mjs                # independent check: rules and a unique solution
```

Each generator grades its puzzles with a step-by-step solver that uses only human-style deductions.
A day accepts a puzzle only if that solver finishes it with the techniques the day allows.
"Generator stats" on the page shows what a puzzle needed.
