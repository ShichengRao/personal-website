// Builds the /biblia/ page's word meanings: for every word in the Spanish text, its
// dictionary form, what form it is (person, tense) and a few English meanings.
//
//   node tools/biblia/glossary.mjs <kaikki Spanish jsonl>
//
// The dictionary is English Wiktionary's Spanish section as extracted by
// kaikki.org (https://kaikki.org/dictionary/Spanish/), CC BY-SA 4.0. Run
// tools/biblia/text.mjs first: this reads static/biblia/es and static/biblia/en.
//
// Writes static/biblia/dict/<n>.json, SHARDS files keyed by the word exactly as it
// appears in the text; a capitalized word lands in the same file as its lowercase
// form. A value is a list of readings [headword, part of speech, form, meanings,
// English, other English, alternatives]:
//   "dijo": [["decir", "verb", "él/ella/usted, past", ["to say, to tell", ...], "said"]]
// English is the word in English in the same shape (tense, person, plural), which
// the page swaps in for the Spanish; "" where nothing fits (se). Other English, when
// there are some, is a list of [English, when], the first that fits winning:
//   "after:se" (or "after:me|se"): the word before is that pronoun, for a verb that
//     means something else with it (se levantó: "got up", not "lifted")
//   "after:det": the word before is el, un, su, este..., so it's the noun (los judíos: "Jews")
//   "after:art": the same, only articles and possessives, for a word that's usually a
//     verb (el vino: "the wine", but este vino a Jesús: "this one came")
//   "after:prep": the word before is a preposition (con él: "him")
//   "before:verb": the word after is a verb (los rodeó: "them")
//   "!pp": the word after isn't a participle, for haber (había un hombre: "there was")
// Alternatives are other English found in the English of the verses the word is in;
// the page uses whichever the verse at hand has (fue: "went" where it's ir).
// Names Wiktionary doesn't have are matched to the English name in the same verses.

import { createReadStream, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BOOKS } from "./books.mjs";
import { headWord, verbFor, pluralOf, reflexivePronoun, OBJECTS, REFLEXIVE, FIXED, FIXED_ALTS, EXISTENTIAL, NEXT_TO, ARTICLES, DETERMINERS, PREPOSITIONS, STOPWORDS } from "./english.mjs";

const SHARDS = 32; // the page's shardOf() must match
function shardOf(word) {
  let h = 0;
  for (const ch of word.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % SHARDS;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dump = process.argv[2];
if (!dump) {
  console.error("usage: node tools/biblia/glossary.mjs <kaikki.org-dictionary-Spanish.jsonl>");
  process.exit(1);
}

// Meanings written by hand: words Wiktionary lacks that come up often enough to
// matter, and common words whose first Wiktionary sense is the wrong one here
// (misericordia as "misericord", nos as the plural of no). These replace whatever
// Wiktionary gives, for the word and its capitalized form.
// Headwords whose Wiktionary senses start with the wrong one for this text; every
// form of them (tierras, carros) gets these meanings.
const HEAD = Object.assign(Object.create(null), {
  "misericordia|noun": ["mercy, compassion"],
  "plata|noun": ["silver", "money"],
  "tierra|noun": ["land, country", "earth, ground, soil", "the Earth"],
  "pueblo|noun": ["people, nation", "town, village"],
  "levita|noun": ["Levite, from the tribe of Levi, who served at the tabernacle and temple"],
  "oración|noun": ["prayer", "sentence (in grammar)"],
  "juicio|noun": ["judgment", "trial", "good sense"],
  "campamento|noun": ["camp, encampment"],
  "servidor|noun": ["servant"],
  "codo|noun": ["elbow", "cubit, a measure of about 45 cm (18 inches)"],
  "holocausto|noun": ["burnt offering", "holocaust"],
  "carro|noun": ["chariot", "cart, wagon"],
  "ganado|noun": ["livestock, cattle, flocks and herds"],
  "desgracia|noun": ["misfortune, disaster", "disgrace"],
  "señor|noun": ["lord, master", "sir, mister", "gentleman"],
  "fin|noun": ["end", "purpose, goal"],
  "llamar|verb": ["to call", "to summon", "to knock (on a door)"],
  "hacer|verb": ["to make, to do", "to cause", "to perform"],
  "rodear|verb": ["to surround", "to go around"],
  "maestro|noun": ["teacher", "master"],
  "vientre|noun": ["womb", "belly"],
  "campo|noun": ["field", "countryside"],
  "justicia|noun": ["righteousness, justice", "fairness"],
  "bastón|noun": ["staff", "walking stick"],
  "consuelo|noun": ["comfort, consolation"],
  "pañal|noun": ["swaddling cloth", "diaper"],
  "alojamiento|noun": ["inn, lodging"],
  "manso|adj": ["meek, gentle", "tame"],
  "principio|noun": ["beginning, start", "principle"],
  "cuerno|noun": ["horn"],
  "fiesta|noun": ["feast, festival", "party, celebration"],
  "noticia|noun": ["news", "notice"],
  "acaso|adv": ["perhaps, maybe", "by any chance (in a question)"],
  "valor|noun": ["courage, bravery", "value, worth"],
  "pesebre|noun": ["manger, feeding trough", "nativity scene"],
});

const OWN = Object.assign(Object.create(null), {
  selah: [["Selah", "word", "", ["a Hebrew word in the Psalms, probably a pause in the music"]]],
  efa: [["efa", "noun", "", ["ephah, a dry measure of about 22 liters (5 gallons)"]]],
  masquil: [["masquil", "word", "", ["maskil, a Hebrew word in psalm titles, maybe a teaching song"]]],
  mictam: [["mictam", "word", "", ["miktam, a Hebrew word in psalm titles, meaning uncertain"]]],
  "hómer": [["hómer", "noun", "", ["homer, a dry measure of about 220 liters"]]],
  "ómer": [["ómer", "noun", "", ["omer, a dry measure of about 2 liters"]]],
  geras: [["gera", "noun", "plural", ["gerah, the smallest weight of silver, 1/20 of a shekel"]]],
  "dáricos": [["dárico", "noun", "plural", ["daric, a Persian gold coin"]]],
  "incircuncisión": [["incircuncisión", "noun", "", ["uncircumcision; not being circumcised"]]],
  "incorrupción": [["incorrupción", "noun", "", ["incorruption; not decaying"]]],
  consiervo: [["consiervo", "noun", "", ["fellow servant"]]],
  consiervos: [["consiervo", "noun", "plural", ["fellow servant"]]],
  su: [["su", "det", "", ["his, her, its, their, your (usted/ustedes)"]]],
  sus: [["su", "det", "plural", ["his, her, its, their, your (usted/ustedes)"]]],
  mis: [["mi", "det", "plural", ["my"]]],
  tus: [["tu", "det", "plural", ["your (tú)"]]],
  les: [["les", "pron", "", ["to them, for them", "to you, for you (ustedes)"]]],
  nos: [["nos", "pron", "", ["us, to us, ourselves"]]],
  me: [["me", "pron", "", ["me, to me, myself"]]],
  te: [["te", "pron", "", ["you, to you, yourself (tú)"]]],
  ellos: [["ellos", "pron", "", ["they, them"]]],
  cuernos: [["cuerno", "noun", "plural", ["horn"]]],
  embargo: [["sin embargo", "phrase", "", ["however, nevertheless"]], ["embargo", "noun", "", ["embargo, seizure"]]],
  mira: [["mirar", "verb", "command (tú) / él/ella/usted, present", ["to look, to look at", "to watch"]], ["mira", "noun", "", ["sight, aim", "purpose"]]],
  reina: [["reina", "noun", "", ["queen"]], ["reinar", "verb", "él/ella/usted, present", ["to reign, to rule"]]],
  mayor: [["mayor", "adj", "", ["older, oldest", "greater, greatest", "bigger, biggest"]], ["mayor", "noun", "", ["adult", "chief, head"]]],
  "perdón": [["perdón", "noun", "", ["forgiveness, pardon"]], ["perdón", "intj", "", ["sorry, excuse me"]]],
});

// ---- the Spanish text: every word, how often, and whether it's capitalized mid-sentence

const freq = new Map(); // exact form -> count
const midCap = new Map(); // lowercase form -> [capitalized mid-sentence, lowercase]
const verseWords = new Map(); // "GEN 1:1" -> Set of exact forms
for (const [id] of BOOKS) {
  const chapters = JSON.parse(readFileSync(join(root, `static/biblia/es/${id}.json`), "utf8"));
  chapters.forEach((blocks, ci) => {
    let verse = 0;
    let sentenceStart = true;
    for (const b of blocks) {
      if (b[0] !== "p" && b[0] !== "q1" && b[0] !== "q2") {
        // headings: count the words but don't align them to verses
        for (const w of String(b[1] ?? "").match(/\p{L}+/gu) || []) freq.set(w, (freq.get(w) || 0) + 1);
        continue;
      }
      for (const item of b.slice(1)) {
        if (typeof item === "number") {
          verse = item;
          sentenceStart = true;
          continue;
        }
        const key = `${id} ${ci + 1}:${verse}`;
        if (!verseWords.has(key)) verseWords.set(key, new Set());
        for (const m of item.matchAll(/(\p{L}+)|([.!?:»])/gu)) {
          if (m[2]) {
            sentenceStart = true;
            continue;
          }
          const w = m[1];
          freq.set(w, (freq.get(w) || 0) + 1);
          verseWords.get(key).add(w);
          if (!sentenceStart) {
            const lc = w.toLowerCase();
            const c = midCap.get(lc) || [0, 0];
            c[w === lc ? 1 : 0]++;
            midCap.set(lc, c);
          }
          sentenceStart = false;
        }
      }
    }
  });
}
console.error(`${freq.size} distinct words`);

// ---- Wiktionary entries for those words, and for the headwords they point to

async function pass(words) {
  const got = [];
  const rl = createInterface({ input: createReadStream(dump), crlfDelay: Infinity });
  for await (const line of rl) {
    const m = line.match(/"word": "((?:[^"\\]|\\.)*)", "lang": "Spanish"/);
    if (!m || !words.has(JSON.parse(`"${m[1]}"`))) continue;
    const d = JSON.parse(line);
    if (words.has(d.word)) got.push(d);
  }
  return got;
}

const wanted = new Set();
for (const w of freq.keys()) {
  wanted.add(w);
  wanted.add(w.toLowerCase());
}
// verbs with pronouns attached that Wiktionary lacks: also look up the bare verb
const CLITICS = ["selos", "selas", "selo", "sela", "noslo", "nosla", "noslos", "noslas", "melo", "mela", "melos", "melas", "telo", "tela", "telos", "telas", "los", "las", "les", "nos", "lo", "la", "le", "me", "te", "se", "os"];
const unaccent = (s) => s.replace(/[áéíóú]/g, (c) => "aeiou"["áéíóú".indexOf(c)]);
function cliticSplits(w) {
  const out = [];
  for (const c of CLITICS) {
    if (w.length > c.length + 2 && w.endsWith(c)) out.push([unaccent(w.slice(0, -c.length)), c], [w.slice(0, -c.length), c]);
  }
  return out;
}
for (const w of freq.keys()) {
  for (const [stem] of cliticSplits(w.toLowerCase())) wanted.add(stem);
  wanted.add(unaccent(w.toLowerCase())); // crió is now spelled crio
}

let entries = await pass(wanted);
// follow "plural of", "inflection of" and the like to their headwords, a few levels deep
const seen = new Set(wanted);
for (let level = 0, fresh = entries; level < 3; level++) {
  const next = new Set();
  for (const d of fresh) for (const s of d.senses || []) for (const f of [...(s.form_of || []), ...(s.alt_of || [])]) if (!seen.has(f.word)) next.add(f.word);
  if (!next.size) break;
  next.forEach((w) => seen.add(w));
  fresh = await pass(next);
  entries = entries.concat(fresh);
}
console.error(`${entries.length} Wiktionary entries`);

const byWord = new Map();
for (const d of entries) {
  if (!byWord.has(d.word)) byWord.set(d.word, []);
  byWord.get(d.word).push(d);
}

// ---- turning entries into readings

// Senses never shown, senses shown only when nothing better is left, and regions
// whose senses count as ordinary (the text is Latin American Spanish).
const DROP_TAGS = new Set(["slang", "vulgar", "derogatory", "offensive", "ethnic", "misspelling", "with-voseo", "pronunciation-spelling"]);
const DEMOTE_TAGS = new Set(["obsolete", "archaic", "rare", "dated", "proscribed", "nonstandard"]);
const HOME_REGIONS = new Set(["Latin-America", "Mexico", "US", "Central-America", "South-America"]);
const isRegion = (t) => /^[A-Z]/.test(t) && !["Judaism", "Christianity", "Biblical"].includes(t);

function senseRank(s) {
  if (!s.glosses?.length) return 9;
  if (/given name|surname|letter-case|abbreviation of|initialism of|\bletter\b.*\balphabet|name of the .*letter|the (Greek|Hebrew) letter|^(Senses relating to|Figurative senses)/i.test(meaning(s))) return 9;
  const tags = s.tags || [];
  if (tags.includes("letter")) return 9;
  if (tags.some((t) => DROP_TAGS.has(t))) return 9;
  const regions = tags.filter(isRegion);
  if (tags.some((t) => DEMOTE_TAGS.has(t))) return 2;
  if (/sexual|intercourse|genitals|genitalia/i.test(meaning(s))) return 9;
  if (regions.length && !regions.some((t) => HOME_REGIONS.has(t))) return 1;
  if (tags.includes("colloquial") || tags.includes("informal")) return 1;
  return 0;
}
const usable = (senses) => senses.map((s, i) => ({ s, r: senseRank(s), i })).filter((x) => x.r < 9).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.s);
const isPlain = (s) => !s.form_of && !s.alt_of;

function shorten(g) {
  g = g.replace(/\s+/g, " ").trim();
  if (g.length <= 70) return g;
  const cut = g.lastIndexOf(" ", 67);
  return g.slice(0, cut > 30 ? cut : 67).replace(/[,;:(]+$/, "") + "…";
}
// Wiktionary nests senses ("Senses relating to motion" > "to come"): the last gloss is the meaning.
function meaning(s) {
  return s.glosses[s.glosses.length - 1];
}
// obsolete, archaic and the like only when there's nothing else
function glossList(senses) {
  const best = senses.filter((s) => senseRank(s) < 2);
  return [...new Set((best.length ? best : senses).map((s) => shorten(meaning(s))))].slice(0, 3);
}

// "apocopic form of grande; great, grand" -> ["grande", "great, grand"]
function altOf(s) {
  const m = s.glosses[0].match(/^apocopic form of (\S+?)[,;:]?(?:\s+\((.+)\)|[,;:]\s*(.+))?$/i);
  return m ? [m[1], m[2] || m[3] || ""] : [s.alt_of[0].word, ""];
}

// What a verb means with its reflexive pronoun (levantarse: "get up"): written by hand
// for the common ones, else Wiktionary's first reflexive sense. Not poder: "se puede"
// is "one can", not its reflexive sense.
function reflexiveOf(word, d) {
  if (d.pos !== "verb") return null;
  if (REFLEXIVE[word]) return REFLEXIVE[word];
  if (word === "poder") return null;
  const s = usable(d.senses || []).find((x) => isPlain(x) && (x.tags || []).some((t) => t === "reflexive" || t === "pronominal"));
  return s ? headWord(meaning(s), "verb") : null;
}

// The headword and meanings a word leads to, following "form of" links when the
// word itself has no meanings of its own (llevada -> llevado -> llevar).
function resolve(word, pos, depth = 0) {
  const ds = byWord.get(word) || [];
  const order = [...ds.filter((d) => d.pos === pos), ...ds.filter((d) => d.pos !== pos)];
  for (const d of order) {
    const plain = usable(d.senses || []).filter(isPlain);
    const own = HEAD[`${word}|${d.pos}`];
    if (plain.length) return { head: word, meanings: own || glossList(plain), demoted: !own && senseRank(plain[0]) >= 2, reflexive: reflexiveOf(word, d) };
    // a short form with its own meaning (mi = my) before trying other parts of speech
    const short = usable(d.senses || []).find((s) => s.alt_of && altOf(s)[1]);
    if (short) return { head: word, meanings: [shorten(altOf(short)[1])] };
  }
  if (depth >= 3) return null;
  for (const d of order) {
    for (const s of usable(d.senses || [])) {
      if (s.alt_of && senseRank(s) >= 2) continue; // an old spelling of something else (far = hacer)
      const next = s.form_of?.[0]?.word || (s.alt_of && altOf(s)[0]);
      const r = next && next !== word && resolve(next, d.pos, depth + 1);
      if (r) return r;
    }
  }
  return null;
}
const PERSON = {
  "first-person singular": "yo",
  "second-person singular": "tú",
  "third-person singular": "él/ella/usted",
  "first-person plural": "nosotros",
  "second-person plural": "vosotros",
  "third-person plural": "ellos/ustedes",
};

function formLabel(tags, gloss) {
  const t = new Set(tags);
  const persons = [];
  for (const p of ["first-person", "second-person", "third-person"]) {
    if (!t.has(p)) continue;
    for (const n of ["singular", "plural"]) if (t.has(n)) persons.push(PERSON[`${p} ${n}`]);
  }
  let tense = "";
  if (t.has("imperative")) {
    tense = "command";
  } else if (t.has("subjunctive")) {
    tense = t.has("imperfect") ? "past subjunctive" : t.has("future") ? "future subjunctive" : "subjunctive";
  } else if (t.has("preterite") && t.has("present")) {
    tense = "present or past";
  } else if (t.has("preterite")) {
    tense = "past";
  } else if (t.has("imperfect")) {
    tense = "past, ongoing";
  } else if (t.has("future")) {
    tense = "future";
  } else if (t.has("conditional")) {
    tense = "would";
  } else if (t.has("present")) {
    tense = "present";
  } else if (t.has("gerund")) {
    tense = "-ing form";
  } else if (t.has("participle")) {
    tense = "past participle";
  } else if (t.has("infinitive")) {
    tense = "infinitive";
  }
  const gender = t.has("feminine") && !t.has("masculine") ? "feminine" : "";
  const number = t.has("plural") && !persons.length ? "plural" : "";
  let label;
  if (tense === "command") label = persons.length ? `command (${persons.join(", ")})` : "command";
  else if (persons.length) label = `${persons.join(", ")}, ${tense}`.replace(/, $/, "");
  else label = [tense, gender, number].filter(Boolean).join(", ");
  const clitic = (gloss.match(/combined with (\w+)/) || [])[1];
  if (clitic) label += ` + ${clitic}`;
  return label;
}

// Readings for one dictionary word (exact case), before ranking.
function readingsFor(word) {
  const out = [];
  for (const d of byWord.get(word) || []) {
    const senses = usable(d.senses || []);
    const plain = senses.filter(isPlain);
    if (plain.length) {
      const own = { head: word, pos: d.pos, labels: [], meanings: HEAD[`${word}|${d.pos}`] || glossList(plain) };
      if (d.pos === "verb") Object.assign(own, { tags: ["infinitive"], reflexive: reflexiveOf(word, d) });
      out.push(own);
    }
    for (const s of senses) {
      if (isPlain(s)) continue;
      const contraction = s.glosses[0].match(/^contraction of (.+?),? literally “(.+?)”/);
      if (contraction) {
        out.unshift({ head: word, pos: d.pos, labels: [contraction[1]], meanings: [contraction[2]] });
        continue;
      }
      let target = s.form_of?.[0]?.word;
      let label = formLabel(s.tags || [], s.glosses[0]);
      if (!target) {
        const [other, meaning] = altOf(s);
        if (meaning) {
          // a short form with its own meaning: gran = great
          const apocopic = (s.tags || []).includes("apocopic");
          out.push({ head: word, pos: d.pos, labels: apocopic ? [`short for ${other}`] : [], meanings: [shorten(meaning)] });
          continue;
        }
        target = other;
        label = "";
      }
      const found = resolve(target, d.pos);
      if (!found) continue; // points at a headword we can't explain
      let r = out.find((x) => x.head === found.head && x.pos === d.pos && x.formOf);
      if (!r) {
        const clitic = (s.glosses[0].match(/combined with (\w+)/) || [])[1];
        r = { head: found.head, pos: d.pos, labels: [], meanings: found.meanings, formOf: true, demoted: found.demoted, tags: s.tags || [], tagSets: [], clitic, reflexive: found.reflexive };
        out.push(r);
      }
      if (r.tagSets && !r.tagSets.some((t) => t.join() === (s.tags || []).join())) r.tagSets.push(s.tags || []);
      if (label && !r.labels.includes(label)) r.labels.push(label);
    }
  }
  return out;
}

// How common each headword is in this text, to put the likely reading first and drop
// far-fetched ones (existe as a form of the old verb exir, pero as a form of perar).
// Each word's count is split among the headwords it could be, the word's own first
// Wiktionary sense weighing most, then re-split once by how common each headword
// turned out to be. (More rounds snowball: la the musical note would collect every
// las and outrank la the article.)
const candidates = new Map();
for (const w of freq.keys()) {
  candidates.set(w, [...readingsFor(w), ...(w !== w.toLowerCase() ? readingsFor(w.toLowerCase()) : [])]);
}
let headCount = new Map();
for (let round = 0; round < 2; round++) {
  const next = new Map();
  for (const [w, n] of freq) {
    const weights = new Map();
    const firstPlain = candidates.get(w).find((r) => !r.formOf);
    for (const r of candidates.get(w)) {
      const h = `${r.head.toLowerCase()}|${r.pos}`;
      const prior = (r === firstPlain ? 4 : 1) * (r.demoted ? 0.1 : 1);
      const seen = round ? headCount.get(h) || 0 : 1;
      weights.set(h, Math.max(weights.get(h) || 0, prior * seen));
    }
    const total = [...weights.values()].reduce((a, b) => a + b, 0);
    if (!total) continue;
    for (const [h, wt] of weights) next.set(h, (next.get(h) || 0) + (n * wt) / total);
  }
  headCount = next;
}

function nameLike(w) {
  const lc = w.toLowerCase();
  const [cap, low] = midCap.get(lc) || [0, 0];
  return w !== lc && cap > 0 && cap >= low;
}

function rank(w, rs) {
  const lc = w.toLowerCase();
  const named = nameLike(w);
  // a capitalized word mid-sentence is a name, never a conjugated verb (Manasés)
  if (named) rs = rs.filter((r) => !(r.formOf && r.pos === "verb"));
  // how likely this word is each reading: the same weighting as the counts above
  const firstPlain = rs.find((r) => !r.formOf);
  const score = (r) => {
    let s = (headCount.get(`${r.head.toLowerCase()}|${r.pos}`) || 0) * (r === firstPlain ? 4 : 1);
    if (r.demoted) s *= 0.1; // its headword is obsolete or archaic
    const capHead = r.head[0] !== r.head[0].toLowerCase();
    if (w !== lc) s *= capHead === named ? 4 : 1;
    else if (capHead) s = 0; // a lowercase word isn't the name
    return s;
  };
  const scored = rs.map((r) => ({ r, s: score(r) })).filter((x) => x.s > 0 || rs.length === 1);
  scored.sort((a, b) => b.s - a.s);
  const top = scored[0]?.s || 0;
  // a word's own meanings always stay; far-fetched "form of" readings go
  // one reading per headword: como the adverb, conjunction and preposition together
  const kept = [];
  for (const { r } of scored.filter((x, i) => i === 0 || !x.r.formOf || x.s >= top * 0.08)) {
    const same = kept.find((k) => k.head === r.head && k.formOf === r.formOf && k.labels.join() === r.labels.join());
    if (!same) {
      kept.push({ ...r, meanings: [...r.meanings], parts: [r] });
      continue;
    }
    same.parts.push(r);
    if (!same.pos.split(" · ").includes(r.pos)) same.pos += ` · ${r.pos}`;
    for (const m of r.meanings) if (same.meanings.length < 3 && !same.meanings.includes(m)) same.meanings.push(m);
  }
  const first = kept[0];
  return kept.slice(0, first && first.pos === "name" ? 2 : 3);
}

// ---- the word in English, in the same shape

function englishOf(lc, r, meaning = r.meanings[0] || "", tags = r.tags) {
  const pos = r.pos.split(" · ")[0];
  if (pos === "name") return headWord(meaning, "name");
  if (pos === "verb" && tags) {
    const clitic = r.clitic && OBJECTS[r.clitic] !== undefined ? r.clitic : null;
    // levántate, arrepiéntanse: the pronoun attached is the verb's own, so it's the reflexive meaning
    const own = clitic ? reflexivePronoun(tags).split("|").includes(clitic) : tags.includes("reflexive");
    if (own && r.reflexive) return verbFor(r.reflexive, tags);
    return verbFor(headWord(meaning, "verb"), tags, clitic ? OBJECTS[clitic] : "");
  }
  const word = headWord(meaning, pos);
  if (pos === "noun" && ((tags || []).includes("plural") || (r.labels || []).some((l) => /plural/.test(l)))) return pluralOf(word);
  return word;
}

// Every English the word could be: each reading, each of its first meanings and their
// alternatives ("to say, to tell"), in each grammar the form can have (toma: "takes",
// "take"). The page picks the one the English verse uses.
function candidatesOf(lc, rs) {
  const out = [];
  const add = (e) => e && !out.includes(e) && out.push(e);
  for (const r of rs) {
    for (const p of r.parts || [r]) {
      for (const tags of p.tagSets?.length ? p.tagSets : [p.tags]) {
        for (const m of p.meanings.slice(0, 3)) {
          for (const alt of m.replace(/\([^)]*\)?/g, "").split(/[,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 3)) add(englishOf(lc, p, alt, tags));
        }
        if (p.pos === "verb" && p.reflexive && tags) add(verbFor(p.reflexive, tags));
      }
    }
  }
  return out;
}

function otherEnglish(lc, rs) {
  const out = [];
  if (NEXT_TO[lc]) out.push(...NEXT_TO[lc]);
  if (EXISTENTIAL[lc]) out.push([EXISTENTIAL[lc], "!pp"]);
  const r = rs[0];
  if (r.pos === "verb" && r.tags && !r.clitic && !r.tags.includes("reflexive") && r.reflexive) {
    const english = verbFor(r.reflexive, r.tags);
    if (english !== englishOf(lc, r)) out.push([english, `after:${reflexivePronoun(r.tags)}`]);
  }
  // after el, un, su...: the noun, when the first reading isn't one (los judíos, el camino)
  const parts = rs.flatMap((x) => x.parts || [x]);
  const noun = parts.find((x) => x.pos === "noun");
  if (noun && (r.parts || [r])[0].pos !== "noun") {
    const english = englishOf(lc, noun);
    if (english && english !== englishOf(lc, r)) out.push([english, r.pos === "verb" ? "after:art" : "after:det"]);
  }
  return out.length ? out : null;
}

const dict = new Map();
const englishCandidates = new Map(); // word -> every English it could be
const missing = [];
for (const [w] of freq) {
  const lc = w.toLowerCase();
  if (OWN[lc]) {
    const rows = OWN[lc].map((r, i) => [...r, i === 0 && FIXED[lc] !== undefined ? FIXED[lc] : englishOf(lc, { head: r[0], pos: r[1], labels: [r[2]], meanings: r[3] })]);
    if (NEXT_TO[lc]) rows[0].push(NEXT_TO[lc]);
    if (FIXED[lc] !== undefined) englishCandidates.set(w, [FIXED[lc], ...(FIXED_ALTS[lc] || [])]);
    dict.set(w, rows);
    continue;
  }
  let rs = rank(w, candidates.get(w));
  if (!rs.length && !nameLike(w) && unaccent(lc) !== lc) rs = rank(lc, readingsFor(unaccent(lc)));
  if (!rs.length && !nameLike(w)) {
    // a verb with pronouns attached: alábenlo = alaben + lo
    for (const [stem, clitic] of cliticSplits(lc)) {
      const base = readingsFor(stem).filter((r) => r.pos === "verb" && r.formOf);
      if (base.length) {
        rs = base.slice(0, 2).map((r) => ({ ...r, clitic, labels: r.labels.slice(0, 2).map((l) => `${l} + ${clitic}`) }));
        break;
      }
    }
  }
  if (rs.length) {
    dict.set(w, rs.map((r, i) => {
      const english = i === 0 && FIXED[lc] !== undefined ? FIXED[lc] : englishOf(lc, r);
      const other = i === 0 ? otherEnglish(lc, rs) : null;
      const row = [r.head, r.pos, r.labels.slice(0, 3).join(" / "), r.meanings, english];
      if (i === 0) englishCandidates.set(w, FIXED[lc] !== undefined ? [FIXED[lc], ...(FIXED_ALTS[lc] || [])] : candidatesOf(lc, rs));
      return other ? [...row, other] : row;
    }));
  }
  else missing.push(w);
}

// ---- names: match each missing word to the English name it shares verses with

const enCount = new Map();
const enVerse = new Map();
for (const [id] of BOOKS) {
  const chapters = JSON.parse(readFileSync(join(root, `static/biblia/en/${id}.json`), "utf8"));
  chapters.forEach((vs, ci) =>
    vs.forEach((t, vi) => {
      if (!t) return;
      const names = new Set(t.match(/\b\p{Lu}[\p{L}]+/gu) || []);
      enVerse.set(`${id} ${ci + 1}:${vi + 1}`, names);
      for (const n of names) enCount.set(n, (enCount.get(n) || 0) + 1);
    }),
  );
}
const missingSet = new Set(missing);
const esVerses = new Map(); // missing word -> verse keys
for (const [key, ws] of verseWords) {
  for (const w of ws) if (missingSet.has(w)) (esVerses.get(w) || esVerses.set(w, []).get(w)).push(key);
}
function bigrams(s) {
  s = unaccent(s.toLowerCase()).replace(/qu/g, "k").replace(/[^a-zñ]/g, "");
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function similarity(a, b) {
  const x = bigrams(a);
  const y = bigrams(b);
  let both = 0;
  for (const g of x) if (y.has(g)) both++;
  return x.size + y.size ? (2 * both) / (x.size + y.size) : 0;
}
let named = 0;
const stillMissing = [];
for (const w of missing) {
  const keys = esVerses.get(w) || [];
  const co = new Map();
  for (const k of keys) for (const n of enVerse.get(k) || []) co.set(n, (co.get(n) || 0) + 1);
  let best = null;
  for (const [n, c] of co) {
    const cos = c / Math.sqrt(keys.length * enCount.get(n));
    const sim = similarity(w, n);
    const score = cos + 0.5 * sim;
    if (cos >= 0.5 && (sim >= 0.3 || (keys.length >= 4 && cos >= 0.8)) && (!best || score > best.score)) best = { n, score };
  }
  if (best) {
    dict.set(w, [[w, "name", "", [best.n], best.n]]);
    named++;
  } else stillMissing.push(w);
}

// ---- the English the English Bible uses: of a word's possible English, the one found
// most often in the English of the verses it's in becomes its default (judíos: "Jews",
// not "Jewish"). The others found there are kept, so the page can pick the one in the
// verse at hand (fue: "went" or "was").

const enText = new Map();
for (const [id] of BOOKS) {
  const chapters = JSON.parse(readFileSync(join(root, `static/biblia/en/${id}.json`), "utf8"));
  chapters.forEach((vs, ci) =>
    vs.forEach((t, vi) => t && enText.set(`${id} ${ci + 1}:${vi + 1}`, ` ${t.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ")} `)),
  );
}
const occurs = new Map(); // word -> the verses it's in
for (const [key, ws] of verseWords) for (const w of ws) (occurs.get(w) || occurs.set(w, []).get(w)).push(key);
let rechosen = 0;
const STOP = new Set(STOPWORDS);
for (const [w, found] of englishCandidates) {
  // hand-picked alternatives (su: his, her) stay; otherwise none of the too-common words
  const fixed = FIXED[lc(w)] !== undefined;
  const cands = fixed ? found : found.filter((c, i) => i === 0 || !STOP.has(c.toLowerCase()));
  const row = dict.get(w)?.[0];
  if (!row) continue;
  const variants = row[5] || [];
  const all = [...new Set([...cands, ...variants.map(([e]) => e)])];
  const hits = new Map(all.map((c) => [c, 0]));
  for (const key of occurs.get(w) || []) {
    const text = enText.get(key);
    if (text) for (const c of all) if (text.includes(` ${c.toLowerCase()} `)) hits.set(c, hits.get(c) + 1);
  }
  // a noun the English never uses for this word is a sense that doesn't belong here (los mansos: "bellwethers")
  const kept = variants.filter(([e, when]) => !["after:det", "after:art"].includes(when) || (hits.get(e) > 0 && !STOP.has(e.toLowerCase())));
  if (kept.length !== variants.length) row[5] = kept.length ? kept : null;
  if (cands.length < 2) continue;
  const ranked = [...cands].sort((a, b) => hits.get(b) - hits.get(a)); // ties keep Wiktionary's order
  const best = ranked[0];
  if (!fixed && best !== row[4] && hits.get(best) >= 3 && hits.get(best) >= 1.5 * (hits.get(row[4]) ?? 0) + 1) {
    row[4] = best;
    rechosen++;
  }
  // only English the English Bible really uses for this word: in at least a fifth of its verses
  const verses = (occurs.get(w) || []).length;
  const alts = ranked.filter((c) => c !== row[4] && (fixed ? hits.get(c) > 0 : hits.get(c) >= 2 && hits.get(c) >= 0.2 * verses)).slice(0, 6);
  if (alts.length) {
    row[5] = row[5] ?? null;
    row[6] = alts;
  }
}
console.error(`${rechosen} words take a different English after checking the English Bible`);
function lc(w) {
  return w.toLowerCase();
}

// ---- write the shards

const shards = Array.from({ length: SHARDS }, () => ({}));
for (const [w, rs] of dict) shards[shardOf(w)][w] = rs;
const outDir = join(root, "static/biblia/dict");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
let bytes = 0;
shards.forEach((s, i) => {
  const json = JSON.stringify(s);
  bytes += json.length;
  writeFileSync(join(outDir, `${i}.json`), json);
});

// the words the page's "after:det" and "after:prep" look for
writeFileSync(join(root, "data/bibliacontext.json"), JSON.stringify({ art: ARTICLES, det: DETERMINERS, prep: PREPOSITIONS, stop: STOPWORDS }) + "\n");

let covered = 0;
let total = 0;
for (const [w, n] of freq) {
  total += n;
  if (dict.has(w)) covered += n;
}
console.error(`${dict.size} words with meanings (${named} names matched to English), ${(bytes / 1e6).toFixed(1)} MB`);
console.error(`${((100 * covered) / total).toFixed(2)}% of words in the text covered; ${stillMissing.length} distinct words left without one`);
if (process.env.VERBOSE) console.error(stillMissing.sort((a, b) => freq.get(b) - freq.get(a)).slice(0, 150).map((w) => `${w}:${freq.get(w)}`).join(" "));
