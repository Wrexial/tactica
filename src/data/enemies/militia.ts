/**
 * Militia and deserters — the "goblin / soldier-type" irregulars (mapping §11).
 *
 * The weakest rung of the enemy roster: green levies, half-trained townsmen, a
 * trained soldier who has walked away from the colours, and the veteran
 * serjeant who holds them together. They fight at musket range, break early,
 * and are worth taking prisoner into the **Auxiliary Barracks** (T078).
 */

import { parseEnemies } from "./shared";

/** Militia, levies and deserters, in ascending order of steadiness. */
export const MILITIA = parseEnemies({
  "militia-conscript": {
    name: "Militia Conscript",
    description: "Green levies in loose order; a musket, a coat and very little drill.",
    flavour:
      "Called from the fields with a piece older than their fathers, they stand because the alternative is worse.",
    family: "militia",
    level: 1,
    stats: { hp: 44, mp: 6, atk: 21, def: 15, mag: 6, res: 10, spd: 33, move: 4, jump: 2 },
    affinities: { dark: "weak" },
    abilities: ["bayonet-charge", "close-order-drill"],
    drops: [
      { itemId: "pattern-musket", weight: 3 },
      { itemId: "forage-cap", weight: 3 },
      { itemId: "water-canteen", weight: 1 },
    ],
    capturable: true,
    aiProfile: "skittish",
    exp: 10,
    ap: 3,
  },

  "town-levy": {
    name: "Town Levy",
    description: "Burghers and shopkeepers under arms; stubborn on ground they know.",
    flavour: "They will not march far, but they will not give up a street they call their own.",
    family: "militia",
    level: 2,
    stats: { hp: 48, mp: 6, atk: 20, def: 18, mag: 6, res: 12, spd: 34, move: 4, jump: 2 },
    affinities: { earth: "resist" },
    abilities: ["hold-the-line", "snap-shot"],
    drops: [
      { itemId: "land-pattern-musket", weight: 2 },
      { itemId: "padded-jacket", weight: 2 },
      { itemId: "lucky-coin", weight: 1 },
    ],
    capturable: true,
    aiProfile: "defensive",
    exp: 14,
    ap: 4,
  },

  "line-deserter": {
    name: "Line Deserter",
    description:
      "A trained soldier who has left the colours; he knows the drill and wants no part of it.",
    flavour: "He still answers the old words before he remembers he has stopped believing them.",
    family: "militia",
    level: 3,
    stats: { hp: 56, mp: 8, atk: 28, def: 20, mag: 8, res: 14, spd: 40, move: 4, jump: 2 },
    affinities: { holy: "weak" },
    abilities: ["volley-fire", "slip-away", "ground-the-arms"],
    drops: [
      { itemId: "charleville-musket", weight: 2 },
      { itemId: "line-uniform", weight: 2 },
      { itemId: "brandy-flask", weight: 2 },
    ],
    capturable: true,
    aiProfile: "skittish",
    exp: 18,
    ap: 5,
  },

  "veteran-serjeant": {
    name: "Veteran Serjeant",
    description: "A steady old hand who holds a wavering line together by voice and example.",
    flavour:
      "The serjeant does not shout to be heard over the guns; he shouts so the men hear something that is not the guns.",
    family: "militia",
    level: 4,
    stats: { hp: 68, mp: 10, atk: 34, def: 26, mag: 10, res: 18, spd: 38, move: 4, jump: 2 },
    affinities: { dark: "resist" },
    abilities: ["steady-the-line", "bayonet-charge", "re-form"],
    drops: [
      { itemId: "pattern-musket", weight: 1 },
      { itemId: "officers-sabre", weight: 1 },
      { itemId: "medal-of-honour", weight: 1 },
    ],
    capturable: true,
    aiProfile: "commander",
    exp: 26,
    ap: 8,
  },
} as const);
