/**
 * Basic commands (T026) — **Wait**, **Face** and **Hold (brace)**.
 *
 * Where `./move.ts` resolves the positional order and `./resolve.ts` runs the
 * declare → charge → resolve action pipeline, this module owns the three
 * "free" orders a soldier can issue without an ability, an item or a target:
 *
 * - **Wait** (FFTA "Wait") — give up the rest of the turn; advances Orders
 *   Tempo, so it is a real choice under pressure. Today it changes nothing on
 *   the unit; Élan regeneration (T040) and Bivouacked recovery hook in here.
 * - **Face** (mapping §12 facing) — turn in place to a new cardinal direction,
 *   setting up a firing line, protecting a flank or denying a rear bonus
 *   (T037). A turn to the current facing is a free no-op.
 * - **Hold / brace** (mapping §8: FFTA "Defend" → a defensive stance) — dig in
 *   without giving ground, applying the **Braced** condition so incoming fire
 *   is blunted. The full stacking/expiry rules are the condition engine's job
 *   (T039); this command applies the stance and reports it.
 *
 * Each helper is the same shape as `applyMove`: it takes the current battle,
 * the acting {@link Unit} and the event sink, pushes the ordered
 * {@link BattleEvent}s describing what happened, and returns a **new**
 * {@link BattleState} with the soldier replaced. Nothing here mutates its
 * inputs, consults a clock or draws randomness — time is the integer Orders
 * Tempo tick (`agents.md` §2, §7).
 *
 * The battle layer (T022) gates the commands: {@link import("../battle").step}
 * only calls these once it has confirmed the actor is the current soldier,
 * alive and able to act, so the functions below assume a legal order.
 */

import type { BattleState } from "../battle";
import type { BattleEvent } from "../events";
import type { Facing } from "../grid";
import { asConditionId, type ConditionId } from "../ids";
import { addCondition, withFacing, type Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Hold (brace) data
 * ------------------------------------------------------------------------ */

/**
 * The condition a brace applies: FFTA's Defend/Protect stance, renamed
 * **Braced** (mapping §8). Kept as a named engine constant so the action, the
 * condition engine (T039) and tests share one key.
 */
export const BRACED_CONDITION: ConditionId = asConditionId("braced");

/**
 * How long a brace holds, in Orders Tempo ticks. The condition engine (T039)
 * owns stacking and expiry and will replace this placeholder with authored
 * `ConditionDef.duration` data; until then a brace lasts a short, fixed window
 * so the stance is observable and can be refreshed by bracing again.
 */
export const BRACE_DURATION_TICKS = 10;

/* --------------------------------------------------------------------------
 * Application helpers
 * ------------------------------------------------------------------------ */

/** Replace one soldier in the deployed list, preserving order. */
function replaceUnit(units: readonly Unit[], updated: Unit): readonly Unit[] {
  return units.map((unit) => (unit.id === updated.id ? updated : unit));
}

/**
 * **Wait**: pass the rest of the turn without acting. The unit is unchanged —
 * the value is tactical (holding a position, waiting for a charge to land, or
 * declining to trigger a reaction). The battle layer still spends the turn's
 * Orders Tempo charge and advances the clock.
 *
 * Élan regeneration and other "end of turn" recovery (T040/T039) will hook in
 * here; for now the intent is deliberately a pure no-op.
 */
export function applyWait(state: BattleState, _unit: Unit, _events: BattleEvent[]): BattleState {
  // The two parameters are retained so every basic action shares one dispatch
  // shape, even though Wait has nothing to change on the unit and nothing to
  // report.
  void _unit;
  void _events;
  return state;
}

/**
 * **Face**: turn in place to `facing` (mapping §12). Emits a `faced` event so
 * the renderer animates the pivot; turning to the direction the soldier already
 * looks is a **no-op** that returns the same state and emits nothing, matching
 * the move module's treatment of a zero-length path.
 */
export function applyFace(
  state: BattleState,
  unit: Unit,
  facing: Facing,
  events: BattleEvent[],
): BattleState {
  if (unit.facing === facing) return state;

  events.push({
    kind: "faced",
    tick: state.tempo.tick,
    unitId: unit.id,
    from: unit.facing,
    to: facing,
  });

  return { ...state, units: replaceUnit(state.units, withFacing(unit, facing)) };
}

/**
 * **Hold / brace**: apply the {@link BRACED_CONDITION} stance to the soldier
 * and report it with a `conditionApplied` event. Bracing again refreshes the
 * duration (`addCondition` replaces the existing instance). The defensive
 * maths that reads the stance — halved incoming Steel/Powder damage, reaction
 * hooks — arrives with the damage rules (T033+) and the condition engine
 * (T039).
 */
export function applyHold(state: BattleState, unit: Unit, events: BattleEvent[]): BattleState {
  const braced = addCondition(unit, {
    conditionId: BRACED_CONDITION,
    duration: BRACE_DURATION_TICKS,
  });

  events.push({
    kind: "conditionApplied",
    tick: state.tempo.tick,
    unitId: unit.id,
    conditionId: BRACED_CONDITION,
    duration: BRACE_DURATION_TICKS,
  });

  return { ...state, units: replaceUnit(state.units, braced) };
}
