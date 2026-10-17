/**
 * Shared authoring helpers for the Officers' Mess contract board (T070, T093;
 * mapping §10).
 *
 * T070 authored the {@link ContractDef} model and a first slice of missions;
 * T093 splits the board by kind so it can grow into a full contract list
 * without becoming one unreadable module:
 *
 * | Module            | Kind (`ContractKind`) | FFTA mission | Tactica fiction              |
 * | ----------------- | --------------------- | ------------ | ---------------------------- |
 * | `battles.ts`      | `battle`              | Regular      | Story/campaign set pieces    |
 * | `skirmishes.ts`   | `skirmish`            | Encounter    | Rival free companies         |
 * | `detachments.ts`  | `detachment`          | Dispatch     | Soldiers sent away for N days |
 * | `pacifications.ts`| `pacification`        | Area         | Clear a region and hold it   |
 * | `index.ts`        | —                     | —            | Aggregate board + lookups    |
 *
 * This module holds only the small, kind-agnostic piece all four reuse:
 * {@link parseContracts}, which stamps the stable id onto each entry and
 * validates it with {@link ContractDefSchema}. Keeping the parser here means a
 * mistyped kind, requirement or negative reward fails **at module load**
 * (`agents.md` §2, §3, §9) rather than skewing the campaign. Nothing here
 * imports the engine — the data layer stays the bottom of the dependency graph
 * (`src/data/README.md`).
 */

import type { z } from "zod";

import { ContractDefSchema, type ContractDef } from "../schema";

/** Raw authoring shape: a contract's fields with the `id` supplied by its key. */
export type ContractInput = z.input<typeof ContractDefSchema>;

/** A single contract as authored, before {@link parseContracts} stamps its id on. */
export type ContractData = Omit<ContractInput, "id">;

/**
 * Validate a module's authored contracts and key them by their stable id.
 *
 * ```ts
 * export const BATTLE_CONTRACTS = parseContracts({
 *   "break-the-bridge": { name: "Break the Bridge", ... },
 * });
 * ```
 *
 * The `const` type parameter preserves the literal keys, so the returned
 * record's `keyof` is exactly the authored contract ids and the aggregate board
 * in `./index.ts` stays exhaustively typed.
 */
export function parseContracts<const T extends Record<string, ContractData>>(
  data: T,
): { readonly [K in keyof T]: ContractDef } {
  const parsed = {} as { [K in keyof T]: ContractDef };
  for (const key of Object.keys(data) as (keyof T)[]) {
    parsed[key] = ContractDefSchema.parse({ id: String(key), ...data[key] });
  }
  return parsed;
}
