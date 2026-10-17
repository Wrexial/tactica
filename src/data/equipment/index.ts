/**
 * Equipment (kit) registry — the aggregate catalogue for T050/T090.
 *
 * In FFTA a soldier's gear does three jobs at once: it supplies flat **stat
 * bonuses**, it carries an **element** that flavours its attacks, and it
 * **teaches abilities** through use — the AP earned in battle masters whatever
 * is bound to the equipped item (**Drill by kit**, mapping §10). This module
 * merges the slot tables into one validated registry:
 *
 * | Module             | Contents                                            |
 * | ------------------ | --------------------------------------------------- |
 * | `weapons.ts`       | Weapons + off-hand arms/shields (one per family)    |
 * | `armour.ts`        | Body armour, uniforms and headgear                  |
 * | `accessories.ts`   | Trinkets: optics, powder, comfort and staff kit      |
 *
 * The public API is unchanged from T050 (`EQUIPMENT`, `getEquipment`,
 * `equipmentForSlot`, `statsOf`, `teachesAbility`, `isElementalOrAfflicting`),
 * so the engine, UI and depot code keep importing from `src/data/equipment`.
 *
 * ## The FFTA mapping
 *
 * The slots keep FFTA's layout (`schema.ts` → `EQUIP_SLOTS`): **weapon**,
 * **offhand**, **armour**, **head** and **accessory**. Weapon families
 * (`weaponType`, `WEAPON_TYPES`) drive the variant Steel formula (T035) and the
 * "no magic" rule of mapping §14/D9 keeps every element a mundane cause — an
 * artillery piece is *Incendiary* or *Shock*, a signal staff is *Colours*.
 *
 * ## Drill by kit
 *
 * Each `teaches` entry names the ability id and the **Drill** (AP) cost to
 * master it from that item (`EquipmentTeachSchema`, T048). Mastery is permanent
 * even after the item is removed (`LearnedAbility` in `src/engine/unit.ts`),
 * which is why the cost lives on the gear, not on the ability. Every taught
 * ability id resolves to an authored ability in `src/data/abilities/`
 * (`tests/unit/data.test.ts`, T089/T090).
 *
 * ## Authored numbers
 *
 * Every cost and stat modifier is **re-authored balance data**, inspired by the
 * scraped FFTA weapon/armour tables
 * (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_weapons.md`) but tuned for
 * detachment-scale play (`agents.md` §3, §10). No balance constant lives in
 * engine code.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse. Ids stay plain strings, branded at the engine
 *   boundary (T012).
 * - **Validated at load.** Each table parses with {@link EquipmentDefSchema},
 *   so a malformed slot, weapon family or element fails loudly at module load
 *   rather than skewing a battle.
 * - **No placeholders.** Every item carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { ACCESSORIES } from "./accessories";
import { ARMOUR } from "./armour";
import { WEAPONS } from "./weapons";
import type { EquipSlot, EquipmentDef, EquipmentTeach, StatMods } from "../schema";

export { parseEquipment, type EquipmentData } from "./shared";

/* --------------------------------------------------------------------------
 * The aggregate registry
 * ------------------------------------------------------------------------ */

/**
 * Every piece of kit, keyed by its stable id, in canonical slot order
 * (weapons/off-hand, armour/head, accessories). Spreading the per-slot records
 * preserves insertion order, so {@link EQUIPMENT_KEYS} — and every menu built
 * from it — is deterministic.
 */
export const EQUIPMENT = {
  ...WEAPONS,
  ...ARMOUR,
  ...ACCESSORIES,
} as const;

/** A known equipment id (an FFTA-shaped, stable string). */
export type EquipmentKey = keyof typeof EQUIPMENT;

/**
 * The canonical equipment keys in authoring order. Typed as the literal union
 * array so iteration order is stable across builds.
 */
export const EQUIPMENT_KEYS = Object.keys(EQUIPMENT) as EquipmentKey[];

/**
 * The kit in its canonical authoring order ({@link EQUIPMENT_KEYS}). Handy for
 * depots (T075), menus and tests that need a stable iteration order.
 */
export const EQUIPMENT_LIST: readonly EquipmentDef[] = EQUIPMENT_KEYS.map((id) => EQUIPMENT[id]);

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
