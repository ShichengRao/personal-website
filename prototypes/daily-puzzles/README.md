# Daily puzzles (prototype)

Five logic games, each with three weeks of generated puzzles, Monday (easiest) to Sunday (hardest).
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

Open http://localhost:8765. Each board stays hidden until you press Play.
The clock runs from Play to solve and pauses while the tab is hidden. Reset clears the board but keeps the clock running.
Red marks a rule break between placed pieces once it has stood untouched for two seconds (`lib/grace.js`), so tapping through one piece on the way to another never flashes red.
In 6×6 Sudoku, a row, column or box flashes bold and green when your digit completes it correctly.
Undo (or Ctrl/Cmd+Z) takes back one tap, drag or stroke.
Hint points out a mistake first, if there is one. Otherwise it highlights the next logical step and explains it.
Only your first attempt at a puzzle is recorded: the solve time or how long you played before showing the solution, plus how many hints you used.
Records are tied to the puzzle itself, so a regenerated day starts fresh.
The feedback box and the 1–5 rating are saved in the browser.
"Copy all feedback" lists each puzzle's size, the grader's score and hardest step, your time, your rating and your note.

## Icon

`icon.svg` is the rounded icon for browsers and desktop installs. `icon-square.svg` is full-bleed for iPhones, which round it themselves. `icon-maskable.svg` keeps the pieces inside Android's safe zone.
After changing them, render the PNGs again:

```bash
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 180 -h 180 icon-square.svg -o icon-180.png
rsvg-convert -w 512 -h 512 icon-maskable.svg -o icon-maskable-512.png
```

## Regenerate

From this folder:

```bash
node generate.mjs                          # all games, 3 weeks
node generate.mjs --game zoning --weeks 5
node generate.mjs --game zoning --days 6,7 --dry   # try settings without writing
node generate.mjs --salt b                 # a different set of puzzles
node games/zoning/check.mjs                # independent check: rules and a unique solution
```

The same seed always gives the same puzzle.
Each generator grades its puzzles with a step-by-step solver that uses only human-style deductions.
A day accepts a puzzle only if that solver finishes it with the techniques the day allows.
"Generator stats" on the page shows what a puzzle needed.
