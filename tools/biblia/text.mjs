// Builds the /biblia/ page's Bible text from eBible.org downloads:
//   - La Biblia en Español Sencillo, USFM (https://ebible.org/Scriptures/spabes_usfm.zip)
//   - World English Bible, VPL (https://ebible.org/Scriptures/engwebp_vpl.zip)
// Both are public domain.
//
//   node tools/biblia/text.mjs <spabes_usfm dir> <engwebp_vpl.txt>
//
// Writes static/biblia/es/<BOOK>.json, static/biblia/en/<BOOK>.json and data/biblia.json.
//
// es/<BOOK>.json is an array of chapters. A chapter is an array of blocks, and a
// block is [style, ...items]: style is "p" (paragraph), "q1"/"q2" (poetry lines),
// "d" (a psalm's heading), "qa" (an acrostic letter) or "sp" (a speaker); a number
// item starts that verse and a string item is text. A verse can run across blocks.
//
// en/<BOOK>.json is an array of chapters, each an array of verse strings (index =
// verse - 1, null where the English has no such verse).

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BOOKS } from "./books.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [usfmDir, webVpl] = process.argv.slice(2);
if (!usfmDir || !webVpl) {
  console.error("usage: node tools/biblia/text.mjs <spabes_usfm dir> <engwebp_vpl.txt>");
  process.exit(1);
}

const BLOCK_STYLES = new Set(["p", "q1", "q2", "d", "qa", "sp"]);

function parseUsfm(src) {
  // Word-level markup carries machine Strong's numbers we don't use: keep the word.
  src = src.replace(/\\\+?w ([^|\\]*)\|[^\\]*\\\+?w\*/g, "$1");
  let name = (src.match(/^\\h (.+)$/m) || [])[1]?.trim();
  const chapters = [];
  let chapter = null;
  let block = null;
  const tokens = src.split(/(\\[a-z0-9]+\*?)/);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.startsWith("\\")) {
      const text = tok.replace(/\s+/g, " ");
      if (!chapter || !block || !text.trim()) continue;
      const last = block[block.length - 1];
      if (block.length > 1 && typeof last === "string") block[block.length - 1] = last + text;
      else block.push(text.replace(/^ /, ""));
      continue;
    }
    const marker = tok.slice(1);
    if (marker === "c") {
      const n = parseInt(tokens[++i], 10);
      chapter = [];
      chapters[n - 1] = chapter;
      block = null;
    } else if (marker === "v") {
      const m = tokens[++i].match(/^\s*(\d+)\s?([\s\S]*)$/);
      if (!block) chapter.push((block = ["p"]));
      block.push(parseInt(m[1], 10));
      const text = m[2].replace(/\s+/g, " ");
      if (text.trim()) block.push(text);
    } else if (BLOCK_STYLES.has(marker)) {
      if (!chapter) continue;
      chapter.push((block = [marker]));
    } else if (marker === "qs" || marker === "qs*") {
      // "Selah" stays as ordinary text in its verse.
    } else if (["id", "h", "toc1", "toc2", "toc3", "mt1", "mt2"].includes(marker)) {
      i++; // skip the marker's text
    } else {
      throw new Error(`unhandled USFM marker \\${marker}`);
    }
  }
  for (const ch of chapters) {
    for (const b of ch) {
      for (let k = 1; k < b.length; k++) {
        if (typeof b[k] === "string") b[k] = b[k].replace(/\s+/g, " ").trim();
      }
    }
    // empty blocks (a \p right before \c) carry nothing
    for (let k = ch.length - 1; k >= 0; k--) if (ch[k].length === 1) ch.splice(k, 1);
  }
  return { name, chapters };
}

const files = readdirSync(usfmDir).filter((f) => f.endsWith(".usfm"));
// The VPL file uses its own book codes (JOH, not JHN), in canonical order.
const english = new Map();
const vplCodes = [];
for (const line of readFileSync(webVpl, "utf8").split("\n")) {
  const m = line.match(/^([1-3A-Z]{3}) (\d+):(\d+) (.*)$/);
  if (!m) continue;
  const [, code, c, v, text] = m;
  if (vplCodes[vplCodes.length - 1] !== code) vplCodes.push(code);
  const book = BOOKS[vplCodes.length - 1][0];
  if (!english.has(book)) english.set(book, []);
  const chs = english.get(book);
  (chs[c - 1] ||= [])[v - 1] = text.trim();
}
if (vplCodes.length !== BOOKS.length) throw new Error(`English text has ${vplCodes.length} books`);

mkdirSync(join(root, "static/biblia/es"), { recursive: true });
mkdirSync(join(root, "static/biblia/en"), { recursive: true });
const books = [];
for (const [id, en, abbr] of BOOKS) {
  const file = files.find((f) => f.includes(`-${id}`));
  if (!file) throw new Error(`no USFM file for ${id}`);
  const { name, chapters } = parseUsfm(readFileSync(join(usfmDir, file), "utf8"));
  writeFileSync(join(root, `static/biblia/es/${id}.json`), JSON.stringify(chapters));
  const enChapters = english.get(id).map((vs) => Array.from(vs, (t) => t ?? null));
  if (enChapters.length !== chapters.length) throw new Error(`${id}: ${chapters.length} chapters in Spanish, ${enChapters.length} in English`);
  writeFileSync(join(root, `static/biblia/en/${id}.json`), JSON.stringify(enChapters));
  books.push({ id, es: name, en, chapters: chapters.length, abbr });
}
writeFileSync(join(root, "data/biblia.json"), JSON.stringify({ books }, null, 1) + "\n");
console.log(`${books.length} books, ${books.reduce((s, b) => s + b.chapters, 0)} chapters`);
