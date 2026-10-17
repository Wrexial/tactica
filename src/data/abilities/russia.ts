/**
 * Russia — the artillery, engineer and irregular action sets (mapping §3).
 *
 * Russia masses the guns and the sappers: the Nu mou "magic" reads as
 * ordnance, mines and signals. Each post authors a complete action set; the
 * equipment-bound ids `quiet-loosing`, `charge-the-sap` and `signal-flare`
 * live here (`agents.md` §3, §9).
 */

import { parseAbilities } from "./shared";

export const RUSSIA_ABILITIES = parseAbilities({
  /* ----- Partisan (Beastmaster) ---------------------------------------- */

  "quiet-loosing": {
    name: "Quiet Loosing",
    description: "A silent bowshot from cover that never gives away the archer's position.",
    flavour: "Irregulars and foresters still trust the bow when powder runs wet.",
    abilityClass: "action",
    skillsetId: "partisan-kit",
    postId: "partisan",
    mpCost: 3,
    chargeTime: 0,
    power: 60,
    range: 4,
    ap: 60,
  },

  "ambush-fire": {
    name: "Ambush Fire",
    description: "Open from concealment at close range; the first volley is the most terrible.",
    flavour: "The partisan chooses the ground, the hour, and the first shot.",
    abilityClass: "action",
    skillsetId: "partisan-kit",
    postId: "partisan",
    mpCost: 7,
    chargeTime: 15,
    power: 95,
    range: 3,
    inflicts: ["confuse"],
    ap: 130,
  },

  "rally-the-irregulars": {
    name: "Rally the Irregulars",
    description: "A whistle and a shout bring the scattered bands back to the fight.",
    flavour: "Irregulars do not hold a line; they hold each other.",
    abilityClass: "action",
    skillsetId: "partisan-kit",
    postId: "partisan",
    mpCost: 6,
    chargeTime: 15,
    power: 0,
    range: 4,
    target: "ally",
    aoeShape: "cross",
    aoeSize: 1,
    inflicts: ["boost", "haste"],
    ap: 140,
  },

  /* ----- Sapper (Alchemist) -------------------------------------------- */

  "charge-the-sap": {
    name: "Charge the Sap",
    description: "Pack a mine under a position and blow it; Siege damage across the works.",
    flavour: "A sap charged beneath a bastion lifts the whole wall in a single breath.",
    abilityClass: "action",
    skillsetId: "sapper-kit",
    postId: "sapper",
    mpCost: 11,
    chargeTime: 40,
    power: 100,
    range: 3,
    target: "tile",
    aoeShape: "square",
    aoeSize: 1,
    element: "earth",
    ap: 130,
  },

  "grenade-volley": {
    name: "Grenade Volley",
    description: "Lob a volley of fused grenades over a parapet and into the enemy's cover.",
    flavour: "The grenade ignores the wall because it was never aimed at it.",
    abilityClass: "action",
    skillsetId: "sapper-kit",
    postId: "sapper",
    mpCost: 9,
    chargeTime: 25,
    power: 80,
    range: 4,
    aoeShape: "cross",
    aoeSize: 1,
    element: "fire",
    ap: 140,
  },

  undermine: {
    name: "Undermine",
    description: "Dig beneath a standing structure; the ground gives way and the target is Pinned.",
    flavour: "Walls do not fall to courage; they fall to patience and a good charge.",
    abilityClass: "action",
    skillsetId: "sapper-kit",
    postId: "sapper",
    mpCost: 8,
    chargeTime: 30,
    power: 70,
    range: 2,
    target: "tile",
    aoeShape: "single",
    aoeSize: 0,
    element: "earth",
    inflicts: ["immobilize"],
    ap: 150,
  },

  /* ----- Signaller (Illusionist) --------------------------------------- */

  "signal-flare": {
    name: "Signal Flare",
    description: "Fire a coloured rocket that marks a target for the whole battery.",
    flavour: "Flags, mirrors and rockets speak where the voice cannot reach.",
    abilityClass: "action",
    skillsetId: "signaller-kit",
    postId: "signaller",
    mpCost: 7,
    chargeTime: 20,
    power: 65,
    range: 7,
    aoeShape: "cross",
    aoeSize: 1,
    element: "holy",
    ap: 110,
  },

  "ranging-signal": {
    name: "Ranging Signal",
    description:
      "Walk a ranging shot onto a target, improving every subsequent artillery strike against it.",
    flavour: "One ranging shot is worth a dozen hurried ones.",
    abilityClass: "action",
    skillsetId: "signaller-kit",
    postId: "signaller",
    mpCost: 6,
    chargeTime: 20,
    power: 0,
    range: 7,
    target: "enemy",
    inflicts: ["advice"],
    ap: 130,
  },

  "mark-the-target": {
    name: "Mark the Target",
    description: "Mark a commander for the guns; the next strike against it cannot be evaded.",
    flavour: "The battery cannot see the crossroads; the signaller can.",
    abilityClass: "action",
    skillsetId: "signaller-kit",
    postId: "signaller",
    mpCost: 8,
    chargeTime: 25,
    power: 90,
    range: 8,
    element: "holy",
    inflicts: ["disable"],
    ap: 160,
  },

  /* ----- Impersonator (Morpher) ---------------------------------------- */

  "assume-identity": {
    name: "Assume Identity",
    description:
      "Take on a captured uniform and manner; enemies lose track of the impostor's allegiance.",
    flavour: "A uniform is a password, and a good forger knows every countersign.",
    abilityClass: "action",
    skillsetId: "impersonator-kit",
    postId: "impersonator",
    mpCost: 8,
    chargeTime: 25,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["conceal", "reflect"],
    ap: 160,
  },

  "mimic-drill": {
    name: "Mimic Drill",
    description: "Copy the enemy's own drill and use it against them; strikes with their methods.",
    flavour: "The best disguise is knowing the other man's orders better than he does.",
    abilityClass: "action",
    skillsetId: "impersonator-kit",
    postId: "impersonator",
    mpCost: 9,
    chargeTime: 25,
    power: 95,
    range: 3,
    ap: 170,
  },

  "sow-confusion": {
    name: "Sow Confusion",
    description: "False orders and forged signals turn a unit on its neighbours.",
    flavour: "An army that cannot trust its own orders has already lost the field.",
    abilityClass: "action",
    skillsetId: "impersonator-kit",
    postId: "impersonator",
    mpCost: 10,
    chargeTime: 30,
    power: 0,
    range: 5,
    target: "enemy",
    aoeShape: "cross",
    aoeSize: 1,
    inflicts: ["confuse", "charm"],
    ap: 190,
  },

  /* ----- Master Gunner (Sage) ------------------------------------------ */

  "grand-barrage": {
    name: "Grand Barrage",
    description:
      "Concentrate the whole battery on one line and fire in unison; devastating area damage.",
    flavour: "The gunners speak last, and the field goes quiet to listen.",
    abilityClass: "action",
    skillsetId: "master-gunner-kit",
    postId: "master-gunner",
    mpCost: 15,
    chargeTime: 50,
    power: 120,
    range: 8,
    aoeShape: "line",
    aoeSize: 2,
    element: "lightning",
    ap: 200,
  },

  "ranging-shot": {
    name: "Ranging Shot",
    description: "Fire a single ranging round to find the distance before the barrage.",
    flavour: "The first round is only an apology; the second is the argument.",
    abilityClass: "action",
    skillsetId: "master-gunner-kit",
    postId: "master-gunner",
    mpCost: 8,
    chargeTime: 25,
    power: 80,
    range: 9,
    element: "earth",
    ap: 150,
  },

  "battery-fire": {
    name: "Battery Fire",
    description:
      "A rolling fire mission from the whole gun line, striking every foe in a wide arc.",
    flavour: "A battery that fires together changes the shape of the ground.",
    abilityClass: "action",
    skillsetId: "master-gunner-kit",
    postId: "master-gunner",
    mpCost: 12,
    chargeTime: 40,
    power: 100,
    range: 7,
    aoeShape: "field",
    aoeSize: 2,
    element: "fire",
    ap: 180,
  },
});
