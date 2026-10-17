/**
 * Volleys (T061) — FFTA's **Combo** rethemed (mapping §6, §12).
 *
 * A Volley is the free company's signature massed-fire action: the initiator
 * **spends Honour** (FFTA Judge Points) to open fire and every eligible
 * **adjacent ally chains in**. It is the retheme's reading of the reference
 * mechanic (`docs/wiki/pages/Combo_(Tactics_Advance).md`):
 *
 * > Combos … are usable once the character has at least one Judge Point. The
 * > initial attack has 100% accuracy … Other characters with a combo set may
 * > join in if they are within the range of their equipped combo ability …
 * > extra Judge Points further increases damage.
 *
 * This module is the **executor**: given a battle, the initiating soldier, a
 * data-defined {@link VolleySpec}, the chosen target, the committed Honour and
 * the battle's seeded {@link Rng}, it spends the Honour, gathers linkers and
 * resolves one volley attack per participant.
 *
 * ## The honour multiplier
 *
 * FFTA scales a combo's damage with the *initiator's* Judge Points:
 *
 * ```text
 *   FinalMultiplier = Multiplier × (10 + 4 × JP) / 10
 * ```
 *
 * Tactica keeps that shape exactly. Committing 1 Honour gives ×1.4, 5 gives
 * ×3.0 and the 10-Honour cap gives ×5.0. The multiplier is applied to every
 * participant's fire — the retheme's deliberate simplification is that **more
 * committed Honour always means more damage**, so a Volley scales with the
 * resource even before it has counted its neighbours (mapping §6: "more Honour
 * = more damage"). Only the **initiator's** pool is considered, matching the
 * reference; linkers spend nothing.
 *
 * ## Chain range
 *
 * The reference gives each combo ability its own join range (1 to 6 tiles). The
 * retheme defaults to the **adjacent** reading the mapping locks in
 * (`docs/NAPOLEONIC_MAPPING.md`: "adjacent allies chain in"), but
 * {@link VolleySpec.linkRange} keeps the reference's longer-ranged combos
 * authorable as data. A linker is an ally of the initiator, still standing, and
 * within `linkRange` tiles of the **target** — a firing line around the mark,
 * exactly as FFTA measures a joiner's reach against the victim.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   All randomness is drawn from the caller-supplied {@link Rng}; the same
 *   state, spec, target, honour and seed always produce byte-identical events.
 * - **State in, state out** — inputs are never mutated; a new
 *   {@link BattleState} is returned (structural sharing is fine).
 * - **Data-driven** — no ability, post or unit id is special-cased. The reach,
 *   effects and link range arrive from the {@link VolleySpec}; the Honour is
 *   spent through the T060 economy (`spendHonour`), never hand-rolled.
 * - **Integer only** — every combat value stays a whole number, so a replay
 *   never drifts on floating point.
 *
 * Reference: `docs/wiki/pages/Combo_(Tactics_Advance).md` (join rules, the
 * `(10 + 4×JP)/10` multiplier) and `docs/wiki/pages/Judge_Points.md` (the cap
 * and the "at least one JP" gate). Fiction: `docs/NAPOLEONIC_MAPPING.md` §6
 * ("C-Abilities → Volley abilities") and §13, step 5.
 */

import type { AbilityEffect, AbilityExecutionOptions, AbilitySpec } from "./ability";
import { abilityRangeProfile, executeAbility } from "./ability";
import type { BattleState } from "../battle";
import type { Target } from "../commands";
import type { BattleEvent } from "../events";
import { isAdjacent, manhattanDistance, type Coord } from "../grid";
import type { UnitId } from "../ids";
import type { Rng } from "../rng";
import { spendHonour } from "../rules/honour";
import { resolveTargeting, type TargetingFailReason, type TargetingResolution } from "../targeting";
import { isOutOfAction, type Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/**
 * Base term of the FFTA combo multiplier (`10` in `(10 + 4×JP)/10`). At zero
 * Honour the multiplier is ×1, i.e. the volley's baseline fire. Re-authored
 * here as named balance data so the curve can be tuned without touching the
 * arithmetic (`agents.md` §3, §10).
 */
export const VOLHONOUR_BASE = 10;

/**
 * Honour term of the FFTA combo multiplier (`4` in `(10 + 4×JP)/10`). Each
 * committed point of Honour adds `4/10` to the multiplier.
 */
export const VOLHONOUR_PER_HONOUR = 4;

/** Divisor of the FFTA combo multiplier (`10` in `(10 + 4×JP)/10`). */
export const VOLHONOUR_DIVISOR = 10;

/**
 * How many tiles from the **target** an ally may stand and still chain in.
 * Defaults to `1` — the mapping's "adjacent allies chain in"
 * (`docs/NAPOLEONIC_MAPPING.md` §6, §12). Longer-ranged combos (`White Combo`,
 * `Bow Combo`, …) set {@link VolleySpec.linkRange} explicitly.
 */
export const DEFAULT_VOLLEY_LINK_RANGE = 1;

/* --------------------------------------------------------------------------
 * Authored action data
 * ------------------------------------------------------------------------ */

/**
 * The executable shape of a Volley ability. It is an {@link AbilitySpec} — the
 * same targeting, hit-rate and effect data an action carries — plus the FFTA
 * combo **join range**, so a volley's chain reach is authored data rather than
 * a hard-coded "adjacent" (mapping §6; `docs/wiki/pages/Combo_(Tactics_
 * Advance).md` lists combos joining from 1 to 6 tiles away).
 */
export interface VolleySpec extends AbilitySpec {
  /**
   * Tiles from the target at which an ally may chain in. Defaults to
   * {@link DEFAULT_VOLLEY_LINK_RANGE}. Must be an integer `>= 1`.
   */
  readonly linkRange?: number;
}

/* --------------------------------------------------------------------------
 * Result shapes
 * ------------------------------------------------------------------------ */

/**
 * Why a Volley was refused. Targeting failures come straight from
 * {@link TargetingFailReason}; `"insufficient-honour"` covers both the FFTA
 * "at least one Judge Point" gate and a commitment larger than the pool.
 */
export type VolleyFailReason = TargetingFailReason | "insufficient-honour";

/** The outcome of one {@link executeVolley} call. */
export interface VolleyExecution {
  /** `false` when the volley was refused (no Honour spent, no events). */
  readonly ok: boolean;
  /** The battle after the volley (or the input, unchanged, on rejection). */
  readonly state: BattleState;
  /** Ordered events describing the volley; empty on rejection. */
  readonly events: readonly BattleEvent[];
  /** Honour the command committed (`>= 1` for an accepted volley). */
  readonly honour: number;
  /** Honour that actually left the initiator's pool (`0` on rejection). */
  readonly honourSpent: number;
  /** Allies eligible to chain in, in deployment order (a forecast aid). */
  readonly linkers: readonly UnitId[];
  /** Full targeting resolution, exposed for the AI and forecast UI (T086). */
  readonly targeting: TargetingResolution<Unit>;
  /** The rejection reason, when {@link ok} is `false`. */
  readonly reason?: VolleyFailReason;
}

/* --------------------------------------------------------------------------
 * Honour multiplier (the FFTA combo formula)
 * ------------------------------------------------------------------------ */

/**
 * The numerator of the FFTA combo multiplier for `honour` committed:
 * `10 + 4 × honour`. Paired with {@link VOLHONOUR_DIVISOR}. Pure and
 * integer-only, so a forecast can show the exact (untruncated) curve.
 *
 * ```ts
 * volleyHonourNumerator(1);  // 14  → ×1.4
 * volleyHonourNumerator(5);  // 30  → ×3.0
 * volleyHonourNumerator(10); // 50  → ×5.0
 * ```
 */
export function volleyHonourNumerator(honour: number): number {
  assertHonour(honour);
  return VOLHONOUR_BASE + VOLHONOUR_PER_HONOUR * honour;
}

/**
 * The FFTA combo multiplier as an exact rational, for a UI forecast:
 * `{ numerator, denominator }` = `(10 + 4×honour) / 10`. Floating point is
 * deliberately avoided (`agents.md` §2: integer determinism).
 */
export function volleyHonourMultiplier(honour: number): {
  readonly numerator: number;
  readonly denominator: number;
} {
  return { numerator: volleyHonourNumerator(honour), denominator: VOLHONOUR_DIVISOR };
}

/**
 * Scale an ability's authored `power` term by the committed Honour:
 * `floor(power × (10 + 4×honour) / 10)`. This is how the multiplier reaches the
 * damage rules (T033–T036) without duplicating their arithmetic — the executor
 * (T041) already reads each effect's `power`.
 *
 * Truncation happens once, at the boundary, so the same honest integer enters
 * the damage formula on every replay.
 *
 * ```ts
 * scaleVolleyPower(100, 1);  // 140
 * scaleVolleyPower(100, 5);  // 300
 * scaleVolleyPower(100, 10); // 500
 * ```
 *
 * Throws a `RangeError` when `power` is not an integer or `honour` is not a
 * non-negative integer.
 */
export function scaleVolleyPower(power: number, honour: number): number {
  if (!Number.isInteger(power)) {
    throw new RangeError(`volley.power must be an integer, received ${String(power)}`);
  }
  const numerator = volleyHonourNumerator(honour);
  return Math.floor((power * numerator) / VOLHONOUR_DIVISOR);
}

/* --------------------------------------------------------------------------
 * Linker selection
 * ------------------------------------------------------------------------ */

/** Assert `linkRange` is a positive integer (fail fast on malformed content). */
function assertLinkRange(linkRange: number): void {
  if (!Number.isInteger(linkRange) || linkRange < 1) {
    throw new RangeError(`volley.linkRange must be an integer >= 1, received ${String(linkRange)}`);
  }
}

/** The effective chain range of a spec, defaulting to adjacent. */
export function volleyLinkRange(spec: VolleySpec): number {
  const linkRange = spec.linkRange ?? DEFAULT_VOLLEY_LINK_RANGE;
  assertLinkRange(linkRange);
  return linkRange;
}

/** Whether `at` is a legal chain tile for `center` under `linkRange`. */
function withinLinkRange(at: Coord, center: Coord, linkRange: number): boolean {
  if (linkRange === 1) return isAdjacent(at, center);
  const distance = manhattanDistance(at, center);
  return distance >= 1 && distance <= linkRange;
}

/**
 * The allies that may chain into a Volley against `center`: everyone on the
 * initiator's side, still standing, and within `linkRange` tiles of the target.
 * The initiator is excluded (they open the volley; they do not "chain in").
 *
 * Results keep deployment order, so a replay chains in the same sequence every
 * time. Exposed so the AI (T095) and the forecast UI (T086) can preview the
 * firing line without resolving it.
 *
 * ```ts
 * const linkers = volleyLinkers(state, fusilier, enemy.at, 1);
 * ```
 *
 * Throws a `RangeError` when `linkRange` is not a positive integer.
 */
export function volleyLinkers(
  state: BattleState,
  initiator: Unit,
  center: Coord,
  linkRange: number = DEFAULT_VOLLEY_LINK_RANGE,
): Unit[] {
  assertLinkRange(linkRange);
  return state.units.filter(
    (unit) =>
      unit.id !== initiator.id &&
      unit.side === initiator.side &&
      !isOutOfAction(unit) &&
      withinLinkRange(unit.at, center, linkRange),
  );
}

/* --------------------------------------------------------------------------
 * Effect scaling
 * ------------------------------------------------------------------------ */

/** Apply the honour multiplier to whichever power term an effect carries. */
function scaleVolleyEffect(effect: AbilityEffect, honour: number): AbilityEffect {
  switch (effect.kind) {
    case "steel":
    case "powder":
    case "weapon":
    case "drain":
    case "heal":
    case "revive":
      return { ...effect, power: scaleVolleyPower(effect.power, honour) };
    case "condition":
    case "cleanse":
      // Conditions and cleanses carry no power term; massed fire does not make
      // a status harsher, only the shot that much heavier.
      return effect;
  }
}

/**
 * A copy of `spec` whose power terms are scaled by the committed Honour. The
 * original is never mutated; the returned spec is what each participant's shot
 * is resolved against.
 */
export function scaleVolleySpec(spec: VolleySpec, honour: number): AbilitySpec {
  return {
    ...spec,
    power: scaleVolleyPower(spec.power, honour),
    effects: spec.effects.map((effect) => scaleVolleyEffect(effect, honour)),
  };
}

/* --------------------------------------------------------------------------
 * The executor
 * ------------------------------------------------------------------------ */

/** Replace one soldier in the deployed list, preserving order. */
function replaceUnit(units: readonly Unit[], updated: Unit): readonly Unit[] {
  return units.map((unit) => (unit.id === updated.id ? updated : unit));
}

/** The tile the volley is centred on and the soldier it names, when any. */
function primaryTargetId(target: Target): UnitId | undefined {
  return target.kind === "unit" ? target.unitId : undefined;
}

/** Whether the named soldier is deployed and out of action. */
function isDown(state: BattleState, unitId: UnitId): boolean {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  return unit !== undefined && isOutOfAction(unit);
}

/** A refusal value, keeping every field of {@link VolleyExecution} well-typed. */
function rejection(
  state: BattleState,
  honour: number,
  targeting: TargetingResolution<Unit>,
  reason: VolleyFailReason | undefined,
): VolleyExecution {
  return {
    ok: false,
    state,
    events: [],
    honour,
    honourSpent: 0,
    linkers: [],
    targeting,
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * Resolve a Volley: the initiator spends Honour, every adjacent ally chains in
 * and the whole firing line's damage scales with the commitment.
 *
 * The steps, in order:
 * 1. **Target** — resolve affiliation, range, line of sight and the area
 *    footprint exactly as a normal action does (T028). An illegal aim returns
 *    `ok: false` with the input untouched and no Honour spent.
 * 2. **Spend** — pay the committed Honour through {@link spendHonour}
 *    (`honourChanged`, `reason: "volley"`). FFTA opens fire only with at least
 *    one Judge Point, so `honour < 1` is refused.
 * 3. **Announce** — emit `volleyStarted` carrying the commitment.
 * 4. **Chain** — collect the eligible adjacent allies ({@link volleyLinkers})
 *    and emit `volleyChained` for each as it fires.
 * 5. **Fire** — resolve one honour-scaled shot per participant through the
 *    action executor (T041), so damage, elements, conditions and misses behave
 *    exactly as any other attack. The volley stops as soon as the primary
 *    target is out of action.
 *
 * The executor emits only the volley's own events plus the shots' effect
 * events; the turn pipeline that declared the command owns `turnEnded` and the
 * next `turnStarted`.
 *
 * ```ts
 * const rng = new Rng(state.seed);
 * const { state: next, events } = executeVolley(
 *   state, fusilier, volleyFire, unitTarget(irregular.id), 3, rng,
 * );
 * ```
 *
 * Throws a `RangeError` only for malformed authored data (a non-integer or
 * negative Honour, a `linkRange` below 1). An in-world unaffordable volley is a
 * refusal (`insufficient-honour`), not an exception.
 */
export function executeVolley(
  state: BattleState,
  actor: Unit,
  spec: VolleySpec,
  target: Target,
  honour: number,
  rng: Rng,
  options: AbilityExecutionOptions = {},
): VolleyExecution {
  assertHonour(honour);
  const tick = state.tempo.tick;
  const linkRange = volleyLinkRange(spec);

  const targeting = resolveTargeting<Unit>(state.map, actor, state.units, target, {
    target: spec.target,
    range: abilityRangeProfile(spec),
    aoeShape: spec.aoeShape ?? "single",
    aoeSize: spec.aoeSize ?? 0,
  });

  if (!targeting.ok) {
    return rejection(state, honour, targeting, targeting.reason);
  }

  // FFTA: combos need at least one Judge Point, and the initiator can never
  // commit more than it holds. Both are refusals, not clamped spends.
  if (honour < 1 || actor.judgePoints < honour) {
    return rejection(state, honour, targeting, "insufficient-honour");
  }

  const events: BattleEvent[] = [];
  const namedTarget = primaryTargetId(target);
  events.push({
    kind: "volleyStarted",
    tick,
    unitId: actor.id,
    abilityId: spec.id,
    at: { x: targeting.center.x, y: targeting.center.y },
    ...(namedTarget === undefined ? {} : { targetId: namedTarget }),
    honour,
  });

  const spent = spendHonour(actor, honour, "volley", tick);
  events.push(...spent.events);
  let working: BattleState = {
    ...state,
    units: replaceUnit(state.units, spent.unit),
  };

  const linkers = volleyLinkers(working, spent.unit, targeting.center, linkRange);
  const scaled = scaleVolleySpec(spec, honour);

  const fire = (participant: Unit): void => {
    const shot = executeAbility(working, participant, scaled, target, rng, options);
    events.push(...shot.events);
    working = shot.state;
  };

  // The initiator opens the volley, then every eligible ally chains in. Only
  // the initiator's Honour was spent and only its pool fed the multiplier.
  fire(spent.unit);
  if (namedTarget === undefined || !isDown(working, namedTarget)) {
    for (const linker of linkers) {
      events.push({
        kind: "volleyChained",
        tick,
        unitId: linker.id,
        abilityId: spec.id,
        at: { x: targeting.center.x, y: targeting.center.y },
        ...(namedTarget === undefined ? {} : { targetId: namedTarget }),
      });
      // Re-read the linker: an earlier shot may have changed the field.
      const current = working.units.find((unit) => unit.id === linker.id) ?? linker;
      fire(current);
      if (namedTarget !== undefined && isDown(working, namedTarget)) break;
    }
  }

  return {
    ok: true,
    state: working,
    events,
    honour,
    honourSpent: spent.amount,
    linkers: linkers.map((linker) => linker.id),
    targeting,
  };
}

/* --------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

/**
 * Reject a malformed Honour commitment. Player input is shaped by the command
 * layer (`isCommand` requires a non-negative integer); this is the engine's own
 * fail-fast boundary for scripted or authored values.
 */
function assertHonour(honour: number): void {
  if (!Number.isInteger(honour) || honour < 0) {
    throw new RangeError(
      `volley.honour must be a non-negative integer, received ${String(honour)}`,
    );
  }
}
