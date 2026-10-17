/**
 * Named commanders and guard formations — the "boss monster" irregulars
 * (mapping §11).
 *
 * FFTA's boss monsters become **named enemy generals and guard formations**:
 * a company captain, a general of brigade, and the elite detachment that has
 * never left a field it did not take. They steady the line, call in support
 * and are never capturable — a captured general is a story event, not a loot
 * roll.
 */

import { parseEnemies } from "./shared";

/** Enemy leadership and elite guard, in ascending order of rank. */
export const COMMAND = parseEnemies({
  "enemy-captain": {
    name: "Enemy Captain",
    description: "A company commander; steadies the line and calls in support.",
    flavour:
      "He is the only man on the field whose death would be worth a paragraph in the dispatch.",
    family: "command",
    level: 5,
    stats: { hp: 72, mp: 16, atk: 34, def: 28, mag: 22, res: 24, spd: 40, move: 4, jump: 2 },
    affinities: { dark: "resist" },
    abilities: ["commanding-voice", "rally-round", "dressing-down"],
    drops: [
      { itemId: "officers-sabre", weight: 1 },
      { itemId: "officers-coat", weight: 1 },
      { itemId: "medal-of-honour", weight: 1 },
    ],
    capturable: false,
    aiProfile: "commander",
    exp: 48,
    ap: 16,
  },

  "enemy-general": {
    name: "Enemy General",
    description: "A general of brigade with a mounted staff and the ear of the whole field.",
    flavour: "His orders move battalions he cannot see; his mistakes are reckoned in widows.",
    family: "command",
    level: 7,
    stats: { hp: 92, mp: 24, atk: 42, def: 34, mag: 30, res: 30, spd: 44, move: 5, jump: 2 },
    element: "holy",
    affinities: { dark: "weak", holy: "resist" },
    abilities: ["commanding-voice", "steady-the-line", "re-form", "well-timed-order"],
    drops: [
      { itemId: "officers-sabre", weight: 1 },
      { itemId: "officers-coat", weight: 1 },
      { itemId: "medal-of-honour", weight: 1 },
      { itemId: "map-case", weight: 1 },
    ],
    capturable: false,
    aiProfile: "commander",
    exp: 80,
    ap: 24,
  },

  "old-guard-detachment": {
    name: "Old Guard Detachment",
    description: "An elite grenadier detachment that has never left a field it did not take.",
    flavour:
      "They advance at the walk because they have no reason to hurry; the field is already theirs.",
    family: "command",
    level: 8,
    stats: { hp: 96, mp: 18, atk: 48, def: 40, mag: 12, res: 28, spd: 42, move: 5, jump: 2 },
    element: "lightning",
    affinities: { dark: "immune", fire: "resist" },
    abilities: ["heavy-volley", "hold-the-line", "bayonet-charge", "ground-the-arms"],
    drops: [
      { itemId: "grenadier-broadsword", weight: 1 },
      { itemId: "grenadier-coat", weight: 1 },
      { itemId: "stovepipe-shako", weight: 1 },
    ],
    capturable: false,
    aiProfile: "fanatic",
    exp: 90,
    ap: 28,
  },
} as const);
