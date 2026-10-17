/**
 * Shared authoring helpers for the post (role) roster (T047).
 *
 * The roster is split by power (`france.ts`, `britain.ts`, ...) so each role
 * tree reads like the mapping table it came from, plus `common.ts` for the
 * shared posts. This module holds the small, power-agnostic pieces they all
 * reuse: the kit templates and {@link parsePosts}, which stamps the stable id
 * onto each entry and validates it with {@link PostDefSchema}.
 *
 * Keeping the parser here means a mistyped growth block, weapon family or
 * equip slot fails **at module load** (`agents.md` §2, §3, §9) rather than
 * skewing a battle later. Nothing here imports the engine — the data layer
 * stays the bottom of the dependency graph (`src/data/README.md`).
 */

import type { z } from "zod";

import { PostDefSchema, type EquipSlot, type PostDef } from "../schema";

/** Raw authoring shape: a post's fields with the `id` supplied by its key. */
export type PostInput = z.input<typeof PostDefSchema>;

/** A post entry as authored, before {@link parsePosts} stamps its id on. */
export type PostData = Omit<PostInput, "id">;

/**
 * Full kit: every equip slot, for troops who fight with blade and firearm and
 * can carry an off-hand item (FFTA's complete equipment list).
 */
export const FULL_KIT: EquipSlot[] = ["weapon", "offhand", "armour", "head", "accessory"];

/**
 * Shoulder-arms kit: both hands serve the piece, so there is no off-hand slot
 * (FFTA jobs restricted to two-handed weapons or instruments).
 */
export const SHOULDER_KIT: EquipSlot[] = ["weapon", "armour", "head", "accessory"];

/**
 * Validate a power's authored posts and key them by their stable id.
 *
 * ```ts
 * export const FRANCE_POSTS = parsePosts({
 *   fusilier: { name: "Fusilier", ... },
 * });
 * ```
 *
 * The `const` type parameter preserves the literal keys, so the returned
 * record's `keyof` is exactly the authored post ids and the aggregate roster in
 * `index.ts` stays exhaustively typed.
 */
export function parsePosts<const T extends Record<string, PostData>>(
  data: T,
): { readonly [K in keyof T]: PostDef } {
  const parsed = {} as { [K in keyof T]: PostDef };
  for (const key of Object.keys(data) as (keyof T)[]) {
    parsed[key] = PostDefSchema.parse({ id: String(key), ...data[key] });
  }
  return parsed;
}
