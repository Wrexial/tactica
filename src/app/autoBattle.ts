/**
 * Ally auto-battle (T098) — **optional AI control for allied units**.
 *
 * The utility AI (`src/ai/utility.ts`, T095) already knows how to plan and
 * legally commit one soldier's Orders Tempo turn. What the game still needed
 * was the *controller* that decides **who the AI fights for**: the enemy, and —
 * when the player delegates them — the company's own allies. This module is
 * that controller. It sits in `src/app` because it wires the engine and the AI
 * together (`agents.md` §6, §7); it never forks the simulation and never invents
 * rules.
 *
 * ## Who owns a turn
 *
 * A {@link ControlPolicy} assigns every soldier a {@link ControlOwner}:
 *
 * - `"player"` — the human gives the orders (the battle stops here);
 * - `"ai"` — the AI plans and commits the turn through `step`, exactly as the
 *   player would.
 *
 * Ownership is resolved **per soldier first, then per side** ({@link
 * controlOwnerOf}), so a policy can leave the free company to the player while
 * handing one named ally — a detached escort, a wounded officer, an irregular
 * auxiliary — to the AI. {@link autoBattleAllies} is the sugar for that;
 * `autoBattleAllies(policy, "all")` runs the whole company in auto-battle.
 *
 * The default policy ({@link DEFAULT_CONTROL_POLICY}) is the ordinary
 * single-player split: **the company is the player's, the enemy and the neutral
 * arbiter are the AI's**. A neutral Provost Marshal left to the AI simply Holds
 * (it is hostile to no one), so it never stalls the loop.
 *
 * ## Running the AI
 *
 * {@link runAutoTurn} plans one soldier's turn with {@link chooseTurn} and
 * commits every command through `step`, returning the state, the events and the
 * plan. {@link runAutoBattle} loops that over consecutive AI-held turns and
 * stops the moment it reaches a soldier the player controls (or the battle
 * ends, stalls, or a safety cap is hit). The result is a fully replayable
 * sequence — the same seed, policy and roster always produce the same turns —
 * because the AI only ever submits ordinary {@link Command}s (`agents.md` §2,
 * §7).
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure and deterministic** — no DOM, no I/O, no `Math.random`, no clock.
 *   Everything reads a {@link BattleState} and returns fresh values; the input
 *   battle is never mutated (engine `step` already guarantees this).
 * - **AI through the front door** — every order is a serialisable command
 *   committed by the engine, so an auto-battled turn replays identically to a
 *   hand-played one.
 * - **Opt-in** — with no policy, allies are the player's; nothing is automated
 *   unless the caller asks for it.
 *
 * Reference: `docs/NAPOLEONIC_MAPPING.md` §1 (the **company**), §11–§12
 * (irregulars and Orders Tempo), `docs/wiki/pages/Charge_time.md` (whose turn
 * it is). The control model is authored for this project, not scraped.
 */

import { chooseTurn, type TurnPlan, type UtilityOptions } from "../ai/utility";
import {
  beginBattle,
  findUnit,
  step,
  type BattleRejection,
  type BattleState,
} from "../engine/battle";
import type { Command } from "../engine/commands";
import type { BattleEvent } from "../engine/events";
import type { UnitId } from "../engine/ids";
import { isOutOfAction, type Unit, type UnitSide } from "../engine/unit";

/* --------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------ */

/**
 * Thrown when auto-battle is asked to run a turn that cannot be run: the
 * soldier is not deployed, the battle is over, or it is somebody else's turn.
 * These are caller/programming faults, not in-world illegal orders (which the
 * AI avoids by construction via {@link chooseTurn}).
 */
export class AutoBattleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutoBattleError";
  }
}

/* --------------------------------------------------------------------------
 * Control policy
 * ------------------------------------------------------------------------ */

/** Who gives a soldier its orders. */
export const CONTROL_OWNERS = ["player", "ai"] as const;
export type ControlOwner = (typeof CONTROL_OWNERS)[number];

/**
 * Who the AI fights for. `sides` is the default owner for each side of the
 * field; `units` overrides it for named soldiers (a per-soldier entry always
 * wins). A policy is a plain, serialisable value — the UI can persist it with
 * the battle.
 */
export interface ControlPolicy {
  /** Default owner for each side. */
  readonly sides: Readonly<Record<UnitSide, ControlOwner>>;
  /** Per-soldier overrides, keyed by branded id. */
  readonly units: Readonly<Partial<Record<UnitId, ControlOwner>>>;
}

/**
 * The ordinary single-player split: the player commands the free company, while
 * the AI commands the hostile irregulars and the neutral arbiter. The company
 * is the player's by default, so no ally is auto-battled unless the caller
 * opts in (`agents.md` §1, mapping §1).
 */
export const DEFAULT_CONTROL_SIDES: Readonly<Record<UnitSide, ControlOwner>> = {
  company: "player",
  enemy: "ai",
  neutral: "ai",
};

/** The default {@link ControlPolicy}; see {@link DEFAULT_CONTROL_SIDES}. */
export const DEFAULT_CONTROL_POLICY: ControlPolicy = {
  sides: DEFAULT_CONTROL_SIDES,
  units: {},
};

/** Authoring input for {@link makeControlPolicy}; omitted fields take defaults. */
export interface ControlPolicyInit {
  readonly sides?: Partial<Record<UnitSide, ControlOwner>>;
  readonly units?: Partial<Record<UnitId, ControlOwner>>;
}

/** Build a policy, filling omitted sides from {@link DEFAULT_CONTROL_SIDES}. */
export function makeControlPolicy(init: ControlPolicyInit = {}): ControlPolicy {
  return {
    sides: { ...DEFAULT_CONTROL_SIDES, ...init.sides },
    units: { ...init.units },
  };
}

/** The minimal soldier shape ownership needs: an id and a side. */
export type ControlSubject = Pick<Unit, "id" | "side">;

/**
 * Who owns `unit`'s turn under `policy`: the per-soldier override when present,
 * otherwise the side default. Pure — the policy is only read.
 */
export function controlOwnerOf(
  unit: ControlSubject,
  policy: ControlPolicy = DEFAULT_CONTROL_POLICY,
): ControlOwner {
  return policy.units[unit.id] ?? policy.sides[unit.side];
}

/** Whether the AI gives `unit`'s orders (`controlOwnerOf` is `"ai"`). */
export function isAiControlled(
  unit: ControlSubject,
  policy: ControlPolicy = DEFAULT_CONTROL_POLICY,
): boolean {
  return controlOwnerOf(unit, policy) === "ai";
}

/** Whether the player gives `unit`'s orders (`controlOwnerOf` is `"player"`). */
export function isPlayerControlled(
  unit: ControlSubject,
  policy: ControlPolicy = DEFAULT_CONTROL_POLICY,
): boolean {
  return controlOwnerOf(unit, policy) === "player";
}

/** Return a copy of `policy` with `side`'s default owner changed. */
export function withSideControl(
  policy: ControlPolicy,
  side: UnitSide,
  owner: ControlOwner,
): ControlPolicy {
  return { ...policy, sides: { ...policy.sides, [side]: owner } };
}

/** Return a copy of `policy` with `unitId`'s owner overridden. */
export function withUnitControl(
  policy: ControlPolicy,
  unitId: UnitId,
  owner: ControlOwner,
): ControlPolicy {
  return { ...policy, units: { ...policy.units, [unitId]: owner } };
}

/**
 * Hand allied soldiers to the AI. Pass `"all"` (the default) to auto-battle the
 * whole free company, or a list of ids to delegate only those soldiers —
 * everyone else on the company side stays under player control.
 *
 * Returns a new policy; the input is never mutated.
 */
export function autoBattleAllies(
  policy: ControlPolicy = DEFAULT_CONTROL_POLICY,
  allies: readonly UnitId[] | "all" = "all",
): ControlPolicy {
  if (allies === "all") return withSideControl(policy, "company", "ai");

  let next = policy;
  for (const unitId of allies) next = withUnitControl(next, unitId, "ai");
  return next;
}

/* --------------------------------------------------------------------------
 * Auto-battle results
 * ------------------------------------------------------------------------ */

/** Why {@link runAutoBattle} handed control back. */
export const AUTO_BATTLE_STOPS = [
  "player-turn",
  "finished",
  "no-actor",
  "stalled",
  "limit",
  "rejected",
] as const;
export type AutoBattleStop = (typeof AUTO_BATTLE_STOPS)[number];

/**
 * Safety cap on the number of AI turns one {@link runAutoBattle} call will take
 * for a policy that owns **every** soldier (an AI-vs-AI sandbox with no
 * objective could otherwise run forever). Far above any real engagement.
 */
export const DEFAULT_MAX_AUTO_TURNS = 512;

/** Options for {@link runAutoTurn} and {@link runAutoBattle}. */
export interface AutoBattleOptions {
  /**
   * Who the AI fights for. Defaults to {@link DEFAULT_CONTROL_POLICY} (player
   * company, AI enemy).
   */
  readonly policy?: ControlPolicy;
  /** AI tuning forwarded verbatim to `chooseTurn` (weights, abilities, orders, ...). */
  readonly ai?: UtilityOptions;
  /** Cap on AI turns per {@link runAutoBattle} call; defaults to {@link DEFAULT_MAX_AUTO_TURNS}. */
  readonly maxTurns?: number;
}

/** One auto-battled turn: what the AI planned and what the engine did with it. */
export interface AutoTurnResult {
  /** The soldier whose turn was taken. */
  readonly unitId: UnitId;
  /** The AI's full plan (commands, destination and scoring breakdown). */
  readonly plan: TurnPlan;
  /** The replayable commands the AI issued. */
  readonly commands: readonly Command[];
  /** Events produced by those commands, in resolution order. */
  readonly events: readonly BattleEvent[];
  /** The battle after the turn. */
  readonly state: BattleState;
  /**
   * Set only if the engine refused a command the AI issued — an invariant
   * violation, because {@link chooseTurn} replays and validates its plan first.
   */
  readonly rejection: BattleRejection | null;
}

/** The outcome of {@link runAutoBattle}: the final state plus every AI turn. */
export interface AutoBattleResult {
  /** The battle after every auto-battled turn (or unchanged when none ran). */
  readonly state: BattleState;
  /** Every event produced, including the battle's opening events. */
  readonly events: readonly BattleEvent[];
  /** The AI turns taken, in order. */
  readonly turns: readonly AutoTurnResult[];
  /** Why the run stopped. */
  readonly stop: AutoBattleStop;
  /** Whose turn it is now (the player's soldier, or `null`). */
  readonly nextActorId: UnitId | null;
}

/* --------------------------------------------------------------------------
 * Running the AI
 * ------------------------------------------------------------------------ */

/**
 * Take one soldier's Orders Tempo turn with the AI and commit it through the
 * engine. The soldier must currently hold the turn; anything else is an
 * {@link AutoBattleError} (use {@link runAutoBattle} to find the actor).
 *
 * The plan comes from {@link chooseTurn}, which already proves every command
 * legal against this state, so a clean run never rejects. If the engine *does*
 * refuse a command the loop stops and reports it on
 * {@link AutoTurnResult.rejection} rather than silently dropping orders.
 */
export function runAutoTurn(
  state: BattleState,
  unitId: UnitId,
  options: AutoBattleOptions = {},
): AutoTurnResult {
  if (state.phase === "finished") {
    throw new AutoBattleError("the battle has already ended");
  }
  const actor = findUnit(state, unitId);
  if (actor === undefined) {
    throw new AutoBattleError(`no soldier "${unitId}" is deployed in this battle`);
  }
  if (state.currentActorId !== unitId) {
    throw new AutoBattleError(
      `it is ${state.currentActorId ?? "nobody's"} turn, not ${actor.name}'s`,
    );
  }

  const plan = chooseTurn(state, unitId, options.ai);
  let working = state;
  const events: BattleEvent[] = [];
  let rejection: BattleRejection | null = null;

  for (const command of plan.commands) {
    const result = step(working, command);
    if (result.rejection !== undefined) {
      rejection = result.rejection;
      break;
    }
    working = result.state;
    events.push(...result.events);
  }

  return {
    unitId,
    plan,
    commands: plan.commands,
    events,
    state: working,
    rejection,
  };
}

/**
 * Auto-battle every consecutive AI-held turn, then hand control back.
 *
 * Starting from `state`'s current actor, run auto-battles while the actor is
 * AI-controlled and the battle has not ended. Stops the moment the turn belongs
 * to a player-controlled soldier, so the loop naturally alternates between the
 * AI and the human. Returns every AI turn plus all events (including the
 * battle's opening `battleStarted`/`unitDeployed`/`turnStarted` events when the
 * battle had not started yet), so the renderer can animate the whole run.
 *
 * ```ts
 * // Give the whole company to the AI and watch the action play out.
 * const run = runAutoBattle(battle, {
 *   policy: autoBattleAllies(DEFAULT_CONTROL_POLICY, "all"),
 *   maxTurns: 200,
 * });
 * ```
 *
 * The input battle is never mutated. The returned value always names why the
 * loop stopped ({@link AutoBattleResult.stop}).
 */
export function runAutoBattle(
  state: BattleState,
  options: AutoBattleOptions = {},
): AutoBattleResult {
  const policy = options.policy ?? DEFAULT_CONTROL_POLICY;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_AUTO_TURNS;
  if (!Number.isInteger(maxTurns) || maxTurns < 0) {
    throw new AutoBattleError(
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

    if (!isAiControlled(actor, policy)) return finish("player-turn");
    if (turns.length >= maxTurns) return finish("limit");

    const turn = runAutoTurn(working, actorId, options);
    working = turn.state;
    events.push(...turn.events);
    turns.push(turn);

    // `chooseTurn` guarantees legality; a rejection here is an invariant break.
    if (turn.rejection !== null) return finish("rejected");
  }
}
