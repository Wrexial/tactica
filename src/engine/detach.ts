/**
 * Detachments (T072) — send soldiers away on an Officers' Mess **detachment
 * contract** for N days and resolve their **rewards** when they march back in
 * (mapping §5, §10).
 *
 * FFTA's **dispatch missions** post a party out of town for a fixed number of
 * days; the calendar ticks while they are gone, and when the timer runs out the
 * clan collects the mission's **Gil**, **AP**, **Experience** and items. The
 * retheme keeps that contract (mapping §10, "Dispatch missions … Send units away
 * for N days") and renames the pieces: the party is a **detachment**, the
 * timer is a {@link Dispatch} on the campaign {@link CampaignCalendar} (T076),
 * and the reward comes from an authored detachment {@link ContractDef} (T070).
 *
 * ```
 *   sendDetachment(company, calendar, { dispatchId, contractId, unitIds })
 *          │
 *          ├─ validate the contract is a detachment and the party is on the roster
 *          ├─ spend the contract fee (Crowns)               ── the Mess posting
 *          └─ scheduleDispatch(calendar, { duration })      ── T076's timer
 *
 *          … N days pass; advanceCampaign / tickDispatches returns the party …
 *
 *   resolveDetachment(company, inventory, dispatch) ── the spoils
 *          │
 *          ├─ addCrowns / awardHonours                      ── the war chest
 *          ├─ addToInventory × reward.itemIds               ── captured kit
 *          └─ awardDrill + awardExperience per soldier       ── T048 / T049
 *
 *   advanceDetachments(company, calendar, inventory, days)
 *          └─ advanceCampaign + resolve every returned dispatch in one step
 * ```
 *
 * ## Where this sits
 *
 * T076's `calendar.ts` owns the **timer**: a {@link Dispatch} records who is
 * away, when they left and when they return. This module is the **detachment
 * policy** on top of it — which contracts may be sent, what it costs to post
 * them, and what the party brings back. Keeping the clock and the reward seam
 * separate means the campaign controller (and the campaign tests, T079) can
 * either resolve returns one at a time or fold the whole advance into a single
 * call, without either module reaching into the other's state.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Engine purity & determinism** — framework-free, DOM-free TypeScript with
 *   no `Math.random` and no `Date`. Time is the integer campaign day; awards
 *   are applied in the roster order of `dispatch.unitIds`, so a save plus an
 *   ordered list of campaign commands replays byte-identically.
 * - **State in, state out** — every helper returns **new** values (company,
 *   calendar, inventory, events); inputs are never mutated. Structural sharing
 *   is fine. The company's roster is rebuilt, not edited in place.
 * - **Data-driven** — the duration, fee and reward all come from the authored
 *   `src/data/contracts.ts` entry; no balance constant or contract id is baked
 *   into this logic. The reward is applied through the T048/T049 progression
 *   helpers, so Drill and Experience keep a single source of truth.
 * - **Trust boundary** — {@link detachmentBlockers} validates a send against
 *   the contract, the roster and the calendar before anything moves, and
 *   {@link resolveDetachment} rejects an unknown or non-detachment contract
 *   rather than silently granting nothing.
 *
 * Reference: mapping §5 (resources: Crowns, Drill, Experience), §9 (campaign
 * calendar) and §10 (dispatch missions). This is original fiction inspired by
 * the Napoleonic Wars, not a port of FFTA's dispatch data.
 */

import { getContract, isContractKey, type ContractKey } from "../data/contracts";
import { isEquipmentKey } from "../data/equipment";
import type { ContractDef, ContractReward } from "../data/schema";

import {
  advanceCampaign,
  dispatchById,
  isUnitDispatched,
  scheduleDispatch,
  type CampaignCalendar,
  type Dispatch,
} from "./calendar";
import {
  addCrowns,
  awardHonours,
  canAfford,
  hasMember,
  spendCrowns,
  type Company,
  type RosterMember,
} from "./company";
import { addToInventory, createDepotInventory, type DepotInventory } from "./depot";
import type { BattleEvent } from "./events";
import { asEquipmentId, assertId, type ContractId, type DispatchId, type UnitId } from "./ids";
import { awardDrill } from "./progression/drill";
import { awardExperience } from "./progression/level";
import { primaryPostGrowth } from "./progression/posts";
import type { DailyArticles } from "./rules/articles";

/* --------------------------------------------------------------------------
 * Shapes
 * ------------------------------------------------------------------------ */

/**
 * The party a player asks to send away: the **dispatch id** that will name the
 * timer, the **detachment contract** they are accepting and the **soldiers**
 * committed. The duration is not supplied — it is authored on the contract
 * (`ContractDef.duration`, T070), so the Mess can never disagree with the clock.
 */
export interface DetachmentInit {
  /** Stable handle for the timer (so a return can be resolved exactly once). */
  readonly dispatchId: DispatchId;
  /** The authored detachment contract to accept. */
  readonly contractId: ContractId;
  /** The soldiers going away, in roster order; must be on the company roster. */
  readonly unitIds: readonly UnitId[];
}

/** Why a detachment cannot be sent right now (empty array ⇒ it can). */
export type DetachmentBlocker =
  | "unknown-contract"
  | "not-a-detachment"
  | "empty-party"
  | "duplicate-soldier"
  | "unit-not-on-roster"
  | "unit-already-away"
  | "duplicate-dispatch"
  | "party-too-small"
  | "insufficient-crowns";

/** The result of a successful {@link sendDetachment}: the party is on the road. */
export interface SentDetachment {
  /** The company after the contract **fee** was paid from the war chest. */
  readonly company: Company;
  /** The calendar now holding the active timer. */
  readonly calendar: CampaignCalendar;
  /** The scheduled timer (redundant with the calendar, handy for the caller). */
  readonly dispatch: Dispatch;
  /** The authored contract the party accepted. */
  readonly contract: ContractDef;
}

/** What one returning soldier collected from a detachment contract. */
export interface UnitDetachmentReward {
  readonly unitId: UnitId;
  /** Drill (AP) credited toward equipped abilities (T048). */
  readonly ap: number;
  /** Experience awarded, and any level-ups crossed (T049). */
  readonly experience: number;
  readonly levelsGained: number;
  /** How many equipped abilities this award mastered. */
  readonly abilitiesMastered: number;
}

/** The resolved spoils of one returning detachment. */
export interface ResolvedDetachment {
  /** The company with Crowns, Honours, kit and soldiers updated. */
  readonly company: Company;
  /** The reserve with any captured `reward.itemIds` added. */
  readonly inventory: DepotInventory;
  /** The timer that came home. */
  readonly dispatch: Dispatch;
  /** The authored contract whose reward was granted. */
  readonly contract: ContractDef;
  /** The reward payload, echoed for menus and tests. */
  readonly reward: ContractReward;
  /** Per-soldier Drill/Experience outcomes, in `dispatch.unitIds` order. */
  readonly units: readonly UnitDetachmentReward[];
  /** `rewardGranted` first, then each soldier's Drill and Experience events. */
  readonly events: readonly BattleEvent[];
}

/** The result of resolving several returns in one pass. */
export interface ResolvedDetachments {
  readonly company: Company;
  readonly inventory: DepotInventory;
  /** One entry per completed dispatch, in the order supplied. */
  readonly resolved: readonly ResolvedDetachment[];
  /** Every event from every resolution, concatenated in order. */
  readonly events: readonly BattleEvent[];
}

/** The result of {@link advanceDetachments}: time spent and the spoils collected. */
export interface DetachmentAdvance {
  readonly company: Company;
  readonly calendar: CampaignCalendar;
  readonly inventory: DepotInventory;
  /** The standing orders for the new day (T055). */
  readonly articles: DailyArticles;
  /** Parties whose return day was reached, in schedule order. */
  readonly completed: readonly Dispatch[];
  /** Their resolved rewards, in the same order. */
  readonly resolved: readonly ResolvedDetachment[];
  readonly events: readonly BattleEvent[];
}

/* --------------------------------------------------------------------------
 * Contract helpers
 * ------------------------------------------------------------------------ */

/**
 * The authored detachment contract for `contractId`, or `undefined` when the id
 * is unknown or names a contract of another kind (a battle is fought, not
 * dispatched). Safe to call with an untrusted id.
 */
export function detachmentOf(contractId: string): ContractDef | undefined {
  if (!isContractKey(contractId)) return undefined;
  const contract = getContract(contractId as ContractKey);
  return contract.kind === "detachment" ? contract : undefined;
}

/**
 * The authored contract's `duration` in campaign days. Always defined for a
 * detachment (T070 validates it), but narrowed here so callers do not have to
 * re-check.
 *
 * @throws RangeError when `contract` is not a detachment or has no duration.
 */
export function detachmentDuration(contract: ContractDef): number {
  if (contract.kind !== "detachment" || contract.duration === undefined) {
    throw new RangeError(`contract ${contract.id} is not a detachment`);
  }
  return contract.duration;
}

/**
 * How many soldiers the contract's `unit` requirement asks for. A detachment
 * with no `unit` gate needs only one soldier (a party is never empty); an
 * authored requirement raises the floor.
 */
export function requiredSoldiers(contract: ContractDef): number {
  return contract.requires
    .filter((requirement) => requirement.kind === "unit")
    .reduce((floor, requirement) => Math.max(floor, requirement.count), 1);
}

/* --------------------------------------------------------------------------
 * Sending a detachment
 * ------------------------------------------------------------------------ */

/**
 * Every reason `init` cannot be sent, in a stable order. An empty array means
 * {@link sendDetachment} will succeed.
 *
 * | Blocker                 | Rule                                                       |
 * | ----------------------- | ---------------------------------------------------------- |
 * | `unknown-contract`      | no authored contract carries that id                       |
 * | `not-a-detachment`      | the contract is a battle/skirmish/pacification, not a party |
 * | `empty-party`           | no soldiers were named                                     |
 * | `duplicate-soldier`     | the same soldier is listed twice                           |
 * | `unit-not-on-roster`    | a named soldier is not in the company                      |
 * | `unit-already-away`     | a named soldier is already out on another timer            |
 * | `duplicate-dispatch`    | that dispatch id is already running                        |
 * | `party-too-small`       | fewer soldiers than the contract's `unit` requirement      |
 * | `insufficient-crowns`   | the war chest cannot cover the contract fee                |
 *
 * @throws RangeError (via {@link assertId}) when an id is malformed.
 */
export function detachmentBlockers(
  company: Company,
  calendar: CampaignCalendar,
  init: DetachmentInit,
): readonly DetachmentBlocker[] {
  assertId(init.dispatchId, "detachment.dispatchId");
  assertId(init.contractId, "detachment.contractId");

  const blockers: DetachmentBlocker[] = [];
  const add = (blocker: DetachmentBlocker): void => {
    if (!blockers.includes(blocker)) blockers.push(blocker);
  };

  const contract = detachmentOf(init.contractId);
  if (contract === undefined) {
    add(isContractKey(init.contractId) ? "not-a-detachment" : "unknown-contract");
  }

  if (init.unitIds.length === 0) add("empty-party");

  const seen = new Set<string>();
  for (const unitId of init.unitIds) {
    assertId(unitId, "detachment.unitIds[]");
    if (seen.has(unitId)) {
      add("duplicate-soldier");
      continue;
    }
    seen.add(unitId);
    if (!hasMember(company, unitId)) add("unit-not-on-roster");
    else if (isUnitDispatched(calendar, unitId)) add("unit-already-away");
  }

  if (dispatchById(calendar, init.dispatchId) !== undefined) add("duplicate-dispatch");

  if (contract !== undefined) {
    if (init.unitIds.length < requiredSoldiers(contract)) add("party-too-small");
    if (!canAfford(company, contract.fee)) add("insufficient-crowns");
  }

  return blockers;
}

/** `true` when {@link sendDetachment} would accept `init`. */
export function canSendDetachment(
  company: Company,
  calendar: CampaignCalendar,
  init: DetachmentInit,
): boolean {
  return detachmentBlockers(company, calendar, init).length === 0;
}

/**
 * Send a party away on an Officers' Mess detachment contract. The contract fee
 * is paid from the war chest and a {@link Dispatch} is scheduled for the
 * contract's authored `duration`, returning on `calendar.day + duration`.
 *
 * ```ts
 * const { company: paid, calendar: away } = sendDetachment(company, calendar, {
 *   dispatchId: asDispatchId("dispatch-1"),
 *   contractId: asContractId("forage-the-valley"), // duration 4, fee 60
 *   unitIds: [asUnitId("unit-3"), asUnitId("unit-4")],
 * });
 * ```
 *
 * @throws RangeError when any {@link DetachmentBlocker} applies.
 */
export function sendDetachment(
  company: Company,
  calendar: CampaignCalendar,
  init: DetachmentInit,
): SentDetachment {
  const blockers = detachmentBlockers(company, calendar, init);
  if (blockers.length > 0) {
    throw new RangeError(`cannot send detachment ${init.dispatchId}: ${blockers.join(", ")}`);
  }

  // `detachmentBlockers` guarantees the contract exists and is a detachment.
  const contract = detachmentOf(init.contractId) as ContractDef;
  const paid = spendCrowns(company, contract.fee);
  const nextCalendar = scheduleDispatch(calendar, {
    id: init.dispatchId,
    contractId: init.contractId,
    unitIds: init.unitIds,
    duration: detachmentDuration(contract),
  });

  const dispatch = dispatchById(nextCalendar, init.dispatchId) as Dispatch;
  return { company: paid, calendar: nextCalendar, dispatch, contract };
}

/* --------------------------------------------------------------------------
 * Resolving a returning detachment
 * ------------------------------------------------------------------------ */

/**
 * Grant a returned detachment's contract reward: Crowns and Regimental Honours
 * to the company, captured kit to the reserve, and Drill plus Experience to
 * each participating soldier still on the roster.
 *
 * Awards are applied in `dispatch.unitIds` order; a soldier dismissed while
 * away is simply skipped (it is no longer there to collect). `tick` stamps the
 * emitted events and defaults to the dispatch's `returnDay`, so a campaign
 * replay carries the right date.
 *
 * @throws RangeError when the dispatch's contract is unknown or not a
 *   detachment, or when `tick` is not a non-negative integer.
 */
export function resolveDetachment(
  company: Company,
  inventory: DepotInventory,
  dispatch: Dispatch,
  tick: number = dispatch.returnDay,
): ResolvedDetachment {
  assertId(dispatch.id, "dispatch.id");
  assertId(dispatch.contractId, "dispatch.contractId");
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(`detachment tick must be a non-negative integer, received ${String(tick)}`);
  }

  const contract = detachmentOf(dispatch.contractId);
  if (contract === undefined) {
    throw new RangeError(
      `dispatch ${dispatch.id} names a contract that is not a detachment: ${String(dispatch.contractId)}`,
    );
  }

  const reward = contract.reward;
  let nextCompany = addCrowns(company, reward.crowns);
  nextCompany = awardHonours(nextCompany, reward.honours);

  // Captured kit: only authored items can be stored; a fixture/unknown id in a
  // reward is ignored rather than poisoning the reserve.
  let nextInventory = inventory;
  const grantedItemIds: string[] = [];
  for (const itemId of reward.itemIds) {
    if (!isEquipmentKey(itemId)) continue;
    nextInventory = addToInventory(nextInventory, asEquipmentId(itemId));
    grantedItemIds.push(itemId);
  }

  const roster: RosterMember[] = [...nextCompany.roster];
  const results: UnitDetachmentReward[] = [];
  const events: BattleEvent[] = [
    {
      kind: "rewardGranted",
      tick,
      crowns: reward.crowns,
      equipmentIds: grantedItemIds.map((itemId) => asEquipmentId(itemId)),
    },
  ];

  for (const unitId of dispatch.unitIds) {
    const index = roster.findIndex((member) => member.unit.id === unitId);
    if (index === -1) continue;
    const member = roster[index] as RosterMember;

    const drill = awardDrill(member.unit, reward.ap, tick);
    const experience = awardExperience(
      drill.unit,
      reward.experience,
      primaryPostGrowth(member.assignment),
      tick,
    );

    roster[index] = { ...member, unit: experience.unit };
    results.push({
      unitId,
      ap: reward.ap,
      experience: reward.experience,
      levelsGained: experience.levelsGained,
      abilitiesMastered: drill.mastered,
    });
    events.push(...drill.events, ...experience.events);
  }

  nextCompany = { ...nextCompany, roster };
  return {
    company: nextCompany,
    inventory: nextInventory,
    dispatch,
    contract,
    reward,
    units: results,
    events,
  };
}

/**
 * Resolve several returned detachments in one pure pass, threading the company
 * and reserve through each in order. Use this on the `completed` list returned
 * by {@link advanceCampaign} / `tickDispatches` (T076).
 */
export function resolveDetachments(
  company: Company,
  inventory: DepotInventory,
  dispatches: readonly Dispatch[],
): ResolvedDetachments {
  let nextCompany = company;
  let nextInventory = inventory;
  const resolved: ResolvedDetachment[] = [];
  const events: BattleEvent[] = [];

  for (const dispatch of dispatches) {
    const result = resolveDetachment(nextCompany, nextInventory, dispatch);
    nextCompany = result.company;
    nextInventory = result.inventory;
    resolved.push(result);
    events.push(...result.events);
  }

  return { company: nextCompany, inventory: nextInventory, resolved, events };
}

/* --------------------------------------------------------------------------
 * The whole round trip
 * ------------------------------------------------------------------------ */

/** Authoring input for {@link advanceDetachments}. */
export interface DetachmentAdvanceInit {
  readonly company: Company;
  readonly calendar: CampaignCalendar;
  readonly inventory?: DepotInventory;
  /** Days to advance; a positive integer, default `1`. */
  readonly days?: number;
}

/**
 * Spend `days` and resolve every detachment that comes home in one step. This
 * is the convenience the campaign controller (and T079's campaign tests) reads:
 * it advances the calendar and syncs the company (T076), then applies the
 * spoils of every completed party (this module).
 *
 * ```ts
 * const { company, calendar, inventory } = advanceDetachments({
 *   company,
 *   calendar,
 *   inventory,
 *   days: 4,
 * });
 * ```
 */
export function advanceDetachments(init: DetachmentAdvanceInit): DetachmentAdvance {
  const advance = advanceCampaign(init.company, init.calendar, init.days ?? 1);
  const resolution = resolveDetachments(
    advance.company,
    init.inventory ?? createDepotInventory(),
    advance.completed,
  );

  return {
    company: resolution.company,
    calendar: advance.calendar,
    inventory: resolution.inventory,
    articles: advance.articles,
    completed: advance.completed,
    resolved: resolution.resolved,
    events: resolution.events,
  };
}
