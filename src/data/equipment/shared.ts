/**
 * Shared authoring helpers for the equipment (kit) tables (T090, mapping §3).
 *
 * T050 authored the {@link EquipmentDef} model and a first slice of kit; T090
 * splits the catalogue by slot so it can grow into full weapon, armour and
 * accessory tables without becoming one unreadable module:
 *
 * | Module            | Contents                                              |
 * | ----------------- | ----------------------------------------------------- |
 * | `weapons.ts`      | Weapons + off-hand arms/shields (one per weapon family) |
 * | `armour.ts`       | Body armour, uniforms and headgear                    |
 * | `accessories.ts`  | Trinkets: optics, powder, comfort and staff kit       |
 * | `index.ts`        | The aggregate registry + every lookup                 |
 *
 * This module holds only the small, slot-agnostic pieces they all reuse:
 * {@link parseEquipment}, which stamps the stable id onto each entry and
 * validates it with {@link EquipmentDefSchema}. Keeping the parser here means a
 * mistyped slot, weapon family or element fails **at module load**
 * (`agents.md` §2, §3, §9) rather than skewing a battle later. Nothing here
 * imports the engine — the data layer stays the bottom of the dependency graph
 * (`src/data/README.md`).
 */

import {
  EquipmentDefSchema,
  type ElementKey,
  type EquipSlot,
  type EquipmentDef,
  type EquipmentTeach,
  type PowerKey,
  type StatMods,
  type WeaponType,
} from "../schema";

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
  readonly restrictedTo?: readonly PowerKey[];
}

/**
 * Validate a module's authored kit and key it by its stable id.
 *
 * ```ts
 * export const WEAPONS = parseEquipment({
 *   "baker-rifle": { name: "Baker Rifle", ... },
 * });
 * ```
 *
 * The `const` type parameter preserves the literal keys, so the returned
 * record's `keyof` is exactly the authored item ids and the aggregate registry
 * in `./index.ts` stays exhaustively typed.
 */
export function parseEquipment<const T extends Record<string, EquipmentData>>(
  data: T,
): { readonly [K in keyof T]: EquipmentDef } {
  const parsed = {} as { [K in keyof T]: EquipmentDef };
  for (const key of Object.keys(data) as (keyof T)[]) {
    parsed[key] = EquipmentDefSchema.parse({ id: String(key), ...data[key] });
  }
  return parsed;
}
