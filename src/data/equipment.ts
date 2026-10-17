/**
 * Equipment (kit) definitions (T050, mapping §3/§10).
 *
 * In FFTA a soldier's gear does three jobs at once: it supplies flat **stat
 * bonuses**, it carries an **element** that flavours its attacks, and it
 * **teaches abilities** through use — the AP earned in battle masters whatever
 * is bound to the equipped item (**Drill by kit**, mapping §10). Our retheme
 * keeps that exact contract: a {@link EquipmentDef} is a weapon, a uniform /
 * armour piece, a headpiece or an accessory that layers `stats`, an `element`,
 * on-hit `inflicts` and `teaches` onto its bearer.
 *
 * ## The FFTA mapping
 *
 * The slots keep FFTA's layout (`schema.ts` → `EQUIP_SLOTS`): **weapon**,
 * **offhand**, **armour**, **head** and **accessory**. The weapon families
 * (`weaponType`, `WEAPON_TYPES`) drive the variant Steel formula (T035) and the
 * "no magic" rule of mapping §14/D9 keeps every element a mundane cause — an
 * artillery piece is *Incendiary* or *Shock*, a signal staff is *Colours*, a
 * sapper's tools are *Siege* (mapping §7). On-hit conditions are carried by the
 * stable FFTA condition ids (`src/data/conditions.ts`), so a rifled ball that
 * opens a wound inflicts `poison` (**Bleeding**) and close shellfire inflicts
 * `blind` (**Dazed**).
 *
 * ## Drill by kit
 *
 * Each `teaches` entry names the ability id and the **Drill** (AP) cost to
 * master it from that item (`EquipmentTeachSchema`, T048). Mastery is
 * permanent even after the item is removed (`LearnedAbility` in
 * `src/engine/unit.ts`), which is why the cost lives on the gear, not on the
 * ability. Ability authoring proper lands in Phase 8 (T089); the ids here are
 * the stable, FFTA-shaped handles those definitions will use.
 *
 * ## Authored numbers
 *
 * Every cost and stat modifier below is **re-authored balance data**, inspired
 * by the scraped FFTA weapon/armour tables
 * (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_weapons.md`) but tuned for
 * detachment-scale play (`agents.md` §3, §10). No balance constant lives in
 * engine code.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse. Ids stay plain strings, branded at the engine
 *   boundary (T012).
 * - **Validated at load.** Every entry is parsed with {@link EquipmentDefSchema},
 *   so a malformed slot, weapon family or element fails loudly at module load
 *   rather than skewing a battle.
 * - **No placeholders.** Every item carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import {
  EquipmentDefSchema,
  type EquipSlot,
  type EquipmentDef,
  type EquipmentTeach,
  type ElementKey,
  type PowerKey,
  type StatMods,
  type WeaponType,
} from "./schema";

/* --------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/**
 * The canonical equipment ids in authoring order (weapons, off-hands, armour,
 * headgear, accessories). Typed as a tuple so the compiler rejects a missing
 * key in {@link EQUIPMENT_DATA} and every menu can iterate a stable order.
 */
export const EQUIPMENT_KEYS = [
  // Weapons — one per FFTA weapon family (T035)
  "cavalry-sabre",
  "grenadier-broadsword",
  "uhlan-lance",
  "charleville-musket",
  "light-carbine",
  "baker-rifle",
  "forester-bow",
  "six-pounder",
  "congreve-rocket",
  "signal-staff",
  "hunting-horn",
  "sappers-tools",
  // Off-hand
  "pavise-shield",
  "horse-pistol",
  // Armour / uniforms
  "line-uniform",
  "cuirass",
  "greatcoat",
  "campaign-shirt",
  // Head
  "shako",
  "bearskin",
  "forage-cap",
  // Accessories
  "spyglass",
  "powder-flask",
  "water-canteen",
  "pocket-watch",
] as const;

/** The stable, FFTA-shaped id of every authored piece of kit. */
export type EquipmentKey = (typeof EQUIPMENT_KEYS)[number];

/**
 * Raw authoring shape: an item's fields with the `id` supplied by its key.
 * Declared explicitly (rather than via `z.input`) so partial `stats` and
 * omitted defaulted fields read naturally at the call site.
 */
export interface EquipmentData {
  readonly name: string;
  readonly description: string;
  readonly flavour: string;
  readonly slot: EquipSlot;
  readonly weaponType?: WeaponType;
  readonly cost?: number | null;
  readonly power?: PowerKey;
  readonly element?: ElementKey;
  readonly stats?: Partial<StatMods>;
  readonly teaches?: readonly EquipmentTeach[];
  readonly inflicts?: readonly string[];
}

/**
 * Unparsed equipment data, keyed by the stable id. `satisfies` enforces that
 * every {@link EquipmentKey} is authored; only fields that differ from the
 * schema defaults need to appear.
 */
const EQUIPMENT_DATA = {
  /* ----- Weapons: one per weapon family (T035) -------------------------- */

  "cavalry-sabre": {
    name: "Cavalry Sabre",
    description: "A light curved blade; +8 Steel, +2 Speed. Teaches Riposte (80 Drill).",
    flavour: "The trooper's sidearm: quick to the draw and quicker to the throat.",
    slot: "weapon",
    weaponType: "sabre",
    cost: 300,
    power: "france",
    stats: { atk: 8, spd: 2 },
    teaches: [{ abilityId: "riposte", ap: 80 }],
  },
  "grenadier-broadsword": {
    name: "Grenadier Broadsword",
    description:
      "A heavy straight blade; +14 Steel, −2 Speed. Teaches Crushing Blow (120 Drill).",
    flavour: "The grenadiers favour the weight; one blow settles most arguments.",
    slot: "weapon",
    weaponType: "blade",
    cost: 520,
    power: "prussia",
    stats: { atk: 14, spd: -2 },
    teaches: [{ abilityId: "crushing-blow", ap: 120 }],
  },
  "uhlan-lance": {
    name: "Uhlan Lance",
    description: "A long reach weapon; +12 Steel, +1 Speed. Teaches Couched Charge (140 Drill).",
    flavour: "Couched in a charge, a lance turns a rider into a single thunderbolt.",
    slot: "weapon",
    weaponType: "lance",
    cost: 640,
    power: "prussia",
    stats: { atk: 12, spd: 1 },
    teaches: [{ abilityId: "couched-charge", ap: 140 }],
  },
  "charleville-musket": {
    name: "Charleville Musket",
    description: "A smoothbore shoulder arm; +10 Steel. Teaches Volley Fire (100 Drill).",
    flavour: "Three ranks, one crashing volley — the Queen of Battles speaks.",
    slot: "weapon",
    weaponType: "musket",
    cost: 400,
    power: "france",
    stats: { atk: 10 },
    teaches: [{ abilityId: "volley-fire", ap: 100 }],
  },
  "light-carbine": {
    name: "Light Carbine",
    description: "A short firearm; +8 Steel, +3 Speed. Teaches Snap Shot (90 Drill).",
    flavour: "Light cavalry carry it slung; it answers fast in a running fight.",
    slot: "weapon",
    weaponType: "carbine",
    cost: 460,
    power: "austria",
    stats: { atk: 8, spd: 3 },
    teaches: [{ abilityId: "snap-shot", ap: 90 }],
  },
  "baker-rifle": {
    name: "Baker Rifle",
    description:
      "A grooved barrel; +13 Steel, +2 Speed. Hits inflict Bleeding. Teaches Aim Vitals (150 Drill).",
    flavour: "A Baker rifle in still hands can pick a man from the enemy line.",
    slot: "weapon",
    weaponType: "rifle",
    cost: 900,
    power: "britain",
    stats: { atk: 13, spd: 2 },
    teaches: [{ abilityId: "aim-vitals", ap: 150 }],
    inflicts: ["poison"],
  },
  "forester-bow": {
    name: "Forester's Bow",
    description: "A drawn bow; +6 Steel, +2 Speed. Teaches Quiet Loosing (60 Drill).",
    flavour: "Irregulars and foresters still trust the bow when powder runs wet.",
    slot: "weapon",
    weaponType: "bow",
    cost: 120,
    stats: { atk: 6, spd: 2 },
    teaches: [{ abilityId: "quiet-loosing", ap: 60 }],
  },
  "six-pounder": {
    name: "Six-Pounder Gun",
    description:
      "A served field piece; +18 Steel, −3 Speed. Attacks are Shock and inflict Dazed. Teaches Canister Shot (200 Drill).",
    flavour: "At close range the canister turns the piece into a mouthful of nails.",
    slot: "weapon",
    weaponType: "gun",
    cost: 1200,
    power: "russia",
    element: "lightning",
    stats: { atk: 18, spd: -3 },
    teaches: [{ abilityId: "canister-shot", ap: 200 }],
    inflicts: ["blind"],
  },
  "congreve-rocket": {
    name: "Congreve Rocket",
    description:
      "A rocket trough; +15 Steel, −1 Speed. Attacks are Incendiary. Teaches Case Shot (170 Drill).",
    flavour: "The rockets are as frightening as they are inaccurate, which is quite enough.",
    slot: "weapon",
    weaponType: "gun",
    cost: 980,
    power: "britain",
    element: "fire",
    stats: { atk: 15, spd: -1 },
    teaches: [{ abilityId: "case-shot", ap: 170 }],
  },
  "signal-staff": {
    name: "Signal Staff",
    description: "Flags, mirrors and rockets; +8 Powder, +4 Faith. Attacks are Colours.",
    flavour: "Flags, mirrors and rockets speak where the voice cannot reach.",
    slot: "weapon",
    weaponType: "staff",
    cost: 300,
    power: "russia",
    element: "holy",
    stats: { mag: 8, res: 4 },
    teaches: [{ abilityId: "signal-flare", ap: 110 }],
  },
  "hunting-horn": {
    name: "Hunting Horn",
    description: "A call that directs troops and hounds; +6 Powder, +2 Steel.",
    flavour: "The horn carries further than any order shouted into the smoke.",
    slot: "weapon",
    weaponType: "instrument",
    cost: 260,
    power: "austria",
    stats: { mag: 6, atk: 2 },
    teaches: [{ abilityId: "call-hounds", ap: 90 }],
  },
  "sappers-tools": {
    name: "Sapper's Tools",
    description: "Picks, charges and wire; +9 Steel, +3 Speed. Attacks are Siege.",
    flavour: "A sapper's kit opens walls that a battery could not crack.",
    slot: "weapon",
    weaponType: "tool",
    cost: 540,
    power: "russia",
    element: "earth",
    stats: { atk: 9, spd: 3 },
    teaches: [{ abilityId: "charge-the-sap", ap: 130 }],
  },

  /* ----- Off-hand ------------------------------------------------------- */

  "pavise-shield": {
    name: "Pavise Shield",
    description: "An off-hand shield; +8 Guard, +6 HP. Teaches Parry (70 Drill).",
    flavour: "In the press of a breach, the boss of a shield is as good as a sword.",
    slot: "offhand",
    weaponType: "shield",
    cost: 220,
    stats: { def: 8, hp: 6 },
    teaches: [{ abilityId: "parry", ap: 70 }],
  },
  "horse-pistol": {
    name: "Horse Pistol",
    description: "A heavy off-hand pistol; +6 Steel, +1 Speed. Teaches Dismounting Shot (80 Drill).",
    flavour: "One shot, close range, and the saddle is suddenly very empty.",
    slot: "offhand",
    weaponType: "gun",
    cost: 380,
    power: "france",
    stats: { atk: 6, spd: 1 },
    teaches: [{ abilityId: "dismounting-shot", ap: 80 }],
  },

  /* ----- Armour / uniforms --------------------------------------------- */

  "line-uniform": {
    name: "Line Uniform",
    description: "Regulation coat and cross-belts; +6 Guard, +10 HP, +2 Faith.",
    flavour: "The coat is meant to be seen, and seeing it heartens the man beside you.",
    slot: "armour",
    cost: 200,
    power: "france",
    stats: { def: 6, hp: 10, res: 2 },
  },
  cuirass: {
    name: "Cuirass",
    description: "A steel breastplate; +16 Guard, +8 HP, −2 Speed.",
    flavour: "Heavy enough to stop a sabre, heavy enough to slow a horse.",
    slot: "armour",
    cost: 700,
    power: "prussia",
    stats: { def: 16, hp: 8, spd: -2 },
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
  "campaign-shirt": {
    name: "Campaign Shirt",
    description: "A plain soldier's shirt; +2 Guard, +4 HP.",
    flavour: "Not much, but better than bare skin under a powder burn.",
    slot: "armour",
    cost: 80,
    stats: { def: 2, hp: 4 },
  },

  /* ----- Head ----------------------------------------------------------- */

  shako: {
    name: "Shako",
    description: "A tall felt cap with a brass plate; +4 Guard, +4 HP.",
    flavour: "The plate catches the sun and tells the enemy exactly where the line stands.",
    slot: "head",
    cost: 140,
    power: "france",
    stats: { def: 4, hp: 4 },
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
  "forage-cap": {
    name: "Forage Cap",
    description: "A soft undress cap; +2 Guard, +1 Speed.",
    flavour: "Off duty, and quiet — which is its own kind of armour.",
    slot: "head",
    cost: 60,
    stats: { def: 2, spd: 1 },
  },

  /* ----- Accessories ---------------------------------------------------- */

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
  "powder-flask": {
    name: "Powder Flask",
    description: "A sealed flask of fine powder; +12 Élan.",
    flavour: "Dry powder is the difference between a volley and a cough.",
    slot: "accessory",
    cost: 180,
    stats: { mp: 12 },
  },
  "water-canteen": {
    name: "Water Canteen",
    description: "A stoppered canteen; +10 HP, +2 Faith.",
    flavour: "A thirsty soldier makes mistakes, and mistakes are expensive.",
    slot: "accessory",
    cost: 60,
    stats: { hp: 10, res: 2 },
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
} satisfies Record<EquipmentKey, EquipmentData>;

/**
 * Every piece of kit, keyed by the stable id and validated at module load. Read
 * this instead of branching on item ids anywhere in the engine; the engine
 * consumes the parsed {@link EquipmentDef} (stats, element, teaches, inflicts).
 */
export const EQUIPMENT: Record<EquipmentKey, EquipmentDef> = Object.fromEntries(
  Object.entries(EQUIPMENT_DATA).map(([id, def]) => [
    id,
    EquipmentDefSchema.parse({ id, ...def }),
  ]),
) as Record<EquipmentKey, EquipmentDef>;

/**
 * The kit in its canonical authoring order ({@link EQUIPMENT_KEYS}). Handy for
 * depots (T075), menus and tests that need a stable iteration order.
 */
export const EQUIPMENT_LIST: readonly EquipmentDef[] = EQUIPMENT_KEYS.map(
  (id) => EQUIPMENT[id],
);

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical equipment key. */
export function isEquipmentKey(value: unknown): value is EquipmentKey {
  return typeof value === "string" && (EQUIPMENT_KEYS as readonly string[]).includes(value);
}

/** Look up a piece of kit by its canonical key. Throws on an unknown key. */
export function getEquipment(id: EquipmentKey): EquipmentDef {
  const item = EQUIPMENT[id];
  if (item === undefined) {
    throw new RangeError(`unknown equipment: ${String(id)}`);
  }
  return item;
}

/** Every item that fills a given equip slot, in canonical order. */
export function equipmentForSlot(slot: EquipSlot): readonly EquipmentDef[] {
  return EQUIPMENT_LIST.filter((item) => item.slot === slot);
}

/** The item's flat stat modifiers (a full block, defaulted by the schema). */
export function statsOf(id: EquipmentKey): StatMods {
  return getEquipment(id).stats;
}

/**
 * The entry teaching `abilityId` from the named item, or `undefined` when the
 * item does not teach it. Backs the Drill-by-kit lookup in T048.
 */
export function teachesAbility(id: EquipmentKey, abilityId: string): EquipmentTeach | undefined {
  return getEquipment(id).teaches.find((teach) => teach.abilityId === abilityId);
}

/**
 * `true` when the item carries an on-hit condition (`inflicts`) or an innate
 * element — the two ways kit flavours an attack (mapping §7/§8).
 */
export function isElementalOrAfflicting(id: EquipmentKey): boolean {
  const item = getEquipment(id);
  return item.element !== undefined || item.inflicts.length > 0;
}
