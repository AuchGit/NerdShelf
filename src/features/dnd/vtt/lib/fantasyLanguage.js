// Ingame-Sprachen für Text-Handouts: der DM markiert Passagen (oder das ganze
// Handout) mit einer Sprache — Spieler, deren Charakter die Sprache NICHT
// beherrscht, sehen stattdessen eine phonetisch zur Sprache passende
// Fantasieschrift (sie können den Text ja wirklich nicht lesen).
//
// Die Verschleierung ist DETERMINISTISCH (Hash aus Wort + Sprache als Seed):
// dasselbe Wort ergibt immer dieselbe Fantasie-Form — der Text „flimmert"
// nicht zwischen Renders und alle Nicht-Sprecher sehen dasselbe Schriftbild.
// Wortlängen, Satzzeichen, Zeilenumbrüche und Großschreibung bleiben grob
// erhalten, damit es wie echte Schrift wirkt.

// ── Sprachkatalog (Standard-D&D; Picker + Normalisierung) ────────────────
export const INGAME_LANGUAGES = [
  { id: 'common',      label: 'Common' },
  { id: 'dwarvish',    label: 'Dwarvish' },
  { id: 'elvish',      label: 'Elvish' },
  { id: 'giant',       label: 'Giant' },
  { id: 'gnomish',     label: 'Gnomish' },
  { id: 'goblin',      label: 'Goblin' },
  { id: 'halfling',    label: 'Halfling' },
  { id: 'orc',         label: 'Orc' },
  { id: 'abyssal',     label: 'Abyssal' },
  { id: 'celestial',   label: 'Celestial' },
  { id: 'draconic',    label: 'Draconic' },
  { id: 'deepspeech',  label: 'Deep Speech' },
  { id: 'infernal',    label: 'Infernal' },
  { id: 'primordial',  label: 'Primordial' },
  { id: 'sylvan',      label: 'Sylvan' },
  { id: 'undercommon', label: 'Undercommon' },
  { id: 'druidic',     label: 'Druidic' },
  { id: 'thievescant', label: "Thieves' Cant" },
];

export const languageLabel = (id) =>
  INGAME_LANGUAGES.find((l) => l.id === id)?.label || id;

// Sprachnamen normalisieren ("Deep Speech" → deepspeech, "Thieves' Cant" →
// thievescant) — matcht die IDs oben und die Namen aus proficiencies.languages.
export const normLang = (name) => String(name || '').toLowerCase().replace(/[\s'’-]/g, '');

// Kennt der Charakter (Liste aus computed.proficiencies.languages) die Sprache?
export function knowsLanguage(knownList, langId) {
  const want = normLang(langId);
  if (!want) return true;
  return (knownList || []).some((l) => normLang(l) === want);
}

// ── Phonem-Stile: thematisch passende Silben pro Sprachfamilie ───────────
// Kein Versuch, echte Sprachen abzubilden — nur ein LESBARES, zur Fantasy-
// Ästhetik der Sprache passendes Schriftbild. `apo` = Chance auf Apostrophe
// im Wortinneren (Deep Speech / Undercommon wirken dadurch fremdartiger).
const STYLES = {
  elvish:    { on: ['l', 'th', 'v', 's', 'f', 'n', 'r', 'syl', 'ael', 'qu'], vo: ['a', 'e', 'i', 'ae', 'ia', 'ie', 'y'], co: ['l', 'n', 'r', 's', 'th', ''], apo: 0 },
  sylvan:    { on: ['l', 'f', 'v', 'th', 'n', 'w', 'sel', 'nym'], vo: ['a', 'e', 'i', 'ea', 'ai', 'y'], co: ['l', 'n', 'r', 's', ''], apo: 0 },
  celestial: { on: ['s', 'h', 'r', 'l', 'ser', 'al', 'v'], vo: ['a', 'e', 'io', 'ae', 'ou'], co: ['l', 'n', 'm', 'h', 's', ''], apo: 0 },
  dwarvish:  { on: ['k', 'd', 'g', 'b', 'thr', 'gr', 'kh', 'dur', 'bar'], vo: ['a', 'o', 'u', 'ai'], co: ['k', 'd', 'r', 'n', 'm', 'rk', 'nd'], apo: 0 },
  giant:     { on: ['g', 'th', 'k', 'v', 'hr', 'gr'], vo: ['o', 'u', 'a', 'au'], co: ['g', 'm', 'r', 'nd', 'k'], apo: 0 },
  orc:       { on: ['g', 'k', 'z', 'gr', 'ur', 'mog'], vo: ['a', 'o', 'u'], co: ['g', 'k', 'z', 'sh', 'r'], apo: 0 },
  goblin:    { on: ['g', 'z', 'k', 'sn', 'gr', 'skr'], vo: ['i', 'a', 'o', 'ee'], co: ['k', 'g', 'z', 't', 'x'], apo: 0 },
  infernal:  { on: ['x', 'z', 'v', 'th', 'ss', 'mal', 'bel'], vo: ['a', 'e', 'i', 'ai', 'ua'], co: ['s', 'th', 'x', 'z', 'r', 'l'], apo: 0.15 },
  abyssal:   { on: ['gh', 'z', 'kr', 'x', 'ul', 'dra'], vo: ['a', 'o', 'u', 'aa'], co: ['g', 'z', 'r', 'th', 'k'], apo: 0.2 },
  draconic:  { on: ['dr', 'k', 'v', 's', 'th', 'ar', 'ix'], vo: ['a', 'i', 'o', 'au'], co: ['x', 'th', 'r', 'k', 's', 'rr'], apo: 0.1 },
  primordial: { on: ['sh', 'k', 'a', 'ur', 'em'], vo: ['a', 'o', 'u', 'ae'], co: ['sh', 'n', 'r', 'm', 'l'], apo: 0 },
  deepspeech: { on: ['gl', 'uth', 'q', 'zz', 'y', 'ct'], vo: ['u', 'o', 'oa', 'uu', 'ie'], co: ['th', 'g', 'lh', 'q', 'n'], apo: 0.3 },
  undercommon: { on: ['x', 'ss', 'v', 'dr', 'il', 'z'], vo: ['i', 'e', 'u', 'ii'], co: ['s', 'x', 'n', 'th', 'l'], apo: 0.2 },
  gnomish:   { on: ['b', 'f', 'w', 'gl', 'nib', 'p'], vo: ['i', 'e', 'o', 'ee'], co: ['n', 'k', 'l', 'p', 't'], apo: 0 },
  halfling:  { on: ['b', 'm', 'p', 'w', 'h', 'l'], vo: ['a', 'o', 'e', 'oo'], co: ['n', 'm', 'l', 'p', ''], apo: 0 },
  goblinoid: { on: ['g', 'z', 'k'], vo: ['a', 'o'], co: ['k', 'g'], apo: 0 },
  druidic:   { on: ['d', 'br', 'w', 'gw', 'll', 'c'], vo: ['y', 'a', 'e', 'oe', 'u'], co: ['n', 'dd', 'r', 'ch', 'l'], apo: 0 },
  thievescant: { on: ['sk', 't', 'c', 'j', 'd', 'sl'], vo: ['i', 'a', 'o', 'u'], co: ['g', 'p', 'sh', 'nt', 'ck'], apo: 0 },
  // Fallback für unbekannte/homebrew Sprach-IDs.
  generic:   { on: ['t', 'k', 'r', 's', 'm', 'n', 'v'], vo: ['a', 'e', 'i', 'o', 'u'], co: ['n', 'r', 's', 'l', ''], apo: 0 },
};

// ── Deterministische Verschleierung ─────────────────────────────────────
// FNV-1a-Hash (Wort + Sprache) als Seed für einen kleinen PRNG.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

export function obfuscateWord(word, langId) {
  const style = STYLES[normLang(langId)] || STYLES.generic;
  const rnd = mulberry32(hash(`${normLang(langId)}|${word.toLowerCase()}`));
  // Silbenzahl grob an der Wortlänge orientieren (1–4) — kurze Wörter
  // bleiben kurz, lange bleiben lang, ohne die Länge exakt zu verraten.
  const syllables = Math.max(1, Math.min(4, Math.round(word.length / 3)));
  let out = '';
  for (let i = 0; i < syllables; i++) {
    out += pick(rnd, style.on) + pick(rnd, style.vo);
    if (rnd() < 0.55) out += pick(rnd, style.co);
    if (i < syllables - 1 && style.apo > 0 && rnd() < style.apo) out += '’';
  }
  // Großschreibung des Originals spiegeln (Satzanfänge/Eigennamen wirken echt).
  if (word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
    out = out[0].toUpperCase() + out.slice(1);
  }
  return out;
}

// Nur Buchstaben-Runs ersetzen — Satzzeichen, Zahlen, Whitespace und damit
// die gesamte Textstruktur (Absätze, Listen) bleiben erhalten.
export function obfuscateText(text, langId) {
  return String(text || '').replace(/\p{L}+/gu, (w) => obfuscateWord(w, langId));
}

// ── HTML-Transform fürs Spieler-Rendering ────────────────────────────────
// Nimmt SANITISIERTES Handout-HTML und ersetzt für den Betrachter alle
// Passagen in Sprachen, die er nicht kennt, durch Fantasieschrift:
//   • <span data-lang="…">-Passagen (vom DM im Editor markiert)
//   • optional das GANZE Handout via entryLang (Sprache des Eintrags)
// Bekannte Sprachen bleiben lesbar und bekommen einen Tooltip mit dem
// Sprachnamen; unbekannte werden ersetzt (ohne die Sprache zu verraten).
export function transformHandoutHtml(html, knownLangs, entryLang = null) {
  if (typeof document === 'undefined') return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const obfuscateNode = (root, langId) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    for (const n of nodes) n.nodeValue = obfuscateText(n.nodeValue, langId);
  };
  for (const span of [...tpl.content.querySelectorAll('[data-lang]')]) {
    const lang = span.getAttribute('data-lang');
    if (knowsLanguage(knownLangs, lang)) {
      span.setAttribute('title', `Auf ${languageLabel(lang)}`);
    } else {
      obfuscateNode(span, lang);
      span.setAttribute('title', 'Eine Schrift, die du nicht lesen kannst');
      span.setAttribute('data-lang-unknown', '1');
    }
    // Passage gilt als behandelt — der entryLang-Durchlauf unten fasst
    // ihre Textknoten nicht erneut an.
    span.setAttribute('data-lang-done', '1');
  }
  if (entryLang && !knowsLanguage(knownLangs, entryLang)) {
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement?.closest?.('[data-lang-done]')) nodes.push(n);
    }
    for (const n of nodes) n.nodeValue = obfuscateText(n.nodeValue, entryLang);
  }
  for (const span of [...tpl.content.querySelectorAll('[data-lang-done]')]) {
    span.removeAttribute('data-lang-done');
  }
  return tpl.innerHTML;
}
