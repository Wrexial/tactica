/**
 * Orders Tempo (T019) — the deterministic, integer-tick **Charge Time Battle**
 * (CTB) scheduler that answers "whose turn is next?".
 *
 * The retheme keeps FFTA's charge-time turn order and renames it **Orders
 * Tempo** (mapping §12; `docs/wiki/pages/Charge_time.md`, "Final Fantasy
 * Tactics Advance" section). Rather than round-robin, every soldier carries a
 * personal **charge** counter. Each tick the counter grows by the soldier's
 * effective Speed; a soldier may act once their charge reaches
 * {@link TEMPO_THRESHOLD}. A faster soldier therefore reaches the threshold
 * sooner **and** reaches it more often, so Speed scales both *when* and *how
 * frequently* a unit acts.
 *
 * Design choices for this engine (see `agents.md` §2 determinism, §7):
 * - **Integer ticks only.** Charge, tick and remaining charge times are all
 *   plain non-negative integers, so replays never drift on floating point.
 * - **Threshold spend, not reset.** Acting deducts one threshold of charge and
 *   keeps the *excess* as progress toward the next turn. A literal reset to
 *   zero would quantise small Speed differences away (Speed 25 and 30 would
 *   both act every 4 ticks); carrying the remainder keeps turns proportional
 *   to Speed, which is what "acts sooner/more often" requires.
 * - **Seeded tie-breaks.** When two ready soldiers hold the *same* charge the
 *   winner is drawn from the seeded PRNG in {@link OrdersTempo.rng}. The RNG
 *   state travels inside the scheduler state, so a battle replays exactly from
 *   a seed plus the ordered command log.
 * - **Pure & JSON-serialisable.** No mutation of inputs, no DOM, no
 *   `Math.random`; every update returns a new {@link OrdersTempo} value.
 *
 * The scheduler is deliberately combat-agnostic: it knows branded
 * {@link UnitId}s and a `(unitId) => speed` lookup, not the unit model. The
 * battle state machine (T022) supplies speeds and turns resolved charges into
 * events; the Orders Tempo tray (T083) uses {@link previewTurns} to show the
 * upcoming order without advancing the battle.
 *
 * Reference (FFTA, re-authored): `docs/wiki/pages/Charge_time.md` — "Each tick,
 * a unit's personal CT counter increases by their Speed (doubled under Haste,
 * halved when under Slow)". We use the simplified threshold-100 reading the
 * working agreement settled on (`agents.md` §7) rather than FFTA-Advance's
 * 1000-scale reserve rule.
 */

import { assertId, type UnitId } from "./ids";
import { Rng, type RngState, type Seed } from "./rng";

/* --------------------------------------------------------------------------
 * Constants (tunable balance lives in data, per agents.md §9)
 * ------------------------------------------------------------------------ */

/**
 * Charge a soldier must accumulate before taking an Orders Tempo turn. The
 * classic CTB value (100) named in `agents.md` §7; per-battle overrides are
 * allowed through {@link OrdersTempoOptions.threshold} so content can tune the
 * battle's pace without touching this logic.
 */
export const TEMPO_THRESHOLD = 100;

/* --------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------ */

/**
 * An ability/effect that is currently *charging* — its resolution is delayed by
 * `remaining` tempo ticks (mapping §12; `agents.md` §7 "abilities have a charge
 * time that can delay when their effect resolves relative to other units").
 *
 * `chargeId` is opaque to the scheduler: the battle layer mints it and uses it
 * to look up what actually resolves. The scheduler only times it.
 */
export interface TempoCharge {
  /** Caller-owned id linking this timed charge to its pending effect. */
  readonly chargeId: string;
  /** The soldier whose action is charging. */
  readonly unitId: UnitId;
  /** Whole ticks left until the effect resolves; always `>= 1`. */
  readonly remaining: number;
}

/**
 * One soldier's entry in the turn order: accumulated charge plus any effects
 * they currently have charging.
 */
export interface TempoEntry {
  /** The soldier this entry tracks. */
  readonly unitId: UnitId;
  /** Accumulated Orders Tempo charge; `>= threshold` means "ready to act". */
  readonly charge: number;
  /** Effects this soldier is currently charging, in scheduling order. */
  readonly pending: readonly TempoCharge[];
}

/**
 * The whole Orders Tempo scheduler state. Plain and JSON-serialisable so it can
 * live inside a battle save; the embedded {@link RngState} is what makes
 * tie-breaks deterministic across a save/load boundary.
 */
export interface OrdersTempo {
  /** Charge required to act (usually {@link TEMPO_THRESHOLD}). */
  readonly threshold: number;
  /** Monotonic integer clock; starts at 0 and grows by one per tick. */
  readonly tick: number;
  /** Per-soldier charge, in stable insertion order. */
  readonly entries: readonly TempoEntry[];
  /** Seeded PRNG state used only for same-charge tie-breaks. */
  readonly rng: RngState;
}

/** Construction options for {@link createOrdersTempo}. */
export interface OrdersTempoOptions {
  /** Charge needed to act; defaults to {@link TEMPO_THRESHOLD}. */
  readonly threshold?: number;
  /** Seed for the tie-break stream; defaults to the string `"orders-tempo"`. */
  readonly seed?: Seed;
  /**
   * Optional starting charge per unit id. Handy for scenarios that begin
   * mid-battle or grant a pre-emptive edge; omitted units start at 0.
   */
  readonly initialCharge?: Readonly<Partial<Record<string, number>>>;
}

/* --------------------------------------------------------------------------
 * Speed
 * ------------------------------------------------------------------------ */

/**
 * Looks up a soldier's current **effective** Speed for the tick that is about
 * to be processed. The battle layer folds base Speed, Haste/Slow and any other
 * modifiers into this value (see {@link tempoSpeed}). Returning `0` means the
 * soldier does not charge this tick (out of action, held, ...).
 */
export type TempoSpeedOf = (unitId: UnitId) => number;

/** Haste/Slow toggles understood by {@link tempoSpeed}. */
export interface TempoSpeedModifier {
  /** Haste doubles charge accumulation (`docs/wiki/pages/Charge_time.md`). */
  readonly haste?: boolean;
  /** Slow halves (rounded down) charge accumulation. */
  readonly slow?: boolean;
}

/**
 * Apply FFTA's Haste/Slow rule to a base Speed: Haste doubles the per-tick
 * charge gain and Slow halves it, rounded down. If both are somehow present
 * they cancel out, matching the wiki's "Haste + Slow" neutral case.
 *
 * This is a convenience for callers; the scheduler itself just consumes the
 * resulting integer.
 */
export function tempoSpeed(baseSpeed: number, modifier: TempoSpeedModifier = {}): number {
  assertNonNegativeInteger(baseSpeed, "baseSpeed");
  let speed = baseSpeed;
  if (modifier.haste) speed *= 2;
  if (modifier.slow) speed = Math.floor(speed / 2);
  return speed;
}

/**
 * Build a {@link TempoSpeedOf} from a plain id→speed table. Missing ids are a
 * programmer error (the scheduler knows every unit it tracks), so this throws
 * rather than silently treating them as stationary.
 */
export function speedLookup(speeds: Readonly<Partial<Record<string, number>>>): TempoSpeedOf {
  return (unitId: UnitId): number => {
    const speed = speeds[unitId];
    if (speed === undefined) {
      throw new RangeError(`no Orders Tempo speed provided for unit ${unitId}`);
    }
    return speed;
  };
}

/* --------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received ${String(value)}`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer, received ${String(value)}`);
  }
}

/* --------------------------------------------------------------------------
 * Construction
 * ------------------------------------------------------------------------ */

/**
 * Create an empty turn order for the given soldiers. Every soldier starts at
 * charge `0` (or the value supplied in `initialCharge`) and the seeded
 * tie-break stream is initialised from `seed`.
 *
 * Throws on duplicate ids, a non-positive threshold or a fractional/negative
 * starting charge, so malformed battle setups fail at the boundary.
 */
export function createOrdersTempo(
  unitIds: readonly UnitId[],
  options: OrdersTempoOptions = {},
): OrdersTempo {
  const threshold = options.threshold ?? TEMPO_THRESHOLD;
  assertPositiveInteger(threshold, "threshold");

  const seen = new Set<string>();
  const entries = unitIds.map((unitId): TempoEntry => {
    assertId(unitId, "unitId");
    if (seen.has(unitId)) {
      throw new RangeError(`duplicate unit id in Orders Tempo: ${unitId}`);
    }
    seen.add(unitId);

    const charge = options.initialCharge?.[unitId] ?? 0;
    assertNonNegativeInteger(charge, `initialCharge[${unitId}]`);
    return { unitId, charge, pending: [] };
  });

  return {
    threshold,
    tick: 0,
    entries,
    rng: new Rng(options.seed ?? "orders-tempo").getState(),
  };
}

/* --------------------------------------------------------------------------
 * Ticking
 * ------------------------------------------------------------------------ */

/** A charging effect that reached zero remaining ticks this tick. */
export interface ResolvedCharge {
  /** The id supplied when the charge was scheduled. */
  readonly chargeId: string;
  /** The soldier whose effect resolved. */
  readonly unitId: UnitId;
}

/** Result of advancing exactly one tick. */
export interface TempoTickResult {
  /** The scheduler after the tick. */
  readonly state: OrdersTempo;
  /** Effects whose timer elapsed during this tick, in entry order. */
  readonly resolved: readonly ResolvedCharge[];
}

/**
 * Advance the clock by exactly one integer tick:
 * 1. every entry gains its effective Speed in charge, and
 * 2. every charging effect loses one tick; those at zero are returned as
 *    {@link TempoTickResult.resolved} and dropped from the pending list.
 *
 * No turn is taken here — callers use {@link advanceToNextTurn} or
 * {@link takeTurn} for that — which lets battle code interleave charge
 * resolution with other per-tick effects.
 */
export function advanceTick(state: OrdersTempo, speedOf: TempoSpeedOf): TempoTickResult {
  const resolved: ResolvedCharge[] = [];

  const entries = state.entries.map((entry): TempoEntry => {
    const speed = speedOf(entry.unitId);
    assertNonNegativeInteger(speed, `speed for ${entry.unitId}`);

    const pending: TempoCharge[] = [];
    for (const charge of entry.pending) {
      const remaining = charge.remaining - 1;
      if (remaining <= 0) {
        resolved.push({ chargeId: charge.chargeId, unitId: charge.unitId });
      } else {
        pending.push({ ...charge, remaining });
      }
    }

    return { unitId: entry.unitId, charge: entry.charge + speed, pending };
  });

  return {
    state: { ...state, tick: state.tick + 1, entries },
    resolved,
  };
}

/* --------------------------------------------------------------------------
 * Turn selection
 * ------------------------------------------------------------------------ */

/** Ids of every soldier ready to act right now (`charge >= threshold`). */
export function readyActorIds(state: OrdersTempo): UnitId[] {
  return state.entries
    .filter((entry) => entry.charge >= state.threshold)
    .map((entry) => entry.unitId);
}

/** Internal: the next actor plus any RNG-state change from breaking a tie. */
interface ActorChoice {
  readonly state: OrdersTempo;
  readonly actorId: UnitId;
}

/**
 * Pick the ready soldier with the highest charge. Ties are broken by the
 * seeded PRNG (and only ties advance the stream, so non-tied battles stay
 * independent of the seed's draw order). Returns `null` when nobody is ready.
 */
function chooseActor(state: OrdersTempo): ActorChoice | null {
  const ready = state.entries.filter((entry) => entry.charge >= state.threshold);
  if (ready.length === 0) return null;

  let maxCharge = ready[0].charge;
  for (const entry of ready) {
    if (entry.charge > maxCharge) maxCharge = entry.charge;
  }
  const candidates = ready.filter((entry) => entry.charge === maxCharge);
  if (candidates.length === 1) {
    return { state, actorId: candidates[0].unitId };
  }

  const rng = Rng.fromState(state.rng);
  const picked = candidates[rng.nextInt(candidates.length)];
  return { state: { ...state, rng: rng.getState() }, actorId: picked.unitId };
}

/** A soldier reaching their turn, with the tick time it took. */
export interface TempoTurn {
  /** Scheduler after charge accumulation and the tie-break draw. */
  readonly state: OrdersTempo;
  /** The soldier whose turn it is. */
  readonly actorId: UnitId;
  /** Ticks elapsed while waiting for this turn (`0` if already ready). */
  readonly ticks: number;
  /** Charging effects that resolved while waiting, in resolution order. */
  readonly resolved: readonly ResolvedCharge[];
}

/**
 * Advance tick by tick until a soldier is ready, then choose that soldier.
 * Charge is **not** spent — call {@link spendTurn} when the turn ends (or use
 * {@link takeTurn} for the whole cycle).
 *
 * `maxTicks` bounds the wait (useful for a UI that must not spin); when it is
 * reached before anyone is ready the function returns `null`. A state where
 * every tracked unit has Speed `0` can never produce a turn and also returns
 * `null` rather than looping forever.
 */
export function advanceToNextTurn(
  state: OrdersTempo,
  speedOf: TempoSpeedOf,
  maxTicks: number = Number.POSITIVE_INFINITY,
): TempoTurn | null {
  if (maxTicks !== Number.POSITIVE_INFINITY) {
    assertNonNegativeInteger(maxTicks, "maxTicks");
  }

  const stalled =
    readyActorIds(state).length === 0 && !state.entries.some((entry) => speedOf(entry.unitId) > 0);
  if (stalled) return null;

  let current = state;
  let ticks = 0;
  const resolved: ResolvedCharge[] = [];

  // Invariant: no one is ready at the start of each iteration.
  while (ticks <= maxTicks) {
    const choice = chooseActor(current);
    if (choice !== null) {
      return { state: choice.state, actorId: choice.actorId, ticks, resolved };
    }
    if (ticks === maxTicks) break;

    const tick = advanceTick(current, speedOf);
    current = tick.state;
    resolved.push(...tick.resolved);
    ticks += 1;
  }

  return null;
}

/**
 * End `unitId`'s turn by deducting `cost` charge (default one
 * {@link OrdersTempo.threshold}). The excess is kept, so a soldier whose Speed
 * overshoots the threshold carries the remainder toward their next turn. The
 * charge never drops below zero.
 */
export function spendTurn(
  state: OrdersTempo,
  unitId: UnitId,
  cost: number = state.threshold,
): OrdersTempo {
  assertId(unitId, "unitId");
  assertNonNegativeInteger(cost, "cost");

  const index = state.entries.findIndex((entry) => entry.unitId === unitId);
  if (index === -1) {
    throw new RangeError(`unknown unit in Orders Tempo: ${unitId}`);
  }

  const entries = state.entries.slice();
  const entry = entries[index];
  entries[index] = { ...entry, charge: Math.max(0, entry.charge - cost) };
  return { ...state, entries };
}

/**
 * A complete turn: advance to the next actor, select them, then spend their
 * charge so the next call yields the following actor. This is the one-call API
 * the battle loop uses; `resolved` carries any charging effects that fired
 * while waiting.
 */
export function takeTurn(
  state: OrdersTempo,
  speedOf: TempoSpeedOf,
  cost?: number,
): TempoTurn | null {
  const advance = advanceToNextTurn(state, speedOf);
  if (advance === null) return null;
  return {
    state: spendTurn(advance.state, advance.actorId, cost ?? advance.state.threshold),
    actorId: advance.actorId,
    ticks: advance.ticks,
    resolved: advance.resolved,
  };
}

/* --------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------ */

/**
 * Project the next `count` actors without advancing the caller's state. Used by
 * the Orders Tempo tray (T083) to paint the upcoming order and by tests to
 * assert Speed ordering. Stops early if the order stalls.
 */
export function previewTurns(state: OrdersTempo, speedOf: TempoSpeedOf, count: number): UnitId[] {
  assertNonNegativeInteger(count, "count");

  let current = state;
  const actors: UnitId[] = [];
  for (let i = 0; i < count; i++) {
    const turn = takeTurn(current, speedOf);
    if (turn === null) break;
    actors.push(turn.actorId);
    current = turn.state;
  }
  return actors;
}

/** The charge currently held by `unitId`, or `undefined` if not tracked. */
export function chargeOf(state: OrdersTempo, unitId: UnitId): number | undefined {
  return state.entries.find((entry) => entry.unitId === unitId)?.charge;
}

/* --------------------------------------------------------------------------
 * Charging effects (delayed abilities)
 * ------------------------------------------------------------------------ */

/**
 * Schedule an effect to resolve after `charge.remaining` more ticks. Ability
 * charge times are data (`chargeTime` in `src/data/schema.ts`); the battle
 * layer turns them into a {@link TempoCharge}.
 *
 * Throws when the caster is untracked or the charge id is already pending, so
 * a duplicate id can never silently shadow an in-flight effect.
 */
export function scheduleCharge(state: OrdersTempo, charge: TempoCharge): OrdersTempo {
  assertId(charge.chargeId, "charge.chargeId");
  assertId(charge.unitId, "charge.unitId");
  assertPositiveInteger(charge.remaining, "charge.remaining");

  const index = state.entries.findIndex((entry) => entry.unitId === charge.unitId);
  if (index === -1) {
    throw new RangeError(`cannot charge for unknown unit: ${charge.unitId}`);
  }

  const duplicate = state.entries.some((entry) =>
    entry.pending.some((pending) => pending.chargeId === charge.chargeId),
  );
  if (duplicate) {
    throw new RangeError(`duplicate charge id: ${charge.chargeId}`);
  }

  const entries = state.entries.slice();
  const entry = entries[index];
  entries[index] = { ...entry, pending: [...entry.pending, { ...charge }] };
  return { ...state, entries };
}

/**
 * Cancel a charging effect (interrupted, caster disabled, ...). Returns the
 * same state object when the id was not pending, so callers can cheaply detect
 * a no-op with `next === previous`.
 */
export function cancelCharge(state: OrdersTempo, chargeId: string): OrdersTempo {
  assertId(chargeId, "chargeId");

  let changed = false;
  const entries = state.entries.map((entry): TempoEntry => {
    const pending = entry.pending.filter((charge) => charge.chargeId !== chargeId);
    if (pending.length === entry.pending.length) return entry;
    changed = true;
    return { ...entry, pending };
  });

  return changed ? { ...state, entries } : state;
}
