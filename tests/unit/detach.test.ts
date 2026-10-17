import { describe, expect, it } from "vitest";

import { POSTS } from "../../src/data/posts";
import { CONTRACTS } from "../../src/data/contracts";

import { createCalendar, scheduleDispatch, type CampaignCalendar } from "../../src/engine/calendar";
import { createCompany, memberOf, travelTo, type Company, type RosterMemberInit } from "../../src/engine/company";
import {
  advanceDetachments,
  canSendDetachment,
  detachmentBlockers,
  detachmentDuration,
  detachmentOf,
  requiredSoldiers,
  resolveDetachment,
  resolveDetachments,
  sendDetachment,
  type DetachmentInit,
} from "../../src/engine/detach";
import { createDepotInventory, inventoryCount } from "../../src/engine/depot";
import { coord } from "../../src/engine/grid";
import {
  asAbilityId,
  asCompanyId,
  asContractId,
  asDispatchId,
  asEquipmentId,
  asPostId,
  asRegionId,
  asUnitId,
  type EquipmentId,
  type UnitId,
} from "../../src/engine/ids";
import { createPostAssignment } from "../../src/engine/progression/posts";
import { deriveStats } from "../../src/engine/stats";
import { createUnit, type LearnedAbility, type Unit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T072 — Detachments
 *
 * Pins the task's "done when": send unit(s) away for N days and resolve the
 * contract reward on return. The tests also lock down the guarantees the
 * campaign layer leans on: sends are gated, the fee is paid once, a return
 * credits Crowns/Honours/kit and the participating soldiers' Drill and
 * Experience, and every step is pure and deterministic.
 * ------------------------------------------------------------------------ */

const FORAGE = asContractId("forage-the-valley"); // duration 4, fee 60, requires 2 soldiers
const RECONNOITRE = asContractId("reconnoitre-the-ridge"); // duration 3, fee 50, 1 soldier
const SKIRMISH = asContractId("crossed-sabres"); // not a detachment

function unitId(name: string): UnitId {
  return asUnitId(name);
}

function makeSoldier(
  id: string,
  options: {
    experience?: number;
    abilities?: readonly LearnedAbility[];
    equipmentWeapon?: EquipmentId;
  } = {},
): Unit {
  return createUnit({
    id: unitId(id),
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at: coord(0, 0),
    stats: deriveStats({ level: 1, growth: POSTS.fusilier.growth }),
    experience: options.experience,
    abilities: options.abilities,
    equipment: options.equipmentWeapon ? { weapon: options.equipmentWeapon } : undefined,
  });
}

function makeMember(id: string, options: Parameters<typeof makeSoldier>[1] = {}): RosterMemberInit {
  return {
    unit: makeSoldier(id, options),
    assignment: createPostAssignment({ primaryPostId: asPostId("fusilier"), power: "france" }),
  };
}

function makeCompany(count = 3, crowns = 1000): Company {
  return createCompany({
    id: asCompanyId("company-1"),
    name: "The Greycoats",
    crowns,
    roster: Array.from({ length: count }, (_, index) => makeMember(`unit-${index + 1}`)),
  });
}

function makeCalendar(day = 1): CampaignCalendar {
  return createCalendar({ seed: "campaign", day, regionId: asRegionId("blackwood") });
}

function sendInit(overrides: Partial<DetachmentInit> = {}): DetachmentInit {
  return {
    dispatchId: asDispatchId("dispatch-1"),
    contractId: FORAGE,
    unitIds: [unitId("unit-1"), unitId("unit-2")],
    ...overrides,
  };
}

/* --------------------------------------------------------------------------
 * Contract helpers
 * ------------------------------------------------------------------------ */

describe("detachmentOf / detachmentDuration / requiredSoldiers", () => {
  it("recognises an authored detachment contract", () => {
    const contract = detachmentOf(FORAGE);
    expect(contract).toBeDefined();
    expect(contract?.kind).toBe("detachment");
    expect(contract?.id).toBe("forage-the-valley");
  });

  it("rejects an unknown id and a non-detachment contract", () => {
    expect(detachmentOf("not-a-contract")).toBeUndefined();
    expect(detachmentOf(SKIRMISH)).toBeUndefined();
  });

  it("reads the authored duration and rejects a non-detachment", () => {
    expect(detachmentDuration(CONTRACTS["forage-the-valley"])).toBe(4);
    expect(detachmentDuration(CONTRACTS["reconnoitre-the-ridge"])).toBe(3);
    expect(() => detachmentDuration(CONTRACTS["crossed-sabres"])).toThrowError(/not a detachment/);
  });

  it("derives the soldier floor from the contract's unit requirement", () => {
    expect(requiredSoldiers(CONTRACTS["forage-the-valley"])).toBe(2);
    expect(requiredSoldiers(CONTRACTS["escort-the-pay-chest"])).toBe(3);
    // No `unit` gate means a party of one is legal.
    expect(requiredSoldiers(CONTRACTS["reconnoitre-the-ridge"])).toBe(1);
  });
});

/* --------------------------------------------------------------------------
 * Sending
 * ------------------------------------------------------------------------ */

describe("sendDetachment", () => {
  it("pays the fee and schedules a timer for the authored duration", () => {
    const company = makeCompany(3, 500);
    const calendar = makeCalendar(2);
    const sent = sendDetachment(company, calendar, sendInit());

    expect(sent.company.crowns).toBe(500 - CONTRACTS["forage-the-valley"].fee);
    expect(sent.calendar.day).toBe(2);
    expect(sent.calendar.dispatches).toHaveLength(1);
    expect(sent.dispatch.contractId).toBe(FORAGE);
    expect(sent.dispatch.dispatchedOnDay).toBe(2);
    expect(sent.dispatch.duration).toBe(4);
    expect(sent.dispatch.returnDay).toBe(6);
    expect(sent.dispatch.unitIds).toEqual([unitId("unit-1"), unitId("unit-2")]);
  });

  it("is pure: the input company and calendar are untouched", () => {
    const company = makeCompany();
    const calendar = makeCalendar(1);
    sendDetachment(company, calendar, sendInit());
    expect(company.crowns).toBe(1000);
    expect(calendar.dispatches).toHaveLength(0);
  });

  it("allows a one-soldier contract with no unit requirement", () => {
    const sent = sendDetachment(makeCompany(), makeCalendar(1), {
      dispatchId: asDispatchId("dispatch-scout"),
      contractId: RECONNOITRE,
      unitIds: [unitId("unit-1")],
    });
    expect(sent.dispatch.duration).toBe(3);
    expect(canSendDetachment(sent.company, sent.calendar, {
      dispatchId: asDispatchId("dispatch-2"),
      contractId: RECONNOITRE,
      unitIds: [unitId("unit-2")],
    })).toBe(true);
  });
});

describe("detachmentBlockers", () => {
  it("reports an unknown contract", () => {
    expect(
      detachmentBlockers(makeCompany(), makeCalendar(), {
        ...sendInit(),
        contractId: asContractId("does-not-exist"),
      }),
    ).toContain("unknown-contract");
  });

  it("refuses a non-detachment contract", () => {
    expect(
      detachmentBlockers(makeCompany(), makeCalendar(), {
        ...sendInit(),
        contractId: SKIRMISH,
      }),
    ).toContain("not-a-detachment");
  });

  it("reports an empty or under-strength party", () => {
    expect(detachmentBlockers(makeCompany(), makeCalendar(), sendInit({ unitIds: [] }))).toContain(
      "empty-party",
    );
    expect(
      detachmentBlockers(makeCompany(), makeCalendar(), sendInit({ unitIds: [unitId("unit-1")] })),
    ).toContain("party-too-small");
  });

  it("reports a duplicate soldier", () => {
    expect(
      detachmentBlockers(
        makeCompany(),
        makeCalendar(),
        sendInit({ unitIds: [unitId("unit-1"), unitId("unit-1")] }),
      ),
    ).toContain("duplicate-soldier");
  });

  it("reports a soldier who is not on the roster", () => {
    expect(
      detachmentBlockers(
        makeCompany(),
        makeCalendar(),
        sendInit({ unitIds: [unitId("unit-1"), unitId("unit-9")] }),
      ),
    ).toContain("unit-not-on-roster");
  });

  it("reports a soldier who is already away, or a duplicate dispatch id", () => {
    const calendar = scheduleDispatch(makeCalendar(), {
      id: asDispatchId("dispatch-1"),
      contractId: FORAGE,
      unitIds: [unitId("unit-1"), unitId("unit-2")],
      duration: 4,
    });
    expect(detachmentBlockers(makeCompany(), calendar, sendInit())).toContain("duplicate-dispatch");
    expect(
      detachmentBlockers(
        makeCompany(),
        calendar,
        sendInit({ dispatchId: asDispatchId("dispatch-2") }),
      ),
    ).toContain("unit-already-away");
  });

  it("reports when the war chest cannot cover the fee", () => {
    const broke = makeCompany(3, 0);
    expect(detachmentBlockers(broke, makeCalendar(), sendInit())).toContain("insufficient-crowns");
  });

  it("throws on a malformed dispatch id", () => {
    expect(() =>
      detachmentBlockers(makeCompany(), makeCalendar(), sendInit({ dispatchId: "" as never })),
    ).toThrow();
  });
});

/* --------------------------------------------------------------------------
 * Resolving a return
 * ------------------------------------------------------------------------ */

describe("resolveDetachment", () => {
  it("grants Crowns, Honours, captured kit and per-soldier Drill/Experience", () => {
    const company = makeCompany(3, 100);
    const calendar = sendDetachment(company, makeCalendar(1), sendInit()).calendar;
    const dispatch = calendar.dispatches[0]!;
    const inventory = createDepotInventory();

    const resolved = resolveDetachment(company, inventory, dispatch);

    expect(resolved.reward.crowns).toBe(CONTRACTS["forage-the-valley"].reward.crowns);
    expect(resolved.company.crowns).toBe(100 + CONTRACTS["forage-the-valley"].reward.crowns);
    expect(inventoryCount(resolved.inventory, "water-canteen")).toBe(1);
    expect(resolved.units.map((unit) => unit.unitId)).toEqual([unitId("unit-1"), unitId("unit-2")]);
    // The third soldier did not go and gains nothing.
    expect(resolved.units).toHaveLength(2);
    expect(
      memberOf(resolved.company, unitId("unit-3"))?.unit.experience,
    ).toBe(0);
    expect(resolved.company.roster[0]?.unit.experience).toBe(
      CONTRACTS["forage-the-valley"].reward.experience,
    );
    expect(resolved.events[0]?.kind).toBe("rewardGranted");
  });

  it("stamps events with the dispatch's return day by default", () => {
    const company = makeCompany();
    const sent = sendDetachment(company, makeCalendar(2), sendInit());
    const resolved = resolveDetachment(company, createDepotInventory(), sent.dispatch);
    const reward = resolved.events[0];
    expect(reward).toMatchObject({ kind: "rewardGranted", tick: 6, crowns: 300 });
  });

  it("masters an equipped ability when the Drill award crosses its cost", () => {
    const veteran: RosterMemberInit = makeMember("unit-1", {
      equipmentWeapon: asEquipmentId("charleville-musket"),
      abilities: [{ abilityId: asAbilityId("volley-fire"), drill: 60, mastered: false }],
    });
    const comrade = makeMember("unit-2");
    const company = createCompany({
      id: asCompanyId("company-1"),
      name: "The Greycoats",
      crowns: 500,
      roster: [veteran, comrade],
    });

    const sent = sendDetachment(company, makeCalendar(1), sendInit());
    const resolved = resolveDetachment(company, createDepotInventory(), sent.dispatch);

    const learned = memberOf(resolved.company, unitId("unit-1"))?.unit.abilities.find(
      (ability: LearnedAbility) => ability.abilityId === "volley-fire",
    );
    expect(learned?.mastered).toBe(true);
    expect(resolved.units[0]?.abilitiesMastered).toBe(1);
    expect(resolved.events.some((event) => event.kind === "abilityLearned")).toBe(true);
  });

  it("levels a soldier whose Experience reward crosses the threshold", () => {
    const nearLevel: RosterMemberInit = makeMember("unit-1", { experience: 90 });
    const company = createCompany({
      id: asCompanyId("company-1"),
      name: "The Greycoats",
      crowns: 500,
      roster: [nearLevel, makeMember("unit-2")],
    });
    const sent = sendDetachment(company, makeCalendar(1), sendInit());
    const resolved = resolveDetachment(company, createDepotInventory(), sent.dispatch);

    expect(memberOf(resolved.company, unitId("unit-1"))?.unit.level).toBe(2);
    expect(resolved.units[0]?.levelsGained).toBe(1);
    expect(resolved.events.some((event) => event.kind === "levelUp")).toBe(true);
  });

  it("skips a soldier dismissed while away", () => {
    const company = makeCompany(3, 100);
    const sent = sendDetachment(company, makeCalendar(1), sendInit());
    const without = {
      ...company,
      roster: company.roster.filter((member) => member.unit.id !== unitId("unit-1")),
    };

    const resolved = resolveDetachment(without, createDepotInventory(), sent.dispatch);
    expect(resolved.units.map((unit) => unit.unitId)).toEqual([unitId("unit-2")]);
  });

  it("rejects an unknown or non-detachment contract", () => {
    const dispatch = {
      id: asDispatchId("d"),
      contractId: SKIRMISH,
      unitIds: [unitId("unit-1")],
      dispatchedOnDay: 1,
      duration: 3,
      returnDay: 4,
    };
    expect(() =>
      resolveDetachment(makeCompany(), createDepotInventory(), dispatch),
    ).toThrowError(/not a detachment/);
  });

  it("is deterministic and does not mutate its inputs", () => {
    const company = makeCompany(3, 100);
    const inventory = createDepotInventory();
    const sent = sendDetachment(company, makeCalendar(1), sendInit());

    const first = resolveDetachment(company, inventory, sent.dispatch);
    const second = resolveDetachment(company, inventory, sent.dispatch);

    expect(first.company).toEqual(second.company);
    expect(first.inventory).toEqual(second.inventory);
    expect(first.events).toEqual(second.events);
    // Inputs untouched.
    expect(company.roster[0]?.unit.experience).toBe(0);
    expect(inventoryCount(inventory, "water-canteen")).toBe(0);
  });
});

describe("resolveDetachments", () => {
  it("threads the company and reserve through several returns", () => {
    let calendar = makeCalendar(1);
    calendar = scheduleDispatch(calendar, {
      id: asDispatchId("dispatch-a"),
      contractId: FORAGE,
      unitIds: [unitId("unit-1"), unitId("unit-2")],
      duration: 4,
    });
    calendar = scheduleDispatch(calendar, {
      id: asDispatchId("dispatch-b"),
      contractId: RECONNOITRE,
      unitIds: [unitId("unit-3")],
      duration: 3,
    });

    const company = makeCompany(3, 0);
    const result = resolveDetachments(company, createDepotInventory(), [
      ...calendar.dispatches,
    ]);

    expect(result.resolved).toHaveLength(2);
    expect(result.company.crowns).toBe(300 + 250);
    // `spyglass` is authored; `water-canteen` is authored.
    expect(inventoryCount(result.inventory, "water-canteen")).toBe(1);
    expect(inventoryCount(result.inventory, "spyglass")).toBe(1);
    expect(result.events.some((event) => event.kind === "rewardGranted")).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * The whole round trip
 * ------------------------------------------------------------------------ */

describe("advanceDetachments", () => {
  it("sends, advances N days and resolves the party on return", () => {
    const company = makeCompany(3, 500);
    const sent = sendDetachment(company, makeCalendar(1), sendInit());

    const advanced = advanceDetachments({
      company: sent.company,
      calendar: sent.calendar,
      days: 4,
    });

    expect(advanced.calendar.day).toBe(5);
    expect(advanced.company.theatre.day).toBe(5);
    expect(advanced.completed.map((dispatch) => dispatch.id)).toEqual(["dispatch-1"]);
    expect(advanced.calendar.dispatches).toHaveLength(0);
    // Fee out, reward in.
    expect(advanced.company.crowns).toBe(500 - 60 + 300);
    expect(inventoryCount(advanced.inventory, "water-canteen")).toBe(1);
    expect(advanced.company.roster[0]?.unit.experience).toBe(25);
    expect(advanced.articles.day).toBe(5);
  });

  it("does nothing when nobody is away", () => {
    const company = travelTo(makeCompany(3, 100), asRegionId("blackwood"));
    const advanced = advanceDetachments({ company, calendar: makeCalendar(1), days: 2 });
    expect(advanced.completed).toHaveLength(0);
    expect(advanced.resolved).toHaveLength(0);
    expect(advanced.company.crowns).toBe(100);
  });

  it("leaves a long detachment in the field until its return day", () => {
    const company = makeCompany(3, 500);
    const sent = sendDetachment(company, makeCalendar(1), {
      dispatchId: asDispatchId("dispatch-long"),
      contractId: asContractId("escort-the-pay-chest"), // duration 6
      unitIds: [unitId("unit-1"), unitId("unit-2"), unitId("unit-3")],
    });
    const early = advanceDetachments({ company: sent.company, calendar: sent.calendar, days: 3 });
    expect(early.completed).toHaveLength(0);
    expect(early.calendar.dispatches).toHaveLength(1);
  });
});
