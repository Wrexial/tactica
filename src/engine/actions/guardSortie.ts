/**
 * Guard Sorties (T062) — FFTA's **Totema** rethemed (mapping §4, §12).
 *
 * A Guard Sortie is the free company calling in a **national elite formation**:
 * the Old Guard's general assault, the Heavy Brigade's draining charge, the
 * Death's Head Hussars' shock break-through, the Grand Battery's massed
 * barrage, or the Kaiser's Bombardiers' walking bombardment. It is the retheme's
 * reading of the reference's race-guardian summons
 * (`docs/wiki/pages/Totema.md`):
 *
 * > The Totema are summoned by spending ten Judge Points (the maximum), and
 * > their effects strike every enemy on the battlefield.
 *
 * This module is the **executor**: given a battle, the calling soldier, a
 * data-defined {@link GuardSortieSpec}, the battle's seeded {@link Rng} and the
 * campaign's story progress, it gates the call, spends the ten Honour, announces
 * the formation and lands its effects on **every** enemy — no range, no line of
 * sight, no evasion.
 *
 * ## Cost and gate
 *
 * FFTA fixes the cost at ten JP, which is also the maximum a character carries.
 * Tactica keeps that exactly: {@link import("../rules/honour").GUARD_SORTIE_COST}
 * (`10`) is spent through the T060 economy, so the pool empties on a call and a
 * soldier who cannot afford it is refused. A Guard Sortie must also be
 * **unlocked by the story** (mapping §4: "you may call on once unlocked … by
 * beating it in the story"). The executor takes an
 * {@link GuardSortieOptions.isUnlocked} predicate, fed from campaign progress;
 * by default nothing is unlocked, so a battle can never summon a formation the
 * story has not met.
 *
 * ## Whole-field reach
 *
 * The formation's effects are applied through the ordinary action executor
 * (T041), so damage, elements and drains behave exactly as any other action.
 * What makes a Guard Sortie special is its footprint: the working ability is
 * given the {@link import("../targeting").aoeTiles} `"field"` shape, a reach
 * that spans the whole map and no line-of-sight requirement. The single call
 * resolves against every living enemy, in deployment order, deterministically.
 * The reference's multi-hit Totema (Famfrit) are expressible as data through
 * {@link GuardSortieSpec.hits}.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   All randomness is drawn from the caller-supplied {@link Rng}; the same
 *   state, spec, seed and story progress always produce byte-identical events.
 * - **State in, state out** — inputs are never mutated; a new
 *   {@link BattleState} is returned (structural sharing is fine).
 * - **Data-driven** — no formation, power or unit id is special-cased. The
 *   effects arrive from the {@link GuardSortieSpec}; the Honour is spent through
 *   the T060 economy (`spendHonour`), never hand-rolled.
 * - **Integer only** — every combat value stays a whole number, so a replay
 *   never drifts on floating point.
 *
 * Reference: `docs/wiki/pages/Totema.md` (cost, whole-field reach) and
 * `docs/wiki/pages/Judge_Points.md` (the ten-point cap). Fiction:
 * `docs/NAPOLEONIC_MAPPING.md` §4 and §13, step 7.
 */

import type { GuardSortieDef, GuardSortieEffect } from "../../data/guards";
import { GUARD_SORTIE_LIST } from "../../data/guards";
import type { AbilityEffect, AbilityExecutionOptions, AbilitySpec } from "./ability";
import { executeAbility } from "./ability";
import type { BattleState } from "../battle";
import { unitTarget } from "../commands";
import type { BattleEvent } from "../events";
import {
  asAbilityId,
  asConditionId,
  asGuardSortieId,
  isValidId,
  type GuardSortieId,
  type UnitId,
} from "../ids";
import type { Rng } from "../rng";
import { GUARD_SORTIE_COST, spendHonour } from "../rules/honour";
import { areHostile } from "../targeting";
import { isOutOfAction, type Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Authored action data
 * ------------------------------------------------------------------------ */

/**
 * The executable shape of a Guard Sortie. It is an {@link AbilitySpec} — the
 * same effect data an action carries — plus the formation's identity and the
 * number of passes it makes. Built from an authored `GuardSortieDef` with
 * {@link guardSortieSpec}; the targeting fields are deliberately fixed by the
 * executor (whole field, no line of sight), not by content.
 */
export interface GuardSortieSpec extends AbilitySpec {
  /** The national formation being called (mapping §4). */
  readonly guardSortieId: GuardSortieId;
  /**
   * Number of passes the formation makes. Defaults to `1`; the Kaiser's
   * Bombardiers author `3` (Famfrit's multi-hit fire). Must be an integer
   * `>= 1`.
   */
  readonly hits?: number;
}

/* --------------------------------------------------------------------------
 * Result shapes
 * ------------------------------------------------------------------------ */

/**
 * Why a Guard Sortie was refused. `"locked"` is the story gate; the others
 * mirror the T060 spend and a field with nothing to strike.
 */
export type GuardSortieFailReason = "locked" | "insufficient-honour" | "no-target";

/** The outcome of one {@link executeGuardSortie} call. */
export interface GuardSortieExecution {
  /** `false` when the call was refused (no Honour spent, no events). */
  readonly ok: boolean;
  /** The battle after the sortie (or the input, unchanged, on rejection). */
  readonly state: BattleState;
  /** Ordered events describing the sortie; empty on rejection. */
  readonly events: readonly BattleEvent[];
  /** Honour that actually left the caller's pool (`0` on rejection). */
  readonly honourSpent: number;
  /** Enemies the sortie was aimed at, in deployment order (empty on rejection). */
  readonly targets: readonly UnitId[];
  /** The rejection reason, when {@link ok} is `false`. */
  readonly reason?: GuardSortieFailReason;
}

/**
 * Hooks for the executor. Extends the action executor's options so elemental
 * affinities can still be supplied; adds the **story gate**.
 */
export interface GuardSortieOptions extends AbilityExecutionOptions {
  /**
   * Whether the campaign has unlocked `guardSortieId`. Defaults to a predicate
   * that unlocks nothing, so a formation can never be called before the story
   * has met it (mapping §4). Build one with {@link guardSortieUnlockPredicate}.
   */
  readonly isUnlocked?: (guardSortieId: GuardSortieId) => boolean;
}

/* --------------------------------------------------------------------------
 * Story unlock seam (T077)
 * ------------------------------------------------------------------------ */

/**
 * The Guard Sorties an at-`chapter` story has unlocked, in canonical order.
 * Backed by the authored `GuardSortieDef.chapter` (`src/data/guards.ts`), so
 * the story spine (T077) gates content without the engine owning a list.
 *
 * ```ts
 * unlockedGuardSorties(2).map((id) => id); // ["old-guard"]
 * unlockedGuardSorties(6);                  // all five
 * ```
 *
 * Throws a `RangeError` for a non-integer or negative chapter.
 */
export function unlockedGuardSorties(chapter: number): readonly GuardSortieId[] {
  if (!Number.isInteger(chapter) || chapter < 0) {
    throw new RangeError(
      `story chapter must be a non-negative integer, received ${String(chapter)}`,
    );
  }
  return GUARD_SORTIE_LIST.filter((guard) => guard.chapter <= chapter).map((guard) =>
    asGuardSortieId(guard.id),
  );
}

/**
 * A story-driven {@link GuardSortieOptions.isUnlocked} predicate for a campaign
 * at `chapter`. Hand this to {@link executeGuardSortie} so the story progress —
 * not the caller — decides what may be summoned.
 *
 * ```ts
 * executeGuardSortie(state, officer, oldGuard, rng, {
 *   isUnlocked: guardSortieUnlockPredicate(campaign.chapter),
 * });
 * ```
 *
 * Throws a `RangeError` for a non-integer or negative chapter.
 */
export function guardSortieUnlockPredicate(
  chapter: number,
): (guardSortieId: GuardSortieId) => boolean {
  const unlocked = new Set(unlockedGuardSorties(chapter));
  return (guardSortieId) => unlocked.has(guardSortieId);
}

/* --------------------------------------------------------------------------
 * Effect conversion (authored data → engine effects)
 * ------------------------------------------------------------------------ */

/** Translate one authored Guard Sortie effect into an engine ability effect. */
function toAbilityEffect(effect: GuardSortieEffect): AbilityEffect {
  switch (effect.kind) {
    case "steel":
      return {
        kind: "steel",
        power: effect.power,
        ...(effect.element === undefined ? {} : { element: effect.element }),
        ...(effect.inflicts.length === 0
          ? {}
          : { inflicts: effect.inflicts.map((id) => asConditionId(id)) }),
      };
    case "powder":
      return {
        kind: "powder",
        power: effect.power,
        ...(effect.element === undefined ? {} : { element: effect.element }),
        ...(effect.inflicts.length === 0
          ? {}
          : { inflicts: effect.inflicts.map((id) => asConditionId(id)) }),
      };
    case "drain":
      return {
        kind: "drain",
        resource: effect.resource,
        power: effect.power,
        ...(effect.element === undefined ? {} : { element: effect.element }),
      };
  }
}

/**
 * Build the executable {@link GuardSortieSpec} for an authored
 * {@link GuardSortieDef}. The targeting fields the executor owns (range,
 * whole-field shape, no line of sight) are left at placeholder values here and
 * fixed per battle by {@link executeGuardSortie}; the id namespaces are bridged
 * (`GuardSortieId` → `AbilityId`) so the ordinary action executor can attribute
 * its events.
 */
export function guardSortieSpec(def: GuardSortieDef): GuardSortieSpec {
  return {
    id: asAbilityId(def.id),
    guardSortieId: asGuardSortieId(def.id),
    mpCost: 0,
    chargeTime: 0,
    range: 1,
    power: 0,
    target: "enemy",
    aoeShape: "field",
    aoeSize: 0,
    hitRate: 100,
    effects: def.effects.map(toAbilityEffect),
    hits: def.hits,
  };
}

/* --------------------------------------------------------------------------
 * The executor
 * ------------------------------------------------------------------------ */

/**
 * The whole-field working ability for a battle: the spec's effects with a reach
 * spanning the map, the `"field"` footprint and no line-of-sight requirement.
 * A guard formation is already on the field's flank — range and cover do not
 * shelter anyone from it.
 */
function fieldAbility(spec: GuardSortieSpec, state: BattleState): AbilitySpec {
  return {
    ...spec,
    range: state.map.grid.width + state.map.grid.height,
    minRange: 1,
    aoeShape: "field",
    aoeSize: 0,
    target: "enemy",
    requiresLineOfSight: false,
  };
}

/** Replace one soldier in the deployed list, preserving order. */
function replaceUnit(units: readonly Unit[], updated: Unit): readonly Unit[] {
  return units.map((unit) => (unit.id === updated.id ? updated : unit));
}

/** Living enemies of `actor`, in deployment order. */
function livingEnemies(state: BattleState, actor: Unit): Unit[] {
  return state.units.filter((unit) => areHostile(actor.side, unit.side) && !isOutOfAction(unit));
}

/** A refusal value, keeping every field of {@link GuardSortieExecution} well-typed. */
function rejection(state: BattleState, reason: GuardSortieFailReason): GuardSortieExecution {
  return { ok: false, state, events: [], honourSpent: 0, targets: [], reason };
}

/** Assert the pass count is a positive integer (fail fast on malformed content). */
function assertHits(hits: number): void {
  if (!Number.isInteger(hits) || hits < 1) {
    throw new RangeError(`guard sortie.hits must be an integer >= 1, received ${String(hits)}`);
  }
}

/** Assert the formation id is non-empty (fail fast on malformed content). */
function assertSpec(spec: GuardSortieSpec): void {
  if (!isValidId(spec.guardSortieId)) {
    throw new RangeError("guard sortie.guardSortieId must be a non-empty id");
  }
  if (spec.effects.length === 0) {
    throw new RangeError("guard sortie must carry at least one effect");
  }
  assertHits(spec.hits ?? 1);
}

/**
 * Call a national Guard Sortie: gate it on story progress, spend the ten
 * Honour, announce the formation, then land its effects on the whole enemy
 * field.
 *
 * The steps, in order:
 * 1. **Gate** — if the campaign has not unlocked the formation, refuse with
 *    `"locked"` and touch nothing (mapping §4).
 * 2. **Find** — collect the living enemies; a field with none is refused with
 *    `"no-target"`.
 * 3. **Afford** — spend {@link GUARD_SORTIE_COST} through the T060 economy. A
 *    soldier holding fewer than ten Honour is refused with
 *    `"insufficient-honour"`.
 * 4. **Announce** — emit `guardSortieCalled`, then the `honourChanged` spend
 *    (`reason: "guardSortie"`).
 * 5. **Strike** — resolve the whole-field ability once per authored pass
 *    through the action executor (T041), so damage, elements, drains and
 *    out-of-action events behave exactly as any other action. Every pass is
 *    centred on a still-standing enemy and catches the entire field.
 *
 * ```ts
 * const rng = new Rng(state.seed);
 * const { state: next, events } = executeGuardSortie(
 *   state, officer, guardSortieSpec(GUARD_SORTIES["old-guard"]), rng,
 *   { isUnlocked: guardSortieUnlockPredicate(campaign.chapter) },
 * );
 * ```
 *
 * Throws a `RangeError` only for malformed authored data (an empty id, no
 * effects, a `hits` below 1). An in-world locked, unaffordable or empty-field
 * call is a refusal, not an exception.
 */
export function executeGuardSortie(
  state: BattleState,
  actor: Unit,
  spec: GuardSortieSpec,
  rng: Rng,
  options: GuardSortieOptions = {},
): GuardSortieExecution {
  assertSpec(spec);

  const isUnlocked = options.isUnlocked ?? (() => false);
  if (!isUnlocked(spec.guardSortieId)) {
    return rejection(state, "locked");
  }

  const enemies = livingEnemies(state, actor);
  if (enemies.length === 0) {
    return rejection(state, "no-target");
  }
  if (actor.judgePoints < GUARD_SORTIE_COST) {
    return rejection(state, "insufficient-honour");
  }

  const tick = state.tempo.tick;
  const events: BattleEvent[] = [
    {
      kind: "guardSortieCalled",
      tick,
      unitId: actor.id,
      guardSortieId: spec.guardSortieId,
    },
  ];

  const spent = spendHonour(actor, GUARD_SORTIE_COST, "guardSortie", tick);
  events.push(...spent.events);
  let working: BattleState = {
    ...state,
    units: replaceUnit(state.units, spent.unit),
  };

  const ability = fieldAbility(spec, state);
  // A national formation cannot be dodged: its fire is laid on ground and the
  // whole field is its beaten zone. Callers may still override the evasion
  // term, but the default guarantees every enemy is reached.
  const executionOptions: AbilityExecutionOptions = {
    evasionOf: options.evasionOf ?? (() => 0),
    ...(options.affinitiesOf === undefined ? {} : { affinitiesOf: options.affinitiesOf }),
  };
  const hits = spec.hits ?? 1;

  for (let pass = 0; pass < hits; pass++) {
    // Re-centre each pass: the formation keeps firing while enemies stand.
    const centre = livingEnemies(working, spent.unit)[0];
    if (centre === undefined) break;
    const caller = working.units.find((unit) => unit.id === spent.unit.id) ?? spent.unit;
    const shot = executeAbility(
      working,
      caller,
      ability,
      unitTarget(centre.id),
      rng,
      executionOptions,
    );
    events.push(...shot.events);
    working = shot.state;
  }

  return {
    ok: true,
    state: working,
    events,
    honourSpent: spent.amount,
    targets: enemies.map((enemy) => enemy.id),
  };
}
