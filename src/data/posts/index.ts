/**
 * Post (role / class) roster — the aggregate registry for T046/T047.
 *
 * A **post** is FFTA's *job*: a power restriction (the military school that may
 * hold it), a per-level stat-growth profile, the kit it is trained to use and
 * the skillsets it commands. Secondary posts are gated FFTA-style by **unlock
 * requirements** — "master N abilities from post X" (mapping §3).
 *
 * This module merges the five power role trees plus the common posts into a
 * single validated registry:
 *
 * | Module        | Power (FFTA race)          | Notes                          |
 * | ------------- | -------------------------- | ------------------------------ |
 * | `france.ts`   | France (Hume)              | Combined arms, balanced        |
 * | `britain.ts`  | Britain (Viera)            | Light troops, rifles, speed    |
 * | `prussia.ts`  | Prussia (Bangaa)           | Disciplined shock infantry     |
 * | `russia.ts`   | Russia (Nu mou)            | Artillery, engineers, resolve  |
 * | `austria.ts`  | Austria (Moogle)           | Defensive lines, support       |
 * | `common.ts`   | Shared (Surgeon, etc.)     | `common: true`, any power      |
 *
 * ## Ids, names and powers
 *
 * As everywhere in `src/data/`, the **id stays stable and mechanical**
 * (`fusilier`, `rifleman`, `line-grenadier`) while the display fields carry the
 * Napoleonic fiction (`src/data/README.md`, mapping §1). Where two different
 * FFTA jobs share one mapping name — Austria's *Fusilier* and *Grenadier* — the
 * ids use the FFTA job keys (`gunner`, `juggler`) so the roster is unique.
 *
 * ## Growth numbers
 *
 * Every growth value is **re-authored balance data** — inspired by the scraped
 * FFTA job tables
 * (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_jobs.md`) but rounded and
 * rebalanced for detachment scale (`agents.md` §3, §10). No balance constant
 * lives in engine code: the engine reads these blocks through `deriveStats`
 * (`src/engine/stats.ts`, T018).
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse. Ids stay plain strings (branded at the engine
 *   boundary, T012).
 * - **Validated at load.** Each entry is parsed with `PostDefSchema` in
 *   `shared.ts`, so a malformed growth block or weapon family fails loudly.
 * - **No placeholders.** Every post carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { AUSTRIA_POSTS } from "./austria";
import { BRITAIN_POSTS } from "./britain";
import { COMMON_POSTS } from "./common";
import { FRANCE_POSTS } from "./france";
import { PRUSSIA_POSTS } from "./prussia";
import { RUSSIA_POSTS } from "./russia";
import type { PostDef, PostRequirement, PowerKey } from "../schema";

/* --------------------------------------------------------------------------
 * The aggregate roster
 * ------------------------------------------------------------------------ */

/**
 * Every post, keyed by its stable id and grouped by power in the canonical
 * order (France, Britain, Prussia, Russia, Austria, common). Spreading the
 * per-power records preserves insertion order, so {@link POST_KEYS} — and
 * every menu built from it — is deterministic.
 */
export const POSTS = {
  ...FRANCE_POSTS,
  ...BRITAIN_POSTS,
  ...PRUSSIA_POSTS,
  ...RUSSIA_POSTS,
  ...AUSTRIA_POSTS,
  ...COMMON_POSTS,
} as const;

/** A known post id (an FFTA-shaped, stable string). */
export type PostKey = keyof typeof POSTS;

/**
 * The canonical post keys in roster order. Typed as the literal union array so
 * iteration order is stable across builds.
 */
export const POST_KEYS = Object.keys(POSTS) as PostKey[];

/**
 * The posts in their canonical order ({@link POST_KEYS}). Handy for menus,
 * post-change screens and tests that need a stable iteration order.
 */
export const POST_LIST: readonly PostDef[] = POST_KEYS.map((id) => POSTS[id]);

/* --------------------------------------------------------------------------
 * Lookups & power restriction
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical post key. */
export function isPostKey(value: unknown): value is PostKey {
  return typeof value === "string" && (POST_KEYS as readonly string[]).includes(value);
}

/** Look up a post by its canonical key. Throws on an unknown key. */
export function getPost(id: PostKey): PostDef {
  const post = POSTS[id];
  if (post === undefined) {
    throw new RangeError(`unknown post: ${String(id)}`);
  }
  return post;
}

/** The common posts any power may take (Surgeon, Artilleryman, Forager, Staff Officer). */
export function commonPosts(): readonly PostDef[] {
  return POST_LIST.filter((post) => post.common);
}

/**
 * Every post a given power may take: its home-school posts **and** the common
 * posts. Order follows {@link POST_LIST}.
 */
export function postsForPower(power: PowerKey): readonly PostDef[] {
  return POST_LIST.filter((post) => post.power === power || post.common);
}

/**
 * `true` when a power may hold a post — either because the post belongs to that
 * school or because it is a common post. Backs the post-change screen's gating
 * (T052).
 */
export function canTakePost(postId: PostKey, power: PowerKey): boolean {
  const post = getPost(postId);
  return post.power === power || post.common;
}

/* --------------------------------------------------------------------------
 * Unlock requirements (FFTA "master N abilities from post X")
 * ------------------------------------------------------------------------ */

/**
 * How many abilities a soldier has mastered, grouped by the post that taught
 * them. Until the ability collection lands (T089) this is the smallest shape
 * that answers "do you meet the prerequisite?", and it keeps the check pure.
 *
 * ```ts
 * const mastered = { fusilier: ["bayonet-charge", "volley-fire"] };
 * meetsPostRequirement({ postId: "fusilier", abilities: 2 }, mastered); // true
 * ```
 */
export type MasteredByPost = Readonly<Record<string, readonly string[]>>;

/** `true` when the soldier has mastered enough abilities from the named post. */
export function meetsPostRequirement(
  requirement: PostRequirement,
  mastered: MasteredByPost,
): boolean {
  const learned = mastered[requirement.postId];
  return (learned?.length ?? 0) >= requirement.abilities;
}

/** `true` when every unlock prerequisite for a post is satisfied. */
export function meetsPostRequirements(post: PostDef, mastered: MasteredByPost): boolean {
  return post.requires.every((requirement) => meetsPostRequirement(requirement, mastered));
}

/**
 * The posts a power can currently unlock: its own and common posts (see
 * {@link postsForPower}) whose prerequisites are met. A starting post has no
 * prerequisites and is always included.
 */
export function unlockablePosts(power: PowerKey, mastered: MasteredByPost): readonly PostDef[] {
  return postsForPower(power).filter((post) => meetsPostRequirements(post, mastered));
}
