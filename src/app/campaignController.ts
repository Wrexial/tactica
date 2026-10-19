/**
 * Campaign controller (T121) — the glue that turns the pure campaign reducer
 * (T120) and the contract-to-battle deployment (T118) into one **playable
 * loop**: take a contract at the Officers' Mess, fight its battle on the Field
 * with the enemy driven by the AI runner (T119), settle the result back into
 * the campaign, advance the day and autosave.
 *
 * ```
 *   Officers' Mess  accept(contractId)
 *        │
 *        ├─ T120 acceptContract ── fee paid, posting marked, history appended
 *        ├─ T118 buildBattleFromContract(seed, company, contract, map)
 *        └─ T119 runAiUntilPlayer ── enemy phase until the company's turn
 *        ▼
 *   Field (BattleController)   player commits orders → engine `step`
 *        │  after every order: enemy AI runs; when the battle freezes…
 *        ▼
 *   T120 applyBattleOutcome ── rewards / casualties / ledger
 *   T120 advanceCampaignDay ── the calendar turns (Articles rotate)
 *   SaveStore autosave (T102) ── the rolling restore point
 *        ▼
 *   CampaignResult ── the summary the Field shows the player
 * ```
 *
 * ## Where this sits
 *
 * `agents.md` §7 makes a battle `seed + setup + command log` and the campaign a
 * {@link CampaignSave} plus an ordered list of actions. T120 already applies
 * those actions purely; T118/T119 already assemble and drive a single battle.
 * This module is the **controller seam** the Field report named missing: it
 * owns the working {@link CampaignSave} plus the active {@link BattleState},
 * and it is the only place that may stitch those pieces together. It stays
 * framework-free and deterministic (`agents.md` §2): no DOM, no `Math.random`,
 * no clock. The React shell (`src/ui/App.tsx`) holds a {@link CampaignState}
 * value and calls these functions; it never re-implements the loop.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Pure value transformations** — every function returns a new
 *   {@link CampaignState}; the input is never mutated.
 * - **AI through the front door** — the enemy phase is committed through the
 *   same `step` path the player uses (`src/app/battleRunner.ts`), so a
 *   campaign action is as replayable as a hand-played one.
 * - **Data-driven** — which contract posts which board is content
 *   (`src/data/contracts`, `src/data/maps`); the seed is derived from the save
 *   so the same campaign always fights the same battle.
 * - **Fail loud, fail early** — an unauthored contract or a combat contract
 *   with no board throws rather than fielding a half-empty action.
 *
 * The demonstration campaign is authored fiction (mapping §14 D6): the
 * Greycoats, a multinational free company, day 12 at Sainte-Colombe. It is
 * seeded and fixed so the e2e suite and manual play see the same company.
 */

import { getContract, isContractKey } from "../data/contracts";
import { combatMapForContract, hasCombatMap } from "../data/maps";
import type { EquipSlot, PowerKey } from "../data/schema";

import { createCalendar } from "../engine/calendar";
import { createCampaignMap } from "../engine/campaignMap";
import { createCompany, type Company } from "../engine/company";
import { createDepotInventory } from "../engine/depot";
import { coord } from "../engine/grid";
import {
  asCompanyId,
  asEquipmentId,
  asMapTokenId,
  asPostId,
  asRegionId,
  asUnitId,
  type ContractId,
  type EquipmentId,
} from "../engine/ids";
import { createPostAssignment, derivePostStats } from "../engine/progression/posts";
import type { Seed } from "../engine/rng";
import { createUnit } from "../engine/unit";

import { createCampaignProgress, createCampaignSave, type CampaignSave } from "../persist/campaign";

import { DEFAULT_CONTROL_POLICY, autoBattleAllies, isAiControlled } from "./autoBattle";
import { createBattleController, type BattleController } from "./battleController";
import { AGGRESSIVE_FIELD_AI, runAiUntilPlayer } from "./battleRunner";
import { buildBattleFromContract, isCombatContract } from "./battleSetup";
import {
  acceptContract,
  advanceCampaignDay,
  applyBattleOutcome,
  battleReportFromState,
} from "./campaign";
import { findUnit, type BattleState } from "../engine/battle";
import type { BattleEvent, BattleOutcome } from "../engine/events";

/* --------------------------------------------------------------------------
 * The deterministic demonstration campaign
 * ------------------------------------------------------------------------ */

/** Root seed of the authored demo campaign; every battle derives from it. */
export const DEMO_CAMPAIGN_SEED = "campaign-1815";

/** Campaign day the demonstration opens on. */
export const DEMO_CAMPAIGN_DAY = 12;

/**
 * Level of the demonstration company. The campaign's growth tables give a
 * level-4 free company a Speed of 4–5 against the regulars' 30–50, so the
 * enemy would finish a short objective before the player ever acted. The demo
 * company is fielded as veterans so the player actually takes a turn and the
 * short objective cannot soft-lock on a downed soldier (a Phase 14 balance
 * pass owns the real curve).
 */
export const DEMO_COMPANY_LEVEL = 30;

/** One authored soldier of the demonstration company. */
interface DemoRecruit {
  readonly id: string;
  readonly name: string;
  readonly power: PowerKey;
  readonly postId: string;
  readonly equipment: Partial<Record<EquipSlot, string>>;
}

/** The five Greycoats, matching the Officers' Mess demonstration board. */
const DEMO_RECRUITS: readonly DemoRecruit[] = [
  {
    id: "unit-aubry",
    name: "Sgt. Aubry",
    power: "france",
    postId: "fusilier",
    equipment: { weapon: "baker-rifle", armour: "line-uniform" },
  },
  {
    id: "unit-bouvet",
    name: "Cpl. Bouvet",
    power: "france",
    postId: "grenadier",
    equipment: { weapon: "grenadier-broadsword", head: "bearskin" },
  },
  {
    id: "unit-okafor",
    name: "Pte. Okafor",
    power: "britain",
    postId: "forager",
    equipment: { weapon: "charleville-musket", accessory: "water-canteen" },
  },
  {
    id: "unit-voss",
    name: "Lt. Voss",
    power: "austria",
    postId: "scout",
    equipment: { weapon: "light-carbine", accessory: "spyglass" },
  },
  {
    id: "unit-duret",
    name: "Cpl. Duret",
    power: "france",
    postId: "chasseur",
    equipment: { weapon: "light-carbine", accessory: "powder-flask" },
  },
];

/** Build one roster member through the authored factories. */
function makeDemoMember(spec: DemoRecruit, level: number) {
  const assignment = createPostAssignment({
    primaryPostId: asPostId(spec.postId),
    power: spec.power,
  });
  const equipment = Object.fromEntries(
    Object.entries(spec.equipment).map(([slot, id]) => [slot, asEquipmentId(id as string)]),
  ) as Partial<Record<EquipSlot, EquipmentId>>;
  const unit = createUnit({
    id: asUnitId(spec.id),
    name: spec.name,
    power: spec.power,
    postId: asPostId(spec.postId),
    level,
    at: coord(0, 0),
    stats: derivePostStats({ level, assignment }),
    equipment,
  });
  return { unit, assignment };
}

/**
 * The multinational free company the demonstration opens with: five soldiers
 * spanning France, Britain and Austria, enough to post the ungated skirmishes
 * while still failing the item/post gates the Mess is meant to show.
 */
export function createDemoCompany(level = DEMO_COMPANY_LEVEL): Company {
  return createCompany({
    id: asCompanyId("company-greycoats"),
    name: "The Greycoats",
    crowns: 900,
    honours: 3,
    theatre: { day: DEMO_CAMPAIGN_DAY, regionId: asRegionId("sainte-colombe") },
    roster: DEMO_RECRUITS.map((spec) => makeDemoMember(spec, level)),
  });
}

/**
 * The deterministic demonstration {@link CampaignSave} the app opens with: The
 * Greycoats on day 12 at Sainte-Colombe, a small Theatre map and no active
 * posting. Fixed seed, day and roster, so every reload and test is identical.
 */
export function createDemoCampaign(): CampaignSave {
  const company = createDemoCompany();
  const map = createCampaignMap({
    width: 4,
    height: 4,
    placements: [
      {
        slot: coord(0, 0),
        marker: {
          id: asMapTokenId("start"),
          name: "Sainte-Colombe",
          terrain: "bridge",
          regionId: asRegionId("sainte-colombe"),
        },
      },
    ],
  });

  return createCampaignSave({
    seed: DEMO_CAMPAIGN_SEED,
    company,
    map,
    calendar: createCalendar({
      seed: DEMO_CAMPAIGN_SEED,
      day: DEMO_CAMPAIGN_DAY,
      regionId: asRegionId("sainte-colombe"),
    }),
    inventory: createDepotInventory(),
    progress: createCampaignProgress(),
    history: [],
  });
}

/* --------------------------------------------------------------------------
 * Controller state
 * ------------------------------------------------------------------------ */

/**
 * The summary of one finished campaign action, held after the reducer has been
 * applied so the Field can show the player what happened. It is a plain,
 * serialisable value — the UI only reads it.
 */
export interface CampaignResult {
  readonly contractId: ContractId;
  readonly contractName: string;
  /** How the action finished, from the company's point of view (T031). */
  readonly outcome: BattleOutcome;
  /** `true` when the company won (rewards were paid). */
  readonly victory: boolean;
  readonly dayBefore: number;
  readonly dayAfter: number;
  readonly crownsBefore: number;
  readonly crownsAfter: number;
  readonly honoursBefore: number;
  readonly honoursAfter: number;
}

/**
 * The working campaign plus the battle it is currently fighting. Held by the
 * React shell as one immutable value; every transition below returns a new one.
 */
export interface CampaignState {
  /** The working campaign save (roster, map, calendar, ledger, history). */
  readonly save: CampaignSave;
  /** The contract the detachment is fighting, or `null` when no battle is live. */
  readonly contractId: ContractId | null;
  /** The active battle, or `null` when the company is in camp. */
  readonly battle: BattleState | null;
  /** The last finished action's summary, or `null` while none is shown. */
  readonly result: CampaignResult | null;
}

/** What one controller step produced: the new state and its engine events. */
export interface CampaignUpdate {
  readonly state: CampaignState;
  /** The battle after the step, or `null` when the action has settled. */
  readonly battle: BattleState | null;
  /** Events emitted by the step, in resolution order (for the renderer). */
  readonly events: readonly BattleEvent[];
}

/** A campaign with no battle in progress. */
export function createCampaignState(save: CampaignSave): CampaignState {
  return { save, contractId: null, battle: null, result: null };
}

/* --------------------------------------------------------------------------
 * Seeding
 * ------------------------------------------------------------------------ */

/** The authored contract for `contractId`, or a loud error when unauthored. */
function requireContract(contractId: ContractId) {
  if (!isContractKey(contractId)) {
    throw new RangeError(`unknown contract: ${String(contractId)}`);
  }
  return getContract(contractId);
}

/**
 * The seed a contract's battle is fought under: derived from the campaign's
 * root seed, the contract id and the current day. Deterministic — the same
 * campaign, posting and day always yields the same battle (T118) — while still
 * giving each posting/day its own field.
 */
export function battleSeedFor(save: CampaignSave, contractId: ContractId): Seed {
  return `${String(save.seed)}:${contractId}:${save.calendar.day}`;
}

/* --------------------------------------------------------------------------
 * Accepting a contract & opening the field
 * ------------------------------------------------------------------------ */

/**
 * Take a postable **combat** contract and open its battle on the Field.
 *
 * 1. The T120 reducer accepts the contract (fee paid, posting marked, history
 *    appended).
 * 2. If it fields a detachment (`isCombatContract` and it posts a board), the
 *    battle is assembled by `buildBattleFromContract` and the enemy phase is
 *    resolved until the company's first turn (or the objective is already met).
 * 3. A non-combat contract (a Detachment) is accepted but leaves the company in
 *    camp — it resolves without a board.
 *
 * Pure: the input state is never mutated.
 *
 * @throws RangeError when the contract cannot be accepted (unknown, already
 *   active, unaffordable) or the board cannot be assembled.
 */
export function startCampaignBattle(state: CampaignState, contractId: ContractId): CampaignState {
  const contract = requireContract(contractId);
  const save = acceptContract(state.save, contractId);

  if (!isCombatContract(contract) || !hasCombatMap(contract.id)) {
    return { save, contractId: null, battle: null, result: null };
  }

  const map = combatMapForContract(contract.id);
  const battle = buildBattleFromContract(
    battleSeedFor(save, contractId),
    save.company,
    contract,
    map,
  );
  const opened: CampaignState = { save, contractId, battle, result: null };
  return advanceCampaignBattle(opened).state;
}

/* --------------------------------------------------------------------------
 * Driving the battle
 * ------------------------------------------------------------------------ */

/** Whether `battle` is waiting on an AI-controlled soldier. */
function aiHoldsTurn(battle: BattleState): boolean {
  if (battle.currentActorId === null) return false;
  const actor = findUnit(battle, battle.currentActorId);
  return actor !== undefined && isAiControlled(actor, DEFAULT_CONTROL_POLICY);
}

/**
 * Advance the live campaign battle by one **AI phase**, then score it.
 *
 * - When the battle is already `finished`, the T120 reducer applies the
 *   outcome, the calendar advances a day and a {@link CampaignResult} is set.
 * - Otherwise, if the enemy holds the turn, `runAiUntilPlayer` takes every
 *   consecutive hostile turn and returns control to the company (or finishes
 *   the objective).
 * - When a company soldier holds the turn, this is a no-op — the player acts.
 *
 * Deterministic: the enemy plans through the seeded utility AI and `step`
 * (T119), so the same state always produces the same run.
 */
export function advanceCampaignBattle(state: CampaignState): CampaignUpdate {
  const battle = state.battle;
  if (state.contractId === null || battle === null || state.result !== null) {
    return { state, battle, events: [] };
  }
  if (battle.phase === "finished") {
    return settleCampaignBattle(state, battle);
  }
  if (!aiHoldsTurn(battle)) {
    return { state, battle, events: [] };
  }

  const run = runAiUntilPlayer(battle, { policy: DEFAULT_CONTROL_POLICY, ai: AGGRESSIVE_FIELD_AI });
  if (run.state.phase === "finished") {
    const settled = settleCampaignBattle(state, run.state);
    return { state: settled.state, battle: null, events: run.events };
  }
  const next: CampaignState = { ...state, battle: run.state };
  return { state: next, battle: run.state, events: run.events };
}

/** Whether the live campaign battle is waiting on an AI-controlled soldier. */
export function campaignAiHoldsTurn(state: CampaignState): boolean {
  return (
    state.contractId !== null &&
    state.battle !== null &&
    state.result === null &&
    aiHoldsTurn(state.battle)
  );
}

/**
 * Take exactly **one** AI soldier's turn in the live campaign battle (and settle
 * it if that turn ends the action), so the caller can pace the enemy phase one
 * action at a time. Returns the unchanged state when no AI soldier holds turn.
 */
export function runCampaignTurn(state: CampaignState): CampaignUpdate {
  const battle = state.battle;
  if (state.contractId === null || battle === null || state.result !== null) {
    return { state, battle, events: [] };
  }
  if (battle.phase === "finished") return settleCampaignBattle(state, battle);
  if (!aiHoldsTurn(battle)) return { state, battle, events: [] };

  const run = runAiUntilPlayer(battle, {
    policy: DEFAULT_CONTROL_POLICY,
    ai: AGGRESSIVE_FIELD_AI,
    maxTurns: 1,
  });
  if (run.state.phase === "finished") {
    const settled = settleCampaignBattle(state, run.state);
    return { state: settled.state, battle: null, events: run.events };
  }
  const next: CampaignState = { ...state, battle: run.state };
  return { state: next, battle: run.state, events: run.events };
}

/**
 * Auto-battle the **rest** of the action: hand both the enemy and the company
 * to the AI (T098) and run until the objective resolves, then apply the
 * outcome. A convenience for a decisive "commit the company" order and for a
 * hands-off test path; the deterministic auto-battle makes it as reproducible
 * as hand-played turns.
 */
export function resolveCampaignBattle(state: CampaignState): CampaignUpdate {
  const battle = state.battle;
  if (state.contractId === null || battle === null || state.result !== null) {
    return { state, battle, events: [] };
  }
  if (battle.phase === "finished") {
    return settleCampaignBattle(state, battle);
  }

  const policy = autoBattleAllies(DEFAULT_CONTROL_POLICY, "all");
  const run = runAiUntilPlayer(battle, { policy, ai: AGGRESSIVE_FIELD_AI });
  if (run.state.phase === "finished") {
    const settled = settleCampaignBattle(state, run.state);
    return { state: settled.state, battle: null, events: run.events };
  }
  const next: CampaignState = { ...state, battle: run.state };
  return { state: next, battle: run.state, events: run.events };
}

/**
 * Apply a finished battle to the campaign: the T120 reducer pays the rewards
 * (or records the loss), recovers/removes casualties, clears the posting and
 * advances the story, then the calendar turns one day. The returned state has
 * `result` set and no live battle.
 *
 * Pure and deterministic; the input state is untouched.
 */
function settleCampaignBattle(state: CampaignState, battle: BattleState): CampaignUpdate {
  const contractId = state.contractId;
  if (contractId === null) {
    return { state, battle: null, events: [] };
  }

  const report = battleReportFromState(battle, contractId);
  const dayBefore = state.save.calendar.day;
  const crownsBefore = state.save.company.crowns;
  const honoursBefore = state.save.company.honours;

  const settledSave = advanceCampaignDay(applyBattleOutcome(state.save, report), 1);

  const result: CampaignResult = {
    contractId,
    contractName: requireContract(contractId).name,
    outcome: report.outcome,
    victory: report.outcome === "companyVictory",
    dayBefore,
    dayAfter: settledSave.calendar.day,
    crownsBefore,
    crownsAfter: settledSave.company.crowns,
    honoursBefore,
    honoursAfter: settledSave.company.honours,
  };

  return {
    state: { save: settledSave, contractId: null, battle: null, result },
    battle: null,
    events: [],
  };
}

/** Clear the result summary (the player has read it) and return to camp. */
export function dismissCampaignResult(state: CampaignState): CampaignState {
  return state.result === null ? state : { ...state, result: null };
}

/** The {@link BattleController} for the live campaign battle, or `null`. */
export function campaignBattleController(state: CampaignState): BattleController | null {
  return state.battle === null ? null : createBattleController(state.battle);
}

/** The authored contract's display name, or `null` when none is active. */
export function activeContractName(state: CampaignState): string | null {
  return state.contractId === null ? null : requireContract(state.contractId).name;
}
