/**
 * Field AI turn runner (T119) — the deterministic driver that takes the
 * **enemy's** Orders Tempo turns so a campaign action can actually reach its
 * objective.
 *
 * `src/app/autoBattle.ts` (T098) already knows how to plan and commit one AI
 * turn and how to loop AI-held turns under a {@link ControlPolicy}; what the
 * Field was missing was a named, campaign-facing entry point that plays the
 * hostile side and then **hands the controls back to the player**. This module
 * is that entry point. It sits in `src/app` because it wires the engine and the
 * utility AI together (`agents.md` §6, §7): it never forks the simulation,
 * never invents a rule and never inspects the DOM.
 *
 * ```
 *   runAiTurn(state, unitId)        one non-company actor's turn via `step`
 *   runAiUntilPlayer(state)         every consecutive AI turn, then stop
 * ```
 *
 * ## The Field contract
 *
 * - A **company** soldier is the player's by default, so `runAiUntilPlayer`
 *   stops the moment one holds the turn — the ordinary hand-off between the AI
 *   and the human at the Field (`DEFAULT_CONTROL_POLICY`).
 * - Every **other** soldier (an irregular, a neutral arbiter) is the AI's, and
 *   its turn is planned by `src/ai/utility.ts` (T095) and committed through the
 *   exact `step` path the battle controller uses (T027). A battle driven by
 *   `runAiUntilPlayer` is therefore as replayable as one driven by hand.
 * - Company allies may be delegated to the AI with `autoBattleAllies` (T098);
 *   pass the resulting policy in {@link BattleRunnerOptions.policy} and those
 *   allies are advanced too, while everyone else still hands back to the human.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure and deterministic** — no DOM, no I/O, no `Math.random`, no clock.
 *   The seeded Orders Tempo/combat RNG already lives inside the battle state.
 * - **AI through the front door** — only ordinary {@link Command}s are issued;
 *   `step` is the sole writer of state.
 * - **Loop-guarded** — a full run is capped by {@link DEFAULT_MAX_AUTO_TURNS},
 *   stops on a stalled actor, and additionally refuses to spin on a turn that
 *   failed to close (no `turnEnded` event).
 *
 * Reference: `docs/NAPOLEONIC_MAPPING.md` §1 (the **company**), §10 (the
 * campaign loop), §11–§12 (irregulars and Orders Tempo),
 * `docs/wiki/pages/Charge_time.md` (whose turn it is). The control model is
 * authored for this project, not scraped.
 */

import {
  DEFAULT_CONTROL_POLICY,
  DEFAULT_MAX_AUTO_TURNS,
  isAiControlled,
  runAutoTurn,
  type AutoBattleOptions,
  type AutoBattleResult,
  type AutoBattleStop,
  type AutoTurnResult,
} from "./autoBattle";
import { beginBattle, findUnit, type BattleState } from "../engine/battle";
import type { BattleEvent } from "../engine/events";
import type { UnitId } from "../engine/ids";
import { isOutOfAction } from "../engine/unit";

/* --------------------------------------------------------------------------
 * Errors and options
 * ------------------------------------------------------------------------ */

/**
 * Thrown when the runner is asked to take a turn that cannot be taken: the
 * battle is over, the soldier is not deployed, is not the current actor, is out
 * of action, or is under player control. These are caller/programming faults,
 * not in-world illegal orders (which the AI avoids by construction).
 */
export class BattleRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BattleRunnerError";
  }
}

/**
 * Options for the Field runner. The same shape as `runAutoBattle`'s options:
 * a {@link ControlPolicy} decides who the AI fights for, `ai` is forwarded to
 * the utility scorer, and `maxTurns` caps one {@link runAiUntilPlayer} call.
 */
export type BattleRunnerOptions = AutoBattleOptions;

/* --------------------------------------------------------------------------
 * One turn
 * ------------------------------------------------------------------------ */

/**
 * Take one AI soldier's Orders Tempo turn on the Field.
 *
 * The soldier must currently hold the turn and be **AI-controlled** under the
 * policy — by default that means anyone who is not a company soldier, so a
 * company soldier is refused with a {@link BattleRunnerError}. Pass a policy
 * from `autoBattleAllies` (T098) to delegate a named company ally.
 *
 * The plan comes from `src/ai/utility.ts` (via `runAutoTurn`) and every command
 * is committed through `step`, returning the state, events, plan and any engine
 * rejection. The input battle is never mutated.
 *
 * ```ts
 * let battle = createDemoBattle();
 * while (battle.phase === "active" && isEnemy(battle.currentActorId)) {
 *   battle = runAiTurn(battle, battle.currentActorId).state;
 * }
 * ```
 */
export function runAiTurn(
  state: BattleState,
  unitId: UnitId,
  options: BattleRunnerOptions = {},
): AutoTurnResult {
  const policy = options.policy ?? DEFAULT_CONTROL_POLICY;

  if (state.phase === "finished") {
    throw new BattleRunnerError("the battle has already ended");
  }
  const actor = findUnit(state, unitId);
  if (actor === undefined) {
    throw new BattleRunnerError(`no soldier "${unitId}" is deployed in this battle`);
  }
  if (state.currentActorId !== unitId) {
    throw new BattleRunnerError(
      `it is ${state.currentActorId ?? "nobody's"} turn, not ${actor.name}'s`,
    );
  }
  if (isOutOfAction(actor)) {
    throw new BattleRunnerError(`${actor.name} is out of action`);
  }
  if (!isAiControlled(actor, policy)) {
    throw new BattleRunnerError(`${actor.name} is under player control`);
  }

  // `runAutoTurn` plans with `chooseTurn` and commits each command through
  // `step`; the ownership check above is the only thing it does not do.
  return runAutoTurn(state, unitId, options);
}

/* --------------------------------------------------------------------------
 * A run of AI turns
 * ------------------------------------------------------------------------ */

/**
 * Auto-battle every consecutive AI-held turn, then hand control back to the
 * player.
 *
 * Starting from `state`'s current actor, takes turns while the actor is
 * AI-controlled (by default: every non-company soldier) and the battle is
 * still active. It stops the moment the turn belongs to a company/player
 * soldier, so a Field loop naturally alternates between the enemy and the
 * human. The opening events (`battleStarted`, deployment, the first
 * `turnStarted`) are included even when the player acts first, so the renderer
 * can paint the whole run.
 *
 * The run is deterministic and loop-guarded:
 * - the same seed, battle and policy always produce the same turns;
 * - at most `maxTurns` turns are taken per call
 *   ({@link DEFAULT_MAX_AUTO_TURNS} by default);
 * - a soldier who is missing or out of action stops the run as `"stalled"`;
 * - a successful turn that did not close its Orders Tempo turn (no
 *   `turnEnded` event) also stops as `"stalled"`, so a buggy plan can never
 *   spin forever.
 *
 * ```ts
 * // The Field: enemy irregulars act, then the player's company is asked.
 * const run = runAiUntilPlayer(battle);
 * const field = run.state;
 * ```
 *
 * The input battle is never mutated; the returned
 * {@link AutoBattleResult.stop} always names why the loop ended.
 */
export function runAiUntilPlayer(
  state: BattleState,
  options: BattleRunnerOptions = {},
): AutoBattleResult {
  const policy = options.policy ?? DEFAULT_CONTROL_POLICY;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_AUTO_TURNS;
  if (!Number.isInteger(maxTurns) || maxTurns < 0) {
    throw new BattleRunnerError(
      `maxTurns must be a non-negative integer, received ${String(maxTurns)}`,
    );
  }

  // Emit the opening events up front so a run that stops before any turn (the
  // player acts first) still reports the deployment.
  const begun = beginBattle(state);
  let working = begun.state;
  const events: BattleEvent[] = [...begun.events];
  const turns: AutoTurnResult[] = [];

  const finish = (stop: AutoBattleStop): AutoBattleResult => ({
    state: working,
    events,
    turns,
    stop,
    nextActorId: working.currentActorId,
  });

  while (true) {
    if (working.phase === "finished") return finish("finished");

    const actorId = working.currentActorId;
    if (actorId === null) return finish("no-actor");

    const actor = findUnit(working, actorId);
    // A casualty that still holds charge cannot be ordered (the engine refuses
    // to command an out-of-action soldier), so the loop stops rather than spin.
    if (actor === undefined || isOutOfAction(actor)) return finish("stalled");

    // A player-held soldier (a company soldier by default) hands control back.
    if (!isAiControlled(actor, policy)) return finish("player-turn");
    if (turns.length >= maxTurns) return finish("limit");

    const turn = runAiTurn(working, actorId, options);
    working = turn.state;
    events.push(...turn.events);
    turns.push(turn);

    // `chooseTurn` guarantees legality; a rejection here is an invariant break.
    if (turn.rejection !== null) return finish("rejected");

    // Yield guard: a successful AI turn must close its Orders Tempo turn (or
    // finish the battle). If it did neither, the same actor would be planned
    // forever, so stop rather than spin.
    const yielded =
      working.phase === "finished" ||
      turn.events.some((event) => event.kind === "turnEnded");
    if (!yielded) return finish("stalled");
  }
}
