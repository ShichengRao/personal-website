import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { books } = JSON.parse(readFileSync(join(root, 'data', 'biblia.json'), 'utf8'));
const json = (...p) => JSON.parse(readFileSync(join(root, 'static', 'biblia', ...p), 'utf8'));
const layout = readFileSync(join(root, 'layouts', 'biblia', 'list.html'), 'utf8');

// the page's own word hash, run here as written there
const SHARDS = Number(layout.match(/const SHARDS = (\d+);/)[1]);
const shardOf = new Function('SHARDS', `${layout.match(/function shardOf\(word\) \{[\s\S]*?\n  \}/)[0]}; return shardOf;`)(SHARDS);

// the page's reference parser, run here as written there: "Juan 3:16" -> "JHN 3:16", or its error
const parseRef = new Function('books', 'book', `${layout.match(/\/\/ ref-parser:start([\s\S]*?)\/\/ ref-parser:end/)[1]}; return parseRef;`)(
  books,
  (id) => books.find((b) => b.id === id),
);
const go = (s) => {
  const r = parseRef(s);
  return r.error ? r.error : `${r.id} ${r.c}${r.v ? `:${r.v}` : ''}`;
};

test('every book has its Spanish and English text, chapter for chapter', () => {
  assert.equal(books.length, 66);
  for (const b of books) {
    const es = json('es', `${b.id}.json`);
    const en = json('en', `${b.id}.json`);
    assert.equal(es.length, b.chapters, b.id);
    assert.equal(en.length, b.chapters, b.id);
    for (const ch of es) assert.ok(ch.length > 0, `${b.id} has an empty chapter`);
  }
});

test('the page and the build split the dictionary the same way', () => {
  assert.equal(readdirSync(join(root, 'static', 'biblia', 'dict')).length, SHARDS);
  const shards = Array.from({ length: SHARDS }, (_, i) => json('dict', `${i}.json`));
  const words = new Set();
  for (const id of ['GEN', 'PSA', 'JHN', 'ROM']) {
    for (const ch of json('es', `${id}.json`)) {
      for (const b of ch) for (const x of b.slice(1)) if (typeof x === 'string') for (const w of x.match(/\p{L}+/gu) || []) words.add(w);
    }
  }
  let found = 0;
  for (const w of words) if (shards[shardOf(w)][w] || shards[shardOf(w)][w.toLowerCase()]) found++;
  assert.ok(found / words.size > 0.98, `${found} of ${words.size} words have a meaning`);
});

test('common words read the way the Bible uses them', () => {
  const look = (w) => json('dict', `${shardOf(w)}.json`)[w];
  assert.equal(look('bendijo')[0][0], 'bendecir');
  assert.equal(look('era')[0][0], 'ser');
  assert.deepEqual(look('Señor')[0].slice(0, 2), ['Señor', 'name']);
  assert.match(look('levántate')[0][2], /command \(tú\) \+ te/);
  assert.equal(look('Ezequías')[0][3][0], 'Hezekiah');
});

test('the Go box takes Spanish and English references', () => {
  const cases = {
    'Juan 3:16': 'JHN 3:16',
    'john 3:16': 'JHN 3:16',
    'Revelations 1:1': 'REV 1:1',
    'revelation 22': 'REV 22',
    'Apocalipsis 1:1': 'REV 1:1',
    'Psalm 23': 'PSA 23',
    'sal 23:1': 'PSA 23:1',
    '1 cor 13': '1CO 13',
    'First Corinthians 13:4': '1CO 13:4',
    '1st John 4:8': '1JN 4:8',
    'Primera de Juan 4:8': '1JN 4:8',
    '1 de Juan 4': '1JN 4',
    'II Kings 2': '2KI 2',
    '2 kgs 2:11': '2KI 2:11',
    'Song of Solomon 2': 'SNG 2',
    'Jas 1:5': 'JAS 1:5',
    'Mk 1:1': 'MRK 1:1',
    'Lk 2:7': 'LUK 2:7',
    'Phil 4:13': 'PHP 4:13',
    'Philemon 6': 'PHM 1:6',
    '3 Juan 2': '3JN 1:2',
    'Abdías 1:15': 'OBA 1:15',
    'Isaiah 40:31': 'ISA 40:31',
    'is 40:31': 'ISA 40:31',
    'Acts 2:38': 'ACT 2:38',
    'hch 2:38': 'ACT 2:38',
    'Génesis 1': 'GEN 1',
    'Jude 3': 'JUD 1:3',
    'Judges 6': 'JDG 6',
    'Juan 30': 'Juan has 21 chapters.',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(go(input), want, input);
  assert.match(go('xyz 3'), /No book called/);
});

test('the Go box forgives common misspellings and extra words', () => {
  const cases = {
    'Phillipians 4:13': 'PHP 4:13',
    'Galations 5:22': 'GAL 5:22',
    'Ecclesiastics 3:1': 'ECC 3:1',
    'Habbakuk 2:4': 'HAB 2:4',
    'Zachariah 9:9': 'ZEC 9:9',
    'Mathew 5:3': 'MAT 5:3',
    'Ezekial 37': 'EZK 37',
    'Collosians 3:23': 'COL 3:23',
    '1 Thesalonians 5:17': '1TH 5:17',
    'Palms 23': 'PSA 23',
    'Isiah 9:6': 'ISA 9:6',
    'Apocalypse 1': 'REV 1',
    'Sacarías 9:9': 'ZEC 9:9',
    'Gospel of John 3:16': 'JHN 3:16',
    'St. Matthew 5': 'MAT 5',
    'Acts of the Apostles 2': 'ACT 2',
    'Hechos de los Apóstoles 2': 'ACT 2',
    'Evangelio según San Juan 1': 'JHN 1',
    'Carta a los Romanos 8': 'ROM 8',
    'First Letter to the Corinthians 13': '1CO 13',
    'Corinthians 13': 'Which one: 1 Corintios or 2 Corintios?',
    'Amos 5': 'AMO 5',
    'Jonah 1': 'JON 1',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(go(input), want, input);
  for (const nonsense of ['Hello 3', 'Banana 3', 'Romeo 3']) assert.match(go(nonsense), /No book called/, nonsense);
});

test('verse times in the recording run in order, chapter by chapter', () => {
  let timed = 0;
  for (const b of books) {
    const audio = json('audio', `${b.id}.json`);
    assert.equal(audio.length, b.chapters, b.id);
    audio.forEach((times, ci) => {
      if (!times) return;
      timed++;
      let prev = -1;
      for (const t of times) {
        if (t === null) continue;
        assert.ok(t > prev, `${b.id} ${ci + 1}: times out of order`);
        prev = t;
      }
    });
  }
  assert.ok(timed / books.reduce((a, b) => a + b.chapters, 0) > 0.95, `${timed} chapters timed`);
  // John 3:16 starts its own sentence, right after the pause at 1:55
  assert.equal(json('audio', 'JHN.json')[2][15], 11543);
});

test('English forms: tenses, persons and plurals', async () => {
  const { pastOf, participleOf, ingOf, thirdPerson, pluralOf, verbFor } = await import(join(root, 'tools', 'biblia', 'english.mjs'));
  assert.deepEqual(['give', 'bless', 'stop', 'carry', 'admit', 'go'].map(pastOf), ['gave', 'blessed', 'stopped', 'carried', 'admitted', 'went']);
  assert.deepEqual(['give', 'write', 'see'].map(participleOf), ['given', 'written', 'seen']);
  assert.deepEqual(['come', 'see', 'die', 'run'].map(ingOf), ['coming', 'seeing', 'dying', 'running']);
  assert.deepEqual(['bless', 'go', 'cry', 'have'].map(thirdPerson), ['blesses', 'goes', 'cries', 'has']);
  assert.deepEqual(['foot', 'sheep', 'shepherd', 'son of man', 'news'].map(pluralOf), ['feet', 'sheep', 'shepherds', 'sons of man', 'news']);
  const past3 = ['form-of', 'indicative', 'preterite', 'singular', 'third-person'];
  assert.equal(verbFor('bless', past3), 'blessed');
  assert.equal(verbFor('be', past3), 'was');
  assert.equal(verbFor('be born', ['indicative', 'present', 'singular', 'third-person']), 'is born');
  assert.equal(verbFor('give', ['future', 'indicative', 'plural', 'third-person']), 'will give');
  assert.equal(verbFor('be able to', ['indicative', 'present', 'singular', 'first-person']), 'can');
  assert.equal(verbFor('bless', ['imperative', 'second-person', 'singular'], 'me'), 'bless me');
});

test('a tapped word becomes the English its neighbours and its verse call for', () => {
  const CONTEXT = JSON.parse(readFileSync(join(root, 'data', 'bibliacontext.json'), 'utf8'));
  const code = layout.match(/\/\/ english-choice:start([\s\S]*?)\/\/ english-choice:end/)[1];
  const chooseEnglish = new Function('CONTEXT', `${code}; return chooseEnglish;`)(CONTEXT);
  const look = (w) => json('dict', `${shardOf(w)}.json`)[w][0];
  const en = (id, c, v) => json('en', `${id}.json`)[c - 1][v - 1];
  assert.equal(look('bendijo')[4], 'blessed');
  assert.equal(look('pastores')[4], 'shepherds');
  assert.equal(chooseEnglish(look('judíos'), 'los', 'que', null, null), 'Jews');
  assert.equal(chooseEnglish(look('él'), 'con', null, null, null), 'him');
  assert.equal(chooseEnglish(look('levantó'), 'se', null, null, null), 'got up');
  assert.equal(chooseEnglish(look('levántate'), null, null, null, null), 'get up');
  // fue is "was" or "went": the verse's English says which
  assert.equal(chooseEnglish(look('fue'), 'también', 'a', null, 'Joseph also went up from Galilee'), 'went');
  assert.equal(chooseEnglish(look('fue'), 'que', 'el', null, 'This was the first census'), 'was');
  // "Este vino a Jesús": este is a pronoun there, and the verse says "came"
  assert.equal(chooseEnglish(look('vino'), 'este', 'a', null, en('JHN', 3, 2)), 'came');
  assert.equal(chooseEnglish(look('su'), 'a', 'hijo', null, en('LUK', 2, 7)), 'her');
});
