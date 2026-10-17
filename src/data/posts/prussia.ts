/**
 * Prussia — the disciplined shock school (Bangaa in FFTA), mapping §3.
 *
 * Prussia's identity is toughness and melee shock: heavy infantry that
 * advances in step, lance-armed cavalry and officers whose auras hold the
 * line. Little in the way of support craft; the tree keeps the Bangaa shape.
 */

import { FULL_KIT, parsePosts } from "./shared";

export const PRUSSIA_POSTS = parsePosts({
  /** FFTA Warrior. */
  "line-grenadier": {
    name: "Line Grenadier",
    description:
      "Disciplined heavy infantry that advances in step and breaks a line with the bayonet.",
    flavour: "The Prussian line moves like a wall, and a wall does not flinch.",
    power: "prussia",
    equipSlots: FULL_KIT,
    weaponTypes: ["musket", "blade"],
    growth: { hp: 9.2, mp: 2.1, atk: 9.2, def: 8.4, mag: 6.2, res: 6.8, spd: 0.9 },
    skillsetIds: ["line-grenadier-kit"],
  },

  /** FFTA Defender. */
  cuirassier: {
    name: "Cuirassier",
    description:
      "Armoured heavy cavalry; a shock trooper who closes with the sabre and shrugs off small-arms fire.",
    flavour: "Breastplate and big horse: when the cuirassiers come, infantry had best form square.",
    power: "prussia",
    equipSlots: FULL_KIT,
    weaponTypes: ["blade", "lance"],
    growth: { hp: 8.4, mp: 1.1, atk: 8.8, def: 9.2, mag: 6.5, res: 7.2, spd: 0.9 },
    skillsetIds: ["cuirassier-kit"],
    requires: [{ postId: "line-grenadier", abilities: 2 }],
  },

  /** FFTA White Monk. */
  "assault-pioneer": {
    name: "Assault Pioneer",
    description:
      "Axes, bayonets and pioneer tools; martial strikes that open a breach and a steady hand to bind wounds.",
    flavour: "Pioneers go in first with the tools of labour and the temper of soldiers.",
    power: "prussia",
    equipSlots: FULL_KIT,
    weaponTypes: ["musket", "tool"],
    growth: { hp: 8.6, mp: 2.2, atk: 9.0, def: 8.0, mag: 6.6, res: 7.6, spd: 1.2 },
    skillsetIds: ["assault-pioneer-kit"],
    requires: [{ postId: "line-grenadier", abilities: 2 }],
  },

  /** FFTA Bishop. */
  chaplain: {
    name: "Chaplain",
    description:
      "A martial shepherd who steadies broken nerve, cleanses fear and guards the colours under fire.",
    flavour: "The chaplain carries no colours, yet the line forms around the cross on his coat.",
    power: "prussia",
    equipSlots: FULL_KIT,
    weaponTypes: ["staff", "blade"],
    growth: { hp: 7.6, mp: 3.4, atk: 7.6, def: 8.0, mag: 8.0, res: 8.8, spd: 1.0 },
    skillsetIds: ["chaplain-kit"],
    requires: [{ postId: "line-grenadier", abilities: 3 }],
  },

  /** FFTA Dragoon. */
  lancer: {
    name: "Lancer",
    description:
      "Reach attacks and a couched charge; the lance lands behind the enemy's guard from two tiles away.",
    flavour: "A lance is a threat before the rider arrives, and a verdict when he does.",
    power: "prussia",
    equipSlots: FULL_KIT,
    weaponTypes: ["lance", "sabre"],
    growth: { hp: 8.6, mp: 1.6, atk: 9.4, def: 8.4, mag: 6.2, res: 7.0, spd: 1.4 },
    skillsetIds: ["lancer-kit"],
    requires: [{ postId: "cuirassier", abilities: 2 }],
  },

  /** FFTA Gladiator. */
  "shock-grenadier": {
    name: "Shock Grenadier",
    description:
      "All offence and no caution; single strikes of the highest physical power in the company.",
    flavour: "The shock grenadier's answer to a problem is a long run-up and a longer blade.",
    power: "prussia",
    equipSlots: FULL_KIT,
    weaponTypes: ["blade", "sabre"],
    growth: { hp: 8.8, mp: 1.4, atk: 9.8, def: 7.8, mag: 5.8, res: 6.8, spd: 1.2 },
    skillsetIds: ["shock-grenadier-kit"],
    requires: [{ postId: "line-grenadier", abilities: 3 }],
  },

  /** FFTA Templar. */
  "line-officer": {
    name: "Line Officer",
    description:
      "Command auras, dispel of enemy orders and steadying buffs; the officer is the line's spine.",
    flavour: "An officer's voice carries over the guns, and the ranks dress themselves to it.",
    power: "prussia",
    equipSlots: FULL_KIT,
    weaponTypes: ["blade", "staff"],
    growth: { hp: 8.0, mp: 2.6, atk: 8.6, def: 8.6, mag: 7.2, res: 8.4, spd: 1.0 },
    skillsetIds: ["line-officer-kit"],
    requires: [{ postId: "chaplain", abilities: 3 }],
  },
});
