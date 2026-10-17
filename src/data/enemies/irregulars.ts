/**
 * Guerrilla bands and war hounds — the "malboro / beast" irregulars (mapping §11).
 *
 * Woodcraft fighters, partisan bands raised by a local chief, a patient pass
 * sniper, and the loose packs of hounds a scout runs to flush skirmishers out
 * of cover. They conceal, ambush and fall back; the bands are prime candidates
 * for the **Auxiliary Barracks** (T078).
 */

import { parseEnemies } from "./shared";

/** Guerrilla bands, partisans and their hounds, in ascending order of threat. */
export const IRREGULARS = parseEnemies({
  "blackwood-guerrilla": {
    name: "Blackwood Guerrilla",
    description:
      "Woodcraft skirmishers who fight from cover and melt away before the line replies.",
    flavour: "They know every deer track and every man who ever wronged them.",
    family: "guerrilla",
    level: 3,
    stats: { hp: 52, mp: 10, atk: 27, def: 18, mag: 12, res: 16, spd: 44, move: 5, jump: 3 },
    element: "wind",
    affinities: { fire: "weak" },
    abilities: ["ambush-fire", "concealed-approach", "smoke-screen"],
    drops: [
      { itemId: "hunting-bow", weight: 3 },
      { itemId: "forester-bow", weight: 1 },
      { itemId: "oilskin-cloak", weight: 2 },
    ],
    capturable: true,
    aiProfile: "guerrilla",
    exp: 22,
    ap: 7,
  },

  "pass-sniper": {
    name: "Pass Sniper",
    description: "A patient marksman who has chosen one stretch of road and learned it by heart.",
    flavour: "He has spent three days in the same hollow, and he will spend three more.",
    family: "guerrilla",
    level: 3,
    stats: { hp: 48, mp: 10, atk: 30, def: 16, mag: 10, res: 14, spd: 45, move: 4, jump: 3 },
    affinities: { dark: "weak" },
    abilities: ["silent-ball", "concealed-approach", "aim-vitals"],
    drops: [
      { itemId: "jaeger-rifle", weight: 2 },
      { itemId: "rifled-piece", weight: 1 },
      { itemId: "powder-flask", weight: 2 },
    ],
    capturable: true,
    aiProfile: "skirmisher",
    exp: 28,
    ap: 8,
  },

  "partisan-band": {
    name: "Partisan Band",
    description:
      "Irregulars raised by a local chief; they rally one another and rarely fight fair.",
    flavour: "A partisan is a patriot to his village and a bandit to the tax collector.",
    family: "guerrilla",
    level: 4,
    stats: { hp: 60, mp: 12, atk: 31, def: 21, mag: 12, res: 18, spd: 46, move: 5, jump: 3 },
    element: "wind",
    affinities: { lightning: "weak" },
    abilities: ["rally-the-irregulars", "quiet-loosing", "slip-away"],
    drops: [
      { itemId: "hunting-bow", weight: 2 },
      { itemId: "jaeger-rifle", weight: 1 },
      { itemId: "hunting-horn", weight: 2 },
    ],
    capturable: true,
    aiProfile: "guerrilla",
    exp: 30,
    ap: 9,
  },

  "scout-hounds": {
    name: "Scout Hounds",
    description: "A loose pack of war dogs used to flush skirmishers out of cover.",
    flavour:
      "Fast, silent and loyal to whoever feeds them, which is not always the same man twice.",
    family: "hound",
    level: 2,
    stats: { hp: 44, mp: 4, atk: 26, def: 14, mag: 4, res: 12, spd: 54, move: 6, jump: 3 },
    element: "wind",
    affinities: { fire: "weak" },
    abilities: ["hunt-the-trail", "cut-and-thrust"],
    drops: [{ itemId: "hunting-horn", weight: 3 }],
    capturable: true,
    aiProfile: "beast",
    exp: 20,
    ap: 6,
  },
} as const);
