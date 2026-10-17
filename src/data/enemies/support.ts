/**
 * Observers, signallers and pioneers — the "floateye / technical" irregulars
 * (mapping §11).
 *
 * FFTA's floateyes become **observation balloons and signal parties**; its
 * technical monsters become **sapper and pioneer sections** that open breaches,
 * clear works and bridge the ground for the rest of the line. They support
 * rather than charge, and several may be taken prisoner into the **Auxiliary
 * Barracks** (T078).
 */

import { parseEnemies } from "./shared";

/** Signal, observation and engineering troops. */
export const SUPPORT = parseEnemies({
  "observation-balloon": {
    name: "Observation Balloon",
    description:
      "A tethered balloon and its observers; it sees the whole field and signals what it sees.",
    flavour: "It cannot fight, and it cannot be ignored.",
    family: "observer",
    level: 3,
    stats: { hp: 40, mp: 16, atk: 8, def: 12, mag: 20, res: 24, spd: 30, move: 3, jump: 0 },
    element: "wind",
    affinities: { fire: "weak", lightning: "immune" },
    abilities: ["scout-ahead", "ranging-signal", "signal-flare"],
    drops: [
      { itemId: "spyglass", weight: 2 },
      { itemId: "signal-mirror", weight: 2 },
      { itemId: "map-case", weight: 1 },
    ],
    capturable: false,
    aiProfile: "commander",
    exp: 24,
    ap: 10,
  },

  "signal-party": {
    name: "Signal Party",
    description: "Flagmen and trumpeters who pass orders along a broken line.",
    flavour: "When the smoke hides the colours, the signal flag is the only voice left.",
    family: "observer",
    level: 3,
    stats: { hp: 46, mp: 18, atk: 16, def: 16, mag: 24, res: 20, spd: 42, move: 4, jump: 2 },
    element: "holy",
    affinities: { dark: "weak" },
    abilities: ["signal-to-engage", "well-timed-order", "rally-round"],
    drops: [
      { itemId: "signal-staff", weight: 2 },
      { itemId: "regimental-drum", weight: 2 },
      { itemId: "dispatch-case", weight: 1 },
    ],
    capturable: true,
    aiProfile: "commander",
    exp: 24,
    ap: 8,
  },

  "sapper-party": {
    name: "Sapper Party",
    description: "Picks, powder and sandbags; they open a breach and clear the works behind it.",
    flavour: "The sapper is paid to walk toward the thing everyone else is walking away from.",
    family: "pioneer",
    level: 4,
    stats: { hp: 58, mp: 12, atk: 28, def: 26, mag: 16, res: 18, spd: 34, move: 4, jump: 2 },
    element: "earth",
    affinities: { lightning: "weak" },
    abilities: ["charge-the-sap", "clear-the-works", "repair-works"],
    drops: [
      { itemId: "pioneer-axe", weight: 2 },
      { itemId: "sappers-tools", weight: 2 },
      { itemId: "cartridge-box", weight: 2 },
    ],
    capturable: true,
    aiProfile: "aggressive",
    exp: 30,
    ap: 10,
  },

  "pioneer-section": {
    name: "Pioneer Section",
    description: "Road-makers and bridge-wreckers; slow, stubborn and hard to dislodge.",
    flavour:
      "An army walks on the roads the pioneers built and stops at the bridges they left standing.",
    family: "pioneer",
    level: 4,
    stats: { hp: 66, mp: 12, atk: 32, def: 30, mag: 14, res: 20, spd: 32, move: 4, jump: 2 },
    element: "earth",
    affinities: { water: "resist" },
    abilities: ["pioneer-charge", "clear-the-works", "hold-the-line"],
    drops: [
      { itemId: "pioneer-axe", weight: 2 },
      { itemId: "padded-jacket", weight: 2 },
      { itemId: "water-canteen", weight: 2 },
    ],
    capturable: true,
    aiProfile: "defensive",
    exp: 32,
    ap: 10,
  },
} as const);
