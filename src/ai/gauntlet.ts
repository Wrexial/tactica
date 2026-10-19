/**
 * Headless AI-vs-AI gauntlet (T130, peer lesson L11) — run a complete battle
 * with **both sides** driven by an AI policy, without touching the renderer or
 * the UI.
 *
 * TinyWars exposes a headless `fast` executor and The Unseen Hand drives full
 * AI-vs-AI battles as its balance harness (`docs/PEER_COMBAT_LESSONS.md` §L11).
 * Our engine has been playable and deterministic for a while, and the utility
 * AI (`./utility.ts`, T095) already plans a single soldier's Orders Tempo turn;
 * what was missing was a loop that wires **two** policies to the two sides and
 * plays the action out to a terminal state. This module is that loop.
 *
 * ## How it is put together
 *
 * ```
 *   BattleSetup ─┐
 *   seed ────────┼─► createBattle ─► beginBattle ─┐
 *   policyA ─────┤                                │
 *   policyB ─────┘                                ▼
 *                              advanceToDecision ─► chooseTurn(policy by side)
 *                                   ▲                    │
 *                                   │                    ▼
 *                                   └──── applyCommand(plan.commands)
 * ```
 *
 * The loop sits on the T123 primitives, exactly as The Unseen Hand's benchmark
 * harness reuses its `advanceToDecision`/`applyCommand` split rather than
 * round-tripping through `step`:
 *
 * 1. {@link advanceToDecision} runs the Orders Tempo clock, resolves matured
 *    charges, skips casualties and surfaces the next living actor (or a
 *    terminal state).
 * 2. The actor's **side** chooses the policy: {@link GauntletPolicy} A commands
 *    the **company**, B commands the **enemy** (a neutral arbiter falls to B by
 *    default; override with {@link GauntletOptions.neutral}).
 * 3. The policy's {@link UtilityOptions} (and optional T099 difficulty tier)
 *    plan the turn via `chooseTurn`/`chooseTurnWithDifficulty`.
 * 4. Every command is committed through {@link applyCommand}, one at a time, so
 *    the AI walks the same front door a player or the Field runner uses.
 *
 * ## Why policies, not a single control policy
 *
 * `src/app/autoBattle.ts` (T098) already models **who owns a turn** with a
 * {@link ControlPolicy} (player vs AI). A gauntlet is the special case where
 * *both* sides are AI — so ownership is fixed ({@link GAUNTLET_CONTROL}) and
 * the interesting variable is **how each side plays**. Two {@link GauntletPolicy}
 * values carry that: separate weights, ability catalogues, Articles postings and
 * difficulty tiers, letting a balance test pit a cautious `recruit` line against
 * an `elite` one and compare the result across seeds.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Headless** — no DOM, no React, no renderer, no I/O. The whole run is a
 *   pure value transformation over {@link BattleState}.
 * - **Deterministic** — the seed is a parameter and the only randomness is the
 *   engine's seeded PRNG carried inside the battle. The same
 *   `(setup, seed, policyA, policyB)` always yields byte-identical state and
 *   events, so a balance run is replayable and a test is stable.
 * - **Loop-guarded** — a run is capped at {@link GauntletOptions.maxTurns}
 *   ({@link DEFAULT_MAX_GAUNTLET_TURNS} by default), stops on a stalled actor or
 *   a rejected order, and never spins (a turn that does not advance Orders Tempo
 *   still increments the counter and therefore hits the cap).
 * - **AI through the front door** — every order is an ordinary, serialisable
 *   {@link Command}; `applyCommand`/`advanceToDecision` are the sole writers of
 *   state. Nothing here forks the simulation.
 *
 * Reference: `docs/PEER_COMBAT_LESSONS.md` §L2, §L11;
 * `docs/NAPOLEONIC_MAPPING.md` §1 (the company), §10 (the campaign loop),
 * §11–§12 (irregulars and Orders Tempo). The harness shape is authored for this
 * project, not scraped.
 */

import { isAiControlled, makeControlPolicy, type ControlPolicy } from "../app/autoBattle";
import { chooseTurnWithDifficulty, type DifficultyChoice } from "./difficulty";
import { chooseTurn, type TurnPlan, type UtilityOptions } from "./utility";
import {
  advanceToDecision,
  applyCommand,
  beginBattle,
  createBattle,
  findUnit,
  type BattleSetup,
  type BattleState,
} from "../engine/battle";
import type { BattleEvent, BattleOutcome } from "../engine/events";
import type { Command } from "../engine/commands";
import type { UnitId } from "../engine/ids";
import type { Seed } from "../engine/rng";
import { isOutOfAction, type Unit, type UnitSide } from "../engine/unit";

/* --------------------------------------------------------------------------
 * Errors and constants
 * ------------------------------------------------------------------------ */

/**
 * Thrown when a gauntlet is asked to run with a malformed options value (a
 * negative turn cap). These are caller/programming faults, not in-world illegal
 * orders — those surface as a `"rejected"` stop.
 */
export class GauntletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GauntletError";
  }
}

/**
 * Safety cap on the number of Orders Tempo turns one gauntlet may take. A
 * sandbox battle with no objective, or two AI policies that both refuse to
 * engage, could otherwise run forever; the cap guarantees the harness returns.
 * Far above any real engagement.
 */
export const DEFAULT_MAX_GAUNTLET_TURNS = 512;

/**
 * The fixed ownership a gauntlet runs under: **every** soldier is AI-held, so
 * the headless loop never waits on a human and can always reach a terminal
 * state (or its turn cap). Exported so callers can assert the same contract.
 */
export const GAUNTLET_CONTROL: ControlPolicy = makeControlPolicy({
  sides: { company: "ai", enemy: "ai", neutral: "ai" },
});

/** Why {@link runGauntlet} stopped. */
export const GAUNTLET_STOPS = ["finished", "limit", "stalled", "rejected"] as const;
export type GauntletStop = (typeof GAUNTLET_STOPS)[number];

/** Which policy won, as labelled by the harness ("A" = company, "B" = enemy). */
export type GauntletWinner = "A" | "B" | "draw" | null;

/* --------------------------------------------------------------------------
 * Policy
 * ------------------------------------------------------------------------ */

/**
 * How one side plays a gauntlet. A policy is plain, serialisable data
 * (`agents.md` §2): it names the side for the summary and carries the AI
 * tuning the engine's decision-makers already understand.
 *
 * ```ts
 * const cautious: GauntletPolicy = {
 *   id: "cautious-line",
 *   difficulty: "recruit",
 *   ai: { weights: { ...DEFAULT_UTILITY_WEIGHTS, advance: 0, brace: 8 } },
 * };
 * const bold: GauntletPolicy = { id: "bold-line", difficulty: "elite" };
 * const summary = runGauntlet(setup, 1815, bold, cautious);
 * ```
 */
export interface GauntletPolicy {
  /** Stable id/display name for the summary and traces. */
  readonly id: string;
  /** AI tuning forwarded to `chooseTurn` (weights, abilities, orders, forecast, ...). */
  readonly ai?: UtilityOptions;
  /**
   * Optional difficulty tier (T099). When present the turn is planned through
   * `chooseTurnWithDifficulty`, composing the tier's aggression, seeded
   * mistakes and search budget on top of {@link ai}.
   */
  readonly difficulty?: DifficultyChoice;
}

/** Options for {@link runGauntlet}; the signature's four arguments cover the essentials. */
export interface GauntletOptions {
  /**
   * Cap on Orders Tempo turns taken before the loop gives up; defaults to
   * {@link DEFAULT_MAX_GAUNTLET_TURNS}. A non-negative integer.
   */
  readonly maxTurns?: number;
  /**
   * The policy that commands a **neutral** arbiter (a Provost Marshal). Defaults
   * to policy B; a neutral soldier is hostile to no one, so either policy just
   * holds.
   */
  readonly neutral?: GauntletPolicy;
}

/* --------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */

/** Net casualties over the run, by side. */
export interface GauntletCasualties {
  /** Company soldiers out of action (or removed) at the end. */
  readonly company: number;
  /** Enemy soldiers out of action (or removed) at the end. */
  readonly enemy: number;
  /** Neutral soldiers out of action (or removed) at the end. */
  readonly neutral: number;
  /** `company + enemy + neutral`. */
  readonly total: number;
}

/**
 * The result of one headless AI-vs-AI run: the state it reached, the events it
 * produced, and the balance summary a test or a tuning script asserts on.
 */
export interface GauntletSummary {
  /** The seed the battle was created from. */
  readonly seed: Seed;
  /** The policy id that commanded the company side. */
  readonly policyA: string;
  /** The policy id that commanded the enemy side. */
  readonly policyB: string;
  /** Why the loop stopped. */
  readonly stop: GauntletStop;
  /** `true` once the battle reached a terminal state and emitted `battleEnded`. */
  readonly finished: boolean;
  /** The engine's outcome from the company's point of view, or `null` if unfinished. */
  readonly outcome: BattleOutcome | null;
  /** Which policy won ("A", "B", "draw"), or `null` if unfinished. */
  readonly winner: GauntletWinner;
  /** Number of Orders Tempo turns taken. */
  readonly turns: number;
  /** Net casualties, by side. */
  readonly unitsLost: GauntletCasualties;
  /** The battle after the run (terminal, capped or stalled). */
  readonly state: BattleState;
  /** Every event produced, in resolution order (including the opening events). */
  readonly events: readonly BattleEvent[];
}

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

/** Guard a policy's authored id so the summary can never name an empty side. */
function assertPolicy(policy: GauntletPolicy, label: string): void {
  if (policy === null || typeof policy !== "object") {
    throw new GauntletError(`${label} must be a gauntlet policy object`);
  }
  if (typeof policy.id !== "string" || policy.id.trim() === "") {
    throw new GauntletError(`${label} must have a non-empty id`);
  }
}

/** The policy that commands `side`: A for the company, B for the enemy. */
export function policyForSide(
  side: UnitSide,
  policyA: GauntletPolicy,
  policyB: GauntletPolicy,
  neutral: GauntletPolicy = policyB,
): GauntletPolicy {
  if (side === "company") return policyA;
  if (side === "enemy") return policyB;
  return neutral;
}

/** Plan the current actor's turn with its side's policy (T095/T099). */
function planTurn(state: BattleState, unitId: UnitId, policy: GauntletPolicy): TurnPlan {
  const options = policy.ai ?? {};
  if (policy.difficulty === undefined) return chooseTurn(state, unitId, options);
  return chooseTurnWithDifficulty(state, unitId, policy.difficulty, options);
}

/**
 * Count net casualties by diffing the opening roster against the final state.
 * A soldier is "lost" when it was standing at the start and is out of action or
 * gone at the end. Soldiers already down before the opening whistle are not
 * counted (the harness measures what the battle cost, not the initial state).
 */
export function countCasualties(
  initial: readonly Unit[],
  final: readonly Unit[],
): GauntletCasualties {
  const finalById = new Map<string, Unit>();
  for (const unit of final) finalById.set(unit.id, unit);

  let company = 0;
  let enemy = 0;
  let neutral = 0;
  for (const unit of initial) {
    if (isOutOfAction(unit)) continue;
    const now = finalById.get(unit.id);
    if (now !== undefined && !isOutOfAction(now)) continue;
    if (unit.side === "company") company += 1;
    else if (unit.side === "enemy") enemy += 1;
    else neutral += 1;
  }
  return { company, enemy, neutral, total: company + enemy + neutral };
}

/** Map the engine's company-POV outcome onto the harness's A/B winner. */
function winnerOf(outcome: BattleOutcome | null): GauntletWinner {
  switch (outcome) {
    case "companyVictory":
      return "A";
    case "companyDefeat":
      return "B";
    case "draw":
      return "draw";
    default:
      return null;
  }
}

/* --------------------------------------------------------------------------
 * The run
 * ------------------------------------------------------------------------ */

/**
 * Play one complete headless AI-vs-AI battle and return a balance summary.
 *
 * The company is commanded by `policyA` and the enemy by `policyB` (a neutral
 * arbiter by {@link GauntletOptions.neutral}, defaulting to B). Both sides are
 * AI; ownership is fixed by {@link GAUNTLET_CONTROL}, so no soldier ever waits
 * on a human and the loop cannot stall for want of an order.
 *
 * ```ts
 * const summary = runGauntlet(setup, 1815, boldPolicy, cautiousPolicy);
 * summary.outcome;   // "companyVictory"
 * summary.turns;     // 6
 * summary.unitsLost; // { company: 0, enemy: 3, neutral: 0, total: 3 }
 * ```
 *
 * Stops when the battle finishes, when the turn cap is reached (`"limit"`),
 * when Orders Tempo stalls with nobody able to act (`"stalled"`), or if the
 * engine ever refuses an order the AI planned (`"rejected"`, an invariant
 * break). The input setup is only read; the returned {@link GauntletSummary}
 * carries the final state and the full event stream.
 *
 * @throws GauntletError when a policy is malformed or `maxTurns` is not a
 *   non-negative integer.
 */
export function runGauntlet(
  setup: BattleSetup,
  seed: Seed,
  policyA: GauntletPolicy,
  policyB: GauntletPolicy,
  options: GauntletOptions = {},
): GauntletSummary {
  assertPolicy(policyA, "policyA");
  assertPolicy(policyB, "policyB");
  const neutral = options.neutral ?? policyB;
  assertPolicy(neutral, "neutral policy");

  const maxTurns = options.maxTurns ?? DEFAULT_MAX_GAUNTLET_TURNS;
  if (!Number.isInteger(maxTurns) || maxTurns < 0) {
    throw new GauntletError(
      `maxTurns must be a non-negative integer, received ${String(maxTurns)}`,
    );
  }

  // The opening events and the first actor's upkeep, emitted once up front so
  // the summary's event stream is complete even for a zero-turn run.
  const begun = beginBattle(createBattle(seed, setup));
  let state = begun.state;
  const events: BattleEvent[] = [...begun.events];
  const initial = state.units.slice();

  let turns = 0;
  let stop: GauntletStop | null = null;

  while (stop === null) {
    if (state.phase === "finished") {
      stop = "finished";
      break;
    }
    if (turns >= maxTurns) {
      stop = "limit";
      break;
    }

    const advanced = advanceToDecision(state);
    state = advanced.state;
    events.push(...advanced.events);
    if (advanced.terminal) {
      stop = state.phase === "finished" ? "finished" : "stalled";
      break;
    }

    const actorId = advanced.actorId;
    const actor = actorId === null ? undefined : findUnit(state, actorId);
    if (actor === undefined || isOutOfAction(actor)) {
      stop = "stalled";
      break;
    }
    // Every side is AI-held under the gauntlet contract; a non-AI owner would
    // mean a headless run waiting on a human, which is a caller mistake.
    if (!isAiControlled(actor, GAUNTLET_CONTROL)) {
      stop = "stalled";
      break;
    }

    const policy = policyForSide(actor.side, policyA, policyB, neutral);
    const plan = planTurn(state, actor.id, policy);
    const commands: readonly Command[] =
      plan.commands.length > 0 ? plan.commands : [{ kind: "wait", unitId: actor.id }];

    let rejected = false;
    for (const command of commands) {
      const applied = applyCommand(state, command);
      if (applied.rejection !== undefined) {
        rejected = true;
        break;
      }
      state = applied.state;
      events.push(...applied.events);
      // A finishing order ends the run immediately; any commands after it would
      // be refused as `battle-over`, which is not an AI fault.
      if (state.phase === "finished") break;
    }

    turns += 1;
    if (rejected) {
      stop = "rejected";
      break;
    }
    if (state.phase === "finished") {
      stop = "finished";
      break;
    }
  }

  const outcome = state.phase === "finished" ? state.outcome : null;
  return {
    seed,
    policyA: policyA.id,
    policyB: policyB.id,
    stop,
    finished: state.phase === "finished",
    outcome,
    winner: winnerOf(outcome),
    turns,
    unitsLost: countCasualties(initial, state.units),
    state,
    events,
  };
}
