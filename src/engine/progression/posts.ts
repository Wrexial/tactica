/**
 * Primary / attached post (T051) — how a soldier's **role** shapes its stats
 * and which **abilities** it may take into the field.
 *
 * In FFTA a unit has a **primary job** and a **secondary (attached) job**
 * (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_jobs.md`). They do different
 * jobs (mapping §10, decision D3):
 *
 * - The **primary post** supplies the stat side of the unit. Its per-level
 *   *growth* block feeds `deriveStats` (T018) and its kit (equip slots + weapon
 *   families) governs equipment legality (T050). An attached post **never**
 *   changes stats.
 * - The **attached post** supplies a second *action skillset*. Once a soldier
 *   has learned at least one ability from a post (its abilities are
 *   **mastered**), that post is *mastered* and its skillsets may be attached —
 *   the retheme's reading of "secondary job command".
 * - **Reaction**, **trait** (support) and **volley** (combo) abilities are
 *   learned once and then equipped from *any* mastered post, independent of the
 *   current primary/attached choice (mapping §6). Each is a single **slot**.
 *
 * ```
 *   PostDef.growth ──► derivePostStats(assignment) ──► StatBlock
 *
 *   mastered = { fusilier: ["volley-fire"], grenadier: ["bayonet-charge"] }
 *        │
 *        ├─ availableSkillsets(assignment, mastered)   primary ＋ every mastered post
 *        └─ equipSlot(assignment, "reaction", id, { mastered })   mastered only
 * ```
 *
 * ## What this module owns
 *
 * - {@link PostAssignment} — the serialisable progression record: primary post,
 *   attached post, chosen action skillset and the three ability slots.
 * - {@link derivePostStats} — the stat block from the **primary** post only.
 * - {@link availableSkillsets} / {@link assignActionSkillset} — the *skillset
 *   choice from any mastered post*.
 * - {@link equipSlot} / {@link clearSlot} — the *reaction / trait / volley
 *   slots*.
 *
 * The battle {@link Unit} carries only a `postId` snapshot today; the full
 * assignment is roster/progression state, so this module keeps it a plain,
 * JSON-safe value that a save (T100/T101) or the post-change screen (T052) can
 * store and validate without touching the engine.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   The same inputs always produce the same assignment or stat block.
 * - **State in, state out** — nothing is mutated; every update returns a new
 *   assignment (structural sharing is fine).
 * - **Data-driven** — the post roster, growth tables and skillset lists are
 *   authored content (`src/data/posts/`); only the *rules* live here.
 * - **Fail fast at the boundary** — an unknown post, a skillset the soldier has
 *   not mastered, or an ability of the wrong class throws a `RangeError`
 *   rather than fielding an impossible loadout.
 *
 * Reference: `docs/wiki/pages/Final_Fantasy_Tactics_Advance_jobs.md` (job growth
 * and equipment), mapping §3 (posts) and §6 (A/R/S/C abilities).
 */

import {
  canTakePost,
  getPost,
  isPostKey,
  POST_LIST,
  type MasteredByPost,
  type PostKey,
} from "../../data/posts";
import type { AbilityClass, PostDef, PowerKey, StatBlock, StatGrowth } from "../../data/schema";
import {
  asPostId,
  asSkillsetId,
  assertId,
  type AbilityId,
  type PostId,
  type SkillsetId,
} from "../ids";
import { deriveStats, type StatModifiers } from "../stats";
import type { Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Ability slots (mapping §6)
 * ------------------------------------------------------------------------ */

/**
 * The three equipped-ability slots every soldier carries. FFTA's single
 * **R-Ability**, single **S-Ability** and **Combo** (C-Ability) slots,
 * rethemed (mapping §1, §6):
 *
 * | Slot       | FFTA      | Tactica            | Class     |
 * | ---------- | --------- | ------------------ | --------- |
 * | `reaction` | R-Ability | **Reaction**       | reaction  |
 * | `trait`    | S-Ability | **Trait** (support) | support  |
 * | `volley`   | C-Ability | **Volley** (combo) | combo     |
 */
export const ABILITY_SLOT_KEYS = ["reaction", "trait", "volley"] as const;
export type AbilitySlot = (typeof ABILITY_SLOT_KEYS)[number];

/** Runtime guard for untrusted slot keys (saves, UI). */
export function isAbilitySlot(value: unknown): value is AbilitySlot {
  return typeof value === "string" && (ABILITY_SLOT_KEYS as readonly string[]).includes(value);
}

/**
 * Which ability class each slot accepts. A reaction goes in the reaction slot,
 * a trait in the trait slot, a volley in the volley slot; {@link equipSlot}
 * enforces this whenever the caller supplies an `abilityClassOf` lookup.
 */
export const ABILITY_SLOT_CLASSES: Readonly<Record<AbilitySlot, AbilityClass>> = {
  reaction: "reaction",
  trait: "support",
  volley: "combo",
};

/** A filled (or empty) ability slot. `null` means the slot is empty. */
export type AbilitySlotLoadout = Readonly<Record<AbilitySlot, AbilityId | null>>;

/** An all-empty slot loadout. Prefix-roll with `...emptySlotLoadout()`. */
export function emptySlotLoadout(): AbilitySlotLoadout {
  // Listed explicitly (rather than looping) so adding a slot is a compile
  // error here, not a silently missing slot.
  return { reaction: null, trait: null, volley: null };
}

/* --------------------------------------------------------------------------
 * The post assignment
 * ------------------------------------------------------------------------ */

/**
 * A soldier's progression record: which post supplies its stats (the
 * {@link PostAssignment.primaryPostId}), which mastered post supplies its
 * second action skillset, and the three equipped abilities.
 *
 * It is a plain, JSON-safe value so a save can round-trip it and the
 * post-change screen (T052) can preview it. It deliberately does **not** carry
 * a `power`: power legality is checked once, when the assignment is created and
 * when a post is unlocked (`src/data/posts`), not on every stat query.
 */
export interface PostAssignment {
  /** The role that supplies stats and kit legality (FFTA primary job). */
  readonly primaryPostId: PostId;
  /** The mastered post supplying the attached action skillset, if any. */
  readonly attachedPostId: PostId | null;
  /** The chosen action skillset (primary or attached). `null` for none. */
  readonly actionSkillsetId: SkillsetId | null;
  /** The reaction / trait / volley slots (each `null` when empty). */
  readonly slots: AbilitySlotLoadout;
}

/**
 * Authoring/creation input for {@link createPostAssignment}. Only the primary
 * post is required: the action skillset defaults to the primary post's first
 * skillset (a soldier always has its own command) and the slots start empty.
 */
export interface PostAssignmentInput {
  readonly primaryPostId: PostId;
  readonly attachedPostId?: PostId | null;
  readonly actionSkillsetId?: SkillsetId | null;
  readonly slots?: Partial<Record<AbilitySlot, AbilityId | null>>;
  /** When supplied, the assignment is checked against the power's school. */
  readonly power?: PowerKey;
}

/* --------------------------------------------------------------------------
 * Intrinsic post lookups
 * ------------------------------------------------------------------------ */

/** Narrow a branded post id to a known roster key, or throw a `RangeError`. */
function requirePost(postId: PostId, label: string): PostDef {
  if (!isPostKey(postId)) {
    throw new RangeError(`${label} is not a known post: ${String(postId)}`);
  }
  return getPost(postId);
}

/** The primary post definition that supplies this assignment's stats. */
export function primaryPostOf(assignment: PostAssignment): PostDef {
  return requirePost(assignment.primaryPostId, "assignment.primaryPostId");
}

/** The attached post definition, or `null` when the soldier has none. */
export function attachedPostOf(assignment: PostAssignment): PostDef | null {
  if (assignment.attachedPostId === null) return null;
  return requirePost(assignment.attachedPostId, "assignment.attachedPostId");
}

/** The per-level growth block of the assignment's **primary** post. */
export function primaryPostGrowth(assignment: PostAssignment): StatGrowth {
  return primaryPostOf(assignment).growth;
}

/* --------------------------------------------------------------------------
 * Mastery
 * ------------------------------------------------------------------------ */

/**
 * Every post the soldier has **mastered** at least one ability from, in roster
 * order. A mastered post may contribute its skillsets to the action command and
 * its abilities to the reaction/trait/volley slots.
 */
export function masteredPosts(mastered: MasteredByPost): readonly PostDef[] {
  return POST_LIST.filter((post) => (mastered[post.id]?.length ?? 0) > 0);
}

/** `true` when `abilityId` has been mastered under any post. */
export function isAbilityMastered(
  abilityId: AbilityId | string,
  mastered: MasteredByPost,
): boolean {
  for (const learned of Object.values(mastered)) {
    if (learned.includes(abilityId)) return true;
  }
  return false;
}

/* --------------------------------------------------------------------------
 * Creation
 * ------------------------------------------------------------------------ */

/** Find the first post (primary, then attached) that owns `skillsetId`. */
function findSkillsetOwner(
  skillsetId: SkillsetId,
  posts: readonly (PostDef | null)[],
): PostDef | undefined {
  for (const post of posts) {
    if (post !== null && post.skillsetIds.includes(skillsetId)) return post;
  }
  return undefined;
}

/** A post's default action skillset — its first authored one, if any. */
function defaultActionSkillset(post: PostDef): SkillsetId | null {
  const first = post.skillsetIds[0];
  return first === undefined ? null : asSkillsetId(first);
}

/** Fill an omitted/partial slot record with empty slots. */
function normalizeSlots(
  slots: Partial<Record<AbilitySlot, AbilityId | null>> | undefined,
): AbilitySlotLoadout {
  const result: Record<AbilitySlot, AbilityId | null> = {
    ...emptySlotLoadout(),
  };
  if (slots === undefined) return result;
  for (const slot of ABILITY_SLOT_KEYS) {
    const value = slots[slot];
    if (value === undefined) continue;
    if (value !== null) assertId(value, `slots.${slot}`);
    result[slot] = value;
  }
  return result;
}

/**
 * Build and validate a {@link PostAssignment}.
 *
 * - The primary post (and an explicit attached post) must be a known roster
 *   entry, and available to `power` when one is supplied.
 * - A supplied `actionSkillsetId` must belong to the primary or attached post.
 *   When omitted, the primary post's first skillset is chosen.
 * - Slot values must be non-empty ability ids; supply {@link equipSlot} to also
 *   enforce mastery and class.
 *
 * ```ts
 * createPostAssignment({ primaryPostId: asPostId("fusilier"), power: "france" });
 * // { primaryPostId: "fusilier", attachedPostId: null,
 * //   actionSkillsetId: "fusilier-kit", slots: { reaction: null, … } }
 * ```
 *
 * @throws RangeError when a post is unknown/unavailable or a skillset is not
 * owned by the primary or attached post.
 */
export function createPostAssignment(input: PostAssignmentInput): PostAssignment {
  const primary = requirePost(input.primaryPostId, "primaryPostId");
  if (input.power !== undefined && !canTakePost(primary.id as PostKey, input.power)) {
    throw new RangeError(`post ${primary.id} is not available to ${input.power}`);
  }

  const attached =
    input.attachedPostId == null ? null : requirePost(input.attachedPostId, "attachedPostId");
  if (
    attached !== null &&
    input.power !== undefined &&
    !canTakePost(attached.id as PostKey, input.power)
  ) {
    throw new RangeError(`post ${attached.id} is not available to ${input.power}`);
  }

  let actionSkillsetId: SkillsetId | null;
  if (input.actionSkillsetId !== undefined) {
    actionSkillsetId = input.actionSkillsetId;
    if (actionSkillsetId !== null) {
      assertId(actionSkillsetId, "actionSkillsetId");
      const owner = findSkillsetOwner(actionSkillsetId, [primary, attached]);
      if (owner === undefined) {
        throw new RangeError(
          `skillset ${actionSkillsetId} is not owned by the primary or attached post`,
        );
      }
    }
  } else {
    actionSkillsetId = defaultActionSkillset(primary);
  }

  return {
    primaryPostId: input.primaryPostId,
    attachedPostId: attached === null ? null : asPostId(attached.id),
    actionSkillsetId,
    slots: normalizeSlots(input.slots),
  };
}

/* --------------------------------------------------------------------------
 * Stats from the primary post
 * ------------------------------------------------------------------------ */

/** Optional flat layers for {@link derivePostStats}, mirroring `deriveStats`. */
export interface PostStatOptions {
  /** Flat post modifiers (baseline, movement rates, a legacy delta, ...). */
  readonly postMods?: StatModifiers;
  /** Flat modifiers from each equipped item, summed in order. */
  readonly equipment?: readonly StatModifiers[];
}

/** Input to {@link derivePostStats}. */
export interface PostStatInput extends PostStatOptions {
  /** Character level, an integer `>= 1`. */
  readonly level: number;
  readonly assignment: PostAssignment;
}

/**
 * Derive a soldier's stats from its **primary** post. The attached post is
 * ignored: FFTA gives the secondary job no stat growth, so attaching a
 * grenadier command to a fusilier changes the abilities, never the numbers
 * (mapping §10).
 *
 * This is a thin, data-driven wrapper over `deriveStats` (T018): growth comes
 * from {@link primaryPostOf}, and the flat `postMods`/`equipment` layers pass
 * straight through.
 *
 * ```ts
 * derivePostStats({ level: 5, assignment });
 * // same as deriveStats({ level: 5, growth: POSTS.fusilier.growth })
 * ```
 */
export function derivePostStats(input: PostStatInput): StatBlock {
  return deriveStats({
    level: input.level,
    growth: primaryPostGrowth(input.assignment),
    postMods: input.postMods,
    equipment: input.equipment,
  });
}

/**
 * Derive stats for a deployed soldier from its assignment, reading its
 * `level`. The assignment is the authority — the unit's stored `postId` and
 * `stats` block are outputs, not inputs (mapping §10; T018/T052).
 */
export function deriveUnitPostStats(
  unit: Unit,
  assignment: PostAssignment,
  options: PostStatOptions = {},
): StatBlock {
  return derivePostStats({ level: unit.level, assignment, ...options });
}

/* --------------------------------------------------------------------------
 * Skillsets from any mastered post
 * ------------------------------------------------------------------------ */

/**
 * Every action skillset the soldier may currently choose: the **primary**
 * post's skillsets (always available) followed by those of every **mastered**
 * post, deduplicated and in roster order.
 *
 * ```ts
 * availableSkillsets(assignment, { grenadier: ["bayonet-charge"] });
 * // ["fusilier-kit", "grenadier-kit"]
 * ```
 */
export function availableSkillsets(
  assignment: PostAssignment,
  mastered: MasteredByPost,
): readonly SkillsetId[] {
  const result: SkillsetId[] = [];
  const seen = new Set<string>();
  for (const post of [primaryPostOf(assignment), ...masteredPosts(mastered)]) {
    for (const skillsetId of post.skillsetIds) {
      if (seen.has(skillsetId)) continue;
      seen.add(skillsetId);
      result.push(asSkillsetId(skillsetId));
    }
  }
  return result;
}

/** `true` when the soldier may attach `skillsetId` (primary or mastered post). */
export function canUseSkillset(
  assignment: PostAssignment,
  skillsetId: SkillsetId,
  mastered: MasteredByPost,
): boolean {
  return availableSkillsets(assignment, mastered).includes(skillsetId);
}

/**
 * Choose the **action skillset** from any post the soldier has mastered,
 * returning a new assignment whose {@link PostAssignment.attachedPostId} names
 * the owner. Choosing the primary post's own skillset clears the attached post.
 *
 * ```ts
 * assignActionSkillset(assignment, asSkillsetId("grenadier-kit"), {
 *   grenadier: ["bayonet-charge"],
 * });
 * // attachedPostId: "grenadier", actionSkillsetId: "grenadier-kit"
 * ```
 *
 * @throws RangeError when the skillset belongs to no mastered post.
 */
export function assignActionSkillset(
  assignment: PostAssignment,
  skillsetId: SkillsetId,
  mastered: MasteredByPost,
): PostAssignment {
  assertId(skillsetId, "skillsetId");
  const primary = primaryPostOf(assignment);
  if (primary.skillsetIds.includes(skillsetId)) {
    return { ...assignment, attachedPostId: null, actionSkillsetId: skillsetId };
  }

  const owner = masteredPosts(mastered).find((post) => post.skillsetIds.includes(skillsetId));
  if (owner === undefined) {
    throw new RangeError(`skillset ${skillsetId} is not available: its post is not mastered`);
  }
  return {
    ...assignment,
    attachedPostId: asPostId(owner.id),
    actionSkillsetId: skillsetId,
  };
}

/** Reset the action command to the primary post's default skillset. */
export function usePrimarySkillset(assignment: PostAssignment): PostAssignment {
  return {
    ...assignment,
    attachedPostId: null,
    actionSkillsetId: defaultActionSkillset(primaryPostOf(assignment)),
  };
}

/* --------------------------------------------------------------------------
 * Reaction / trait / volley slots
 * ------------------------------------------------------------------------ */

/** Options for {@link equipSlot}, gating what may go in a slot. */
export interface EquipSlotOptions {
  /**
   * The soldier's mastered abilities, keyed by post. When supplied, the ability
   * must appear in the map (a slot may only hold something the soldier has
   * learned). Omit for authoring/test fixtures.
   */
  readonly mastered?: MasteredByPost;
  /**
   * Optional ability-class lookup. When supplied, the ability must match the
   * slot's class ({@link ABILITY_SLOT_CLASSES}). Unknown abilities are allowed.
   */
  readonly abilityClassOf?: (abilityId: AbilityId) => AbilityClass | undefined;
}

/** Read one slot: the equipped ability, or `null` when empty. */
export function slotAbility(assignment: PostAssignment, slot: AbilitySlot): AbilityId | null {
  if (!isAbilitySlot(slot)) {
    throw new RangeError(`unknown ability slot: ${String(slot)}`);
  }
  return assignment.slots[slot];
}

/**
 * Fill a slot with a mastered ability, returning a new assignment. The input
 * is never mutated.
 *
 * ```ts
 * equipSlot(assignment, "reaction", asAbilityId("riposte"), {
 *   mastered: { fusilier: ["riposte"] },
 * });
 * ```
 *
 * @throws RangeError when the slot is unknown, the id is malformed, the
 * ability is not mastered (when `mastered` is supplied), or its class does not
 * match the slot (when `abilityClassOf` is supplied).
 */
export function equipSlot(
  assignment: PostAssignment,
  slot: AbilitySlot,
  abilityId: AbilityId,
  options: EquipSlotOptions = {},
): PostAssignment {
  if (!isAbilitySlot(slot)) {
    throw new RangeError(`unknown ability slot: ${String(slot)}`);
  }
  assertId(abilityId, `slots.${slot}`);

  if (options.mastered !== undefined && !isAbilityMastered(abilityId, options.mastered)) {
    throw new RangeError(`ability ${abilityId} is not mastered and cannot be equipped`);
  }

  if (options.abilityClassOf !== undefined) {
    const expected = ABILITY_SLOT_CLASSES[slot];
    const actual = options.abilityClassOf(abilityId);
    if (actual !== undefined && actual !== expected) {
      throw new RangeError(
        `ability ${abilityId} is a ${actual} ability, not a ${expected} ability`,
      );
    }
  }

  return { ...assignment, slots: { ...assignment.slots, [slot]: abilityId } };
}

/** Empty one slot, returning a new assignment. */
export function clearSlot(assignment: PostAssignment, slot: AbilitySlot): PostAssignment {
  if (!isAbilitySlot(slot)) {
    throw new RangeError(`unknown ability slot: ${String(slot)}`);
  }
  return { ...assignment, slots: { ...assignment.slots, [slot]: null } };
}
