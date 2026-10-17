/**
 * Shared authoring helpers for the Article-of-War card pool (T054, T093;
 * mapping §9).
 *
 * T054 authored the {@link ArticleDef} model and a first slice of standing
 * orders; T093 splits the pool by disposition so it can grow into a full card
 * list without becoming one unreadable module:
 *
 * | Module        | Contents                                                     |
 * | ------------- | ------------------------------------------------------------ |
 * | `forbid.ts`   | Forbidding standing orders (Reprimand / Court-Martial on breach) |
 * | `commend.ts`  | Commended acts (grant Honour, mapping §5)                     |
 * | `index.ts`    | The aggregate pool + every lookup and matching helper         |
 *
 * This module holds only the small, disposition-agnostic piece both halves
 * reuse: {@link parseArticles}, which stamps the stable id onto each entry and
 * validates it with {@link ArticleDefSchema}. Keeping the parser here means a
 * mistyped target, kind or severity fails **at module load**
 * (`agents.md` §2, §3, §9) rather than silently disarming a standing order.
 * Nothing here imports the engine — the data layer stays the bottom of the
 * dependency graph (`src/data/README.md`).
 */

import type { z } from "zod";

import { ArticleDefSchema, type ArticleDef } from "../schema";

/**
 * Raw authoring shape: an Article's fields with the `id` supplied by its key.
 * Declared explicitly (rather than via `z.input`) so the defaulted enforcement
 * fields may be omitted at the call site.
 */
export type ArticleInput = z.input<typeof ArticleDefSchema>;

/** A single Article as authored, before {@link parseArticles} stamps its id on. */
export type ArticleData = Omit<ArticleInput, "id">;

/**
 * Validate a module's authored Articles and key them by their stable id.
 *
 * ```ts
 * export const FORBID_ARTICLES = parseArticles({
 *   "no-fire": { name: "No Incendiary", ... },
 * });
 * ```
 *
 * The `const` type parameter preserves the literal keys, so the returned
 * record's `keyof` is exactly the authored Article ids and the aggregate pool
 * in `./index.ts` stays exhaustively typed.
 */
export function parseArticles<const T extends Record<string, ArticleData>>(
  data: T,
): { readonly [K in keyof T]: ArticleDef } {
  const parsed = {} as { [K in keyof T]: ArticleDef };
  for (const key of Object.keys(data) as (keyof T)[]) {
    parsed[key] = ArticleDefSchema.parse({ id: String(key), ...data[key] });
  }
  return parsed;
}
