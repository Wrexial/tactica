/**
 * Campaign progression (T120) — the pure **reducer** that moves a
 * {@link CampaignSave} through the campaign loop: take a contract at the
 * Officers' Mess, settle a finished battle, and turn the page on the calendar.
 *
 * `agents.md` §7 makes a battle `seed + setup + command log` and a campaign the
 * same idea one level up: a serialisable {@link CampaignSave} plus an ordered
 * list of campaign actions. T101 defined the save and T068/T070/T072/T073/T076
 * authored the pieces it bundles (company, map, contracts, calendar, depot,
 * progress, history); this module is the missing seam that **applies** those
 * pieces to one another. Every function here is a value transformation —
 * `CampaignSave` in, a new `CampaignSave` out — so the campaign controller
 * (T121) can drive it, autosave the result and replay it exactly.
 *
 * ```
 *   acceptContract(save, contractId)
 *      ├─ pay the Officers' Mess entry fee            ── spendCrowns
 *      ├─ mark the contract posted                    ── progress.activeContractId
 *      └─ append a `contract-accepted` history entry
 *
 *   applyBattleOutcome(save, report)
 *      ├─ strike permanent losses from the roster      ── removeMember
 *      ├─ patch up casualties between actions
 *      ├─ on victory, grant the authored reward        ── Crowns / Honour / kit
 *      │                                              ── awardDrill / awardExperience
 *      ├─ mark the contract completed / clear the post ── progress
 *      ├─ open the next story chapter                  ── advanceChapter
 *      └─ append a `contract-completed` history entry
 *
 *   advanceCampaignDay(save, days)
 *      ├─ advance the clock, sync the company and
 *      │  resolve returning detachments                ── advanceDetachments (T072/T076)
 *      ├─ open any chapter the new day unlocks         ── advanceChapter
 *      └─ append a `day-advanced` history entry
 *
 *   dailyArticlesFor(save) ──► the day's Articles of War (T055), rotated by day
 * ```
 *
 * ## Why a reducer in `src/app/`
 *
 * The engine (`src/engine/`) stays a pure simulation with no knowledge of a
 * save file; `src/persist/` owns the serialisable {@link CampaignSave}. The
 * campaign **policy** — which contract to post, what a victory pays, how a
 * defeat is felt — is presentation-adjacent, so it lives in the controller
 * layer where T121 can own it next to the working state. Nothing here mutates
 * its input, reads the DOM, or draws randomness (`agents.md` §2).
 *
 * ## Determinism
 *
 * The only "randomness" in the campaign loop is the daily Articles of War,
 * which are derived from `(calendar.seed, calendar.day)` (T055) — so the same
 * save and the same ordered calls always produce a byte-identical result. The
 * reducers never call `Math.random` or read a clock.
 *
 * Reference: `docs/NAPOLEONIC_MAPPING.md` §5 (Crowns / Drill / Experience /
 * Honour), §10 (the campaign layer: Mess contracts, dispatch missions, the
 * calendar and daily laws) and D13 (an open contract sandbox with a story
 * spine). This is original fiction inspired by the Napoleonic Wars, not a port
 * of FFTA's save data.
 */

import { getContract, isContractKey } from "../data/contracts";
import { isEquipmentKey } from "../data/equipment";
import type { ContractDef } from "../data/schema";
import { advanceChapter } from "../data/story";

import type { BattleState } from "../engine/battle";
import {
  articlesForDay,
  type CampaignCalendar,
} from "../engine/calendar";
import {
  addCrowns,
  awardHonours,
  canAfford,
  removeMember,
  spendCrowns,
  type Company,
  type RosterMember,
} from "../engine/company";
import { advanceDetachments } from "../engine/detach";
import { addToInventory, type DepotInventory } from "../engine/depot";
import { BATTLE_OUTCOMES, type BattleOutcome } from "../engine/events";
import { asEquipmentId, type ContractId, type UnitId } from "../engine/ids";
import { awardDrill } from "../engine/progression/drill";
import { awardExperience } from "../engine/progression/level";
import { primaryPostGrowth } from "../engine/progression/posts";
import type { DailyArticles, DailyArticlesOptions } from "../engine/rules/articles";
import { isOutOfAction } from "../engine/unit";

import {
  createCampaignProgress,
  createCampaignSave,
  storyFactsOf,
  type CampaignHistoryEntry,
  type CampaignProgress,
  type CampaignSave,
} from "../persist/campaign";

/* --------------------------------------------------------------------------
 * Shared helpers
 * ------------------------------------------------------------------------ */

/**
 * A validated patch over a {@link CampaignSave}. Every field is optional and
 * omitted fields keep the value from the source save, so a reducer names only
 * the sections it touched and the untranslated sections keep structural
 * sharing.
 */
interface CampaignPatch {
  readonly company?: Company;
  readonly calendar?: CampaignCalendar;
  readonly inventory?: DepotInventory;
  readonly progress?: CampaignProgress;
  readonly history?: readonly CampaignHistoryEntry[];
}

/**
 * Rebuild a {@link CampaignSave} from `save` plus a {@link CampaignPatch}.
 * Always goes through {@link createCampaignSave}, so the result is canonical
 * and every field is re-validated at the trust boundary rather than trusted by
 * construction.
 */
function rebuild(save: CampaignSave, patch: CampaignPatch): CampaignSave {
  return createCampaignSave({
    seed: save.seed,
    company: patch.company ?? save.company,
    map: save.map,
    calendar: patch.calendar ?? save.calendar,
    inventory: patch.inventory ?? save.inventory,
    progress: patch.progress ?? save.progress,
    history: patch.history ?? save.history,
  });
}

/** The authored contract for `contractId`, or a loud error if this build does not know it. */
function requireContract(contractId: ContractId): ContractDef {
  if (!isContractKey(contractId)) {
    throw new RangeError(`unknown contract: ${String(contractId)}`);
  }
  return getContract(contractId);
}

/** Runtime guard for an untrusted battle outcome (a JSON report, a replay). */
function assertBattleOutcome(outcome: BattleOutcome): void {
  if (!(BATTLE_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new RangeError(`unknown battle outcome: ${String(outcome)}`);
  }
}

/** Deduplicate branded ids, first occurrence wins (stable order). */
function uniqueIds(ids: readonly UnitId[]): UnitId[] {
  const seen = new Set<string>();
  const unique: UnitId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

/** Open any story chapter the campaign's facts now reach (T077). Pure. */
function withAdvancedStory(progress: CampaignProgress, day: number): CampaignProgress {
  const chapter = advanceChapter(progress.chapter, storyFactsOf(progress, day));
  if (chapter === progress.chapter) return progress;
  return createCampaignProgress({
    chapter,
    activeContractId: progress.activeContractId,
    completedContractIds: progress.completedContractIds,
  });
}

/* --------------------------------------------------------------------------
 * Daily Articles of War
 * ------------------------------------------------------------------------ */

/**
 * The **Articles of War** in force on the save's current day (T055/T076). This
 * is a pure query: the posting is derived from `(calendar.seed, calendar.day)`,
 * so advancing the calendar **rotates** it automatically and no list has to be
 * stored in the save.
 *
 * ```ts
 * const before = dailyArticlesFor(campaign);
 * const after = dailyArticlesFor(advanceCampaignDay(campaign));
 * before.ids; // day 1's forbidding + commended orders
 * after.ids;  // day 2's, generated from the same seed
 * ```
 */
export function dailyArticlesFor(
  save: CampaignSave,
  options: DailyArticlesOptions = {},
): DailyArticles {
  return articlesForDay(save.calendar, options);
}

/* --------------------------------------------------------------------------
 * Accepting a contract
 * ------------------------------------------------------------------------ */

/** Why a contract cannot be posted right now (an empty array ⇒ it can). */
export type ContractAcceptanceBlocker =
  | "unknown-contract"
  | "already-active"
  | "insufficient-crowns";

/**
 * Every reason `contractId` cannot be accepted from `save`, in a stable order.
 *
 * | Blocker               | Rule                                              |
 * | --------------------- | ------------------------------------------------- |
 * | `unknown-contract`    | no authored contract carries that id              |
 * | `already-active`      | that contract is already the active posting       |
 * | `insufficient-crowns` | the war chest cannot cover the entry fee          |
 *
 * Posting **requirements** (item / post / unit / honour) and the story gate are
 * the Officers' Mess's job (T071) and the campaign integration tests (T079) —
 * this reducer owns the economy and the ledger, not the menu.
 */
export function contractAcceptanceBlockers(
  save: CampaignSave,
  contractId: ContractId,
): readonly ContractAcceptanceBlocker[] {
  if (!isContractKey(contractId)) return ["unknown-contract"];
  const contract = getContract(contractId);

  const blockers: ContractAcceptanceBlocker[] = [];
  if (save.progress.activeContractId === contractId) blockers.push("already-active");
  if (!canAfford(save.company, contract.fee)) blockers.push("insufficient-crowns");
  return blockers;
}

/** `true` when {@link acceptContract} would accept `contractId`. */
export function canAcceptContract(save: CampaignSave, contractId: ContractId): boolean {
  return contractAcceptanceBlockers(save, contractId).length === 0;
}

/**
 * Accept a contract from the Officers' Mess: pay its entry fee out of the war
 * chest, mark it the active posting and record the acceptance in the campaign
 * history.
 *
 * The returned save is a **new** value built through {@link createCampaignSave};
 * `save` and every value reachable from it are untouched.
 *
 * ```ts
 * const posted = acceptContract(campaign, asContractId("take-the-mill"));
 * posted.company.crowns;              // fee paid
 * posted.progress.activeContractId;   // "take-the-mill"
 * ```
 *
 * @throws RangeError when any {@link ContractAcceptanceBlocker} applies.
 */
export function acceptContract(save: CampaignSave, contractId: ContractId): CampaignSave {
  const blockers = contractAcceptanceBlockers(save, contractId);
  if (blockers.length > 0) {
    throw new RangeError(
      `cannot accept contract ${String(contractId)}: ${blockers.join(", ")}`,
    );
  }

  const contract = requireContract(contractId);
  const company = spendCrowns(save.company, contract.fee);
  const progress = createCampaignProgress({
    chapter: save.progress.chapter,
    activeContractId: contractId,
    completedContractIds: save.progress.completedContractIds,
  });
  const history: readonly CampaignHistoryEntry[] = [
    ...save.history,
    { kind: "contract-accepted", day: save.calendar.day, contractId },
  ];

  return rebuild(save, { company, progress, history });
}

/* --------------------------------------------------------------------------
 * Applying a finished battle
 * ------------------------------------------------------------------------ */

/**
 * The serialisable summary of a finished battle the campaign reducer consumes.
 *
 * The engine's {@link BattleState} is a full battlefield (terrain, tempo,
 * pending charges); the campaign only needs the **decisions** it produced. A
 * report is that small value, so a controller can build it from a live battle
 * with {@link battleReportFromState} — or from a replay or a save — without
 * carrying the board into the campaign layer.
 */
export interface BattleReport {
  /** The contract the detachment fought under (must be authored). */
  readonly contractId: ContractId;
  /** How the action finished, from the company's point of view (T031). */
  readonly outcome: BattleOutcome;
  /**
   * Soldiers who took the field, in roster order. On a victory each receives
   * the contract's Drill and Experience. Defaults to the whole remaining
   * roster, so a company action without a detailed roster still trains.
   */
  readonly participantIds?: readonly UnitId[];
  /**
   * Soldiers still out of action when the action ended. They are **recovered**
   * between actions (the FFTA "Judges protect the fallen" case, T065); only
   * {@link lostIds} leaves the roster.
   */
  readonly casualtyIds?: readonly UnitId[];
  /**
   * Soldiers permanently lost (a No-Man's Land knockout, a court-martial) and
   * struck from the roster, mirroring `resolveAftermath` (T065) / `removeMember`
   * (T068).
   */
  readonly lostIds?: readonly UnitId[];
}

/** Optional context for {@link battleReportFromState}. */
export interface BattleReportOptions {
  /**
   * Soldiers to strike from the campaign roster as permanent losses. The
   * battle state cannot know the region's law, so the caller supplies the ids
   * `resolveAftermath` reported (T065).
   */
  readonly lostIds?: readonly UnitId[];
}

/**
 * Read a {@link BattleReport} out of a **finished** {@link BattleState}. Every
 * company soldier is a participant; everyone still out of action is a
 * casualty; and `options.lostIds` names the permanent losses.
 *
 * ```ts
 * const { lostIds } = resolveAftermath(field, battle.units);
 * const report = battleReportFromState(battle, contractId, { lostIds });
 * ```
 *
 * @throws RangeError when the battle has not finished (no outcome to apply).
 */
export function battleReportFromState(
  state: BattleState,
  contractId: ContractId,
  options: BattleReportOptions = {},
): BattleReport {
  if (state.phase !== "finished" || state.outcome === null) {
    throw new RangeError("battleReportFromState requires a finished battle with an outcome");
  }
  const companyUnits = state.units.filter((unit) => unit.side === "company");
  return {
    contractId,
    outcome: state.outcome,
    participantIds: companyUnits.map((unit) => unit.id),
    casualtyIds: companyUnits.filter((unit) => isOutOfAction(unit)).map((unit) => unit.id),
    lostIds: options.lostIds ?? [],
  };
}

/** Patch every casualty on the roster back to full health and Élan (pure). */
function recoverCasualties(company: Company, casualtyIds: readonly UnitId[]): Company {
  if (casualtyIds.length === 0) return company;
  const wanted = new Set<string>(casualtyIds);
  let changed = false;
  const roster = company.roster.map((member): RosterMember => {
    if (!wanted.has(member.unit.id)) return member;
    const { hp, mp, stats } = member.unit;
    if (hp === stats.hp && mp === stats.mp) return member;
    changed = true;
    return { ...member, unit: { ...member.unit, hp: stats.hp, mp: stats.mp } };
  });
  return changed ? { ...company, roster } : company;
}

/**
 * Grant an authored contract reward to a company and its kit reserve: Crowns,
 * Regimental Honours, captured kit, and per-soldier Drill and Experience for
 * the named participants. Unknown/foreign reward ids are skipped (a fixture
 * reward must not poison the reserve), matching `resolveDetachment` (T072).
 */
function grantContractReward(
  company: Company,
  inventory: DepotInventory,
  contract: ContractDef,
  participantIds: readonly UnitId[],
  day: number,
): { readonly company: Company; readonly inventory: DepotInventory } {
  const reward = contract.reward;

  let nextInventory = inventory;
  for (const itemId of reward.itemIds) {
    if (!isEquipmentKey(itemId)) continue;
    nextInventory = addToInventory(nextInventory, asEquipmentId(itemId));
  }

  let nextCompany = addCrowns(company, reward.crowns);
  nextCompany = awardHonours(nextCompany, reward.honours);

  const rewarded = new Set<string>(participantIds);
  const roster = nextCompany.roster.map((member): RosterMember => {
    if (!rewarded.has(member.unit.id)) return member;
    const drill = awardDrill(member.unit, reward.ap, day);
    const experience = awardExperience(
      drill.unit,
      reward.experience,
      primaryPostGrowth(member.assignment),
      day,
    );
    return { ...member, unit: experience.unit };
  });

  return { company: { ...nextCompany, roster }, inventory: nextInventory };
}

/**
 * Apply a finished battle's outcome to the campaign.
 *
 * - **Permanent losses** (`report.lostIds`) leave the roster first, so a lost
 *   soldier collects nothing.
 * - **Casualties** are patched back to full health and Élan between actions.
 * - On **victory** the contract's authored reward is granted and the contract
 *   joins the completed ledger; on defeat or draw nothing is paid.
 * - The active posting is cleared, the story chapter is advanced against the
 *   new facts (T077) and a `contract-completed` entry is appended on victory.
 *
 * Pure: `save` is never mutated and no randomness is drawn. The result is a
 * fresh, validated {@link CampaignSave}.
 *
 * @throws RangeError when the contract is unauthored, the outcome is unknown,
 *   or a report references malformed ids.
 */
export function applyBattleOutcome(save: CampaignSave, report: BattleReport): CampaignSave {
  const contract = requireContract(report.contractId);
  assertBattleOutcome(report.outcome);

  const day = save.calendar.day;
  const victory = report.outcome === "companyVictory";

  // 1. Permanent losses leave the roster (mapping §9 — No-Man's Land KOs).
  let company = save.company;
  for (const unitId of uniqueIds(report.lostIds ?? [])) {
    company = removeMember(company, unitId);
  }

  // 2. The wounded are recovered; a casualty is not a permanent loss.
  company = recoverCasualties(company, uniqueIds(report.casualtyIds ?? []));

  // 3. On a victory, pay the contract and train the participants.
  let inventory = save.inventory;
  if (victory) {
    const participants =
      report.participantIds === undefined
        ? company.roster.map((member) => member.unit.id)
        : uniqueIds(report.participantIds);
    const granted = grantContractReward(company, inventory, contract, participants, day);
    company = granted.company;
    inventory = granted.inventory;
  }

  // 4. Update the ledger and open any reachable story beat.
  const completedContractIds = victory
    ? [
        ...save.progress.completedContractIds.filter((id) => id !== report.contractId),
        report.contractId,
      ]
    : save.progress.completedContractIds;
  const activeContractId =
    save.progress.activeContractId === report.contractId
      ? null
      : save.progress.activeContractId;
  const progress = withAdvancedStory(
    createCampaignProgress({
      chapter: save.progress.chapter,
      activeContractId,
      completedContractIds,
    }),
    day,
  );

  const history: readonly CampaignHistoryEntry[] = victory
    ? [...save.history, { kind: "contract-completed", day, contractId: report.contractId }]
    : save.history;

  return rebuild(save, { company, inventory, progress, history });
}

/* --------------------------------------------------------------------------
 * Advancing the day
 * ------------------------------------------------------------------------ */

/**
 * Spend `days` (default `1`) on the campaign clock: advance the calendar, sync
 * the company's theatre to it, resolve any detachments that came home (T072),
 * open any story beat the new day unlocks (T077) and record a `day-advanced`
 * history entry.
 *
 * Because the Articles of War are generated from `(seed, day)`, the new day's
 * standing orders are already in force when this returns — see
 * {@link dailyArticlesFor}. Detachment rewards and Crowns are threaded through
 * the returned save exactly as `advanceDetachments` produced them.
 *
 * Pure and deterministic; the input save is never mutated.
 *
 * @throws RangeError when `days` is not a positive integer.
 */
export function advanceCampaignDay(save: CampaignSave, days = 1): CampaignSave {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`days must be a positive integer, received ${String(days)}`);
  }

  const advanced = advanceDetachments({
    company: save.company,
    calendar: save.calendar,
    inventory: save.inventory,
    days,
  });

  const day = advanced.calendar.day;
  const progress = withAdvancedStory(save.progress, day);
  const history: readonly CampaignHistoryEntry[] = [
    ...save.history,
    { kind: "day-advanced", day, days },
  ];

  return rebuild(save, {
    company: advanced.company,
    calendar: advanced.calendar,
    inventory: advanced.inventory,
    progress,
    history,
  });
}
