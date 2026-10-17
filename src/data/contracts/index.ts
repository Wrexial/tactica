/**
 * Officers' Mess contract board (T070, T093; mapping §10).
 *
 * In FFTA the **pub** posts missions on a board: each one has an entry **fee**,
 * a set of **requirements** (an item, a job level, a unit count, ...) and a
 * **reward** (Gil, AP, XP, an item, a clan title). The retheme keeps that
 * contract exactly and renames the board the **Officers' Mess**, the currency
 * **Crowns**, AP **Drill**, XP **Experience** and clan titles **Regimental
 * Honours** (mapping §1, §5, §10). A mission kind maps 1:1:
 *
 * | FFTA mission   | `kind` in this module | Tactica fiction                                          |
 * | -------------- | --------------------- | -------------------------------------------------------- |
 * | Regular        | `battle`              | A story/campaign set piece                               |
 * | Encounter      | `skirmish`            | A rival free company met on the road                     |
 * | Dispatch       | `detachment`          | Soldiers sent away for N days (`duration`)               |
 * | Area           | `pacification`        | Clear a region and hold it (`regionId`)                  |
 *
 * This module is the **aggregate board**, assembled from one module per kind:
 *
 * | Module            | Kind            | Count |
 * | ----------------- | --------------- | ----- |
 * | `battles.ts`      | `battle`        | 7     |
 * | `skirmishes.ts`   | `skirmish`      | 7     |
 * | `detachments.ts`  | `detachment`    | 7     |
 * | `pacifications.ts`| `pacification`  | 7     |
 *
 * The engine (`src/engine/company.ts`, `src/engine/detach.ts` and the
 * officers' mess UI) consumes these definitions; this module only **declares**
 * them. The fee is paid in Crowns, so every contract's reward is authored to
 * turn a profit on success — the risk is the battle, not the arithmetic.
 *
 * ## Requirements
 *
 * A {@link ContractRequirement} mirrors the FFTA pub gate and names its class
 * with `kind`:
 *
 * | `kind`   | `id` names...                    | `count` means...            |
 * | -------- | -------------------------------- | --------------------------- |
 * | `item`   | an equipment id (`baker-rifle`)  | how many are needed         |
 * | `post`   | a post id (`scout`, `surgeon`)   | how many of that trade      |
 * | `unit`   | — (any soldier)                  | how many soldiers to commit |
 * | `honour` | — (company Honour / JP)          | Honour the company must hold |
 *
 * Requirements are **data only**; the check against the roster lives in the
 * officers' mess UI (T071) and the campaign tests (T079). Because the ids are
 * the same stable handles used everywhere else in `src/data/`, this module can
 * be validated against the post and equipment registries in tests.
 *
 * ## Region and story gates
 *
 * `regionId`, when present, ties a contract to a campaign-map region
 * (`RegionId`, owned by the map in T073). Every battle and pacification names
 * one; a skirmish or detachment may. `chapter`, when present, gates a contract
 * to a story beat (T077); a contract with no `chapter` is always postable, and
 * every gated contract must be opened by the story spine (`src/data/story.ts`).
 * `duration` is authored only for `detachment` contracts.
 *
 * ## Authored numbers
 *
 * Every fee and reward below is **re-authored balance data**, inspired by the
 * FFTA mission/fee tables but tuned for detachment-scale play
 * (`agents.md` §3, §10). No balance constant lives in engine code.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse. Ids stay plain strings, branded at the engine
 *   boundary (T012).
 * - **Validated at load.** Every entry is parsed with
 *   {@link ContractDefSchema} via {@link parseContracts}.
 * - **No placeholders.** Every contract carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { BATTLE_CONTRACTS } from "./battles";
import { DETACHMENT_CONTRACTS } from "./detachments";
import { PACIFICATION_CONTRACTS } from "./pacifications";
import { SKIRMISH_CONTRACTS } from "./skirmishes";
import type { ContractDef, ContractKind, ContractRequirement } from "../schema";

/* --------------------------------------------------------------------------
 * The aggregate board
 * ------------------------------------------------------------------------ */

export { BATTLE_CONTRACTS } from "./battles";
export { DETACHMENT_CONTRACTS } from "./detachments";
export { PACIFICATION_CONTRACTS } from "./pacifications";
export { SKIRMISH_CONTRACTS } from "./skirmishes";

/**
 * Every authored contract, keyed by its stable id. Battles, skirmishes,
 * detachments and pacifications are spread in that order, so
 * {@link CONTRACT_KEYS} — and every menu built from it — is deterministic.
 */
export const CONTRACTS = {
  ...BATTLE_CONTRACTS,
  ...SKIRMISH_CONTRACTS,
  ...DETACHMENT_CONTRACTS,
  ...PACIFICATION_CONTRACTS,
} as const;

/** A known contract id (an FFTA-shaped, stable string). */
export type ContractKey = keyof typeof CONTRACTS;

/**
 * The canonical contract ids in authoring order — battles, skirmishes,
 * detachments, then pacifications. Typed as the literal union array so
 * iteration order is stable across builds.
 */
export const CONTRACT_KEYS = Object.keys(CONTRACTS) as ContractKey[];

/** The battle contract keys in authoring order (`battle`). */
export const BATTLE_CONTRACT_KEYS = Object.keys(BATTLE_CONTRACTS) as Array<
  keyof typeof BATTLE_CONTRACTS
>;

/** The skirmish contract keys in authoring order (`skirmish`). */
export const SKIRMISH_CONTRACT_KEYS = Object.keys(SKIRMISH_CONTRACTS) as Array<
  keyof typeof SKIRMISH_CONTRACTS
>;

/** The detachment contract keys in authoring order (`detachment`). */
export const DETACHMENT_CONTRACT_KEYS = Object.keys(DETACHMENT_CONTRACTS) as Array<
  keyof typeof DETACHMENT_CONTRACTS
>;

/** The pacification contract keys in authoring order (`pacification`). */
export const PACIFICATION_CONTRACT_KEYS = Object.keys(PACIFICATION_CONTRACTS) as Array<
  keyof typeof PACIFICATION_CONTRACTS
>;

/**
 * Every contract, in canonical authoring order ({@link CONTRACT_KEYS}). Handy
 * for the mission board and tests that need a stable iteration order.
 */
export const CONTRACT_LIST: readonly ContractDef[] = CONTRACT_KEYS.map((id) => CONTRACTS[id]);

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical contract key. */
export function isContractKey(value: unknown): value is ContractKey {
  return typeof value === "string" && (CONTRACT_KEYS as readonly string[]).includes(value);
}

/** Look up a contract by its canonical key. Throws on an unknown key. */
export function getContract(id: ContractKey): ContractDef {
  const contract = CONTRACTS[id];
  if (contract === undefined) {
    throw new RangeError(`unknown contract: ${String(id)}`);
  }
  return contract;
}

/** Every contract of a given kind (`battle`, `skirmish`, `detachment`, `pacification`). */
export function contractsOfKind(kind: ContractKind): readonly ContractDef[] {
  return CONTRACT_LIST.filter((contract) => contract.kind === kind);
}

/** Every contract posted for a region (`pacifications`, mostly), in canonical order. */
export function contractsForRegion(regionId: string): readonly ContractDef[] {
  return CONTRACT_LIST.filter((contract) => contract.regionId === regionId);
}

/**
 * The contracts a story at `chapter` has unlocked: those gated at or below the
 * party's progress, plus the ungated contracts that belong to no story beat.
 * Mirrors `guardSortiesForChapter` so the story spine (T077) reads the same.
 */
export function contractsForChapter(chapter: number): readonly ContractDef[] {
  if (!Number.isInteger(chapter) || chapter < 0) {
    throw new RangeError(
      `story chapter must be a non-negative integer, received ${String(chapter)}`,
    );
  }
  return CONTRACT_LIST.filter(
    (contract) => contract.chapter === undefined || contract.chapter <= chapter,
  );
}

/**
 * The requirements of a contract, in authored order. A tiny convenience so
 * menus and tests do not reach through the definition for the common field.
 */
export function requirementsOf(id: ContractKey): readonly ContractRequirement[] {
  return getContract(id).requires;
}
