/**
 * Britain — the professional light-troop school (Viera in FFTA), mapping §3.
 *
 * Britain's edge is precision and pace: rifles, loose order and fast roles
 * that trade armour for reach and initiative. The tree keeps the speed-based
 * Viera identity while re-authoring names and growth as our own balance data.
 */

import { FULL_KIT, SHOULDER_KIT, parsePosts } from "./shared";

export const BRITAIN_POSTS = parsePosts({
  /** FFTA Archer. */
  rifleman: {
    name: "Rifleman",
    description:
      "Light troops with a rifled piece; long-range fire, loose order and an eye for broken ground.",
    flavour: "A rifleman fights from cover and shadow, and makes every shot tell.",
    power: "britain",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["rifle"],
    growth: { hp: 7.2, mp: 1.6, atk: 8.1, def: 6.8, mag: 7.2, res: 7.6, spd: 1.6 },
    skillsetIds: ["rifleman-kit"],
  },

  /** FFTA Sniper. */
  sharpshooter: {
    name: "Sharpshooter",
    description:
      "A marksman of the light companies; extreme-range precision and a talent for picking officers out of the line.",
    flavour: "One round, one officer, and the enemy's advance loses its head.",
    power: "britain",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["rifle"],
    growth: { hp: 6.2, mp: 2.4, atk: 9.4, def: 6.8, mag: 7.6, res: 7.6, spd: 1.8 },
    skillsetIds: ["sharpshooter-kit"],
    requires: [{ postId: "rifleman", abilities: 2 }],
  },

  /** FFTA Fencer. */
  sabreur: {
    name: "Sabreur",
    description:
      "Fast melee specialist who strings together blade strikes before the enemy can answer.",
    flavour: "A sabreur closes fast and finishes quicker; the fight is over before it is joined.",
    power: "britain",
    equipSlots: FULL_KIT,
    weaponTypes: ["sabre", "blade"],
    growth: { hp: 7.0, mp: 1.6, atk: 8.6, def: 7.0, mag: 6.6, res: 7.2, spd: 1.8 },
    skillsetIds: ["sabreur-kit"],
  },

  /** FFTA Red Mage. */
  adjutant: {
    name: "Adjutant",
    description:
      "Blade-and-pistol staff work: mixed offence, small buffs and the utility an officer's aide provides.",
    flavour: "The adjutant rides between the orders and the guns, and is expected to survive both.",
    power: "britain",
    equipSlots: FULL_KIT,
    weaponTypes: ["sabre", "carbine"],
    growth: { hp: 6.4, mp: 3.0, atk: 7.6, def: 7.0, mag: 8.2, res: 8.0, spd: 1.6 },
    skillsetIds: ["adjutant-kit"],
    requires: [{ postId: "sabreur", abilities: 2 }],
  },

  /** FFTA Elementalist. */
  rocketeer: {
    name: "Rocketeer",
    description:
      "Congreve-style rockets that carry an element across a wide area; smoke, fire and concussive blast.",
    flavour: "The rocket is a wild, screaming thing — the rocketeer's trade is to make it land true.",
    power: "britain",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["gun", "tool"],
    growth: { hp: 5.8, mp: 3.6, atk: 6.4, def: 6.6, mag: 8.8, res: 8.4, spd: 1.2 },
    skillsetIds: ["rocketeer-kit"],
    requires: [{ postId: "sharpshooter", abilities: 2 }],
  },

  /** FFTA Assassin. */
  "long-rifle": {
    name: "Long Rifle",
    description:
      "Concealed assassin's work: patient stalking, a single killing shot and a knife for the close work.",
    flavour: "The long rifle speaks once from a treeline, and a name comes off the enemy's roll.",
    power: "britain",
    equipSlots: FULL_KIT,
    weaponTypes: ["rifle", "sabre"],
    growth: { hp: 6.2, mp: 1.8, atk: 9.0, def: 6.4, mag: 6.8, res: 7.0, spd: 2.0 },
    skillsetIds: ["long-rifle-kit"],
    requires: [{ postId: "sharpshooter", abilities: 3 }],
  },

  /** FFTA Summoner. */
  commodore: {
    name: "Commodore",
    description:
      "Naval signals and off-map bombardment; calls in a heavy fire mission that lands across the field.",
    flavour: "The commodore's flags reach a ship of the line, and the horizon answers with thunder.",
    power: "britain",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["staff", "instrument"],
    growth: { hp: 5.6, mp: 4.4, atk: 6.0, def: 6.6, mag: 9.4, res: 9.0, spd: 1.0 },
    skillsetIds: ["commodore-kit"],
    requires: [{ postId: "adjutant", abilities: 3 }],
  },
});
