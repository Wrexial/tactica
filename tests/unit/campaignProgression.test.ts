import { describe, expect, it } from "vitest";

import {
  acceptContract,
  advanceCampaignDay,
  applyBattleOutcome,
  battleReportFromState,
  canAcceptContract,
  contractAcceptanceBlockers,
  dailyArticlesFor,
  type BattleReport,
} from "../../src/app/campaign";

import { createCalendar } from "../../src/engine/calendar";
import { createCampaignMap } from "../../src/engine/campaignMap";
import { createCompany } from "../../src/engine/company";
import { createTerrainMap } from "../../src/engine/terrain";
import { createDepotInventory } from "../../src/engine/depot";
import { coord } from "../../src/engine/grid";
import {
  asCompanyId,
  asContractId,
  asEquipmentId,
  asPostId,
  asUnitId,
  type EquipmentId,
} from "../../src/engine/ids";
import { createPostAssignment, derivePostStats } from "../../src/engine/progression/posts";
import { createBattle, type BattleState } from "../../src/engine/battle";
import { createUnit, type Unit } from "../../src/engine/unit";
import type { EquipSlot } from "../../src/data/schema";

import {
  createCampaignProgress,
  createCampaignSave,
  serializeCampaign,
  type CampaignSave,
} from "../../src/persist/campaign";

/* --------------------------------------------------------------------------
 * T120 — Campaign progression: accept, outcome, day
 *
 * Pins the task's "done when": pure functions over a {@link CampaignSave}
 * 1. **accept** a contract (pay the fee, mark it posted),
 * 2. **apply** a finished battle's outcome (Crowns/Drill/XP/kit, Honour,
 *    casualties and removals), and
 * 3. **advance** the day, rotating the daily Articles of War,
 *
 * each returning a new save with no mutation and no randomness.
 *
 * The fixtures use real authored content: `take-the-mill` is an ungated battle
 * (fee 200; reward 950 Crowns / 50 Drill / 40 XP / 1 Honour / `mining-tools`)
 * and `break-the-bridge` is the chapter-1 story battle (fee 250). The cavalry
 * sabre teaches Riposte at 80 Drill, so a reward's Drill is observable.
 * ------------------------------------------------------------------------ */

/** One authored soldier, with optional kit and a starting wound. */
function soldier(
  id: string,
  options: { equipment?: Partial<Record<EquipSlot, string>>; hp?: number } = {},
) {
  const assignment = createPostAssignment({
    primaryPostId: asPostId("fusilier"),
    power: "france",
  });
  const equipment = Object.fromEntries(
    Object.entries(options.equipment ?? {}).map(([slot, itemId]) => [
      slot,
      asEquipmentId(itemId as string),
    ]),
  ) as Partial<Record<EquipSlot, EquipmentId>>;

  const unit = createUnit({
    id: asUnitId(id),
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at: coord(0, 0),
    stats: derivePostStats({ level: 1, assignment }),
    equipment,
    ...(options.hp !== undefined ? { hp: options.hp } : {}),
  });
  return { unit, assignment, recruitedOnDay: 1 };
}

/** A three-strong company: a learner, a casualty and a spare. */
function campaign(
  options: { crowns?: number; honours?: number; day?: number; chapter?: number } = {},
): CampaignSave {
  const day = options.day ?? 1;
  const company = createCompany({
    id: asCompanyId("company-greycoats"),
    name: "The Greycoats",
    crowns: options.crowns ?? 1000,
    honours: options.honours ?? 0,
    roster: [
      soldier("unit-1", { equipment: { weapon: "cavalry-sabre" } }),
      soldier("unit-2", { hp: 0 }),
      soldier("unit-3"),
    ],
    theatre: { day },
  });

  return createCampaignSave({
    seed: "campaign-1815",
    company,
    map: createCampaignMap({ width: 4, height: 4 }),
    calendar: createCalendar({ seed: "campaign-1815", day }),
    inventory: createDepotInventory(),
    progress: createCampaignProgress({ chapter: options.chapter ?? 0 }),
    history: [],
  });
}

const TAKE_THE_MILL = asContractId("take-the-mill");
const BREAK_THE_BRIDGE = asContractId("break-the-bridge");

/** The deployed company soldiers, on distinct tiles, for a finished battle. */
function battleUnitsFrom(save: CampaignSave): Unit[] {
  return save.company.roster.map((member, index) =>
    createUnit({ ...member.unit, at: coord(index, 0) }),
  );
}

/** A finished battle state reporting `outcome` for the report helper. */
function finishedBattle(save: CampaignSave, outcome: BattleState["outcome"]): BattleState {
  const battle = createBattle("battle-seed", {
    map: createTerrainMap(6, 4, "field"),
    units: battleUnitsFrom(save),
  });
  return { ...battle, phase: "finished", outcome };
}

/* --------------------------------------------------------------------------
 * Accepting a contract
 * ------------------------------------------------------------------------ */

describe("acceptContract", () => {
  it("pays the fee, marks the contract posted and appends history", () => {
    const before = campaign();
    const after = acceptContract(before, TAKE_THE_MILL);

    expect(after.company.crowns).toBe(800); // 1000 − 200 fee
    expect(after.progress.activeContractId).toBe(TAKE_THE_MILL);
    expect(after.history).toEqual([
      { kind: "contract-accepted", day: 1, contractId: TAKE_THE_MILL },
    ]);

    // Pure: the source save is untouched.
    expect(before.company.crowns).toBe(1000);
    expect(before.progress.activeContractId).toBeNull();
    expect(before.history).toEqual([]);
  });

  it("refuses an unknown contract, a double posting and an unaffordable fee", () => {
    const poor = campaign({ crowns: 100 });
    expect(contractAcceptanceBlockers(poor, asContractId("no-such-contract"))).toEqual([
      "unknown-contract",
    ]);
    expect(contractAcceptanceBlockers(poor, TAKE_THE_MILL)).toContain("insufficient-crowns");
    expect(canAcceptContract(poor, TAKE_THE_MILL)).toBe(false);
    expect(() => acceptContract(poor, TAKE_THE_MILL)).toThrow(/insufficient-crowns/);

    const posted = acceptContract(campaign(), TAKE_THE_MILL);
    expect(contractAcceptanceBlockers(posted, TAKE_THE_MILL)).toContain("already-active");
    expect(canAcceptContract(posted, TAKE_THE_MILL)).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Applying a victory
 * ------------------------------------------------------------------------ */

describe("applyBattleOutcome — victory", () => {
  it("grants Crowns, Honour, Drill, Experience and captured kit", () => {
    const accepted = acceptContract(campaign(), TAKE_THE_MILL);
    const report: BattleReport = {
      contractId: TAKE_THE_MILL,
      outcome: "companyVictory",
      participantIds: [asUnitId("unit-1"), asUnitId("unit-2")],
      casualtyIds: [],
      lostIds: [],
    };

    const after = applyBattleOutcome(accepted, report);

    // Fee paid (800) plus the authored reward (950 Crowns, 1 Honour, 1 item).
    expect(after.company.crowns).toBe(1750);
    expect(after.company.honours).toBe(1);
    expect(after.inventory).toEqual({ "mining-tools": 1 });
    expect(after.progress.activeContractId).toBeNull();
    expect(after.progress.completedContractIds).toEqual([TAKE_THE_MILL]);
    expect(after.history).toEqual([
      { kind: "contract-accepted", day: 1, contractId: TAKE_THE_MILL },
      { kind: "contract-completed", day: 1, contractId: TAKE_THE_MILL },
    ]);

    // The learner banked the reward's 50 Drill toward Riposte (80 required)…
    const learner = after.company.roster.find((member) => member.unit.id === asUnitId("unit-1"));
    expect(learner?.unit.abilities).toEqual([
      { abilityId: "riposte", drill: 50, mastered: false },
    ]);
    expect(learner?.unit.experience).toBe(40);

    // …and the soldier left in reserve trained for nothing.
    const reserve = after.company.roster.find((member) => member.unit.id === asUnitId("unit-3"));
    expect(reserve?.unit.experience).toBe(0);

    // Pure: accepting and resolving never mutate the earlier save.
    expect(accepted.company.crowns).toBe(800);
    expect(accepted.progress.completedContractIds).toEqual([]);
  });

  it("masteries a teaching ability when the reward crosses its Drill cost", () => {
    let save = acceptContract(campaign(), TAKE_THE_MILL);
    save = applyBattleOutcome(save, {
      contractId: TAKE_THE_MILL,
      outcome: "companyVictory",
      participantIds: [asUnitId("unit-1")],
    });
    // 50 Drill from `take-the-mill`, then 60 from `break-the-bridge` = 110 ≥ 80.
    save = acceptContract(save, BREAK_THE_BRIDGE);
    save = applyBattleOutcome(save, {
      contractId: BREAK_THE_BRIDGE,
      outcome: "companyVictory",
      participantIds: [asUnitId("unit-1")],
    });

    const learner = save.company.roster.find((member) => member.unit.id === asUnitId("unit-1"));
    expect(learner?.unit.abilities).toEqual([{ abilityId: "riposte", drill: 80, mastered: true }]);
  });
});

/* --------------------------------------------------------------------------
 * Applying a loss / an objective failure
 * ------------------------------------------------------------------------ */

describe("applyBattleOutcome — defeat", () => {
  it("grants nothing, recovers casualties and strikes permanent losses", () => {
    const accepted = acceptContract(campaign(), TAKE_THE_MILL);
    const report: BattleReport = {
      contractId: TAKE_THE_MILL,
      outcome: "companyDefeat",
      participantIds: [asUnitId("unit-1"), asUnitId("unit-2")],
      casualtyIds: [asUnitId("unit-2")],
      lostIds: [asUnitId("unit-3")],
    };

    const after = applyBattleOutcome(accepted, report);

    expect(after.company.crowns).toBe(800); // the fee is gone, no reward paid
    expect(after.company.honours).toBe(0);
    expect(after.inventory).toEqual({});
    expect(after.progress.activeContractId).toBeNull();
    expect(after.progress.completedContractIds).toEqual([]);
    expect(after.history).toEqual(accepted.history); // no completion entry

    // The permanently lost soldier is struck; the casualty survives and refits.
    expect(after.company.roster.map((member) => member.unit.id)).toEqual([
      asUnitId("unit-1"),
      asUnitId("unit-2"),
    ]);
    const casualty = after.company.roster.find((member) => member.unit.id === asUnitId("unit-2"));
    expect(casualty?.unit.hp).toBe(casualty?.unit.stats.hp);
    expect(casualty?.unit.experience).toBe(0);
  });

  it("treats an objective failure as a defeat when read from a finished battle", () => {
    const accepted = acceptContract(campaign(), TAKE_THE_MILL);
    const battle = finishedBattle(accepted, "companyDefeat");

    const report = battleReportFromState(battle, TAKE_THE_MILL);
    expect(report.outcome).toBe("companyDefeat");
    expect(report.participantIds).toHaveLength(3);
    expect(report.casualtyIds).toEqual([asUnitId("unit-2")]);

    const after = applyBattleOutcome(accepted, report);
    expect(after.company.crowns).toBe(800);
    expect(after.progress.completedContractIds).toEqual([]);
    const casualty = after.company.roster.find((member) => member.unit.id === asUnitId("unit-2"));
    expect(casualty?.unit.hp).toBe(casualty?.unit.stats.hp);
  });

  it("refuses to read a report from a battle that is still running", () => {
    const accepted = acceptContract(campaign(), TAKE_THE_MILL);
    const running = createBattle("battle-seed", {
      map: createTerrainMap(6, 4, "field"),
      units: battleUnitsFrom(accepted),
    });
    expect(() => battleReportFromState(running, TAKE_THE_MILL)).toThrow(/finished/);
  });

  it("advances the story chapter as a completed contract opens the next beat", () => {
    const accepted = acceptContract(campaign(), BREAK_THE_BRIDGE);
    const after = applyBattleOutcome(accepted, {
      contractId: BREAK_THE_BRIDGE,
      outcome: "companyVictory",
    });
    // Chapter 1 (start) then chapter 2 (bridge completed) are both reachable.
    expect(after.progress.completedContractIds).toContain(BREAK_THE_BRIDGE);
    expect(after.progress.chapter).toBeGreaterThanOrEqual(2);
  });
});

/* --------------------------------------------------------------------------
 * Advancing the day
 * ------------------------------------------------------------------------ */

describe("advanceCampaignDay", () => {
  it("advances the clock, syncs the company, appends history and rotates the Articles", () => {
    const before = campaign();
    const beforeArticles = dailyArticlesFor(before);

    const after = advanceCampaignDay(before, 1);

    expect(after.calendar.day).toBe(2);
    expect(after.company.theatre.day).toBe(2);
    expect(after.history).toEqual([{ kind: "day-advanced", day: 2, days: 1 }]);

    const afterArticles = dailyArticlesFor(after);
    expect(afterArticles.day).toBe(2);
    // The posting is generated from (seed, day); a new day means a new posting.
    expect(afterArticles.ids).not.toEqual(beforeArticles.ids);

    // Pure: the source save and its calendar are untouched.
    expect(before.calendar.day).toBe(1);
    expect(before.company.theatre.day).toBe(1);
    expect(before.history).toEqual([]);
  });

  it("spends several days at once and records the jump", () => {
    const after = advanceCampaignDay(campaign(), 4);
    expect(after.calendar.day).toBe(5);
    expect(after.company.theatre.day).toBe(5);
    expect(after.history).toEqual([{ kind: "day-advanced", day: 5, days: 4 }]);
    expect(() => advanceCampaignDay(campaign(), 0)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * The whole loop — purity & determinism
 * ------------------------------------------------------------------------ */

describe("campaign loop", () => {
  it("replays the accept → resolve → advance loop deterministically and immutably", () => {
    const run = (): CampaignSave => {
      let save = acceptContract(campaign(), TAKE_THE_MILL);
      save = applyBattleOutcome(save, {
        contractId: TAKE_THE_MILL,
        outcome: "companyVictory",
        participantIds: [asUnitId("unit-1"), asUnitId("unit-2")],
      });
      return advanceCampaignDay(save);
    };

    const first = run();
    const second = run();

    expect(serializeCampaign(first)).toBe(serializeCampaign(second));
    expect(createCampaignSave(first)).toEqual(first);
    expect(first.history.map((entry) => entry.kind)).toEqual([
      "contract-accepted",
      "contract-completed",
      "day-advanced",
    ]);
    expect(first.calendar.day).toBe(2);
  });
});
