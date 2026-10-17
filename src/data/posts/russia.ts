/**
 * Russia — the artillery and engineer school (Nu mou in FFTA), mapping §3.
 *
 * Russia's identity is massed ordnance, sappers and stubborn resilience. The
 * Nu mou's "magic" becomes guns, powder and fieldworks here (mapping D9:
 * grounded — no literal spells), while the growth shape stays technical and
 * slow. The common Surgeon, Artilleryman and Staff Officer cover the rest.
 */

import { FULL_KIT, SHOULDER_KIT, parsePosts } from "./shared";

export const RUSSIA_POSTS = parsePosts({
  /** FFTA Beastmaster. */
  partisan: {
    name: "Partisan",
    description:
      "Irregular officer who raises and directs local levies, hounds and bands of auxiliaries.",
    flavour:
      "A partisan knows every ford and farm track, and turns a whole countryside into a trap.",
    power: "russia",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["sabre", "instrument"],
    growth: { hp: 7.4, mp: 2.1, atk: 8.8, def: 8.8, mag: 6.8, res: 8.4, spd: 1.2 },
    skillsetIds: ["partisan-kit"],
  },

  /** FFTA Alchemist. */
  sapper: {
    name: "Sapper",
    description:
      "Grenades, charges and tools; throws items, undermines works and sabotages enemy ground.",
    flavour: "A sapper measures success in inches of earth moved and in what the enemy no longer has.",
    power: "russia",
    equipSlots: FULL_KIT,
    weaponTypes: ["tool", "gun"],
    growth: { hp: 6.6, mp: 3.0, atk: 7.4, def: 8.2, mag: 8.2, res: 8.6, spd: 1.2 },
    skillsetIds: ["sapper-kit"],
    requires: [{ postId: "partisan", abilities: 2 }],
  },

  /** FFTA Illusionist. */
  signaller: {
    name: "Signaller",
    description:
      "Flags, rockets and mirrors that strike a whole class of target at range without a line of sight.",
    flavour: "The signaller's rocket is a message the whole enemy line is obliged to read.",
    power: "russia",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["instrument", "staff"],
    growth: { hp: 5.8, mp: 4.2, atk: 6.2, def: 6.8, mag: 9.2, res: 9.0, spd: 1.1 },
    skillsetIds: ["signaller-kit"],
    requires: [{ postId: "sapper", abilities: 2 }],
  },

  /** FFTA Morpher. */
  impersonator: {
    name: "Impersonator",
    description:
      "Assumes a captured identity and its methods, copying an enemy's form and actions for a time.",
    flavour: "A stolen coat and a confident accent have opened more gates than any battery.",
    power: "russia",
    equipSlots: FULL_KIT,
    weaponTypes: ["sabre", "tool"],
    growth: { hp: 6.8, mp: 2.8, atk: 7.8, def: 7.6, mag: 8.0, res: 8.0, spd: 1.4 },
    skillsetIds: ["impersonator-kit"],
    requires: [{ postId: "partisan", abilities: 3 }],
  },

  /** FFTA Sage. */
  "master-gunner": {
    name: "Master Gunner",
    description:
      "High-tier ordnance: heavy shot, ranging fire and the judgement to place a battery's whole weight.",
    flavour: "The master gunner talks in angles and elevation, and the enemy answers in wreckage.",
    power: "russia",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["gun", "staff"],
    growth: { hp: 6.0, mp: 4.0, atk: 6.6, def: 7.0, mag: 9.6, res: 9.2, spd: 1.0 },
    skillsetIds: ["master-gunner-kit"],
    requires: [{ postId: "sapper", abilities: 3 }],
  },
});
