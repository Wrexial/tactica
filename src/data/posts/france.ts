/**
 * France — the combined-arms school (Hume in FFTA), mapping §3.
 *
 * France is the balanced, conscription-driven tree: the widest role list and
 * no extreme weakness. Each post keeps its FFTA job's mechanical kit (action
 * list, growth shape, unlock rule) and only the fiction, name and weapon model
 * are re-authored around the Napoleonic theatre (`agents.md` §3, mapping D3).
 *
 * Growth numbers are **our balance data**, inspired by the scraped FFTA job
 * tables (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_jobs.md`) but rounded
 * and rebalanced for detachment scale; no balance constant lives in engine
 * code (`agents.md` §9).
 */

import { FULL_KIT, SHOULDER_KIT, parsePosts } from "./shared";

export const FRANCE_POSTS = parsePosts({
  /** FFTA Soldier. */
  fusilier: {
    name: "Fusilier",
    description:
      "Line infantry drilled to fire by volley and hold with the bayonet; balanced growth and the broadest kit.",
    flavour:
      "The fusilier is the army's anvil: steady under fire and dangerous at the point of the bayonet.",
    power: "france",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["musket", "blade"],
    growth: { hp: 8.4, mp: 1.1, atk: 8.8, def: 8.8, mag: 6.0, res: 7.2, spd: 1.1 },
    skillsetIds: ["fusilier-kit"],
  },

  /** FFTA Fighter. */
  grenadier: {
    name: "Grenadier",
    description:
      "Heavy shock infantry built for the assault; trades finesse for raw strength and a punishing charge.",
    flavour: "Grenadiers go first over the breach, tall men chosen for the worst work of the day.",
    power: "france",
    equipSlots: FULL_KIT,
    weaponTypes: ["musket", "blade"],
    growth: { hp: 7.2, mp: 1.1, atk: 9.2, def: 8.1, mag: 5.6, res: 6.8, spd: 1.1 },
    skillsetIds: ["grenadier-kit"],
    requires: [{ postId: "fusilier", abilities: 2 }],
  },

  /** FFTA Archer. */
  marksman: {
    name: "Marksman",
    description:
      "A hunter's eye turned on the enemy line; deliberate ranged damage from a fowling piece.",
    flavour: "Patience, breath and one clean shot — the marksman wastes neither powder nor lead.",
    power: "france",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["carbine", "rifle"],
    growth: { hp: 6.8, mp: 1.4, atk: 8.6, def: 6.6, mag: 6.8, res: 7.4, spd: 1.3 },
    skillsetIds: ["marksman-kit"],
    requires: [{ postId: "fusilier", abilities: 2 }],
  },

  /** FFTA Paladin. */
  "colour-guard": {
    name: "Colour Guard",
    description:
      "The standard-bearer's escort; shields comrades with steadying orders and defensive traits.",
    flavour: "While the colours stand, the line stands — and the colour guard does not let them fall.",
    power: "france",
    equipSlots: FULL_KIT,
    weaponTypes: ["blade", "shield"],
    growth: { hp: 7.4, mp: 2.8, atk: 8.4, def: 8.8, mag: 7.2, res: 8.4, spd: 1.0 },
    skillsetIds: ["colour-guard-kit"],
    requires: [{ postId: "fusilier", abilities: 3 }],
  },

  /** FFTA Ninja. */
  hussar: {
    name: "Hussar",
    description:
      "Fast light cavalry who strike twice before the enemy answers and slip away from the counter-blow.",
    flavour: "A hussar is never where the shot was aimed, and always where it was not expected.",
    power: "france",
    equipSlots: FULL_KIT,
    weaponTypes: ["sabre", "carbine"],
    growth: { hp: 6.8, mp: 1.4, atk: 8.4, def: 6.6, mag: 6.2, res: 6.6, spd: 2.0 },
    skillsetIds: ["hussar-kit"],
    requires: [{ postId: "marksman", abilities: 2 }],
  },

  /** FFTA Hunter. */
  chasseur: {
    name: "Chasseur",
    description:
      "Long-range hunter of men who tracks a target across broken ground and can take prisoners.",
    flavour: "Chasseurs fight in the green, and they never lose the trail they set out on.",
    power: "france",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["rifle"],
    growth: { hp: 7.0, mp: 1.8, atk: 8.6, def: 7.0, mag: 6.8, res: 7.4, spd: 1.5 },
    skillsetIds: ["chasseur-kit"],
    requires: [{ postId: "marksman", abilities: 3 }],
  },

  /** FFTA Blue Mage. */
  "intelligence-officer": {
    name: "Intelligence Officer",
    description:
      "Gathers the enemy's methods from the field and turns them back on their author; learns foreign drill.",
    flavour: "A captured order is worth a battery — an intelligence officer knows how to read it aloud.",
    power: "france",
    equipSlots: FULL_KIT,
    weaponTypes: ["sabre", "staff"],
    growth: { hp: 6.6, mp: 3.2, atk: 7.8, def: 7.4, mag: 8.4, res: 8.2, spd: 1.2 },
    skillsetIds: ["intelligence-officer-kit"],
    requires: [{ postId: "colour-guard", abilities: 2 }],
  },

  /** FFTA Illusionist. */
  bombardier: {
    name: "Bombardier",
    description:
      "Incendiary shells and carcass shot that fall on a whole class of target at once, at field range.",
    flavour: "The bombardier does not aim at a man; he aims at a place and lets the place do the work.",
    power: "france",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["gun"],
    growth: { hp: 5.8, mp: 4.0, atk: 6.4, def: 6.8, mag: 9.2, res: 8.6, spd: 1.0 },
    skillsetIds: ["bombardier-kit"],
    requires: [{ postId: "grenadier", abilities: 3 }],
  },
});
