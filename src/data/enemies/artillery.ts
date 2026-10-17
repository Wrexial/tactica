/**
 * Petard crews and gun lines — the "bomb / flan / summoned" irregulars
 * (mapping §11).
 *
 * Bombs and flans become **petard and powder crews**; the summoned creatures
 * become **massed batteries**. All of them fight at range, work in smoke and
 * fire, and never seek a bayonet. The light crews may be taken prisoner; the
 * guns themselves never are.
 */

import { parseEnemies } from "./shared";

/** Powder crews and artillery sections, in ascending order of weight of shot. */
export const ARTILLERY = parseEnemies({
  "petard-crew": {
    name: "Petard Crew",
    description: "Engineers with fuses, grenades and no interest in a fair exchange of musketry.",
    flavour:
      "Their answer to a defended gate is the same as their answer to most questions: more powder.",
    family: "petard",
    level: 3,
    stats: { hp: 50, mp: 14, atk: 24, def: 18, mag: 26, res: 16, spd: 36, move: 4, jump: 2 },
    element: "fire",
    affinities: { water: "weak", fire: "resist" },
    abilities: ["grenade-lob", "grenade-toss", "field-contraption"],
    drops: [
      { itemId: "sappers-tools", weight: 2 },
      { itemId: "powder-flask", weight: 3 },
      { itemId: "artillery-apron", weight: 2 },
    ],
    capturable: true,
    aiProfile: "artillery",
    exp: 26,
    ap: 8,
  },

  "powder-team": {
    name: "Powder Team",
    description:
      "Shells, carcasses and smoke; they work the chaos of a bombardment close to the line.",
    flavour: "They measure nothing twice; the first measure is the one they trust.",
    family: "petard",
    level: 4,
    stats: { hp: 54, mp: 16, atk: 25, def: 20, mag: 32, res: 18, spd: 34, move: 4, jump: 2 },
    element: "fire",
    affinities: { water: "weak", fire: "immune" },
    abilities: ["grenade-volley", "smoke-screen", "carcass-fire"],
    drops: [
      { itemId: "artillery-apron", weight: 2 },
      { itemId: "powder-flask", weight: 2 },
      { itemId: "congreve-rocket", weight: 1 },
    ],
    capturable: false,
    aiProfile: "artillery",
    exp: 34,
    ap: 10,
  },

  "six-pounder-section": {
    name: "Six-Pounder Section",
    description: "A light field gun and its crew; solid shot at range, canister at the last.",
    flavour:
      "The gun is small, the crew is quick, and the space between them and the enemy is their business.",
    family: "battery",
    level: 4,
    stats: { hp: 60, mp: 18, atk: 30, def: 24, mag: 34, res: 20, spd: 30, move: 4, jump: 1 },
    element: "lightning",
    affinities: { wind: "weak" },
    abilities: ["solid-shot", "canister-shot", "case-shot"],
    drops: [
      { itemId: "six-pounder", weight: 1 },
      { itemId: "cartridge-box", weight: 2 },
      { itemId: "artillery-apron", weight: 2 },
    ],
    capturable: false,
    aiProfile: "artillery",
    exp: 36,
    ap: 12,
  },

  "howitzer-section": {
    name: "Howitzer Section",
    description: "A high-angle piece that drops shell and carcass behind cover and into villages.",
    flavour: "It does not need to see you; it only needs to know where you are.",
    family: "battery",
    level: 5,
    stats: { hp: 64, mp: 20, atk: 30, def: 25, mag: 40, res: 22, spd: 28, move: 4, jump: 1 },
    element: "fire",
    affinities: { water: "weak", fire: "resist" },
    abilities: ["shell-fire", "carcass-fire", "ranging-shot"],
    drops: [
      { itemId: "powder-flask", weight: 2 },
      { itemId: "spyglass", weight: 1 },
      { itemId: "field-notebook", weight: 1 },
    ],
    capturable: false,
    aiProfile: "artillery",
    exp: 44,
    ap: 14,
  },

  "rocket-troop": {
    name: "Rocket Troop",
    description: "Congreve frames on tripods; wildly inaccurate and terrifying all the same.",
    flavour: "Nobody, least of all the crew, knows quite where this one will land.",
    family: "battery",
    level: 4,
    stats: { hp: 52, mp: 18, atk: 28, def: 20, mag: 34, res: 18, spd: 34, move: 5, jump: 1 },
    element: "lightning",
    affinities: { fire: "weak" },
    abilities: ["congreve-salvo", "rocket-ladder", "signal-flare"],
    drops: [
      { itemId: "congreve-rocket", weight: 2 },
      { itemId: "gadget-case", weight: 1 },
      { itemId: "powder-flask", weight: 2 },
    ],
    capturable: false,
    aiProfile: "artillery",
    exp: 38,
    ap: 12,
  },
} as const);
