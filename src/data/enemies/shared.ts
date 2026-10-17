/**
 * Shared authoring helpers for the irregular/auxiliary troop roster (T091).
 *
 * FFTA's **monsters** become **irregular and auxiliary troops** (mapping §11):
 * goblin-soldiers are militia and deserters, bombs are petard crews, malboros
 * are guerrilla bands, floateyes are observation balloons, dragons are heavy
 * cavalry, and the boss monsters are named generals and guard formations. The
 * retheme keeps the whole mechanical contract — a stat block, an enemy action
 * list, elemental affinities, a loot table and an AI profile — and renames the
 * fiction (mapping §11, §14).
 *
 * The roster is split by archetype (`militia.ts`, `irregulars.ts`,
 * `artillery.ts`, `cavalry.ts`, `support.ts`, `command.ts`) so each module
 * reads like the mapping table it came from. This module holds the piece they
 * all share: {@link parseEnemies}, which stamps the stable id onto each entry
 * and validates it with {@link EnemyDefSchema}, so a mistyped element, affinity
 * or missing stat block fails **at module load** (`agents.md` §2, §3, §9)
 * rather than skewing a battle later.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse. Ids stay plain strings, branded at the engine
 *   boundary (T012); `src/engine/barracks.ts` projects an {@link EnemyDef} down
 *   to its slim `IrregularDef`.
 * - **Validated at load.** Every troop is parsed with {@link EnemyDefSchema},
 *   so a malformed affinity or a negative stat fails loudly.
 * - **No placeholders.** Every troop carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import type { z } from "zod";

import { EnemyDefSchema, type EnemyDef } from "../schema";

/** Raw authoring shape: a troop's fields with the `id` supplied by its key. */
export type EnemyInput = z.input<typeof EnemyDefSchema>;

/** A troop entry as authored, before {@link parseEnemies} stamps its id on. */
export type EnemyData = Omit<EnemyInput, "id">;

/**
 * Validate a module's authored troops and key them by their stable id.
 *
 * ```ts
 * export const MILITIA = parseEnemies({
 *   "militia-conscript": { name: "Militia Conscript", ... },
 * });
 * ```
 *
 * The `const` type parameter preserves the literal keys, so the returned
 * record's `keyof` is exactly the authored troop ids and the aggregate roster
 * in `./index.ts` stays exhaustively typed.
 */
export function parseEnemies<const T extends Record<string, EnemyData>>(
  data: T,
): { readonly [K in keyof T]: EnemyDef } {
  const parsed = {} as { [K in keyof T]: EnemyDef };
  for (const key of Object.keys(data) as (keyof T)[]) {
    parsed[key] = EnemyDefSchema.parse({ id: String(key), ...data[key] });
  }
  return parsed;
}
