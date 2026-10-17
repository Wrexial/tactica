/**
 * Armour, uniforms and headgear — the body/head tables (T090, mapping §3).
 *
 * These pieces carry the **Guard** (FFTA Weapon Def / `def`) and **Faith**
 * (`res`) that keep a specialist alive, plus pockets of HP and Élan. They keep
 * the grounded reading of mapping §14/D9: a cuirass stops steel, a greatcoat
 * stops weather, and neither is a "spell".
 *
 * The `armour` and `head` slots never carry an innate element (only weapons
 * do); a few rigid pieces teach a passive drill (a cuirass teaches the
 * `drilled-guards` footing), which is how FFTA armour occasionally did.
 *
 * Numbers are **our balance data**, inspired by the scraped FFTA armour tables
 * (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_armor.md`) but re-authored for
 * detachment scale (`agents.md` §3, §10).
 */

import { parseEquipment } from "./shared";

/**
 * Every body-armour, uniform and headpiece, keyed by its stable id and
 * validated at module load. Grouped body-first, then headgear, ascending
 * within each group.
 */
export const ARMOUR = parseEquipment({
  /* ----- Body armour & uniforms ---------------------------------------- */

  "campaign-shirt": {
    name: "Campaign Shirt",
    description: "A plain soldier's shirt; +2 Guard, +4 HP.",
    flavour: "Not much, but better than bare skin under a powder burn.",
    slot: "armour",
    cost: 80,
    stats: { def: 2, hp: 4 },
  },
  "line-uniform": {
    name: "Line Uniform",
    description: "Regulation coat and cross-belts; +6 Guard, +10 HP, +2 Faith.",
    flavour: "The coat is meant to be seen, and seeing it heartens the man beside you.",
    slot: "armour",
    cost: 200,
    power: "france",
    stats: { def: 6, hp: 10, res: 2 },
  },
  "rifleman-jacket": {
    name: "Rifleman's Jacket",
    description: "Green cloth cut for the skirmish line; +5 Guard, +6 HP, +2 Speed.",
    flavour: "Green because a rifleman's first duty is not to be seen at all.",
    slot: "armour",
    cost: 240,
    power: "britain",
    stats: { def: 5, hp: 6, spd: 2 },
  },
  "hussar-dolman": {
    name: "Hussar's Dolman",
    description: "A braided light-cavalry jacket; +6 Guard, +4 HP, +3 Speed.",
    flavour: "Half the uniform is for fighting and the other half is for being looked at.",
    slot: "armour",
    cost: 320,
    power: "france",
    stats: { def: 6, hp: 4, spd: 3 },
  },
  "grenadier-coat": {
    name: "Grenadier Coat",
    description: "A heavy reinforced coat; +8 Guard, +12 HP, −1 Speed.",
    flavour: "Built for the men who go first through the door.",
    slot: "armour",
    cost: 360,
    power: "prussia",
    stats: { def: 8, hp: 12, spd: -1 },
  },
  cuirass: {
    name: "Cuirass",
    description:
      "A steel breastplate; +16 Guard, +8 HP, −2 Speed. Teaches Drilled Guards (110 Drill).",
    flavour: "Heavy enough to stop a sabre, heavy enough to slow a horse.",
    slot: "armour",
    cost: 700,
    power: "prussia",
    stats: { def: 16, hp: 8, spd: -2 },
    teaches: [{ abilityId: "drilled-guards", ap: 110 }],
  },
  greatcoat: {
    name: "Greatcoat",
    description: "A heavy woollen coat; +5 Guard, +5 Faith, +6 HP. Winter issue.",
    flavour: "The Russian winter has broken more armies than any battery ever massed.",
    slot: "armour",
    cost: 260,
    power: "russia",
    stats: { def: 5, res: 5, hp: 6 },
  },
  "oilskin-cloak": {
    name: "Oilskin Cloak",
    description: "A waterproofed cloak; +4 Guard, +4 Faith, +4 HP.",
    flavour: "Wet powder and a wet man are both useless; the cloak prevents the one that counts.",
    slot: "armour",
    cost: 180,
    power: "britain",
    stats: { def: 4, res: 4, hp: 4 },
  },
  "padded-jacket": {
    name: "Padded Jacket",
    description: "A quilted gambeson under the coat; +5 Guard, +8 HP, +3 Faith.",
    flavour: "Quilted wool has stopped cuts since before anyone kept a history.",
    slot: "armour",
    cost: 200,
    power: "austria",
    stats: { def: 5, res: 3, hp: 8 },
  },
  "officers-coat": {
    name: "Officer's Coat",
    description: "A well-cut command coat; +7 Guard, +8 HP, +4 Faith.",
    flavour: "The officer's coat is visible on purpose; someone has to be the steady point.",
    slot: "armour",
    cost: 420,
    power: "france",
    stats: { def: 7, hp: 8, res: 4 },
  },
  "artillery-apron": {
    name: "Artillery Apron",
    description: "Leather and canvas against powder burns; +5 Guard, +4 Faith, +6 HP.",
    flavour: "A gunner's apron is scorched constantly, which is rather the point.",
    slot: "armour",
    cost: 260,
    power: "russia",
    stats: { def: 5, res: 4, hp: 6 },
  },

  /* ----- Headgear ------------------------------------------------------ */

  "forage-cap": {
    name: "Forage Cap",
    description: "A soft undress cap; +2 Guard, +1 Speed.",
    flavour: "Off duty, and quiet — which is its own kind of armour.",
    slot: "head",
    cost: 60,
    stats: { def: 2, spd: 1 },
  },
  shako: {
    name: "Shako",
    description: "A tall felt cap with a brass plate; +4 Guard, +4 HP.",
    flavour: "The plate catches the sun and tells the enemy exactly where the line stands.",
    slot: "head",
    cost: 140,
    power: "france",
    stats: { def: 4, hp: 4 },
  },
  "stovepipe-shako": {
    name: "Stovepipe Shako",
    description: "A tall cased shako; +5 Guard, +5 HP.",
    flavour: "The taller the hat, the better the soldier — or so the regulation insists.",
    slot: "head",
    cost: 180,
    power: "britain",
    stats: { def: 5, hp: 5 },
  },
  bearskin: {
    name: "Bearskin",
    description: "A tall fur cap for grenadiers; +6 Guard, +6 HP, −1 Speed.",
    flavour: "The bearskins make the grenadiers look a head taller, which is often enough.",
    slot: "head",
    cost: 240,
    power: "prussia",
    stats: { def: 6, hp: 6, spd: -1 },
  },
  "dragoon-helmet": {
    name: "Dragoon Helmet",
    description: "A crested metal helmet; +7 Guard, +6 HP, −1 Speed.",
    flavour: "Heavy, hot and loud; the dragoon wears it anyway, for the obvious reason.",
    slot: "head",
    cost: 300,
    power: "france",
    stats: { def: 7, hp: 6, spd: -1 },
  },
  kilmarnock: {
    name: "Kilmarnock Bonnet",
    description: "A soft bonnet with a feather; +3 Guard, +2 Speed.",
    flavour: "Light on the head and quick off the mark; the light infantry swear by it.",
    slot: "head",
    cost: 90,
    power: "britain",
    stats: { def: 3, spd: 2 },
  },
  "peaked-cap": {
    name: "Peaked Cap",
    description: "A visored service cap; +4 Guard, +3 HP, +1 Faith.",
    flavour: "The peak keeps the sun out of a gunner's eye and the rain off his powder.",
    slot: "head",
    cost: 120,
    power: "russia",
    stats: { def: 4, hp: 3, res: 1 },
  },
  "slouch-hat": {
    name: "Slouch Hat",
    description: "A broad-brimmed felt hat; +3 Guard, +2 Faith, +1 Speed.",
    flavour: "The brim shades the eyes and sheds the rain; the irregulars never take it off.",
    slot: "head",
    cost: 100,
    power: "austria",
    stats: { def: 3, res: 2, spd: 1 },
  },
});
