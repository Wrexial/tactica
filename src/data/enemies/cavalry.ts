/**
 * Heavy and light horse — the "dragon-type" irregulars (mapping §11).
 *
 * FFTA's dragons become **heavy cavalry and armoured troops**: cuirassiers who
 * break a line at the gallop, hussars who ride the flanks and refuse a
 * stand-up fight, and uhlans who break squares with the lance. They are fast,
 * they flank, and they are never taken alive.
 */

import { parseEnemies } from "./shared";

/** Mounted troops, from flank patrol to line-breaking heavy horse. */
export const CAVALRY = parseEnemies({
  "hussar-patrol": {
    name: "Hussar Patrol",
    description:
      "Fast light horse that rides the flanks, cuts down stragglers and refuses a stand-up fight.",
    flavour: "A hussar will steal your horse, your dinner and your dispatch, in that order.",
    family: "cavalry",
    level: 3,
    stats: { hp: 62, mp: 12, atk: 34, def: 22, mag: 10, res: 18, spd: 52, move: 7, jump: 2 },
    affinities: { earth: "weak" },
    abilities: ["sabre-cut", "ride-down", "trot-to-gallop"],
    drops: [
      { itemId: "cavalry-sabre", weight: 2 },
      { itemId: "hussar-dolman", weight: 2 },
      { itemId: "brandy-flask", weight: 2 },
    ],
    capturable: false,
    aiProfile: "cavalry",
    exp: 38,
    ap: 12,
  },

  "uhlan-lancer": {
    name: "Uhlan Lancer",
    description: "Lancers with a long reach and a taste for broken squares.",
    flavour: "The lance is a one-stroke argument, and the uhlan has already made it.",
    family: "cavalry",
    level: 4,
    stats: { hp: 70, mp: 12, atk: 40, def: 28, mag: 10, res: 20, spd: 46, move: 6, jump: 2 },
    affinities: { fire: "weak" },
    abilities: ["lance-charge", "lance-point", "couched-charge"],
    drops: [
      { itemId: "uhlan-lance", weight: 2 },
      { itemId: "peaked-cap", weight: 2 },
      { itemId: "cavalry-carbine", weight: 1 },
    ],
    capturable: false,
    aiProfile: "cavalry",
    exp: 46,
    ap: 15,
  },

  "cuirassier-squadron": {
    name: "Cuirassier Squadron",
    description: "Armoured heavy horse built to break a line at the gallop.",
    flavour: "Breastplate, straight sword and the sound of hooves; the rest is arithmetic.",
    family: "cavalry",
    level: 5,
    stats: { hp: 78, mp: 12, atk: 42, def: 34, mag: 10, res: 22, spd: 40, move: 6, jump: 2 },
    affinities: { lightning: "weak", earth: "resist" },
    abilities: ["armoured-charge", "ride-them-down", "couched-charge"],
    drops: [
      { itemId: "dragoon-sabre", weight: 2 },
      { itemId: "dragoon-helmet", weight: 2 },
      { itemId: "cuirass", weight: 1 },
    ],
    capturable: false,
    aiProfile: "cavalry",
    exp: 50,
    ap: 16,
  },
} as const);
