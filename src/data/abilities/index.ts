/**
 * Action catalogue — the aggregate registry for T089.
 *
 * This module merges the four FFTA ability classes into one validated
 * catalogue:
 *
 * | Module        | Contents                                                      |
 * | ------------- | ------------------------------------------------------------- |
 * | `shared.ts`   | R (Reactions), S (Traits) and C (Volleys) shared by every power |
 * | `france.ts`   | France's action sets (Fusilier … Bombardier)                  |
 * | `britain.ts`  | Britain's action sets (Rifleman … Commodore)                  |
 * | `prussia.ts`  | Prussia's action sets (Line Grenadier … Line Officer)         |
 * | `russia.ts`   | Russia's action sets (Partisan … Master Gunner)               |
 * | `austria.ts`  | Austria's action sets (Scout … Engineer)                      |
 * | `common.ts`   | The four shared posts' action sets                            |
 *
 * ## Completeness contract
 *
 * Every **post** in `../posts` names one or more `skillsetIds`. T089's "done
 * when" is that each of those skillsets has a complete action set — at least
 * one `abilityClass: "action"` ability, with a signature action plus the drills
 * the FFTA job carried. {@link actionAbilitiesForSkillset} and
 * {@link postActionSet} expose that contract, and `tests/unit/data.test.ts`
 * pins it for every authored post.
 *
 * ## Cross-references
 *
 * The catalogue is the resolution target for the ids other content already
 * binds to:
 *
 * - every `EquipmentDef.teaches[].abilityId` (`../equipment.ts`) resolves to an
 *   entry here;
 * - the `action` keys of the Articles of War (`../articles.ts`)
 *   (`volley-fire`, `parry`, `canister-shot`, `couched-charge`) do too;
 * - the engine's reaction ids (`REACTION_IDS` in `src/engine/reactions.ts`)
 *   match `riposte`, `return-fire`, `dodge` and `field-dressing`.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse. Ids stay plain strings (branded at the engine
 *   boundary, T012).
 * - **Validated at load.** Every entry is parsed with `AbilityDefSchema` via
 *   {@link parseAbilities}, so a malformed class, range or element fails
 *   loudly rather than skewing a battle.
 */

import { AUSTRIA_ABILITIES } from "./austria";
import { BRITAIN_ABILITIES } from "./britain";
import { COMMON_ABILITIES } from "./common";
import { FRANCE_ABILITIES } from "./france";
import { PRUSSIA_ABILITIES } from "./prussia";
import { RUSSIA_ABILITIES } from "./russia";
import { REACTION_SKILLSET, SHARED_ABILITIES, TRAIT_SKILLSET, VOLLEY_SKILLSET } from "./shared";
import type { AbilityClass, AbilityDef } from "../schema";
import { POST_LIST } from "../posts";

/* --------------------------------------------------------------------------
 * The aggregate catalogue
 * ------------------------------------------------------------------------ */

/**
 * Every authored ability, keyed by its stable id and grouped by power in the
 * canonical order (France, Britain, Prussia, Russia, Austria, common, shared).
 * Spreading the per-power records preserves insertion order, so
 * {@link ABILITY_KEYS} — and every menu built from it — is deterministic.
 */
export const ABILITIES = {
  ...FRANCE_ABILITIES,
  ...BRITAIN_ABILITIES,
  ...PRUSSIA_ABILITIES,
  ...RUSSIA_ABILITIES,
  ...AUSTRIA_ABILITIES,
  ...COMMON_ABILITIES,
  ...SHARED_ABILITIES,
} as const;

/** A known ability id (an FFTA-shaped, stable string). */
export type AbilityKey = keyof typeof ABILITIES;

/**
 * The canonical ability keys in catalogue order. Typed as the literal union
 * array so iteration order is stable across builds.
 */
export const ABILITY_KEYS = Object.keys(ABILITIES) as AbilityKey[];

/** The abilities in their canonical order ({@link ABILITY_KEYS}). */
export const ABILITY_LIST: readonly AbilityDef[] = ABILITY_KEYS.map((id) => ABILITIES[id]);

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical ability key. */
export function isAbilityKey(value: unknown): value is AbilityKey {
  return typeof value === "string" && (ABILITY_KEYS as readonly string[]).includes(value);
}

/** Look up an ability by its canonical key. Throws on an unknown key. */
export function getAbility(id: AbilityKey): AbilityDef {
  const ability = ABILITIES[id];
  if (ability === undefined) {
    throw new RangeError(`unknown ability: ${String(id)}`);
  }
  return ability;
}

/**
 * Resolve an arbitrary id (an engine `AbilityId`, a save string) to its
 * definition, or `undefined` when nothing is authored under it. The branded
 * engine ids are structurally strings, so this backs catalogue lookups without
 * the data layer importing `src/engine`.
 */
export function findAbility(id: string): AbilityDef | undefined {
  return (ABILITIES as Record<string, AbilityDef | undefined>)[id];
}

/** Every ability in a skillset, in canonical order. */
export function abilitiesForSkillset(skillsetId: string): readonly AbilityDef[] {
  return ABILITY_LIST.filter((ability) => ability.skillsetId === skillsetId);
}

/** The abilities of a given class (action / reaction / support / combo). */
export function abilitiesOfClass(abilityClass: AbilityClass): readonly AbilityDef[] {
  return ABILITY_LIST.filter((ability) => ability.abilityClass === abilityClass);
}

/**
 * The **action set** of a skillset: the `abilityClass: "action"` abilities a
 * post commands, in canonical order. This is the slice T089 guarantees is
 * non-empty for every authored post skillset.
 */
export function actionAbilitiesForSkillset(skillsetId: string): readonly AbilityDef[] {
  return abilitiesForSkillset(skillsetId).filter((ability) => ability.abilityClass === "action");
}

/** Every ability whose authored `postId` is the given post. */
export function abilitiesForPost(postId: string): readonly AbilityDef[] {
  return ABILITY_LIST.filter((ability) => ability.postId === postId);
}

/**
 * A post's complete action set across all of its skillsets, in the post's
 * skillset order then canonical ability order. Throws on an unknown post id so
 * a typo fails loudly rather than returning an empty set.
 */
export function postActionSet(postId: string): readonly AbilityDef[] {
  const post = POST_LIST.find((candidate) => candidate.id === postId);
  if (post === undefined) {
    throw new RangeError(`unknown post: ${postId}`);
  }
  const seen = new Set<string>();
  const result: AbilityDef[] = [];
  for (const skillsetId of post.skillsetIds) {
    for (const ability of actionAbilitiesForSkillset(skillsetId)) {
      if (seen.has(ability.id)) continue;
      seen.add(ability.id);
      result.push(ability);
    }
  }
  return result;
}

/** Every skillset that owns at least one non-action ability (Reaction/Trait/Volley). */
export const SHARED_SKILLSET_IDS: readonly string[] = [
  REACTION_SKILLSET,
  TRAIT_SKILLSET,
  VOLLEY_SKILLSET,
];

/**
 * The skillsets a lookup may legally encounter: every post's authored
 * `skillsetIds` plus the three shared command sets. Backs the integrity checks
 * in `tests/unit/data.test.ts` and the content pipeline (T094).
 */
export function isKnownSkillset(skillsetId: string): boolean {
  if (SHARED_SKILLSET_IDS.includes(skillsetId)) return true;
  return POST_LIST.some((post) => post.skillsetIds.includes(skillsetId));
}
