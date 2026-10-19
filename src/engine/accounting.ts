/**
 * Resolution accounting (T128, peer lesson L9) — a pure, deterministic helper
 * that reads **what a resolution actually did** by diffing two
 * {@link BattleState}s.
 *
 * The engine already reports everything a renderer needs as {@link BattleEvent}s
 * (`./events.ts`, T021). Accounting answers a different, narrower question:
 * *"for this resolution, credited to this actor, who lost HP, how much, who was
 * knocked out, who was healed and what conditions were newly applied?"* It is
 * the primitive the AI evaluation (`src/ai/`) and battle reports need, and it is
 * deliberately **state in, state out** — no events required, no randomness, no
 * DOM (`agents.md` §2, §7).
 *
 * ## The peer model (The Unseen Hand's `hpDiffEvent`)
 *
 * Three ideas are borrowed from the peer engine's `src/sim/driver.ts`
 * (`docs/PEER_COMBAT_LESSONS.md` §L9):
 *
 * 1. **Credit by HP diff.** Rather than re-deriving a formula, compare the
 *    before and after states and attribute the difference.
 * 2. **A reaction is its own credited resolution.** A riposte or return fire
 *    damages the *attacker*, so it must be credited to the **reactor**. Slice
 *    the state around each resolution and pass the soldier who owns it; the
 *    helper never guesses.
 * 3. **Tripwire, not silent mis-credit.** If a window credited to a soldier
 *    shows one of that soldier's **own side** losing HP, the credit is
 *    incoherent — friendly fire, a mis-sliced reaction window or a future
 *    mechanic that has not accounted itself. {@link accountResolution} throws
 *    {@link FriendlyFireError} instead of quietly awarding the damage.
 *
 * ## One window, one credited actor
 *
 * The helper accounts a single **resolution window**:
 *
 * ```ts
 * const before = battle;                       // full HP
 * const attack = step(before, attackOrder);    // A hits D
 * const dealt  = accountResolution(before, attack.state, attacker.id);
 *
 * const reacted = resolveReactionResponses(...); // D ripostes A
 * const reaction = accountResolution(attack.state, reacted.state, reactor.id);
 * //                                            ^ credited to the *reactor*
 * ```
 *
 * Passing the attacker for the reaction window would make the attacker appear
 * to damage its own side, which the tripwire rejects. Splitting windows this way
 * is what keeps the credit honest; the helper enforces it.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — the same `(before, after, sourceUnitId)` always
 *   yields a deep-equal result; iteration follows the stable `before.units`
 *   (and per-unit `conditions`) order, never a hash set.
 * - **No mutation** — both inputs are read-only; the result is fresh plain data.
 * - **Framework-free** — engine only: no DOM, no I/O, no `Math.random`.
 *
 * Reference: `docs/PEER_COMBAT_LESSONS.md` §L9; mapping §5 (Élan/Honour),
 * §8 (conditions) and §9 (the Provost's enforcement of friendly fire as an
 * Article concern rather than a free-for-all).
 */

import type { BattleState } from "./battle";
import { isValidId, type ConditionId, type UnitId } from "./ids";
import { isOutOfAction, type Unit } from "./unit";

/* --------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------ */

/**
 * Thrown by {@link accountResolution} when a window credited to `sourceUnitId`
 * lowered the HP of a soldier on the **same side**. That is friendly fire (or a
 * mis-sliced reaction window), so it fails loudly rather than silently awarding
 * the damage to the wrong soldier (peer lesson L9).
 *
 * A dedicated class (rather than a bare `Error`) lets callers distinguish a
 * genuine accounting fault from an authored-data `RangeError` and inspect the
 * parties involved.
 */
export class FriendlyFireError extends Error {
  /** The soldier the window was credited to. */
  readonly sourceId: UnitId;
  /** The same-side soldier whose HP dropped. */
  readonly victimId: UnitId;
  /** Hit points lost (`> 0`). */
  readonly amount: number;

  constructor(sourceId: UnitId, victimId: UnitId, amount: number) {
    super(
      `resolution credited to "${sourceId}" lowered same-side soldier ` +
        `"${victimId}" by ${amount} HP (friendly fire); credit the acting ` +
        `soldier's own resolution instead`,
    );
    this.name = "FriendlyFireError";
    this.sourceId = sourceId;
    this.victimId = victimId;
    this.amount = amount;
  }
}

/* --------------------------------------------------------------------------
 * Result shapes
 * ------------------------------------------------------------------------ */

/** One soldier's HP loss during a resolution window, credited to its source. */
export interface AccountedDamage {
  /** Who took the damage. */
  readonly unitId: UnitId;
  /** Who is credited with dealing it (the window's actor / reactor). */
  readonly sourceId: UnitId;
  /** Hit points lost (`> 0`). */
  readonly amount: number;
  /** `true` when this blow took the soldier out of action. */
  readonly fatal: boolean;
}

/** One soldier's HP recovery during a resolution window. */
export interface AccountedHealing {
  /** Who recovered hit points. */
  readonly unitId: UnitId;
  /** Who is credited with the recovery. */
  readonly sourceId: UnitId;
  /** Hit points restored (`> 0`). */
  readonly amount: number;
}

/** One condition newly present on a soldier after the window. */
export interface AccountedCondition {
  /** Who now carries the condition. */
  readonly unitId: UnitId;
  /** The condition that was applied. */
  readonly conditionId: ConditionId;
  /** Remaining Orders Tempo ticks (`0` = indefinite until cured). */
  readonly duration: number;
  /**
   * Who applied it: the condition instance's own `sourceId` when the engine
   * recorded one, otherwise the window's credited `sourceUnitId`.
   */
  readonly sourceId: UnitId;
}

/**
 * Everything one credited resolution window did, as plain data. The aggregate
 * totals ({@link damageDealt}, {@link healingDone}) are conveniences for AI
 * scoring and battle reports; the per-soldier lists preserve attribution.
 */
export interface ResolutionAccount {
  /** The soldier every change is credited to. */
  readonly sourceId: UnitId;
  /** HP losses, in `before.units` order. */
  readonly damage: readonly AccountedDamage[];
  /** HP recoveries, in `before.units` order. */
  readonly healing: readonly AccountedHealing[];
  /** Soldiers knocked out during the window, in `before.units` order. */
  readonly kos: readonly UnitId[];
  /** Conditions newly applied during the window, in `after.units` order. */
  readonly conditions: readonly AccountedCondition[];
  /** Total hit points dealt (`sum of damage amounts`). */
  readonly damageDealt: number;
  /** Total hit points restored (`sum of healing amounts`). */
  readonly healingDone: number;
}

/* --------------------------------------------------------------------------
 * Diffing
 * ------------------------------------------------------------------------ */

/** Index a unit list by id, preserving the list's order for later lookups. */
function unitsById(units: readonly Unit[]): ReadonlyMap<string, Unit> {
  const byId = new Map<string, Unit>();
  for (const unit of units) byId.set(unit.id, unit);
  return byId;
}

/** Whether `previous` did not already carry `conditionId`. */
function isNewCondition(previous: Unit, conditionId: ConditionId): boolean {
  return previous.conditions.every((condition) => condition.conditionId !== conditionId);
}

/**
 * Account one resolution window by diffing two battle states.
 *
 * `before` is the state when the window opened and `after` the state when it
 * closed; `sourceUnitId` is the **credited actor** — the soldier whose action
 * (or reaction) the window represents. The helper walks `before.units` (and,
 * for conditions, the matching after-unit) in stable order and reports:
 *
 * - **damage** — every soldier whose HP dropped, with the amount, whether it was
 *   fatal and the credited source;
 * - **healing** — every soldier whose HP rose (a revive out of action counts as
 *   healing too, and its KO will not be in {@link ResolutionAccount.kos});
 * - **KOs** — soldiers that crossed from `hp > 0` to `hp <= 0`;
 * - **conditions** — condition ids present in `after` but absent in `before`.
 *
 * A **condition refresh** (same id, a new duration) is not reported as new;
 * removals are ignored. A soldier that left the field between the two states
 * (court-martial, capture) is skipped for HP because no after-value exists —
 * removal is not a KO and is the caller's concern.
 *
 * **Friendly-fire tripwire.** If a soldier on the credited source's own side
 * (including the source itself) lost HP, the window is incoherent and this
 * throws {@link FriendlyFireError}. This is what forces a reaction window to be
 * credited to the reactor: crediting the attacker instead would show the
 * attacker damaging its own side and fail loudly (peer lesson L9).
 *
 * Throws a `RangeError` when `sourceUnitId` is not a valid id or is not one of
 * `before.units`, since a window can only be credited to a deployed soldier.
 *
 * ```ts
 * const dealt = accountResolution(before, after, fusilier.id);
 * if (dealt.damageDealt >= foe.hp) planTheKill();
 * ```
 */
export function accountResolution(
  before: BattleState,
  after: BattleState,
  sourceUnitId: UnitId,
): ResolutionAccount {
  if (!isValidId(sourceUnitId)) {
    throw new RangeError("accountResolution sourceUnitId must be a non-empty id");
  }
  const source = before.units.find((unit) => unit.id === sourceUnitId);
  if (source === undefined) {
    throw new RangeError(
      `accountResolution cannot credit soldier "${sourceUnitId}": not deployed in the before state`,
    );
  }

  const afterById = unitsById(after.units);
  const damage: AccountedDamage[] = [];
  const healing: AccountedHealing[] = [];
  const kos: UnitId[] = [];
  const conditions: AccountedCondition[] = [];
  let damageDealt = 0;
  let healingDone = 0;

  for (const previous of before.units) {
    const current = afterById.get(previous.id);
    if (current === undefined) continue; // left the field; not an HP change

    const delta = current.hp - previous.hp;

    if (delta < 0) {
      const amount = -delta;
      // The tripwire: a credited window must never lower a same-side soldier's
      // HP (including the source itself). See the class doc and lesson L9.
      if (previous.side === source.side) {
        throw new FriendlyFireError(source.id, previous.id, amount);
      }
      const fatal = isOutOfAction(current) && !isOutOfAction(previous);
      damage.push({ unitId: previous.id, sourceId: source.id, amount, fatal });
      damageDealt += amount;
    } else if (delta > 0) {
      healing.push({ unitId: previous.id, sourceId: source.id, amount: delta });
      healingDone += delta;
    }

    if (!isOutOfAction(previous) && isOutOfAction(current)) {
      kos.push(previous.id);
    }

    for (const condition of current.conditions) {
      if (!isNewCondition(previous, condition.conditionId)) continue;
      conditions.push({
        unitId: current.id,
        conditionId: condition.conditionId,
        duration: condition.duration,
        sourceId: condition.sourceId ?? source.id,
      });
    }
  }

  return {
    sourceId: source.id,
    damage,
    healing,
    kos,
    conditions,
    damageDealt,
    healingDone,
  };
}
