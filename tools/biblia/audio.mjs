// Times every verse in AudioBiblia.org's recording of La Biblia en Español Sencillo,
// so the /biblia/ page can highlight the verse being read and start from any verse.
//
//   node tools/biblia/audio.mjs <folder of chapter MP3s>
//
// The MP3s are https://audiobiblia.org/spabes_ab/<BOOK><chapter>.mp3 (JHN03.mp3,
// PSA023.mp3), public domain. Needs ffmpeg. Run tools/biblia/text.mjs first: this
// reads static/biblia/es.
//
// The recording opens with the book and chapter ("Juan", "Capítulo 3"), then reads
// the text with a pause of about a second after every sentence, and no pause where
// one verse runs into the next mid-sentence. So the pauses split the audio into one
// piece per sentence. The sentences are matched to those pieces in order, checking
// each length against how long it should take to say, which also copes with the odd
// sentence read without a pause or a heading that isn't read. A verse that starts
// mid-sentence gets a time in proportion to how far into the sentence it starts.
//
// Writes static/biblia/audio/<BOOK>.json: per chapter, each verse's start time in
// hundredths of a second (index = verse - 1), or null for a chapter whose recording
// didn't match its text well enough to trust.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BOOKS } from "./books.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = process.argv[2];
if (!dir) {
  console.error("usage: node tools/biblia/audio.mjs <folder of chapter MP3s>");
  process.exit(1);
}
const run = promisify(execFile);
const { books } = JSON.parse(readFileSync(join(root, "data/biblia.json"), "utf8"));
const NUMBERS = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"];

// ---- the recording: stretches of speech between pauses

async function speech(file) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=noise=-40dB:d=0.5", "-f", "null", "-"], { maxBuffer: 1 << 26 });
  const duration = hms(stderr.match(/Duration: ([\d:.]+)/)[1]);
  const out = [];
  let from = 0;
  for (const m of stderr.matchAll(/silence_(start|end): ([\d.]+)/g)) {
    const t = Number(m[2]);
    if (m[1] === "start") {
      if (t - from > 0.05) out.push([from, t]);
      from = Infinity;
    } else from = t;
  }
  if (from < duration - 0.05) out.push([from, duration]);
  return out;
}
const hms = (s) => s.split(":").reduce((a, x) => a * 60 + Number(x), 0);

// ---- the text: sentences, and where each verse starts in them

const SENTENCE_END = /(?<=[.?!…][»”"')]*)\s+(?=\S)/u;

function pieces(id, c, blocks) {
  const out = [];
  const add = (text, starts = [], kind = "text") => {
    // split text (with verse starts at char offsets) into sentences
    let at = 0;
    for (const s of text.split(SENTENCE_END)) {
      const begin = text.indexOf(s, at);
      at = begin + s.length;
      out.push({ len: s.length, kind, starts: starts.filter((x) => x.at >= begin && x.at < at).map((x) => ({ v: x.v, at: x.at - begin })) });
    }
  };
  add(books.find((b) => b.id === id).es, [], "intro");
  add(`Capítulo ${NUMBERS[c] || c}`, [], "intro");
  let text = "";
  let starts = [];
  const flush = () => {
    if (text.trim()) add(text.trim(), starts);
    text = "";
    starts = [];
  };
  for (const [style, ...items] of blocks) {
    if (style !== "p" && style !== "q1" && style !== "q2") {
      flush();
      add(items.filter((x) => typeof x === "string").join(" "), [], "heading");
      continue;
    }
    for (const x of items) {
      if (typeof x === "number") starts.push({ v: x, at: text.length });
      else text += `${x} `;
    }
  }
  flush();
  return out;
}

// ---- matching sentences to the recording's pieces of speech

function align(segs, parts) {
  const N = segs.length;
  const M = parts.length;
  const dur = segs.map(([a, b]) => b - a);
  const speechTime = dur.reduce((a, b) => a + b, 0);
  const chars = parts.reduce((a, p) => a + p.len, 0);
  const rate = chars / speechTime; // characters a second, about 16
  const fit = (d, len) => {
    const p = len / rate;
    return (d - p) ** 2 / (0.1 * p + 0.3);
  };
  const INF = 1e18;
  const cost = Array.from({ length: N + 1 }, () => new Float64Array(M + 1).fill(INF));
  const from = Array.from({ length: N + 1 }, () => new Array(M + 1));
  cost[0][0] = 0;
  // steps: [segments used, sentences used, extra cost]
  const STEPS = [[1, 1, 0], [1, 2, 2], [1, 3, 5], [2, 1, 2], [3, 1, 5], [0, 1, null], [1, 0, null]];
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= M; j++) {
      const here = cost[i][j];
      if (here >= INF) continue;
      for (const [di, dj, extra] of STEPS) {
        const i2 = i + di;
        const j2 = j + dj;
        if (i2 > N || j2 > M) continue;
        let c;
        if (di === 0) c = parts[j].kind === "text" ? 6 + parts[j].len / rate : 1.5; // a sentence not heard
        else if (dj === 0) c = 6 + dur[i]; // speech that matches no sentence
        else {
          let d = 0;
          for (let k = i; k < i2; k++) d += dur[k];
          let len = 0;
          for (let k = j; k < j2; k++) len += parts[k].len;
          c = fit(d, len) + extra;
        }
        if (here + c < cost[i2][j2]) {
          cost[i2][j2] = here + c;
          from[i2][j2] = [i, j];
        }
      }
    }
  }
  const steps = [];
  for (let i = N, j = M; i || j; ) {
    const [pi, pj] = from[i][j];
    steps.push({ segs: [pi, i], parts: [pj, j] });
    [i, j] = [pi, pj];
  }
  steps.reverse();
  // how much of the text (not the book and chapter announcement) got its own stretch of speech
  const text = parts.filter((p) => p.kind !== "intro").length;
  const matched = steps.filter((s) => s.segs[1] - s.segs[0] === 1 && s.parts[1] - s.parts[0] === 1 && parts[s.parts[0]].kind !== "intro").length;
  return { steps, cost: cost[N][M] / Math.max(1, M), match: matched / Math.max(1, text), rate };
}

function verseTimes(segs, parts, steps, verses) {
  const times = new Array(verses).fill(null);
  for (const { segs: [s0, s1], parts: [p0, p1] } of steps) {
    if (s0 === s1) continue; // not heard
    const group = parts.slice(p0, p1);
    const total = group.reduce((a, p) => a + p.len, 0);
    const spoken = segs.slice(s0, s1);
    const speechLen = spoken.reduce((a, [x, y]) => a + y - x, 0);
    // a character position in these sentences -> a time in these stretches of speech
    const at = (pos) => {
      let left = (pos / total) * speechLen;
      for (const [x, y] of spoken) {
        if (left <= y - x) return x + left;
        left -= y - x;
      }
      return spoken[spoken.length - 1][1];
    };
    let offset = 0;
    for (const p of group) {
      for (const { v, at: a } of p.starts) if (v <= verses && times[v - 1] === null) times[v - 1] = at(offset + a);
      offset += p.len;
    }
  }
  return times.map((t) => (t === null ? null : Math.round(t * 100)));
}

// ---- every chapter

mkdirSync(join(root, "static/biblia/audio"), { recursive: true });
const jobs = [];
for (const [id] of BOOKS) {
  const chapters = JSON.parse(readFileSync(join(root, `static/biblia/es/${id}.json`), "utf8"));
  chapters.forEach((blocks, ci) => jobs.push({ id, c: ci + 1, blocks }));
}

const results = new Map();
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    const file = join(dir, `${job.id}${String(job.c).padStart(job.id === "PSA" ? 3 : 2, "0")}.mp3`);
    if (!existsSync(file)) {
      results.set(`${job.id} ${job.c}`, { missing: true });
      continue;
    }
    const segs = await speech(file);
    const parts = pieces(job.id, job.c, job.blocks);
    const verses = Math.max(...job.blocks.flatMap((b) => b.filter((x) => typeof x === "number")));
    const a = align(segs, parts);
    // trusted when nearly every sentence lined up with its own stretch of speech
    const ok = a.match >= 0.85 && a.cost < 1.5;
    results.set(`${job.id} ${job.c}`, { ...a, ok, times: ok ? verseTimes(segs, parts, a.steps, verses) : null });
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

let good = 0;
let bad = [];
let missing = 0;
for (const [id] of BOOKS) {
  const out = [];
  for (const job of jobs.filter((j) => j.id === id)) {
    const r = results.get(`${id} ${job.c}`);
    if (r.missing) missing++;
    else if (r.ok) good++;
    else bad.push(`${id} ${job.c} (match ${(r.match * 100).toFixed(0)}%, cost ${r.cost.toFixed(2)})`);
    out.push(r.times ?? null);
  }
  writeFileSync(join(root, `static/biblia/audio/${id}.json`), JSON.stringify(out));
}
console.error(`${good} chapters timed, ${bad.length} not trusted, ${missing} without a recording`);
if (bad.length) console.error(bad.join("\n"));
if (process.env.VERBOSE) {
  const rows = [...results].filter(([, r]) => !r.missing).map(([k, r]) => [k, r.match, r.cost, r.rate]);
  rows.sort((a, b) => a[1] - b[1]);
  console.error(rows.slice(0, 15).map(([k, m, c, r]) => `${k}: match ${(m * 100).toFixed(0)}% cost ${c.toFixed(2)} rate ${r.toFixed(1)}`).join("\n"));
}
