# Running MAGPIE with Seven Tiles's rules

[MAGPIE](https://github.com/jvc56/MAGPIE) is the reference engine that
`tools/seven-tiles-vs-magpie.mjs` compares against and that produced the leave
values in `static/seven-tiles/core.js`. It needs to be told about our board,
tiles and word list; the two data files here do that.

```sh
git clone https://github.com/jvc56/MAGPIE.git && cd MAGPIE
./download_data.sh
make magpie BUILD=no_pgo_release
cp .../tools/magpie/crossplay15.txt data/layouts/
cp .../tools/magpie/english_mod.csv data/letterdistributions/
# the lexicon: our word list, upper-cased, under a name MAGPIE accepts (CSW* prefix)
node .../tools/lexicon.mjs dump words | tr a-z A-Z | sort > data/lexica/CSWMOD.txt   # local only: never commit it
./bin/magpie convert text2kwg CSWMOD english_mod        # data/lexica/CSWMOD.kwg
./bin/magpie createdata klv CSWMOD english_mod          # data/lexica/CSWMOD.klv2, all-zero leaves (required to exist)
```

Then every session needs these settings (`-bb 40` is the bingo bonus; `-wmp
false` because MAGPIE's word-map builder refuses a set with three blanks;
`-savesettings false` so nothing is written into the MAGPIE directory):

```
set -savesettings false -lex CSWMOD -ld english_mod -bdn crossplay15 -bb 40 -wmp false -leaves CSW24
```

`-leaves CSW24` borrows MAGPIE's standard-English leave values; to generate
leaves for this tile set instead (what `core.js` uses), run leavegen and point
`-leaves` at the result:

```
set -savesettings false -lex CSWMOD -ld english_mod -bdn crossplay15 -bb 40 -wmp false -threads 5 -r1 best -r2 best -pl1 0 -pl2 0 -sinfer false -si1 false -si2 false -leaves CSWMOD
leavegen 3,6,12 500000
```

That schedule (minimum rack occurrences per generation, then normal games
before rare racks are forced) took about 15 minutes a generation on five
threads and writes `data/lexica/CSWMOD_gen_N.csv`, which
`node tools/seven-tiles-lab.mjs fitklv <csv> tools/leaves.json` fits to the
engine's singles-and-pairs model. MAGPIE's recommended schedule
(`100,200,500,1000,1000,1000 100000000`) is days of compute.

A position is given in CGP form, e.g. QUILT from the center with the rack
OEAFRGW to move and the scores 0/34:

```
cgp 15/15/15/15/15/15/15/7QUILT3/15/15/15/15/15/15/15 OEAFRGW/ 0/34 0
generate
shmoves 10
simulate
```
