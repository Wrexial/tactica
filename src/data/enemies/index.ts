/**
 * Irregular / auxiliary troop roster — the aggregate registry for T091.
 *
 * In FFTA the battlefield is held by **monsters**: goblins, bombs, malboros,
 * floateyes, dragons and the boss creatures that anchor an area. The retheme
 * turns them into **irregular and auxiliary troops** (mapping §11) — militia and
 * deserters, petard and powder crews, guerrilla bands, observation balloons and
 * signallers, heavy and light horse, and named generals with their guard. Each
 * keeps FFTA's mechanical contract (a stat block, an action list, elemental
 * affinities, a loot table) and gains an **AI profile** for Phase 9 (T095).
 *
 * This module merges the archetype tables into one validated registry:
 *
 * | Module            | Archetype (mapping §11)            |
 * | ----------------- | ---------------------------------- |
 * | `militia.ts`      | Goblin / soldier → militia, deserters |
 * | `irregulars.ts`   | Malboro / beast → guerrillas, hounds |
 * | `artillery.ts`    | Bomb / Flan / summoned → petards, batteries |
 * | `cavalry.ts`      | Dragon → heavy cavalry             |
 * | `support.ts`      | Floateye / technical → balloons, signallers, pioneers |
 * | `command.ts`      | Boss → named generals, guard formations |
 * | `profiles.ts`     | AI profiles (Phase 9 inputs)       |
 *
 * ## Cross-references
 *
 * The roster is the resolution target for the content pipeline (T094):
 *
 * - every `EnemyDef.abilities[]` id resolves to an authored **action** in
 *   `src/data/abilities/`;
 * - every `EnemyDef.drops[].itemId` resolves to authored kit in
 *   `src/data/equipment/`;
 * - every `EnemyDef.aiProfile` resolves to an entry in {@link AI_PROFILES}.
 *
 * `tests/unit/data.test.ts` pins all three, plus the display-integrity sweep
 * and the legal contract (`agents.md` §3).
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this* (via `src/engine/barracks.ts`), never the reverse.
 * - **Validated at load.** Every troop parses with {@link EnemyDefSchema} in
 *   `./shared.ts`, so a malformed affinity or stat block fails loudly.
 * - **No placeholders.** Every troop carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { ARTILLERY } from "./artillery";
import { CAVALRY } from "./cavalry";
import { COMMAND } from "./command";
import { IRREGULARS } from "./irregulars";
import { MILITIA } from "./militia";
import { SUPPORT } from "./support";
import type { EnemyDef, EnemyDrop } from "../schema";

export * from "./profiles";
export * from "./ordersOfBattle";
export { parseEnemies, type EnemyData } from "./shared";

/* --------------------------------------------------------------------------
 * The aggregate roster
 * ------------------------------------------------------------------------ */

/**
 * Every authored troop, keyed by its stable id, grouped by archetype in the
 * canonical order (militia, irregulars, artillery, cavalry, support, command).
 * Spreading the per-archetype records preserves insertion order, so
 * {@link ENEMY_KEYS} — and every encounter built from it — is deterministic.
 */
export const ENEMIES = {
  ...MILITIA,
  ...IRREGULARS,
  ...ARTILLERY,
  ...CAVALRY,
  ...SUPPORT,
  ...COMMAND,
} as const;

/** A known troop id (an FFTA-shaped, stable string). */
export type EnemyKey = keyof typeof ENEMIES;

/** The canonical troop keys in roster order. */
export const ENEMY_KEYS = Object.keys(ENEMIES) as EnemyKey[];

/** The troops in their canonical order. */
export const ENEMY_LIST: readonly EnemyDef[] = ENEMY_KEYS.map((id) => ENEMIES[id]);

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical troop key. */
export function isEnemyKey(value: unknown): value is EnemyKey {
  return typeof value === "string" && (ENEMY_KEYS as readonly string[]).includes(value);
}

/** Look up a troop by its canonical key. Throws on an unknown key. */
export function getEnemy(id: EnemyKey): EnemyDef {
  const enemy = ENEMIES[id];
  if (enemy === undefined) {
    throw new RangeError(`unknown enemy: ${String(id)}`);
  }
  return enemy;
}

/**
 * Resolve an arbitrary id (an engine `EnemyId`, a save string) to its
 * definition, or `undefined` when nothing is authored under it. The branded
 * engine ids are structurally strings, so this backs `irregularDefOf`
 * (`src/engine/barracks.ts`) without the data layer importing the engine.
 */
export function findEnemy(id: string): EnemyDef | undefined {
  return (ENEMIES as Record<string, EnemyDef | undefined>)[id];
}

/** Every authored troop family, in first-appearance order. */
export function enemyFamilies(): readonly string[] {
  const seen = new Set<string>();
  const families: string[] = [];
  for (const enemy of ENEMY_LIST) {
    if (seen.has(enemy.family)) continue;
    seen.add(enemy.family);
    families.push(enemy.family);
  }
  return families;
}

/** Every troop of the given family, in canonical order. */
export function enemiesForFamily(family: string): readonly EnemyDef[] {
  return ENEMY_LIST.filter((enemy) => enemy.family === family);
}

/** Every troop exactly at the given level, in canonical order. */
export function enemiesAtLevel(level: number): readonly EnemyDef[] {
  return ENEMY_LIST.filter((enemy) => enemy.level === level);
}

/** Every troop at or below the given level, in canonical order (encounter building). */
export function enemiesUpToLevel(level: number): readonly EnemyDef[] {
  return ENEMY_LIST.filter((enemy) => enemy.level <= level);
}

/** Every troop flagged `capturable` for the Auxiliary Barracks (T078). */
export function capturableEnemies(): readonly EnemyDef[] {
  return ENEMY_LIST.filter((enemy) => enemy.capturable);
}

/** Every troop using the given AI profile, in canonical order. */
export function enemiesForAiProfile(profileId: string): readonly EnemyDef[] {
  return ENEMY_LIST.filter((enemy) => enemy.aiProfile === profileId);
}

/** A troop's loot table, in canonical order. Throws on an unknown id. */
export function dropsFor(id: string): readonly EnemyDrop[] {
  const enemy = findEnemy(id);
  if (enemy === undefined) {
    throw new RangeError(`unknown enemy: ${id}`);
  }
  return enemy.drops;
}
