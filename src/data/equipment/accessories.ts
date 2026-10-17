/**
 * Accessories — the trinket table (T090, mapping §3/§10).
 *
 * FFTA's accessory slot held the small items that changed a unit's numbers or
 * taught it a trick. Our retheme keeps that: optics and notebooks teach
 * reconnaissance drills, a powder flask tops up **Élan** (FFTA MP), and a
 * canteen or haversack adds a few HP of staying power. None carries an innate
 * element — only weapons do (mapping §7).
 *
 * Numbers are **our balance data**, inspired by the scraped FFTA accessory
 * entries (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_armor.md`) but
 * re-authored for detachment scale (`agents.md` §3, §10).
 */

import { parseEquipment } from "./shared";

/**
 * Every accessory, keyed by its stable id and validated at module load,
 * in ascending order of practical value.
 */
export const ACCESSORIES = parseEquipment({
  /* ----- Everyday kit -------------------------------------------------- */

  "water-canteen": {
    name: "Water Canteen",
    description: "A stoppered canteen; +10 HP, +2 Faith.",
    flavour: "A thirsty soldier makes mistakes, and mistakes are expensive.",
    slot: "accessory",
    cost: 60,
    stats: { hp: 10, res: 2 },
  },
  "brandy-flask": {
    name: "Brandy Flask",
    description: "A flask of rough spirits; +6 HP, +6 Élan.",
    flavour: "The surgeon calls it medicine, the sergeant calls it morale, the men call it both.",
    slot: "accessory",
    cost: 90,
    stats: { hp: 6, mp: 6 },
  },
  "lucky-coin": {
    name: "Lucky Coin",
    description: "A worn coin kept over the heart; +2 Speed, +2 Faith.",
    flavour: "It has never stopped a ball, but it has never been left behind either.",
    slot: "accessory",
    cost: 100,
    power: "austria",
    stats: { spd: 2, res: 2 },
  },
  haversack: {
    name: "Haversack",
    description: "A pack of rations and clean linen; +8 HP, +3 Faith.",
    flavour: "A fed soldier fights twice as long, and a dry one complains half as much.",
    slot: "accessory",
    cost: 140,
    power: "russia",
    stats: { hp: 8, res: 3 },
  },
  "powder-flask": {
    name: "Powder Flask",
    description: "A sealed flask of fine powder; +12 Élan.",
    flavour: "Dry powder is the difference between a volley and a cough.",
    slot: "accessory",
    cost: 180,
    stats: { mp: 12 },
  },
  "cartridge-box": {
    name: "Cartridge Box",
    description: "Ready-made cartridges at the belt; +8 Élan, +2 Steel.",
    flavour: "A measured cartridge is a fast reload, and a fast reload wins the exchange.",
    slot: "accessory",
    cost: 220,
    power: "france",
    stats: { mp: 8, atk: 2 },
  },
  "signal-mirror": {
    name: "Signal Mirror",
    description: "A shaving mirror pressed into service; +5 Powder, +2 Speed.",
    flavour: "A flash of light across the valley carries a whole order without a sound.",
    slot: "accessory",
    cost: 240,
    power: "russia",
    stats: { mag: 5, spd: 2 },
  },
  "field-notebook": {
    name: "Field Notebook",
    description:
      "Orders, sketches and observations; +4 Powder, +2 Faith. Teaches Read the Enemy (90 Drill).",
    flavour: "What one officer learns from the enemy, the notebook teaches the whole staff.",
    slot: "accessory",
    cost: 260,
    power: "france",
    stats: { mag: 4, res: 2 },
    teaches: [{ abilityId: "read-the-enemy", ap: 90 }],
  },
  compass: {
    name: "Compass",
    description: "A brass pocket compass; +3 Speed, +3 Powder. Teaches Mark the Range (80 Drill).",
    flavour: "Know where you are, and every other problem becomes a smaller one.",
    slot: "accessory",
    cost: 280,
    power: "britain",
    stats: { spd: 3, mag: 3 },
    teaches: [{ abilityId: "mark-the-range", ap: 80 }],
  },
  "surgeons-roll": {
    name: "Surgeon's Roll",
    description: "Lint, ligature and a bone saw; +6 Powder. Teaches Surgical Dressing (100 Drill).",
    flavour: "The surgeon's first duty is speed; the second is to never let the men see doubt.",
    slot: "accessory",
    cost: 320,
    stats: { mag: 6 },
    teaches: [{ abilityId: "surgical-dressing", ap: 100 }],
  },
  spyglass: {
    name: "Spyglass",
    description: "A brass glass; +4 Speed, +2 Powder. Teaches Range the Ground (70 Drill).",
    flavour: "See the ground before you cross it, and half the battle is already won.",
    slot: "accessory",
    cost: 320,
    power: "britain",
    stats: { spd: 4, mag: 2 },
    teaches: [{ abilityId: "range-the-ground", ap: 70 }],
  },
  "pocket-watch": {
    name: "Pocket Watch",
    description: "A brass watch and chain; +6 Speed. Teaches Well-Timed Order (100 Drill).",
    flavour: "An officer who knows the minute can order the charge a moment before the enemy.",
    slot: "accessory",
    cost: 420,
    power: "france",
    stats: { spd: 6 },
    teaches: [{ abilityId: "well-timed-order", ap: 100 }],
  },
  "medal-of-honour": {
    name: "Medal of Honour",
    description: "A ribbon and a bright disc; +4 Faith, +4 HP.",
    flavour: "A medal costs little and is worth a great deal to the man wearing it.",
    slot: "accessory",
    cost: 500,
    power: "france",
    stats: { res: 4, hp: 4 },
  },
});
