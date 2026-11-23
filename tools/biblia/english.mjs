// English for a Spanish word in the shape it has in the text: bendijo -> "blessed",
// pastores -> "shepherds", dará -> "will give", levántate -> "get up". Used by
// glossary.mjs for the /biblia/ page, which swaps a tapped word for this English.

// ---- English verbs and nouns

const IRREGULAR = `arise arose arisen|awake awoke awoken|be was been|bear bore borne|beat beat beaten|become became become|beget begot begotten|begin began begun|behold beheld beheld|bend bent bent|bereave bereft bereft|beseech besought besought|bet bet bet|bid bid bid|bind bound bound|bite bit bitten|bleed bled bled|blow blew blown|break broke broken|breed bred bred|bring brought brought|build built built|burn burned burned|burst burst burst|buy bought bought|cast cast cast|catch caught caught|choose chose chosen|cleave cleft cleft|cling clung clung|come came come|cost cost cost|creep crept crept|cut cut cut|deal dealt dealt|dig dug dug|do did done|draw drew drawn|drink drank drunk|drive drove driven|dwell dwelt dwelt|eat ate eaten|fall fell fallen|feed fed fed|feel felt felt|fight fought fought|find found found|flee fled fled|fling flung flung|fly flew flown|forbear forbore forborne|forbid forbade forbidden|foresee foresaw foreseen|foretell foretold foretold|forget forgot forgotten|forgive forgave forgiven|forsake forsook forsaken|freeze froze frozen|get got gotten|give gave given|go went gone|grind ground ground|grow grew grown|hang hung hung|have had had|hear heard heard|hew hewed hewn|hide hid hidden|hit hit hit|hold held held|hurt hurt hurt|keep kept kept|kneel knelt knelt|know knew known|lay laid laid|lead led led|leap leaped leaped|leave left left|lend lent lent|let let let|lie lay lain|light lit lit|lose lost lost|make made made|mean meant meant|meet met met|mistake mistook mistaken|overcome overcame overcome|overtake overtook overtaken|overthrow overthrew overthrown|partake partook partaken|pay paid paid|put put put|quit quit quit|read read read|rebuild rebuilt rebuilt|rend rent rent|repay repaid repaid|rid rid rid|ride rode ridden|ring rang rung|rise rose risen|run ran run|say said said|see saw seen|seek sought sought|sell sold sold|send sent sent|set set set|sew sewed sewn|shake shook shaken|shed shed shed|shine shone shone|shoot shot shot|show showed shown|shrink shrank shrunk|shut shut shut|sing sang sung|sink sank sunk|sit sat sat|slay slew slain|sleep slept slept|slide slid slid|sling slung slung|smite smote smitten|sow sowed sown|speak spoke spoken|speed sped sped|spend spent spent|spin spun spun|spit spat spat|split split split|spread spread spread|spring sprang sprung|stand stood stood|steal stole stolen|stick stuck stuck|sting stung stung|stink stank stunk|stride strode stridden|strike struck struck|string strung strung|strive strove striven|swear swore sworn|sweep swept swept|swell swelled swollen|swim swam swum|swing swung swung|take took taken|teach taught taught|tear tore torn|tell told told|think thought thought|throw threw thrown|thrust thrust thrust|tread trod trodden|understand understood understood|undertake undertook undertaken|undo undid undone|uphold upheld upheld|upset upset upset|wake woke woken|wear wore worn|weave wove woven|weep wept wept|win won won|wind wound wound|withdraw withdrew withdrawn|withhold withheld withheld|withstand withstood withstood|wring wrung wrung|write wrote written`;
const PAST = new Map();
const PARTICIPLE = new Map();
for (const row of IRREGULAR.split("|")) {
  const [base, past, pp] = row.split(" ");
  PAST.set(base, past);
  PARTICIPLE.set(base, pp);
}
// the final consonant doubles in these longer verbs too: admitted, preferred
const DOUBLES = new Set("admit commit permit submit omit emit transmit acquit befit prefer refer occur incur deter confer defer regret control patrol compel expel repel propel dispel excel rebel equip abhor".split(" "));
const doubles = (v) => DOUBLES.has(v) || /^[^aeiou]*[aeiou][^aeiouwxy]$/.test(v);

function regular(v) {
  if (v.endsWith("e")) return `${v}d`;
  if (/[^aeiou]y$/.test(v)) return `${v.slice(0, -1)}ied`;
  if (doubles(v)) return `${v}${v.slice(-1)}ed`;
  return `${v}ed`;
}
export const pastOf = (v) => PAST.get(v) ?? regular(v);
export const participleOf = (v) => PARTICIPLE.get(v) ?? regular(v);

export function ingOf(v) {
  if (v === "be") return "being";
  if (v.endsWith("ie")) return `${v.slice(0, -2)}ying`;
  if (/ee$/.test(v)) return `${v}ing`;
  if (/[^aeiouy]e$/.test(v)) return `${v.slice(0, -1)}ing`;
  if (doubles(v)) return `${v}${v.slice(-1)}ing`;
  return `${v}ing`;
}

export function thirdPerson(v) {
  if (v === "be") return "is";
  if (v === "have") return "has";
  if (/(s|x|z|ch|sh|o)$/.test(v)) return `${v}es`;
  if (/[^aeiou]y$/.test(v)) return `${v.slice(0, -1)}ies`;
  return `${v}s`;
}

const PLURALS = Object.assign(Object.create(null), { man: "men", woman: "women", child: "children", foot: "feet", tooth: "teeth", goose: "geese", mouse: "mice", louse: "lice", ox: "oxen", sheep: "sheep", deer: "deer", fish: "fish", person: "people", life: "lives", wife: "wives", knife: "knives", leaf: "leaves", loaf: "loaves", wolf: "wolves", calf: "calves", half: "halves", thief: "thieves", sheaf: "sheaves", self: "selves", shelf: "shelves", cattle: "cattle", livestock: "livestock", people: "peoples", offspring: "offspring", news: "news", means: "means", species: "species", series: "series", bread: "loaves", clothing: "clothes", die: "dice" });

export function pluralOf(noun) {
  const words = noun.split(" ");
  // "son of man" -> "sons of man"; "burnt offering" -> "burnt offerings"
  const i = words.indexOf("of") > 0 ? words.indexOf("of") - 1 : words.length - 1;
  const w = words[i];
  let p;
  if (PLURALS[w]) p = PLURALS[w];
  else if (/(s|x|z|ch|sh)$/.test(w)) p = `${w}es`;
  else if (/[^aeiou]y$/.test(w)) p = `${w.slice(0, -1)}ies`;
  else p = `${w}s`;
  words[i] = p;
  return words.join(" ");
}

// ---- from a Spanish form's grammar to English

// "can" and "must" don't inflect like other verbs
const MODALS = Object.assign(Object.create(null), {
  "be able to": { present: "can", past: "could", future: "will be able to", would: "could", base: "be able to" },
  "have to": { present: "must", past: "had to", future: "will have to", would: "would have to", base: "have to" },
});

// a dictionary gloss down to the one word or phrase to put in the text
export function headWord(gloss, pos) {
  let g = gloss.split(/[,;]/)[0].replace(/\([^)]*\)?/g, "").replace(/[“”"…:.]/g, "").replace(/\s+/g, " ").trim();
  return pos === "verb" ? g.replace(/^to /, "") : g.replace(/^(the|a|an) /i, "");
}

const OBJECTS = Object.assign(Object.create(null), { me: "me", te: "you", lo: "it", la: "her", le: "him", nos: "us", os: "you", los: "them", las: "them", les: "them", se: "" });

// the person and number a set of tags is in, for "is" or "are", "was" or "were"
function subject(t) {
  const plural = t.has("plural");
  if (t.has("first-person")) return plural ? "we" : "I";
  if (t.has("second-person")) return "you";
  return plural ? "they" : "he";
}

// gloss: the verb's meaning ("bless", "get up", "be born"); tags: the form's Wiktionary tags
export function verbFor(gloss, tags, object = "") {
  const t = new Set(tags);
  const modal = MODALS[gloss];
  const [v, ...rest] = gloss.split(" ");
  const tail = rest.length ? ` ${rest.join(" ")}` : "";
  const who = subject(t);
  const be = (past) => (past ? (who === "I" || who === "he" ? "was" : "were") : who === "I" ? "am" : who === "he" ? "is" : "are");
  let out;
  if (t.has("infinitive") || t.has("imperative")) out = modal ? modal.base : gloss;
  else if (t.has("gerund")) out = `${ingOf(v)}${tail}`;
  else if (t.has("participle")) out = `${participleOf(v)}${tail}`;
  else if (t.has("future")) out = modal ? modal.future : `will ${gloss}`;
  else if (t.has("conditional")) out = modal ? modal.would : `would ${gloss}`;
  else if (t.has("subjunctive")) {
    if (t.has("imperfect")) out = modal ? modal.past : v === "be" ? `were${tail}` : `${pastOf(v)}${tail}`;
    else out = modal ? modal.present : gloss;
  } else if (t.has("preterite") && t.has("present")) out = modal ? modal.present : v === "be" ? `${be(false)}${tail}` : gloss;
  else if (t.has("preterite") || t.has("imperfect")) out = modal ? modal.past : v === "be" ? `${be(true)}${tail}` : `${pastOf(v)}${tail}`;
  else if (t.has("present")) {
    if (modal) out = modal.present;
    else if (v === "be") out = `${be(false)}${tail}`;
    else out = who === "he" ? `${thirdPerson(v)}${tail}` : gloss;
  } else out = gloss;
  return object ? `${out} ${object}` : out;
}

// The pronoun that makes a verb form reflexive, in front of it (se levantó, me acuerdo)
// or attached to it (levántate, acuérdense)
// "me|se" for a form that's both yo and él (pierda: me pierda, se pierda)
export function reflexivePronoun(tags) {
  const t = new Set(tags);
  if (!t.has("first-person") && !t.has("second-person") && !t.has("third-person")) return "se";
  const plural = t.has("plural");
  const out = [];
  if (t.has("first-person")) out.push(plural ? "nos" : "me");
  if (t.has("second-person")) out.push(plural ? "os" : "te");
  if (t.has("third-person")) out.push("se");
  return out.join("|");
}

export { OBJECTS };

// ---- what reflexive verbs mean, where Wiktionary doesn't say

export const REFLEXIVE = Object.assign(Object.create(null), {
  levantar: "get up", arrepentir: "repent", acordar: "remember", ir: "go away", sentar: "sit down",
  acercar: "come near", postrar: "bow down", humillar: "humble oneself", alegrar: "rejoice", quedar: "stay",
  morir: "die", dormir: "fall asleep", despertar: "wake up", llamar: "be called", volver: "turn",
  vestir: "get dressed", lavar: "wash", reunir: "gather", juntar: "gather", apartar: "turn away",
  alejar: "go away", acostar: "lie down", inclinar: "bow down", arrodillar: "kneel", maravillar: "marvel",
  asombrar: "be amazed", enojar: "get angry", avergonzar: "be ashamed", gloriar: "boast", jactar: "boast",
  olvidar: "forget", preocupar: "worry", someter: "submit", entregar: "give oneself up", convertir: "turn",
  hacer: "become", poner: "put on", quitar: "take off", llevar: "carry off", salvar: "be saved",
  perder: "be lost", esconder: "hide", ocultar: "hide", burlar: "mock", quejar: "complain", atrever: "dare",
  negar: "refuse", dirigir: "head", presentar: "appear", manifestar: "appear", cumplir: "be fulfilled",
  llenar: "be filled", cansar: "grow tired", fortalecer: "be strengthened", regocijar: "rejoice",
  gozar: "rejoice", deleitar: "delight", consolar: "be comforted", lamentar: "lament", sanar: "be healed",
  casar: "marry", detener: "stop", encontrar: "be", mover: "move", sostener: "stand firm", guardar: "guard oneself",
  confiar: "trust", purificar: "purify oneself", santificar: "consecrate oneself", multiplicar: "multiply",
  extender: "spread", apoderar: "seize", retirar: "withdraw", marchar: "leave", ahogar: "drown",
  bajar: "get down", subir: "climb", sentir: "feel", encender: "burn", abrir: "open", cerrar: "close",
  romper: "break", secar: "dry up", pudrir: "rot", dar: "give oneself", decir: "be said", ver: "be seen",
  oír: "be heard", saber: "be known", escribir: "be written", vender: "be sold", comer: "eat up",
  beber: "drink up", tomar: "take", hallar: "be", sacrificar: "sacrifice oneself", ofrecer: "offer oneself",
  rendir: "surrender", acabar: "run out", terminar: "end", dividir: "be divided", separar: "separate",
  unir: "join", parar: "stand",
});

// small words with a fixed English, and words whose English depends on context too much to guess
export const FIXED = Object.assign(Object.create(null), {
  de: "of", del: "of the", al: "to the", y: "and", e: "and", o: "or", u: "or", que: "that", a: "to", en: "in",
  con: "with", por: "for", para: "for", sin: "without", sobre: "on", entre: "among", hasta: "until",
  desde: "from", hacia: "toward", contra: "against", ante: "before", bajo: "under", tras: "after",
  según: "according to", durante: "during", mediante: "through", no: "not", ni: "nor", pero: "but",
  sino: "but", si: "if", sí: "yes", porque: "because", pues: "for", como: "like", cuando: "when",
  donde: "where", mientras: "while", aunque: "although", también: "also", tampoco: "neither", ya: "already",
  muy: "very", más: "more", menos: "less", tan: "so", tanto: "so much", así: "so", aquí: "here", acá: "here",
  allí: "there", ahí: "there", allá: "there", hoy: "today", entonces: "then", luego: "then", siempre: "always",
  nunca: "never", jamás: "never", todavía: "still", aún: "still", aun: "even", solo: "only", sólo: "only",
  el: "the", la: "the", los: "the", las: "the", lo: "it", un: "a", una: "a", unos: "some", unas: "some",
  mi: "my", mis: "my", tu: "your", tus: "your", su: "his/her", sus: "his/her", nuestro: "our",
  nuestra: "our", nuestros: "our", nuestras: "our", vuestro: "your", vuestra: "your", yo: "I", tú: "you",
  él: "he", ella: "she", ello: "it", nosotros: "we", nosotras: "we", vosotros: "you", ellos: "they",
  ellas: "they", usted: "you", ustedes: "you", me: "me", te: "you", le: "him", les: "them", nos: "us",
  os: "you", se: "", mí: "me", ti: "you", conmigo: "with me", contigo: "with you", consigo: "with himself",
  este: "this", esta: "this", estos: "these", estas: "these", ese: "that", esa: "that", esos: "those",
  esas: "those", aquel: "that", aquella: "that", aquellos: "those", aquellas: "those", esto: "this",
  eso: "that", aquello: "that", éste: "this one", ésta: "this one", ése: "that one", ésa: "that one",
  quien: "who", quienes: "who", qué: "what", quién: "who", quiénes: "who", cómo: "how", cuándo: "when",
  dónde: "where", cuál: "which", cuáles: "which", cuánto: "how much", cuántos: "how many", cual: "which",
  cuyo: "whose", cuya: "whose", cuyos: "whose", cuyas: "whose", cada: "each", otro: "other", otra: "other",
  otros: "others", otras: "others", mismo: "same", misma: "same", nada: "nothing", nadie: "no one",
  algo: "something", alguien: "someone", algún: "some", alguna: "some", alguno: "some", algunos: "some",
  algunas: "some", ningún: "no", ninguna: "no", ninguno: "none", todo: "all", toda: "all", todos: "all",
  todas: "all", tal: "such", varios: "several", ambos: "both", demás: "rest", hay: "there is",
  embargo: "however",
});

// English too common to tell anything by being in a verse ("in", "is", "no")
export const STOPWORDS = "a an the in on at to of for by with from as and or but nor is are am was were be been being it its he him his she her hers they them their we us our you your i me my mine that this these those there here not no so do did does done have has had will would shall should can could may might must all some any one if then than when what who whom which up out about into over after before also just only very more most such own same other".split(" ");

// the words that make the next word a noun (el camino), or a pronoun's object form (con él)
export const ARTICLES = "el la los las un una unos unas al del mi mis tu tus su sus nuestro nuestra nuestros nuestras".split(" ");
export const DETERMINERS = "el la los las un una unos unas este esta estos estas ese esa esos esas aquel aquella aquellos aquellas mi mis tu tus su sus nuestro nuestra nuestros nuestras al del ningún ninguna algún alguna cada otro otra otros otras mucho mucha muchos muchas poco poca pocos pocas tanto tanta tantos tantas cuyo cuya cuyos cuyas dos tres cuatro cinco seis siete ocho nueve diez doce cien mil".split(" ");
export const PREPOSITIONS = "a de en con por para sin sobre entre hasta desde hacia contra ante bajo tras según durante como que mediante excepto".split(" ");

// English that depends on the word next to it: him after a preposition (con él), them
// right before a verb (los rodeó)
export const NEXT_TO = Object.assign(Object.create(null), {
  él: [["him", "after:prep"]], ella: [["her", "after:prep"]], ellos: [["them", "after:prep"]],
  ellas: [["them", "after:prep"]], nosotros: [["us", "after:prep"]], los: [["them", "before:verb"]],
  las: [["them", "before:verb"]], la: [["her", "before:verb"]],
});

// the other English a small word can be, for the page to pick by the verse (su madre: "his mother")
export const FIXED_ALTS = Object.assign(Object.create(null), {
  su: ["his", "her", "their", "your", "its"], sus: ["his", "her", "their", "your", "its"],
  le: ["to him", "to her", "her", "you"], les: ["to them", "you"], lo: ["him", "what"], que: ["who", "which", "than"],
  como: ["as", "how"], por: ["by", "through", "because of"], para: ["to", "in order to"], en: ["on", "into", "at"],
  de: ["from", "about"], a: ["at"], sobre: ["over", "upon", "about"], entre: ["between"], hasta: ["to", "even"],
  ante: ["in front of"], así: ["thus", "like this"], pues: ["then", "so"], tanto: ["so"],
});

// forms of haber: "had" before a participle (había dicho), "there was" otherwise (había un hombre)
export const EXISTENTIAL = Object.assign(Object.create(null), { había: "there was", habían: "there were", hubo: "there was", habrá: "there will be", haya: "there may be" });
