// src/features/wh40k/services/wargearGrammar.js
//
// Shared grammar for Warhammer 40K default-loadout and wargear-option
// prose. Used in two places:
//
//   1. Import time (scripts/wh40k-import/normalize.mjs) — parses the raw
//      Wahapedia HTML into the `structured` field of wargear-options.json
//      and the `loadout` field of units.json.
//
//   2. Runtime (services/loadout.js) — as a fallback for datasets that
//      predate the structured fields, parsing the flattened text that is
//      already shipped ("…following:1 bolt pistol1 combi-weapon…").
//
// Everything here is derived from the datasheet text itself — no unit
// names, weapon names or per-faction tables are hard-coded. When a
// sentence doesn't match the grammar the parser returns `null` and the
// caller falls back to showing the raw text (never silently guessing).
//
// ── Structured wargear option shape ──────────────────────────────────
//
//   {
//     kind: 'replace' | 'add',
//     removes: [{ count, name }],          // items removed per application
//     choices: [{ items: [{count,name}] }],// pick EXACTLY ONE per application
//     max: { type: 'fixed',    n }         // "1 model may…", "Up to 2 …"
//        | { type: 'perModels', per, n }   // "For every 5 models, 1 …"
//        | { type: 'allModels' },          // "Any number of models …"
//     note: string,                        // unparsed trailing restriction
//   }
//
// An "application" = one model using the option once. A selection in the
// UI is stored as an array of choice indexes, one per application.

/* ─────────────────── text utilities ─────────────────── */

const NBSP = / /g;

/** Normalise curly quotes/dashes so pattern matching is stable. */
function normText(s) {
  return String(s || '')
    .replace(NBSP, ' ')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lower-case comparison key for item / weapon names. */
export function normalizeItemName(s) {
  return normText(s).toLowerCase().replace(/[.,;:]+$/, '').trim();
}

/**
 * Split raw datasheet HTML into logical lines. `<li>` items become
 * `• item` lines, `<br>` and block ends become newlines. Also copes with
 * input that is already flat text (no tags).
 */
function htmlToLines(raw) {
  let s = String(raw || '').replace(NBSP, ' ');
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<\/li>/gi, '');
  s = s.replace(/<(br|\/p|\/ul|\/ol|\/div)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  return s.split('\n').map(l => normText(l)).filter(Boolean);
}

/**
 * Flattened dataset text lost its list separators ("…following:1 bolt
 * pistol1 combi-weapon"). Recover the items by splitting on `<digit> `
 * boundaries that directly follow a word character.
 */
function splitFlattenedList(tail) {
  const parts = normText(tail)
    .split(/(?<=[a-z)\]"'])\s*(?=\d+\s)/i)
    .map(p => normText(p).replace(/[.;]+$/, ''))
    .filter(Boolean);
  return parts;
}

/**
 * Parse an item phrase like "1 plasma pistol", "2 phosphor pistols" or
 * "1 heavy stubber and 1 storm bolter" into [{count, name}].
 */
export function parseItemPhrase(phrase) {
  const items = [];
  for (const part of normText(phrase).split(/\s+and\s+|\s*&\s*/i)) {
    const p = normText(part).replace(/^[•*-]\s*/, '').replace(/[.;,]+$/, '');
    if (!p) continue;
    const m = /^(\d+)\s+(.+)$/.exec(p);
    if (m) items.push({ count: parseInt(m[1], 10), name: m[2].trim() });
    else items.push({ count: 1, name: p });
  }
  return items.filter(i => i.name);
}

/**
 * Human-readable single-line text of datasheet HTML — keeps `•` markers
 * between list items so choice lists stay readable (unlike a bare
 * tag-strip, which glues "1 bolt pistol1 combi-weapon" together).
 */
export function htmlToText(raw) {
  return htmlToLines(raw).join(' ');
}

/* ─────────────────── default loadout ─────────────────── */

/**
 * Parse a datasheet's default-equipment prose into groups:
 *
 *   [{ who, scope: 'all'|'named'|'unit', count, items: [{count,name}] }]
 *
 * `scope`:
 *   - 'all'   → every model in the unit ("Every model…", "Each model…",
 *               "This model…")
 *   - 'named' → a named subset ("The Sergeant…", "Every Boss Nob…");
 *               `count` is how many models the sentence names (1 unless
 *               "are both" / "N models" phrasing says otherwise).
 *   - 'unit'  → equipment carried once per unit ("This unit…")
 *
 * Returns [] when nothing parses (callers treat that as "unknown").
 */
export function parseLoadout(raw) {
  if (!raw) return [];
  const text = htmlToLines(raw).join(' ');
  const groups = [];
  // Split on "<subject> is/are equipped with:" boundaries, keeping subjects.
  const re = /([^.:]*?)\s+(?:is|are)(?:\s+(?:both|all|each))?\s+equipped\s+with:\s*/gi;
  let m;
  const found = [];
  while ((m = re.exec(text)) !== null) {
    found.push({ subject: normText(m[1]), start: m.index, end: re.lastIndex });
  }
  for (let i = 0; i < found.length; i++) {
    const tail = text.slice(found[i].end, i + 1 < found.length ? found[i + 1].start : undefined);
    // Items are ";"-separated; a trailing sentence after "." is dropped.
    const itemsText = normText(tail).split(/(?<=\.)\s+(?=[A-Z])/)[0].replace(/\.$/, '');
    const items = itemsText
      .split(/;\s*/)
      .flatMap(part => parseItemPhrase(part));
    if (items.length === 0) continue;

    const subject = found[i].subject;
    let scope = 'named';
    let count = 1;
    const em = /^(?:every|each|all)\s+(.*)$/i.exec(subject);
    if (/^this\s+model\b/i.test(subject) || (em && /^models?$/i.test(em[1].trim()))) {
      scope = 'all';
    } else if (/^this\s+unit\b/i.test(subject)) {
      scope = 'unit';
    } else if (em) {
      // "Every Boss Nob…", "Every other model…" → named subset of unknown
      // size; count = null marks "the rest of the unit".
      scope = 'named';
      count = null;
    } else {
      const both = /\bare both\b|\band\b.*\bare\b/i.test(text.slice(found[i].start, found[i].end));
      const nm = /^(\d+)\b/.exec(subject);
      count = nm ? parseInt(nm[1], 10) : (both ? 2 : 1);
    }
    groups.push({ who: subject || 'Every model', scope, count, items });
  }
  return groups;
}

/* ─────────────────── wargear options ─────────────────── */

/** Sentences that carry no selectable option. */
function isNoneText(t) {
  return /^none\.?$/i.test(normText(t));
}

/**
 * Parse one wargear-option description (raw HTML at import time, or the
 * flattened dataset text at runtime) into the structured shape, or null
 * when the sentence doesn't match the grammar.
 */
export function parseWargearOption(raw) {
  if (!raw) return null;
  const lines = htmlToLines(raw);
  if (lines.length === 0) return null;
  if (lines.length === 1 && isNoneText(lines[0])) return { kind: 'none' };

  // Footnote-style restriction rows ("* You cannot select…").
  if (/^\*/.test(lines[0])) return { kind: 'note', note: lines.join(' ') };

  const bullets = lines.filter(l => /^•/.test(l)).map(l => l.replace(/^•\s*/, ''));
  const head = normText(lines.filter(l => !/^•/.test(l)).join(' '));

  // ── Subject → max applications ──────────────────────────
  // Stage A: optional multiplier prefix ("For every 5 models, …").
  let per = null;
  let rest = head;
  let m = /^for every (\d+|one|two|three|four|five)\s+models?(?:\s+in this unit)?,?\s*/i.exec(rest)
       || /^if this unit contains (\d+)(?:\s+or more)?\s+models?,?\s*/i.exec(rest);
  if (m) {
    per = wordToNum(m[1]);
    rest = rest.slice(m[0].length);
  }

  // Stage B: how many models the sentence names.
  let count = null;         // number | 'all'
  const countPatterns = [
    { re: /^up to (\d+|one|two|three|four)\s*/i,        val: (x) => wordToNum(x[1]) },
    { re: /^(any number of|all|every|each)\b\s*/i,      val: () => 'all' },
    { re: /^(\d+)\s*/,                                  val: (x) => parseInt(x[1], 10) },
    { re: /^(one|two|three|four)\b\s*/i,                val: (x) => wordToNum(x[1]) },
    { re: /^(an?)\b\s*/i,                               val: () => 1 },
    { re: /^(this model(?:'s)?|this unit(?:'s)?|it(?:s)?\b|the )\s*/i, val: () => 1 },
  ];
  for (const p of countPatterns) {
    const cm = p.re.exec(rest);
    if (cm) {
      count = p.val(cm);
      rest = rest.slice(cm[0].length);
      break;
    }
  }
  if (count == null) return null;

  let max;
  if (per != null) {
    max = { type: 'perModels', per, n: count === 'all' ? 1 : count };
  } else if (count === 'all') {
    max = { type: 'allModels' };
  } else {
    max = { type: 'fixed', n: count };
  }

  // ── Action: replace vs add ──────────────────────────────
  // Grab everything up to the "can …" verb as the ownership prefix
  // ("Battle Sister's boltgun can be replaced with …").
  let kind = null;
  let removes = [];
  let tail = null;

  if ((m = /^(.*?)\bcan(?:\s+each)?(?:\s+be)?\s+replaced\s+with:?\s+/i.exec(rest))) {
    kind = 'replace';
    removes = ownedItems(m[1]);
    tail = rest.slice(m[0].length);
  } else if ((m = /^(.*?)\bcan(?:\s+each)?\s+(?:have|has)\s+(?:its|their|\d+\s+)?\s*(.*?)\s+replaced\s+with:?\s+/i.exec(rest))) {
    kind = 'replace';
    removes = parseItemPhrase(m[2]);
    tail = rest.slice(m[0].length);
  } else if ((m = /^(.*?)\bcan(?:\s+each)?\s+replace\s+(?:its|their|1|one)\s+(.*?)\s+with:?\s+/i.exec(rest))) {
    kind = 'replace';
    removes = parseItemPhrase(m[2]);
    tail = rest.slice(m[0].length);
  } else if ((m = /^(.*?)\breplaced\s+with:?\s+/i.exec(rest))) {
    // Source typo: missing "can be" ("This model's twin heavy bolter
    // replaced with 1 twin lascannon.").
    kind = 'replace';
    removes = ownedItems(m[1]);
    tail = rest.slice(m[0].length);
  } else if ((m = /^(.*?)\bcan(?:\s+each)?\s+be\s+equipped\s+with:?\s*/i.exec(rest))) {
    kind = 'add';
    tail = rest.slice(m[0].length);
  } else if ((m = /^(.*?)\bcan(?:\s+each)?\s+(?:take|have)\s+/i.exec(rest))) {
    kind = 'add';
    tail = rest.slice(m[0].length);
  } else {
    return null;
  }

  // "…equipped with:" directly followed by a bullet list (no "one of the
  // following" phrasing) — the bullets ARE the choice list.
  if (!tail && bullets.length > 0) {
    const choices = bullets.map(p => ({ items: parseItemPhrase(p) })).filter(c => c.items.length > 0);
    if (choices.length === 0) return null;
    return { kind, removes, choices, max, note: '' };
  }

  // ── Object: choice list ─────────────────────────────────
  let choices = [];
  let note = '';
  let picks = 1;

  const upToOf = /^up to (\d+|one|two|three|four)\s+of the following:?\s*/i.exec(tail);
  const oneOf = /^one of the following:?\s*/i.exec(tail);
  if (upToOf || oneOf) {
    if (upToOf) picks = wordToNum(upToOf[1]);
    const after = tail.slice((upToOf || oneOf)[0].length);
    let listParts;
    if (bullets.length > 0) {
      listParts = bullets;
      note = normText(after);
    } else {
      listParts = splitFlattenedList(after);
    }
    choices = listParts
      .map(p => ({ items: parseItemPhrase(p) }))
      .filter(c => c.items.length > 0);
    // A footnote inside the flattened list tail ends up glued to the last
    // item — leave it; display uses names only up to punctuation anyway.
  } else {
    // Single fixed object: "1 power klaw." / "2 magma cutters." / "up to
    // 2 hunter-killer missiles."
    const upTo = /^up to (\d+|one|two|three|four)\s+/i.exec(tail);
    let objText = tail;
    if (upTo) {
      picks = wordToNum(upTo[1]);
      objText = '1 ' + tail.slice(upTo[0].length);
    }
    const sentence = objText.split(/(?<=\.)\s+/)[0];
    note = normText(objText.slice(sentence.length));
    const items = parseItemPhrase(sentence.replace(/[.;]\s*$/, ''));
    if (items.length === 0) return null;
    choices = [{ items }];
  }

  if (choices.length === 0) return null;

  // "up to N of the following / up to N <item>" scales applications, each
  // application picking one choice.
  if (picks > 1) {
    if (max.type === 'fixed') max = { type: 'fixed', n: max.n * picks };
    else if (max.type === 'perModels') max = { type: 'perModels', per: max.per, n: max.n * picks };
  }

  // Parenthetical restriction in the head ("(that model's boltgun cannot
  // be replaced)") — keep it visible.
  const paren = /\(([^)]+)\)\s*[.:]?\s*$/.exec(head);
  if (paren && !note) note = paren[1];

  return { kind, removes, choices, max, note: note || '' };
}

/** Items owned by the subject: "…'s boltgun and close combat weapon". */
function ownedItems(prefix) {
  const p = normText(prefix);
  const m = /'s\s+(.+)$/.exec(p);
  const owned = m ? m[1] : p;
  return parseItemPhrase(owned);
}

function wordToNum(w) {
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const n = parseInt(w, 10);
  return Number.isFinite(n) ? n : (words[String(w).toLowerCase()] || 1);
}

/* ─────────────────── constraint helpers ─────────────────── */

/**
 * How many times a structured option may be applied at a given unit size.
 * Unparsed / note / none options return 0 (they are not selectable).
 */
export function maxApplications(structured, modelCount) {
  if (!structured || !structured.max) return 0;
  const models = Math.max(1, Number(modelCount) || 1);
  switch (structured.max.type) {
    case 'fixed':     return structured.max.n;
    case 'perModels': return Math.floor(models / structured.max.per) * structured.max.n;
    case 'allModels': return models;
    default:          return 0;
  }
}

/** Human-readable constraint line for the option UI (German). */
export function describeConstraint(structured, modelCount) {
  if (!structured?.max) return '';
  const limit = maxApplications(structured, modelCount);
  const verb = structured.kind === 'add' ? 'erhalten' : 'tauschen';
  switch (structured.max.type) {
    case 'fixed':
      return limit === 1 ? `1 Modell kann ${verb}` : `Bis zu ${limit} Modelle können ${verb}`;
    case 'perModels':
      return `Je ${structured.max.per} Modelle: ${structured.max.n}× möglich (aktuell ${limit}×)`;
    case 'allModels':
      return `Jedes Modell kann ${verb} (${limit}×)`;
    default:
      return '';
  }
}
