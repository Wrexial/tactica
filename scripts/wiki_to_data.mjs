#!/usr/bin/env node
/**
 * wiki_to_data.mjs — Wiki → data converter (T088, Phase 8).
 *
 * Turns the scraped FFTA reference tables under `docs/wiki/raw/` into
 * **validated, re-authored** content for *Lines of Glory*. It is the front of
 * the content pipeline (T089/T090 finish the authoring by hand): read a wiki
 * table, pull out the mechanical shape, and emit a {@link EquipmentDef} /
 * {@link AbilityDef} whose display fiction and balance numbers are **ours**.
 *
 * ## Legal posture (`agents.md` §3, §10)
 *
 * The reference mirror is study material. The converter deliberately does
 * **not** copy reference prose: a table cell wrapped in `''...''` (the wiki's
 * flavour line) is read and discarded, and every emitted `name`, `description`
 * and `flavour` is generated from original templates plus our own balance
 * numbers. No FFTA item/ability name is ever written into an id or display
 * string, and no reference numeral is copied verbatim (see `deriveStats`).
 *
 * ## Pipeline
 *
 * ```
 *   docs/wiki/raw/*.wiki
 *        │  extractTables / parseWikiTable   (generic MediaWiki table reader)
 *        ▼
 *   reference items  { section, name, stats, cost, skills, element, effects }
 *        │  reauthor…                       (our balance + original fiction)
 *        ▼
 *   { equipment: EquipmentDef[], abilities: AbilityDef[] }
 *        │  validate                          (Zod schemas from src/data)
 *        ▼
 *   validated DataBundle slice
 * ```
 *
 * Every stage is a pure function of its input (no `Date`, no `Math.random`), so
 * the converter is deterministic: the same wiki bytes always produce the same
 * data (`agents.md` §2). The only side effects live in `main()` at the very
 * bottom (file reads and writes).
 *
 * ## Usage
 *
 * ```bash
 * node scripts/wiki_to_data.mjs                 # convert the bundled mirror
 * node scripts/wiki_to_data.mjs --check         # validate and print a summary
 * node scripts/wiki_to_data.mjs --out out.json  # write the converted slice
 * node scripts/wiki_to_data.mjs --stdin         # read wikitext on stdin
 * ```
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Our schemas live in TypeScript; Node 22.18+/24 strips the types on import and
// Vite/Vitest transforms them in tests. Keeping validation in one place means
// the converter can never drift from the content contract.
import { AbilityDefSchema, EquipmentDefSchema } from "../src/data/schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = join(HERE, "..", "docs", "wiki", "raw");

/** Reference file names inside `docs/wiki/raw/`. */
export const WEAPONS_FILE = "Final_Fantasy_Tactics_Advance_weapons.wiki";
export const ARMOR_FILE = "Final_Fantasy_Tactics_Advance_armor.wiki";

/* ==========================================================================
 * 1. MediaWiki text helpers
 * ======================================================================== */

/** Split `value` on top-level `sep`, ignoring separators inside `[[..]]`/`{{..}}`. */
export function splitTopLevel(value, sep) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && value.startsWith(sep, i)) {
      out.push(value.slice(start, i));
      i += sep.length - 1;
      start = i + 1;
    }
  }
  out.push(value.slice(start));
  return out;
}

/** HTML entity + markup table used by {@link cleanWikiText}. */
const ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

/**
 * Strip MediaWiki markup down to plain text, preserving line breaks (`<br>`
 * becomes `\n`) so multi-line cells such as skills and effects stay separable.
 */
export function cleanWikiText(input) {
  if (input === undefined || input === null) return "";
  let s = String(input);

  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  s = s.replace(/<ref[^>]*\/>/gi, "");
  // Files/images first: their captions may contain nested [[links]].
  s = s.replace(/\[\[(?:File|Image):[\s\S]*?\]\]/gi, "");
  // Link templates keep their display alias (the last positional argument).
  s = s.replace(/\{\{\s*LA\s*\|([^{}]*)\}\}/gi, (_m, args) => {
    const parts = splitTopLevel(args, "|");
    return parts.length >= 2 ? parts[parts.length - 1] : parts[0];
  });
  s = s.replace(/\{\{\s*A\s*\|([^{}]*)\}\}/gi, (_m, args) => splitTopLevel(args, "|")[0]);
  s = s.replace(/\{\{\s*note\s*\|[^{}]*\}\}/gi, "");
  // Strip any remaining templates, innermost first.
  let prev;
  do {
    prev = s;
    s = s.replace(/\{\{[^{}]*\}\}/g, "");
  } while (s !== prev);
  // Wikilinks: [[target|label]] → label, [[target]] → target.
  s = s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1");
  s = s.replace(/\[\[([^\]]*)\]\]/g, "$1");
  // External links and raw HTML.
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/?[^>]+>/g, "");
  // Bold/italic (also the marker that identifies a flavour line).
  s = s.replace(/'{2,5}/g, "");
  for (const [entity, replacement] of Object.entries(ENTITIES)) {
    s = s.split(entity).join(replacement);
  }
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\s*\n\s*/g, "\n");
  return s.trim();
}

/** Collapse a cleaned string to a single line (for names and descriptions). */
export function cleanInline(input) {
  return cleanWikiText(input).replace(/\s+/g, " ").trim();
}

/* ==========================================================================
 * 2. Generic MediaWiki table reader
 * ======================================================================== */

/** Parse one cell's attributes and content (caller strips the leading `|`/`!`). */
function parseCell(part, isHeader) {
  const text = part.trim();
  let attributes = "";
  let content = text;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === "|" && depth === 0) {
      attributes = text.slice(0, i);
      content = text.slice(i + 1);
      break;
    }
  }
  const span = (name) => {
    const m = attributes.match(new RegExp(`${name}\\s*=\\s*"?\\s*(\\d+)`, "i"));
    return m ? Math.max(1, Number(m[1])) : 1;
  };
  return {
    text: content,
    isHeader,
    colspan: span("colspan"),
    rowspan: span("rowspan"),
  };
}

/** Split a full table body into raw rows of cells. */
function parseRawRows(tableText) {
  const lines = String(tableText).split(/\r?\n/);
  const rows = [];
  let current = null;
  let cell = null;

  const flushCell = () => {
    if (cell) {
      current.cells.push(cell);
      cell = null;
    }
  };
  const flushRow = () => {
    flushCell();
    if (current && current.cells.length) rows.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("{|")) continue;
    if (line.startsWith("|}")) {
      flushRow();
      continue;
    }
    if (line.startsWith("|-")) {
      flushRow();
      current = { cells: [] };
      continue;
    }
    if (line.startsWith("!") || line.startsWith("|")) {
      if (!current) current = { cells: [] };
      flushCell();
      const body = line.slice(1);
      const sep = line.startsWith("!") ? "!!" : "||";
      for (const part of body.split(sep)) {
        current.cells.push(parseCell(part, line.startsWith("!")));
      }
      continue;
    }
    // Continuation of the current cell (wrapped content).
    if (current && current.cells.length) {
      current.cells[current.cells.length - 1].text += `\n${line}`;
    }
  }
  flushRow();
  return rows;
}

/**
 * Build a rectilinear grid from raw rows, resolving `rowspan` / `colspan`.
 * Returns the cleaned cell strings plus a `cont` flag per row that is `true`
 * when the row's first column came from a `rowspan` (i.e. it belongs to the
 * item above rather than starting a new one).
 */
function buildGrid(rawRows) {
  const rows = [];
  const cont = [];
  const spans = new Map(); // column → { text, remaining }

  for (const raw of rawRows) {
    const row = [];
    let col = 0;
    let fromSpan = false;

    const skipOccupied = () => {
      while (spans.has(col) && spans.get(col).remaining > 0) {
        const span = spans.get(col);
        row[col] = span.text;
        span.remaining--;
        if (span.remaining === 0) spans.delete(col);
        fromSpan = true;
        col++;
      }
    };

    for (const cellDefinition of raw.cells) {
      skipOccupied();
      const span = cellDefinition.colspan;
      row[col] = cleanWikiText(cellDefinition.text);
      for (let i = 1; i < span; i++) row[col + i] = "";
      if (cellDefinition.rowspan > 1) {
        for (let i = 0; i < span; i++) {
          spans.set(col + i, {
            text: i === 0 ? row[col] : "",
            remaining: cellDefinition.rowspan - 1,
          });
        }
      }
      col += span;
    }
    skipOccupied();
    rows.push(row);
    cont.push(fromSpan);
  }
  return { rows, cont };
}

/** Normalise a column heading for alias matching. */
function normHeader(value) {
  return cleanInline(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** A table parsed into `{ headers, rows, cont }` with the header row removed. */
export function parseWikiTable(tableText) {
  const raw = parseRawRows(tableText);
  if (!raw.length) return null;
  const { rows, cont } = buildGrid(raw);
  const headerIndex = rows.findIndex(
    (row, i) => raw[i].cells.length >= 3 && raw[i].cells.every((cell) => cell.isHeader),
  );
  if (headerIndex < 0) return null;
  const headers = rows[headerIndex];
  return {
    headers,
    rows: rows.slice(headerIndex + 1),
    cont: cont.slice(headerIndex + 1),
  };
}

/* ==========================================================================
 * 3. Section discovery
 * ======================================================================== */

/** Extract every `{|…|}` table with its enclosing heading path. */
export function extractTables(wikitext) {
  const lines = String(wikitext).split(/\r?\n/);
  const stack = [];
  const tables = [];
  let buffer = null;

  for (const line of lines) {
    const heading = line.match(/^(={2,})\s*(.+?)\s*\1\s*$/);
    if (!buffer && heading) {
      const level = heading[1].length - 1;
      stack.length = level - 1;
      stack[level - 1] = cleanInline(heading[2]);
      continue;
    }
    if (!buffer && line.trim().startsWith("{|")) {
      buffer = [line];
      continue;
    }
    if (buffer) {
      buffer.push(line);
      if (line.trim().startsWith("|}")) {
        tables.push({ path: stack.filter(Boolean), tableText: buffer.join("\n") });
        buffer = null;
      }
    }
  }
  return tables;
}

/* ==========================================================================
 * 4. Reference vocabularies
 * ======================================================================== */

/** FFTA weapon section → our weapon family (T035) base. */
export const WEAPON_SECTION_TYPES = {
  swords: "blade",
  blades: "blade",
  sabers: "sabre",
  knightswords: "blade",
  greatswords: "blade",
  broadswords: "blade",
  knives: "sabre",
  rapiers: "sabre",
  katana: "blade",
  staves: "staff",
  rods: "staff",
  maces: "blade",
  bows: "bow",
  greatbows: "bow",
  spears: "lance",
  instruments: "instrument",
  knuckles: "blade",
  souls: "staff",
  guns: "gun",
  shields: "shield",
};

/** FFTA armour section → our equip slot. */
export const ARMOR_SECTION_SLOTS = {
  helmets: "head",
  hats: "head",
  femaleonlyornament: "head",
  heavyarmor: "armour",
  clothing: "armour",
  robes: "armour",
  shields: "offhand",
};

/** FFTA job (role tree) → Napoleonic post + military school (mapping §3). */
export const JOB_TO_POST = {
  soldier: { role: "Fusilier", power: "france" },
  thief: { role: "Forager", power: "france" },
  archer: { role: "Marksman", power: "france" },
  "white mage": { role: "Surgeon", power: "france" },
  "black mage": { role: "Artilleryman", power: "france" },
  fighter: { role: "Grenadier", power: "france" },
  paladin: { role: "Colour Guard", power: "france" },
  ninja: { role: "Hussar", power: "france" },
  hunter: { role: "Chasseur", power: "france" },
  "blue mage": { role: "Intelligence Officer", power: "france" },
  illusionist: { role: "Bombardier", power: "france" },
  warrior: { role: "Line Grenadier", power: "prussia" },
  "white monk": { role: "Assault Pioneer", power: "prussia" },
  bishop: { role: "Chaplain", power: "prussia" },
  defender: { role: "Cuirassier", power: "prussia" },
  dragoon: { role: "Lancer", power: "prussia" },
  gladiator: { role: "Shock Grenadier", power: "prussia" },
  templar: { role: "Line Officer", power: "prussia" },
  beastmaster: { role: "Partisan", power: "russia" },
  alchemist: { role: "Sapper", power: "russia" },
  morpher: { role: "Impersonator", power: "russia" },
  sage: { role: "Master Gunner", power: "russia" },
  "time mage": { role: "Staff Officer", power: "russia" },
  fencer: { role: "Sabreur", power: "britain" },
  sniper: { role: "Sharpshooter", power: "britain" },
  "red mage": { role: "Adjutant", power: "britain" },
  elementalist: { role: "Rocketeer", power: "britain" },
  assassin: { role: "Long Rifle", power: "britain" },
  summoner: { role: "Commodore", power: "britain" },
  animist: { role: "Scout", power: "austria" },
  gunner: { role: "Fusilier", power: "austria" },
  "mog knight": { role: "Lancer", power: "austria" },
  juggler: { role: "Grenadier", power: "austria" },
  gadgeteer: { role: "Engineer", power: "austria" },
};

/** FFTA element name → our stable element key (mapping §7). */
export const ELEMENT_NAMES = {
  fire: "fire",
  ice: "ice",
  lightning: "lightning",
  thunder: "lightning",
  earth: "earth",
  water: "water",
  wind: "wind",
  holy: "holy",
  dark: "dark",
};

/** FFTA status keyword → our stable condition id (mapping §8). */
export const CONDITION_KEYWORDS = [
  ["poison", "poison"],
  ["venom", "poison"],
  ["blind", "blind"],
  ["daze", "blind"],
  ["sleep", "sleep"],
  ["silence", "silence"],
  ["petrify", "petrify"],
  ["petrification", "petrify"],
  ["confuse", "confuse"],
  ["charm", "charm"],
  ["berserk", "berserk"],
  ["stop", "stop"],
  ["doom", "doom"],
  ["frog", "frog"],
  ["slow", "slow"],
  ["immobilize", "immobilize"],
  ["disable", "disable"],
  ["addle", "addle"],
  ["zombie", "zombie"],
];

/** Quality tiers keyed to an item's rank within its table (our authored scale). */
export const QUALITY_TIERS = [
  "Recruit's",
  "Line",
  "Veteran",
  "Guardsman's",
  "Colonel's",
  "Marshal's",
];

/** Noun used for a re-authored item name, by weapon family. */
export const WEAPON_NOUNS = {
  sabre: "Sabre",
  blade: "Broadsword",
  lance: "Lance",
  musket: "Musket",
  carbine: "Carbine",
  rifle: "Rifle",
  bow: "Bow",
  gun: "Gun",
  staff: "Signal Staff",
  instrument: "Horn",
  tool: "Tools",
  shield: "Shield",
};

/** Noun used for a re-authored item name, by armour section. */
export const SECTION_NOUNS = {
  helmets: "Helmet",
  hats: "Cap",
  femaleonlyornament: "Ornament",
  heavyarmor: "Cuirass",
  clothing: "Coat",
  robes: "Greatcoat",
  shields: "Shield",
};

/** Original, generated flavour lines (never sourced from the mirror). */
const FLAVOUR_BY_FAMILY = {
  sabre: "A trooper's blade, quick out of the scabbard and quicker in the press.",
  blade: "Weighted for the line, where one clean blow can settle a file.",
  lance: "Reach and momentum: the charge arrives at the point.",
  musket: "Smoothbore fire, three ranks deep, and the smoke to follow it.",
  carbine: "Short, handy and answered fast in a running fight.",
  rifle: "Grooved and deliberate; patience outranges volume.",
  bow: "Silent, cheap and still trusted where powder runs wet.",
  gun: "Ordnance does not care whose hand serves it, only whose eye aims it.",
  staff: "Flags, mirrors and rockets speak where the voice cannot.",
  instrument: "A horn carries an order further than any shout into the smoke.",
  tool: "Sappers open what a battery cannot crack.",
  shield: "In the press of a breach, a good boss is as useful as a blade.",
};

/* ==========================================================================
 * 5. Parsing reference items
 * ======================================================================== */

/** Normalise a section heading into a lookup key. */
function sectionKey(path) {
  const raw = path[path.length - 1] || "";
  const parent = path[path.length - 2] || "";
  const chosen = /weapon ?stats/i.test(raw) && parent ? parent : raw;
  return chosen.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Weapon family for a section, specialising guns by their reference name. */
function weaponTypeFor(section, refName) {
  const base = WEAPON_SECTION_TYPES[section];
  if (base === "gun") {
    if (/rifle/i.test(refName)) return "rifle";
    if (/carbine|blunderbuss|musketoon/i.test(refName)) return "carbine";
    if (/musket/i.test(refName)) return "musket";
  }
  return base;
}

/** Build `{ key → column index }` from the header row. */
function buildHeaderIndex(headers) {
  const normalized = headers.map(normHeader);
  const find = (...aliases) => {
    for (const alias of aliases) {
      const i = normalized.indexOf(alias);
      if (i >= 0) return i;
    }
    return undefined;
  };
  return {
    name: 0,
    atk: find("atk", "attack"),
    def: find("def", "defense", "defence"),
    mag: find("magpwr", "magatk", "magicpower", "mag"),
    res: find("magresis", "magres", "magrst", "magicresist", "mres"),
    spd: find("spd", "speed"),
    eva: find("eva", "evade", "evasion"),
    jump: find("jump"),
    range: find("range"),
    cost: find("cost"),
    skills: find("skillsap", "skills", "skill"),
    effect: find("specialeffect", "effect"),
  };
}

/** Parse the skills cell into `{ job, name, ap }` records. */
export function parseSkillLines(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /^none$/i.test(trimmed)) continue;
    const match = trimmed.match(/^(.*?):\s*(.*?)\s*\((\d+)(?:\s*AP)?\)\s*$/i);
    if (!match) continue;
    const jobs = match[1]
      .split("/")
      .map((job) => job.trim())
      .filter(Boolean);
    const name = cleanInline(match[2]);
    const ap = Number(match[3]);
    if (!name || !Number.isFinite(ap)) continue;
    out.push({ jobs, name, ap });
  }
  return out;
}

/** Classify a continuation cell into element / effect / (ignored) flavour. */
function classifyNotes(text, target) {
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const element = trimmed.match(/^Element:\s*(.+)$/i);
    if (element) {
      const key = ELEMENT_NAMES[cleanInline(element[1]).toLowerCase()];
      if (key) target.element = key;
      continue;
    }
    const effect = trimmed.match(/^Effect:\s*(.+)$/i);
    if (effect) target.effects.push(cleanInline(effect[1]));
    // Anything else is the wiki's italic flavour line — read and discarded.
  }
}

/**
 * Read every equipment table out of one reference file.
 * Returns reference-shaped records (NOT yet our data).
 */
export function extractReferenceItems(wikitext) {
  const items = [];
  for (const { path, tableText } of extractTables(wikitext)) {
    const section = sectionKey(path);
    const slot = ARMOR_SECTION_SLOTS[section];
    const weaponType = WEAPON_SECTION_TYPES[section];
    if (!slot && !weaponType) continue;

    const table = parseWikiTable(tableText);
    if (!table) continue;
    const idx = buildHeaderIndex(table.headers);
    if (idx.name === undefined || table.rows.length === 0) continue;

    const number = (row, column) => {
      if (column === undefined) return 0;
      const raw = String(row[column] ?? "").replace(/[^0-9.-]/g, "");
      const value = Number(raw);
      return Number.isFinite(value) ? value : 0;
    };

    let owner = null;
    for (let r = 0; r < table.rows.length; r++) {
      const row = table.rows[r];
      if (table.cont[r]) {
        if (owner) classifyNotes(row[1] ?? row[0] ?? "", owner);
        continue;
      }
      const refName = cleanInline(row[idx.name] ?? "");
      if (!refName) {
        owner = null;
        continue;
      }
      owner = {
        section,
        refName,
        slot,
        weaponType: weaponType ? weaponTypeFor(section, refName) : undefined,
        stats: {
          atk: number(row, idx.atk),
          def: number(row, idx.def),
          mag: number(row, idx.mag),
          res: number(row, idx.res),
          spd: number(row, idx.spd),
          eva: number(row, idx.eva),
          jump: number(row, idx.jump),
          range: number(row, idx.range),
        },
        cost: number(row, idx.cost),
        skills: parseSkillLines(row[idx.skills] ?? ""),
        element: undefined,
        effects: [],
      };
      items.push(owner);
    }
  }
  return items;
}

/* ==========================================================================
 * 6. Re-authoring (our balance + original fiction)
 * ======================================================================== */

/** Scale factors from reference numerals to our detachment-scale modifiers. */
const STAT_SCALE = { atk: 0.4, def: 0.4, mag: 0.4, res: 0.5, spd: 0.5 };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Round to the nearest `step` (our authored number hygiene). */
const roundTo = (value, step) => Math.round(value / step) * step;

/** Convert a reference AP cost into our Drill cost (bounded, rounded). */
export function reauthorDrill(referenceAp) {
  return clamp(roundTo(referenceAp / 4, 10), 40, 400);
}

/** Re-author the reference stat line as our flat modifiers. */
export function deriveStats(refStats) {
  const scale = (key) => Math.round((refStats[key] || 0) * STAT_SCALE[key]);
  return {
    hp: 0,
    mp: 0,
    atk: scale("atk"),
    def: scale("def"),
    mag: scale("mag"),
    res: scale("res"),
    spd: scale("spd"),
    move: 0,
    jump: refStats.jump > 0 ? Math.round(refStats.jump) : 0,
  };
}

/** Re-author the item cost from its derived stats (never copied from the wiki). */
export function deriveCost(stats) {
  const base =
    40 +
    stats.atk * 50 +
    stats.def * 40 +
    Math.abs(stats.mag) * 30 +
    stats.res * 25 +
    Math.max(0, stats.spd) * 15;
  return clamp(roundTo(base, 10), 40, 2500);
}

/** The single largest derived modifier — used to rank an item's quality tier. */
function primaryModifier(stats) {
  return Math.max(stats.atk, stats.def, stats.mag, stats.res, stats.spd, 1);
}

/** Map a reference effect/condition keyword to our condition id. */
function conditionsFromEffects(effects) {
  const found = new Set();
  for (const effect of effects) {
    const lower = effect.toLowerCase();
    for (const [keyword, id] of CONDITION_KEYWORDS) {
      if (lower.includes(keyword)) found.add(id);
    }
  }
  return [...found];
}

/** Original noun for an item, from its weapon family or armour section. */
function nounFor(item) {
  return SECTION_NOUNS[item.section] || WEAPON_NOUNS[item.weaponType] || "Kit";
}

/** Resolve the first recognised FFTA job in a skill to our post + power. */
function postForSkills(skills) {
  for (const skill of skills) {
    for (const job of skill.jobs) {
      const key = job
        .toLowerCase()
        .replace(/[^a-z ]/g, "")
        .trim();
      if (JOB_TO_POST[key]) return JOB_TO_POST[key];
    }
  }
  return null;
}

/** Roman numeral for small positive integers (I … XX). */
const ROMAN = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
  "XVI",
  "XVII",
  "XVIII",
  "XIX",
  "XX",
];
function roman(n) {
  return ROMAN[n - 1] || String(n);
}

/** Slug a label into a stable, lower-case id fragment. */
export function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const STAT_WORDS = [
  ["atk", "Steel"],
  ["def", "Guard"],
  ["mag", "Powder"],
  ["res", "Faith"],
  ["spd", "Speed"],
  ["hp", "HP"],
  ["mp", "Élan"],
];

/** Build our original description text from the derived stats + teaches. */
function describeItem(stats, teaches) {
  const parts = [];
  for (const [key, label] of STAT_WORDS) {
    if (stats[key]) parts.push(`${stats[key] > 0 ? "+" : ""}${stats[key]} ${label}`);
  }
  if (teaches.length) {
    parts.push(`Teaches ${teaches.map((t) => t.name).join(", ")}`);
  }
  return parts.length ? `${parts.join(", ")}.` : "Plain campaign issue.";
}

/* --------------------------------------------------------------------------
 * Ability re-authoring
 * ------------------------------------------------------------------------ */

/** Keyword → original Napoleonic action word (never copies the reference name). */
const ABILITY_KEYWORDS = [
  [/\bfire\b|\bflame\b|\bblaze\b|\bincendiary\b/i, "Incendiary"],
  [/\bice\b|\bcold\b|\bfrost\b|\bflurry\b|\bsnow\b/i, "Cold"],
  [/\bbolt\b|\blightning\b|\bthunder\b|\bshock\b/i, "Shock"],
  [/\bearth\b|\bquake\b|\bbreak\b|\bshatter\b/i, "Siege"],
  [/\bwater\b|\baqua\b|\bdrown\b/i, "Deluge"],
  [/\bwind\b|\baero\b|\bgale\b|\bcyclone\b/i, "Smoke"],
  [/\bholy\b|\bsaint\b|\bbless\b|\bwhite wind\b/i, "Colours"],
  [/\bdark\b|\bshadow\b|\bnight\b/i, "Terror"],
  [/\bcure\b|\bheal\b|\brestore\b|\bremedy\b|\blast rites\b/i, "Field Dressing"],
  [/\bpoison\b|\bvenom\b|\btoxin\b/i, "Bleeding"],
  [/\bblind\b|\bdaze\b/i, "Daze"],
  [/\bsleep\b|\bslumber\b|\bnightmare\b/i, "Unconscious"],
  [/\bhaste\b|\bquick\b|\bhaste\b/i, "Double-Quick"],
  [/\bslow\b|\bdelay\b|\bbog\b/i, "Bog"],
  [/\bcombo\b|\bvolley\b/i, "Volley"],
  [/\bfight\b|\bstrike\b|\bslash\b|\bcut\b|\bbeatdown\b/i, "Sabre Cut"],
  [/\baim\b|\bprecision\b|\bsnipe\b|\bmark\b/i, "Mark"],
  [/\bguard\b|\bshield\b|\bparry\b|\bprotect\b/i, "Form Square"],
  [/\bcounter\b|\briposte\b|\breturn\b/i, "Riposte"],
  [/\bsteal\b|\bforage\b|\bcatch\b|\bmug\b/i, "Forage"],
  [/\bsummon\b|\bultima\b|\bmog\b/i, "Grand Battery"],
  [/\bjump\b|\bcharge\b|\bimpale\b|\bwyrm/i, "Couched Charge"],
];

/** Original fallback noun per post role. */
const ROLE_NOUNS = {
  Fusilier: "Volley",
  Forager: "Forage",
  Marksman: "Mark",
  Surgeon: "Dressing",
  Artilleryman: "Shell",
  Grenadier: "Grenade",
  "Colour Guard": "Standard",
  Hussar: "Sabre",
  Chasseur: "Hunt",
  "Intelligence Officer": "Cipher",
  Bombardier: "Bomb",
  "Line Grenadier": "Bayonet",
  "Assault Pioneer": "Pioneer",
  Chaplain: "Blessing",
  Cuirassier: "Cuirass",
  Lancer: "Lance",
  "Shock Grenadier": "Shock",
  "Line Officer": "Order",
  Partisan: "Ambush",
  Sapper: "Sap",
  Signaller: "Signal",
  Impersonator: "Disguise",
  "Master Gunner": "Gun",
  "Staff Officer": "Dispatch",
  Sabreur: "Fence",
  Rifleman: "Rifle",
  Sharpshooter: "Sharpshoot",
  Adjutant: "Aide",
  Rocketeer: "Rocket",
  "Long Rifle": "Assassinate",
  Commodore: "Broadside",
  Scout: "Scout",
  Engineer: "Contraption",
};

/** Pick the original base word for an ability without reusing the reference name. */
function abilityBaseWord(skill, role) {
  for (const [pattern, word] of ABILITY_KEYWORDS) {
    if (pattern.test(skill.name)) return word;
  }
  return ROLE_NOUNS[role] || "Drilled";
}

/** The element an ability's reference name implies, if any. */
function abilityElement(skill) {
  const lower = skill.name.toLowerCase();
  for (const [name, key] of Object.entries(ELEMENT_NAMES)) {
    if (lower.includes(name)) return key;
  }
  return undefined;
}

/* ==========================================================================
 * 7. The conversion
 * ======================================================================== */

/**
 * Convert reference items into validated `EquipmentDef` / `AbilityDef` records.
 * Deterministic: identity depends only on the input order and values.
 */
export function convertReferenceItems(items) {
  const abilities = [];
  const abilityByRefName = new Map();
  const equipment = [];

  // Quality tiers are relative to the strongest item in the same table.
  const sectionPeak = new Map();
  for (const item of items) {
    const peak = primaryModifier(deriveStats(item.stats));
    sectionPeak.set(item.section, Math.max(sectionPeak.get(item.section) || 0, peak));
  }
  const tierCounts = new Map();

  items.forEach((item, index) => {
    const stats = deriveStats(item.stats);
    const peak = sectionPeak.get(item.section) || 1;
    const tier = clamp(Math.round((primaryModifier(stats) / peak) * 5), 0, 5);
    const noun = nounFor(item);
    const countKey = `${item.section}|${tier}`;
    const seen = tierCounts.get(countKey) || 0;
    tierCounts.set(countKey, seen + 1);
    const baseName = `${QUALITY_TIERS[tier]} ${noun}`;
    const name = seen === 0 ? baseName : `${baseName} ${roman(seen + 1)}`;

    // Abilities are deduplicated by their reference name; the first job wins.
    const teaches = [];
    for (const skill of item.skills) {
      let ability = abilityByRefName.get(skill.name);
      if (!ability) {
        const post =
          JOB_TO_POST[
            skill.jobs[0]
              ?.toLowerCase()
              .replace(/[^a-z ]/g, "")
              .trim()
          ];
        const role = post?.role || "Common";
        const word = abilityBaseWord(skill, role);
        const duplicate = abilities.filter((a) => a.name.replace(/\s[IVX]+$/, "") === word).length;
        const abilityName = duplicate === 0 ? word : `${word} ${roman(duplicate + 1)}`;
        const drill = reauthorDrill(skill.ap);
        const def = AbilityDefSchema.parse({
          id: `${slug(role)}-kit-${String(abilities.length).padStart(3, "0")}`,
          name: abilityName,
          description: `${role} action. Costs ${clamp(
            Math.round(drill / 40),
            0,
            24,
          )} Élan; Power ${clamp(Math.round(drill / 3), 10, 90)}.`,
          flavour: `Drilled in the ${role} tradition, where a steady hand and a clear order carry the field.`,
          abilityClass: "action",
          skillsetId: `${slug(role)}-kit`,
          postId: post ? slug(role) : undefined,
          mpCost: clamp(Math.round(drill / 40), 0, 24),
          chargeTime: clamp(Math.round(drill / 20), 0, 40),
          power: clamp(Math.round(drill / 3), 10, 90),
          range: 1,
          element: abilityElement(skill),
          ap: drill,
        });
        ability = { name: def.name, id: def.id, def };
        abilityByRefName.set(skill.name, ability);
        abilities.push(def);
      }
      teaches.push({ abilityId: ability.id, ap: reauthorDrill(skill.ap), name: ability.name });
    }

    const post = postForSkills(item.skills);
    const def = EquipmentDefSchema.parse({
      id: `kit-${slug(item.section)}-${String(index).padStart(4, "0")}`,
      name,
      description: describeItem(stats, teaches),
      flavour:
        FLAVOUR_BY_FAMILY[item.weaponType] ||
        "Campaign issue, maintained by the quartermaster's stores.",
      slot: item.slot || "weapon",
      weaponType: item.weaponType,
      cost: deriveCost(stats),
      power: post?.power,
      element: item.element,
      stats,
      teaches: teaches.map(({ abilityId, ap }) => ({ abilityId, ap })),
      inflicts: conditionsFromEffects(item.effects),
    });
    equipment.push(def);
  });

  return { equipment, abilities };
}

/** Convenience wrapper: convert one or more wikitext sources end-to-end. */
export function convertWikiSources({ weapons = "", armor = "" } = {}) {
  return convertReferenceItems([
    ...extractReferenceItems(weapons),
    ...extractReferenceItems(armor),
  ]);
}

/** Read the bundled mirror from `docs/wiki/raw/`. */
export function loadReferenceSources() {
  return {
    weapons: readFileSync(join(REFERENCE_DIR, WEAPONS_FILE), "utf8"),
    armor: readFileSync(join(REFERENCE_DIR, ARMOR_FILE), "utf8"),
  };
}

/** Validate a converted slice against the content schemas. Throws on failure. */
export function validateConverted(converted) {
  const equipment = converted.equipment.map((entry) => EquipmentDefSchema.parse(entry));
  const abilities = converted.abilities.map((entry) => AbilityDefSchema.parse(entry));
  return { equipment, abilities };
}

/* ==========================================================================
 * 8. CLI (the only place with side effects)
 * ======================================================================== */

function main() {
  const args = process.argv.slice(2);
  const sources = args.includes("--stdin")
    ? { weapons: readFileSync(0, "utf8"), armor: "" }
    : loadReferenceSources();

  const converted = convertWikiSources(sources);
  const validated = validateConverted(converted);

  const outIndex = args.indexOf("--out");
  if (outIndex >= 0 && args[outIndex + 1]) {
    writeFileSync(args[outIndex + 1], `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    console.log(`wrote ${args[outIndex + 1]}`);
  }

  console.log(
    `converted ${validated.equipment.length} equipment and ${validated.abilities.length} abilities`,
  );
  if (!args.includes("--out") && !args.includes("--quiet")) {
    const bySlot = {};
    for (const item of validated.equipment) bySlot[item.slot] = (bySlot[item.slot] || 0) + 1;
    console.log("by slot:", bySlot);
  }
}

// Only run when executed directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
