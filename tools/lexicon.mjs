#!/usr/bin/env node
/* Seven Tiles word lists: builds the two packed lists the game ships, and
   reads them back for the tests and tools.

   The game never ships a readable word list. It loads
     static/seven-tiles/words.bin   every playable word
     static/seven-tiles/common.bin  the common words: the easy and medium bots
                                    play only these, and ratings use them
   both packed by core.js (packLexicon): front-coded, gzipped, scrambled.

   Build:
     node tools/lexicon.mjs build enable
         ENABLE (public domain, tools/lexicon/enable.txt) plus the stopgap
         NWL words in tools/lexicon/word-additions.txt
     node tools/lexicon.mjs build nwl23 <path to the NWL2023 file>
         NASPA Word List 2023, from the file NASPA delivers. Keep that file
         out of the repo (tools/lexicon/private/ is gitignored).
   The common list is the source list intersected with the 50,000 most
   frequent English words in hermitdave/FrequencyWords (OpenSubtitles 2018,
   MIT licence), plus the stopgap words of three letters or fewer, since
   anyone who has played a word game knows QI and ZA. The frequency list is
   downloaded once and cached in the system temp folder, or given with
   FREQ=<path>.

   Read back:
     node tools/lexicon.mjs dump words|common > out.txt
         the plain list, for local use only (building a MAGPIE lexicon);
         never commit the output
     node tools/lexicon.mjs info
         which list is packed, and how many words each file holds

   From other scripts: import { loadWords, loadDict } from './lexicon.mjs'. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { gzipSync, gunzipSync, constants } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const C = require(join(root, 'static', 'seven-tiles', 'core.js'));
// LEXICON_DIR builds and reads the packed lists somewhere else (a private trial build), leaving the served ones alone
const OUT = process.env.LEXICON_DIR || join(root, 'static', 'seven-tiles');
const HERE = join(root, 'tools', 'lexicon');
const FREQ_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt';

// What each list is called in the game, and the credit it carries there.
const PRESETS = {
  enable: {
    name: 'ENABLE',
    note: 'ENABLE, the public-domain word list, with a few dozen short words added.'
  },
  nwl23: {
    name: 'NASPA Word List 2023',
    short: 'NWL23',
    link: 'https://www.scrabbleplayers.org/landing/seven-tiles/',   // NASPA's page for the game (section 4h lets NASPA name the URL)
    // the wording NASPA's licence (section 4g) asks for, verbatim
    attribution: 'NASPA Word List 2023 Edition © NASPA 2023. The copy included in this app is licensed for personal use. You may not use it for any commercial purposes.'
  }
};

const words = (text) => text.split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0].toLowerCase()).filter((w) => /^[a-z]{2,15}$/.test(w));
const additions = () => words(readFileSync(join(HERE, 'word-additions.txt'), 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n'));

export function loadWords(kind = 'words') {
  return C.unpackLexicon(readFileSync(join(OUT, kind + '.bin')), gunzipSync);
}
let cache = {};
export function loadDict(kind = 'words') {
  return (cache[kind] ||= C.buildDict(loadWords(kind).words));
}

async function frequent() {
  const path = process.env.FREQ || join(tmpdir(), 'seven-tiles-en_50k.txt');
  if (!existsSync(path)) {
    const r = await fetch(FREQ_URL);
    if (!r.ok) throw new Error('could not download the frequency list: HTTP ' + r.status);
    writeFileSync(path, await r.text());
  }
  return words(readFileSync(path, 'utf8'));
}

async function build(preset, file) {
  const meta = PRESETS[preset];
  if (!meta) throw new Error('unknown list "' + preset + '": use enable or nwl23');
  let list;
  if (preset === 'enable') list = [...words(readFileSync(join(HERE, 'enable.txt'), 'utf8')), ...additions()];
  else {
    if (!file || !existsSync(file)) throw new Error('give the path to the NWL2023 file: node tools/lexicon.mjs build nwl23 <file>');
    list = words(readFileSync(file, 'utf8'));
  }
  const all = new Set(list);
  if (all.size < 100000) throw new Error('only ' + all.size + ' words read from the source: is that the right file?');
  const common = new Set((await frequent()).filter((w) => all.has(w)));
  for (const w of additions()) if (w.length <= 3 && all.has(w)) common.add(w);
  const gz = (b) => gzipSync(b, { level: constants.Z_BEST_COMPRESSION });
  writeFileSync(join(OUT, 'words.bin'), C.packLexicon(meta, [...all], gz));
  writeFileSync(join(OUT, 'common.bin'), C.packLexicon(Object.assign({}, meta, { common: true }), [...common], gz));
  console.log(meta.name + ': ' + all.size + ' words, ' + common.size + ' common; wrote static/seven-tiles/words.bin and common.bin');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'build') await build(a, b);
    else if (cmd === 'dump') process.stdout.write(loadWords(a || 'words').words.join('\n') + '\n');
    else if (cmd === 'info') for (const k of ['words', 'common']) { const l = loadWords(k); console.log(k + '.bin: ' + l.meta.name + ', ' + l.words.length + ' words'); }
    else { console.error('usage: node tools/lexicon.mjs build enable | build nwl23 <file> | dump words|common | info'); process.exit(1); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
