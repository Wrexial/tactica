import { describe, expect, it } from "vitest";

import {
  CONTRACT_LIST,
  CONTRACTS,
  contractsForChapter,
  contractsForRegion,
  getContract,
} from "../../src/data/contracts";
import type { PostKey } from "../../src/data/posts";
import {
  CONTRACT_KINDS,
  EQUIP_SLOTS,
  type ContractDef,
  type ContractRequirement,
  type EquipSlot,
  type PowerKey,
} from "../../src/data/schema";

import {
  advanceDetachments,
  canSendDetachment,
  detachmentBlockers,
  resolveDetachment,
  sendDetachment,
  type DetachmentInit,
} from "../../src/engine/detach";
import {
  createCalendar,
  dispatchDaysRemaining,
  isDispatchDue,
  type CampaignCalendar,
} from "../../src/engine/calendar";
import {
  createCampaignMap,
  createCampaignMarker,
  createTreasureRule,
  findTreasure,
  huntTreasure,
  placeMarker,
  placementCount,
  travelCompany,
  travelPlan,
  type CampaignMapState,
  type CampaignMarker,
} from "../../src/engine/campaignMap";
import {
  canAfford,
  createCompany,
  memberOf,
  rosterSize,
  spendCrowns,
  travelTo,
  type Company,
} from "../../src/engine/company";
import {
  addToInventory,
  buyKit,
  createDepot,
  createDepotInventory,
  inventoryCount,
  sellKit,
  type Depot,
  type DepotInventory,
} from "../../src/engine/depot";
import { coord } from "../../src/engine/grid";
import {
  asCompanyId,
  asContractId,
  asDepotId,
  asDispatchId,
  asEquipmentId,
  asMapTokenId,
  asPostId,
  asRegionId,
  asUnitId,
  type EquipmentId,
} from "../../src/engine/ids";
import { createPostAssignment, derivePostStats } from "../../src/engine/progression/posts";
import { createUnit, type Unit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T079 — Campaign integration tests
 *
 * Phase 6 authored five systems that only make sense together: **contracts**
 * (`src/data/contracts.ts`, T070), **detachments** (T072), the **campaign map
 * + markers** (T073), the **depots** (T075) and the **calendar** (T076). This
 * suite ties them into one sandbox and pins the "done when":
 *
 * | Concern            | What is exercised                                                |
 * | ------------------ | ---------------------------------------------------------------- |
 * | Contract gating    | story chapter, region, fee/affordability and the four requirement |
 * |                    | kinds (item / post / unit / honour) against a real company        |
 * | Dispatch timing    | fee paid once, return day = leave day + authored duration,        |
 * |                    | resolves exactly on that day and not before                       |
 * | Marker rewards     | map grows by placement, treasure depends on adjacent terrain,     |
 * |                    | finds bank into the reserve, marching charts a region             |
 * | Economy            | the full loop fee → battle reward → kit → depot sale/purchase     |
 *
 * ## The gating check lives here
 *
 * `docs/NAPOLEONIC_MAPPING.md` §10 keeps the pub's gates as **data**
 * (`ContractRequirement`) and puts the roster check in the Officers' Mess UI
 * (T071) and these campaign tests. The helper below is that check: it mirrors
 * the Mess's rule (`src/ui/Mess.tsx`) so the authored contracts are verified
 * against a roster in one place, without duplicating engine state.
 *
 * ## Contract (`agents.md` §2, §3, §9)
 *
 * - **No engine source is changed.** These tests read the pure engine/data
 *   values exactly as the controllers and menus do.
 * - **Determinism.** Every fixture is authored data plus the seeded calendar;
 *   the same inputs replay byte-identically.
 * ------------------------------------------------------------------------ */

/* --------------------------------------------------------------------------
 * Roster fixtures
 * ------------------------------------------------------------------------ */

/** One authored soldier: a power, a primary post and any kit it carries. */
interface SoldierSpec {
  readonly id: string;
  readonly power?: PowerKey;
  readonly postId?: PostKey;
  readonly equipment?: Partial<Record<EquipSlot, string>>;
}

function soldier(spec: SoldierSpec): Unit {
  const power = spec.power ?? "france";
  const postId = spec.postId ?? "fusilier";
  const assignment = createPostAssignment({ primaryPostId: asPostId(postId), power });
  const equipment = Object.fromEntries(
    Object.entries(spec.equipment ?? {}).map(([slot, id]) => [slot, asEquipmentId(id)]),
  ) as Partial<Record<EquipSlot, EquipmentId>>;
  return createUnit({
    id: asUnitId(spec.id),
    name: `Soldier ${spec.id}`,
    power,
    postId: asPostId(postId),
    level: 1,
    at: coord(0, 0),
    stats: derivePostStats({ level: 1, assignment }),
    equipment,
  });
}

function member(spec: SoldierSpec) {
  return {
    unit: soldier(spec),
    assignment: createPostAssignment({
      primaryPostId: asPostId(spec.postId ?? "fusilier"),
      power: spec.power ?? "france",
    }),
  };
}

/** A mixed-power company of the shape the demo Mess roster uses. */
function makeCompany(
  specs: readonly SoldierSpec[],
  options: { crowns?: number; honours?: number } = {},
): Company {
  return createCompany({
    id: asCompanyId("company-greycoats"),
    name: "The Greycoats",
    crowns: options.crowns ?? 1000,
    honours: options.honours ?? 0,
    roster: specs.map(member),
  });
}

/** Six soldiers covering every post the authored contracts gate on. */
const RICH_ROSTER: readonly SoldierSpec[] = [
  { id: "unit-grenadier", postId: "grenadier", equipment: { weapon: "sappers-tools" } },
  { id: "unit-chasseur", postId: "chasseur", equipment: { accessory: "powder-flask" } },
  { id: "unit-forager", postId: "forager", equipment: { accessory: "powder-flask" } },
  { id: "unit-scout", power: "austria", postId: "scout", equipment: { accessory: "powder-flask" } },
  { id: "unit-partisan", power: "russia", postId: "partisan" },
  { id: "unit-fusilier", postId: "fusilier" },
];

/* --------------------------------------------------------------------------
 * The Officers' Mess gate (mirrors src/ui/Mess.tsx — mapping §10)
 * ------------------------------------------------------------------------ */

/** One requirement measured against a company. */
interface RequirementStatus {
  readonly requirement: ContractRequirement;
  readonly have: number;
  readonly required: number;
  readonly met: boolean;
}

/** How many copies of `itemId` the roster currently carries, in any slot. */
function equipmentCopies(company: Company, itemId: string): number {
  let total = 0;
  for (const member of company.roster) {
    for (const slot of EQUIP_SLOTS) {
      if (member.unit.equipment[slot] === itemId) total += 1;
    }
  }
  return total;
}

/** How many soldiers hold `postId` as their **primary** post. */
function primaryPostCount(company: Company, postId: string): number {
  return company.roster.filter((entry) => entry.assignment.primaryPostId === postId).length;
}

/** Evaluate one requirement against the company (the Mess's four cases). */
function evaluateRequirement(
  company: Company,
  requirement: ContractRequirement,
): RequirementStatus {
  const required = requirement.count;
  const measure = (have: number): RequirementStatus => ({
    requirement,
    have,
    required,
    met: have >= required,
  });
  switch (requirement.kind) {
    case "item":
      return measure(equipmentCopies(company, requirement.id ?? ""));
    case "post":
      return measure(primaryPostCount(company, requirement.id ?? ""));
    case "unit":
      return measure(rosterSize(company));
    case "honour":
      return measure(company.honours);
  }
}

/** Every requirement of `contract` evaluated in authored order. */
function requirementStatuses(
  company: Company,
  contract: ContractDef,
): readonly RequirementStatus[] {
  return contract.requires.map((requirement) => evaluateRequirement(company, requirement));
}

/** `true` when the company satisfies every requirement of `contract`. */
function meetsRequirements(company: Company, contract: ContractDef): boolean {
  return requirementStatuses(company, contract).every((status) => status.met);
}

/** `true` when the story has reached a chapter that unlocks `contract`. */
function chapterOpen(contract: ContractDef, chapter: number): boolean {
  return contract.chapter === undefined || contract.chapter <= chapter;
}

/**
 * The Mess's full gate: the contract must be unlocked by the story, every
 * requirement met and the fee affordable.
 */
function canTakeContract(company: Company, contract: ContractDef, chapter: number): boolean {
  return (
    chapterOpen(contract, chapter) &&
    meetsRequirements(company, contract) &&
    canAfford(company, contract.fee)
  );
}

/* --------------------------------------------------------------------------
 * Contract gating
 * ------------------------------------------------------------------------ */

describe("campaign — contract gating", () => {
  it("unlocks story contracts as the chapter advances, always keeping ungated ones", () => {
    const ungated = CONTRACT_LIST.filter((contract) => contract.chapter === undefined);
    expect(contractsForChapter(0)).toHaveLength(ungated.length);
    expect(contractsForChapter(0).every((contract) => contract.chapter === undefined)).toBe(true);

    // Every gated contract appears exactly once, on or after its chapter.
    for (const contract of CONTRACT_LIST) {
      if (contract.chapter === undefined) continue;
      expect(contractsForChapter(contract.chapter)).toContain(contract);
      expect(contractsForChapter(contract.chapter - 1)).not.toContain(contract);
    }

    expect(contractsForChapter(5)).toHaveLength(CONTRACT_LIST.length);
    expect(contractsForChapter(99)).toHaveLength(CONTRACT_LIST.length);
  });

  it("ties battles and pacifications to the campaign regions", () => {
    for (const kind of ["battle", "pacification"] as const) {
      for (const contract of CONTRACT_LIST.filter((entry) => entry.kind === kind)) {
        expect(contract.regionId, contract.id).toBeDefined();
        expect(contractsForRegion(contract.regionId as string)).toContain(contract);
      }
    }
    // A theatre with no contracts posted in that region yields an empty board.
    expect(contractsForRegion("no-such-region")).toEqual([]);
    // The regions referenced by contracts are all non-empty stable handles.
    expect(getContract("break-the-bridge").regionId).toBe("sainte-colombe");
  });

  it("evaluates all four requirement kinds against a real roster", () => {
    const company = makeCompany(RICH_ROSTER, { honours: 3 });

    // item — sappers-tools and three powder flasks are carried.
    expect(equipmentCopies(company, "sappers-tools")).toBe(1);
    expect(equipmentCopies(company, "powder-flask")).toBe(3);

    // post — each gated trade is present.
    expect(primaryPostCount(company, "grenadier")).toBe(1);
    expect(primaryPostCount(company, "chasseur")).toBe(1);
    expect(primaryPostCount(company, "forager")).toBe(1);
    expect(primaryPostCount(company, "scout")).toBe(1);
    expect(primaryPostCount(company, "partisan")).toBe(1);

    // unit / honour — read straight from the company.
    expect(requirementStatuses(company, getContract("break-the-bridge"))).toEqual([
      { requirement: { kind: "unit", count: 4 }, have: 6, required: 4, met: true },
    ]);
    const highland = requirementStatuses(company, getContract("break-the-guerrilla-camp"));
    expect(highland.map((status) => status.requirement.kind)).toEqual([
      "item",
      "post",
      "unit",
      "honour",
    ]);
    expect(highland.every((status) => status.met)).toBe(true);
  });

  it("passes a fully-equipped contract and reports the exact failing gate", () => {
    const company = makeCompany(RICH_ROSTER, { honours: 3 });

    expect(canTakeContract(company, getContract("storm-the-farmhouse"), 3)).toBe(true);
    expect(canTakeContract(company, getContract("clear-the-forest-bands"), 5)).toBe(true);
    expect(canTakeContract(company, getContract("reconnoitre-the-ridge"), 5)).toBe(true);

    // Too small a party fails the unit gate.
    const squad = makeCompany(RICH_ROSTER.slice(0, 3), { honours: 3 });
    const unitGate = requirementStatuses(squad, getContract("break-the-bridge")).find(
      (status) => status.requirement.kind === "unit",
    );
    expect(unitGate).toMatchObject({ have: 3, required: 4, met: false });
    expect(canTakeContract(squad, getContract("break-the-bridge"), 1)).toBe(false);

    // Missing the authored kit fails the item gate.
    const noTools = makeCompany(
      RICH_ROSTER.map((spec) => (spec.id === "unit-grenadier" ? { ...spec, equipment: {} } : spec)),
      { honours: 3 },
    );
    expect(canTakeContract(noTools, getContract("storm-the-farmhouse"), 3)).toBe(false);

    // Not enough Regimental Honours fails the honour gate.
    const lowHonour = makeCompany(RICH_ROSTER, { honours: 2 });
    expect(canTakeContract(lowHonour, getContract("break-the-guerrilla-camp"), 5)).toBe(false);
  });

  it("closes the board before the story chapter is reached", () => {
    const company = makeCompany(RICH_ROSTER, { honours: 3, crowns: 5000 });
    // `storm-the-farmhouse` is a chapter-3 contract.
    expect(chapterOpen(getContract("storm-the-farmhouse"), 2)).toBe(false);
    expect(canTakeContract(company, getContract("storm-the-farmhouse"), 2)).toBe(false);

    const early = contractsForChapter(2).map((contract) => contract.id);
    expect(early).not.toContain("storm-the-farmhouse");
    expect(early).not.toContain("break-the-guerrilla-camp");
  });

  it("gates on the entry fee as well as the requirements", () => {
    const contract = getContract("pacify-the-coast-road"); // 1600 Crowns, needs 5 soldiers
    const rich = makeCompany(RICH_ROSTER, { crowns: 5000 });
    const poor = makeCompany(RICH_ROSTER, { crowns: 100 });

    expect(meetsRequirements(rich, contract)).toBe(true);
    expect(canAfford(rich, contract.fee)).toBe(true);
    expect(canTakeContract(rich, contract, 99)).toBe(true);

    expect(meetsRequirements(poor, contract)).toBe(true);
    expect(canAfford(poor, contract.fee)).toBe(false);
    expect(canTakeContract(poor, contract, 99)).toBe(false);
    // Taking it anyway throws rather than silently overdrawing the chest.
    expect(() => spendCrowns(poor, contract.fee)).toThrow(RangeError);
  });

  it("authors every contract kind with a positive reward and a resolvable gate", () => {
    for (const kind of CONTRACT_KINDS) {
      const contracts = CONTRACT_LIST.filter((contract) => contract.kind === kind);
      expect(contracts.length, kind).toBeGreaterThan(0);
    }
    for (const contract of CONTRACT_LIST) {
      expect(contract.reward.crowns, contract.id).toBeGreaterThan(0);
      for (const requirement of contract.requires) {
        if (requirement.kind === "item" || requirement.kind === "post") {
          expect(requirement.id, contract.id).toBeDefined();
        }
      }
    }
  });
});

/* --------------------------------------------------------------------------
 * Dispatch timing (T072 + T076)
 * ------------------------------------------------------------------------ */

const FORAGE = asContractId("forage-the-valley"); // duration 4, fee 60, needs 2 soldiers
const RECONNOITRE = asContractId("reconnoitre-the-ridge"); // duration 3, fee 50, needs 1
const ESCORT = asContractId("escort-the-pay-chest"); // duration 6, fee 120, needs 3

function makeCalendar(day = 1, regionId = "blackwood"): CampaignCalendar {
  return createCalendar({ seed: "campaign-1815", day, regionId: asRegionId(regionId) });
}

function forageInit(overrides: Partial<DetachmentInit> = {}): DetachmentInit {
  return {
    dispatchId: asDispatchId("dispatch-forage"),
    contractId: FORAGE,
    unitIds: [asUnitId("unit-grenadier"), asUnitId("unit-forager")],
    ...overrides,
  };
}

describe("campaign — dispatch timing", () => {
  it("charges the fee once and schedules the authored duration", () => {
    const company = makeCompany(RICH_ROSTER, { crowns: 500 });
    const sent = sendDetachment(company, makeCalendar(2), forageInit());

    expect(sent.company.crowns).toBe(500 - CONTRACTS["forage-the-valley"].fee);
    expect(sent.dispatch.dispatchedOnDay).toBe(2);
    expect(sent.dispatch.duration).toBe(4);
    expect(sent.dispatch.returnDay).toBe(6);
    expect(sent.calendar.dispatches).toHaveLength(1);

    // The inputs are untouched.
    expect(company.crowns).toBe(500);
  });

  it("resolves the party exactly on the return day and not before", () => {
    const company = makeCompany(RICH_ROSTER, { crowns: 500 });
    const sent = sendDetachment(company, makeCalendar(1), forageInit());
    const dispatch = sent.dispatch;

    expect(isDispatchDue(dispatch, 4)).toBe(false);
    expect(dispatchDaysRemaining(dispatch, 4)).toBe(1);
    expect(isDispatchDue(dispatch, 5)).toBe(true);

    // Three days pass: the party is still on the road.
    const early = advanceDetachments({ company: sent.company, calendar: sent.calendar, days: 3 });
    expect(early.calendar.day).toBe(4);
    expect(early.completed).toHaveLength(0);
    expect(early.resolved).toHaveLength(0);
    expect(early.inventory).toEqual(createDepotInventory());

    // One more day: the party marches back and the spoils are paid.
    const atReturn = advanceDetachments({
      company: early.company,
      calendar: early.calendar,
      days: 1,
    });
    expect(atReturn.calendar.day).toBe(5);
    expect(atReturn.completed.map((entry) => entry.id)).toEqual(["dispatch-forage"]);
    expect(atReturn.resolved).toHaveLength(1);
  });

  it("grants the authored reward, Drill and Experience on return", () => {
    const company = makeCompany(RICH_ROSTER, { crowns: 500 });
    const sent = sendDetachment(company, makeCalendar(1), forageInit());

    const resolved = resolveDetachment(sent.company, createDepotInventory(), sent.dispatch);
    const reward = CONTRACTS["forage-the-valley"].reward;

    expect(resolved.company.crowns).toBe(500 - 60 + reward.crowns);
    expect(resolved.company.honours).toBe(reward.honours);
    expect(inventoryCount(resolved.inventory, "water-canteen")).toBe(1);
    expect(resolved.units.map((entry) => entry.unitId)).toEqual([
      asUnitId("unit-grenadier"),
      asUnitId("unit-forager"),
    ]);
    expect(memberOf(resolved.company, asUnitId("unit-grenadier"))?.unit.experience).toBe(
      reward.experience,
    );
    expect(resolved.events[0]?.kind).toBe("rewardGranted");
  });

  it("leaves a longer contract in the field when the clock has not reached it", () => {
    const company = makeCompany(RICH_ROSTER, { crowns: 500 });
    const sent = sendDetachment(company, makeCalendar(1), {
      dispatchId: asDispatchId("dispatch-escort"),
      contractId: ESCORT,
      unitIds: [asUnitId("unit-grenadier"), asUnitId("unit-chasseur"), asUnitId("unit-forager")],
    });
    const advanced = advanceDetachments({
      company: sent.company,
      calendar: sent.calendar,
      days: 3,
    });
    expect(advanced.completed).toHaveLength(0);
    expect(advanced.calendar.dispatches).toHaveLength(1);
    expect(dispatchDaysRemaining(advanced.calendar.dispatches[0]!, advanced.calendar.day)).toBe(3);
  });

  it("gates a send on the contract, the roster, the clock and the war chest", () => {
    const company = makeCompany(RICH_ROSTER, { crowns: 100 });
    const calendar = makeCalendar(1);

    // An unknown and a non-detachment contract.
    expect(
      detachmentBlockers(company, calendar, forageInit({ contractId: asContractId("no-such") })),
    ).toContain("unknown-contract");
    expect(
      detachmentBlockers(
        company,
        calendar,
        forageInit({ contractId: asContractId("crossed-sabres") }),
      ),
    ).toContain("not-a-detachment");

    // Under-strength party, stranger off the roster and an unaffordable fee.
    expect(
      detachmentBlockers(company, calendar, forageInit({ unitIds: [asUnitId("unit-grenadier")] })),
    ).toContain("party-too-small");
    expect(
      detachmentBlockers(
        company,
        calendar,
        forageInit({ unitIds: [asUnitId("unit-grenadier"), asUnitId("unit-stranger")] }),
      ),
    ).toContain("unit-not-on-roster");
    expect(canSendDetachment(company, calendar, forageInit())).toBe(true);
    expect(canSendDetachment(makeCompany(RICH_ROSTER, { crowns: 0 }), calendar, forageInit())).toBe(
      false,
    );
    expect(
      detachmentBlockers(makeCompany(RICH_ROSTER, { crowns: 0 }), calendar, forageInit()),
    ).toContain("insufficient-crowns");

    // A soldier already away cannot be booked twice.
    const sent = sendDetachment(company, calendar, forageInit());
    expect(
      detachmentBlockers(sent.company, sent.calendar, {
        dispatchId: asDispatchId("dispatch-2"),
        contractId: RECONNOITRE,
        unitIds: [asUnitId("unit-grenadier")],
      }),
    ).toContain("unit-already-away");
  });

  it("replays a dispatch round trip deterministically and purely", () => {
    const company = makeCompany(RICH_ROSTER, { crowns: 500 });
    const calendar = makeCalendar(1);

    const run = () => {
      const sent = sendDetachment(company, calendar, forageInit());
      return advanceDetachments({ company: sent.company, calendar: sent.calendar, days: 4 });
    };

    const first = run();
    const second = run();
    expect(first.company).toEqual(second.company);
    expect(first.inventory).toEqual(second.inventory);
    expect(first.completed).toEqual(second.completed);
    // Source values are never mutated by the pure engine.
    expect(company.crowns).toBe(500);
    expect(calendar.dispatches).toHaveLength(0);
  });
});

/* --------------------------------------------------------------------------
 * Marker rewards (T073)
 * ------------------------------------------------------------------------ */

function marker(
  id: string,
  name: string,
  terrain: CampaignMarker["terrain"],
  regionId: string,
  treasure: readonly {
    itemId: string;
    count?: number;
    nearTerrain?: CampaignMarker["terrain"] | null;
  }[] = [],
): CampaignMarker {
  return createCampaignMarker({
    id: asMapTokenId(id),
    name,
    terrain,
    regionId: asRegionId(regionId),
    treasure: treasure.map((rule) =>
      createTreasureRule({
        itemId: rule.itemId,
        ...(rule.count !== undefined ? { count: rule.count } : {}),
        nearTerrain: rule.nearTerrain ?? null,
      }),
    ),
  });
}

const SAINTE_COLOMBE = marker("start", "Sainte-Colombe", "bridge", "sainte-colombe", [
  { itemId: "powder-flask" },
]);

const BLACKWOOD = marker("blackwood", "The Blackwood", "wood", "blackwood", [
  { itemId: "water-canteen" },
  { itemId: "forester-bow", nearTerrain: "wood" },
  { itemId: "spyglass", nearTerrain: "hill" },
]);

const HIGHLANDS = marker("highlands", "The Highlands", "hill", "the-highlands", [
  { itemId: "spyglass", nearTerrain: "wood" },
]);

function startingMap(): CampaignMapState {
  return createCampaignMap({
    width: 4,
    height: 4,
    placements: [{ slot: coord(0, 0), marker: SAINTE_COLOMBE }],
  });
}

describe("campaign — marker rewards", () => {
  it("grows the map one marker at a time", () => {
    let map = startingMap();
    expect(placementCount(map)).toBe(1);

    map = placeMarker(map, BLACKWOOD, coord(1, 1));
    map = placeMarker(map, HIGHLANDS, coord(2, 1));
    expect(placementCount(map)).toBe(3);
    expect(map.placements.map((entry) => entry.marker.regionId)).toEqual([
      "sainte-colombe",
      "blackwood",
      "the-highlands",
    ]);
  });

  it("changes the spoils with the placement of neighbouring markers", () => {
    // The wood alone: only its unconditional canteen drops.
    const lonely = placeMarker(startingMap(), BLACKWOOD, coord(1, 1));
    expect(findTreasure(lonely, coord(1, 1)).map((find) => find.itemId)).toEqual(["water-canteen"]);

    // Drop a hill next door: the wood's spyglass rule fires too.
    const besideHill = placeMarker(lonely, HIGHLANDS, coord(2, 1));
    expect(findTreasure(besideHill, coord(1, 1)).map((find) => find.itemId)).toEqual([
      "water-canteen",
      "spyglass",
    ]);
    // The hill, facing the wood, pays out its own spyglass rule.
    expect(findTreasure(besideHill, coord(2, 1)).map((find) => find.itemId)).toEqual(["spyglass"]);
  });

  it("hunts a location once and banks the finds into the reserve", () => {
    let map = placeMarker(startingMap(), BLACKWOOD, coord(1, 1));
    map = placeMarker(map, HIGHLANDS, coord(2, 1));

    const first = huntTreasure(map, coord(1, 1));
    expect(first.finds.map((find) => find.itemId)).toEqual(["water-canteen", "spyglass"]);
    expect(map.huntedSlots).toEqual([]); // pure: the source map is not marked

    let inventory: DepotInventory = createDepotInventory();
    for (const find of first.finds) {
      inventory = addToInventory(inventory, asEquipmentId(find.itemId), find.count);
    }
    expect(inventoryCount(inventory, "water-canteen")).toBe(1);
    expect(inventoryCount(inventory, "spyglass")).toBe(1);

    expect(() => huntTreasure(first.map, coord(1, 1))).toThrow(/already been hunted/);
  });

  it("multiplies a repeatable find by matching neighbours", () => {
    const secondWood = marker("blackwood-2", "The Koringwood", "wood", "koringwood", [
      { itemId: "forester-bow", nearTerrain: "wood" },
    ]);
    let map = placeMarker(startingMap(), BLACKWOOD, coord(1, 1));
    map = placeMarker(map, secondWood, coord(1, 2));

    // `forester-bow × count 1` (default) fires once per adjacent wood.
    expect(
      findTreasure(map, coord(1, 1)).find((find) => find.itemId === "forester-bow")?.count,
    ).toBe(1);
  });

  it("marching to a charted region spends the days and charts it", () => {
    let map = startingMap();
    map = placeMarker(map, BLACKWOOD, coord(2, 1));

    const company = makeCompany(RICH_ROSTER, { crowns: 0 });
    const based = travelTo(company, asRegionId("sainte-colombe"));

    const plan = travelPlan(map, asRegionId("sainte-colombe"), asRegionId("blackwood"));
    expect(plan.days).toBe(3);

    const { company: arrived, plan: marched } = travelCompany(based, map, asRegionId("blackwood"));
    expect(marched.days).toBe(3);
    expect(arrived.theatre.day).toBe(company.theatre.day + 3);
    expect(arrived.theatre.regionId).toBe("blackwood");
    expect(arrived.theatre.knownRegionIds).toEqual(["sainte-colombe", "blackwood"]);
    // Pure: the source company is untouched, and the base is unchanged.
    expect(company.theatre.regionId).toBeNull();
    expect(based.theatre.regionId).toBe("sainte-colombe");
  });

  it("refuses to march to a region that is not on the map", () => {
    expect(() =>
      travelPlan(startingMap(), asRegionId("sainte-colombe"), asRegionId("no-such-region")),
    ).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Economy — the whole loop (T068 + T072 + T075)
 * ------------------------------------------------------------------------ */

function sainteColombeDepot(): Depot {
  return createDepot({
    id: asDepotId("depot-sainte-colombe"),
    name: "Sainte-Colombe Quartermaster",
    regionId: asRegionId("sainte-colombe"),
    power: "france",
    stock: ["charleville-musket", "baker-rifle", "water-canteen"],
  });
}

describe("campaign — economy", () => {
  it("runs the full loop: fee out, battle reward in, kit banked", () => {
    const company = makeCompany(RICH_ROSTER, { crowns: 500 });
    const calendar = makeCalendar(1, "sainte-colombe");
    const sent = sendDetachment(company, calendar, forageInit());

    // The fee left the chest on posting.
    expect(sent.company.crowns).toBe(440);

    const advanced = advanceDetachments({
      company: sent.company,
      calendar: sent.calendar,
      days: 4,
    });

    // Crowns, Honour, kit and per-soldier progression all landed together.
    expect(advanced.company.crowns).toBe(440 + CONTRACTS["forage-the-valley"].reward.crowns);
    expect(advanced.company.honours).toBe(CONTRACTS["forage-the-valley"].reward.honours);
    expect(inventoryCount(advanced.inventory, "water-canteen")).toBe(1);
    expect(memberOf(advanced.company, asUnitId("unit-grenadier"))?.unit.experience).toBe(25);
    expect(advanced.company.theatre.day).toBe(5);
  });

  it("sells the spoils and buys favoured kit at a power-specific price", () => {
    const depot = sainteColombeDepot();
    const company = travelTo(makeCompany(RICH_ROSTER, { crowns: 440 }), depot.regionId);
    const reserve = createDepotInventory({ "water-canteen": 1 });

    // Neutral kit sells at the standard half price (cost 60 → 30).
    const sold = sellKit(company, reserve, depot, "water-canteen");
    expect(sold.paid).toBe(-30);
    expect(sold.company.crowns).toBe(470);
    expect(inventoryCount(sold.inventory, "water-canteen")).toBe(0);

    // France's own musket is favoured: 80% of 400 = 320.
    const bought = buyKit(sold.company, sold.inventory, depot, "charleville-musket");
    expect(bought.paid).toBe(320);
    expect(bought.company.crowns).toBe(150);
    expect(inventoryCount(bought.inventory, "charleville-musket")).toBe(1);
  });

  it("prices a rival power's kit at a premium and gates trade on the region", () => {
    const depot = sainteColombeDepot();
    const rich = travelTo(makeCompany(RICH_ROSTER, { crowns: 5000 }), depot.regionId);
    const away = makeCompany(RICH_ROSTER, { crowns: 5000 });

    // A British Baker Rifle is foreign here: 120% of 900 = 1080.
    const foreign = buyKit(rich, createDepotInventory(), depot, "baker-rifle");
    expect(foreign.paid).toBe(1080);

    // The same purchase is blocked before the company reaches the region.
    expect(() => buyKit(away, createDepotInventory(), depot, "baker-rifle")).toThrow(
      /wrong-region/,
    );
  });

  it("keeps the ledger consistent across a save-and-replay of the loop", () => {
    const depot = sainteColombeDepot();
    const company = travelTo(makeCompany(RICH_ROSTER, { crowns: 500 }), depot.regionId);
    const calendar = makeCalendar(1, "sainte-colombe");

    const run = () => {
      const sent = sendDetachment(company, calendar, forageInit());
      const advanced = advanceDetachments({
        company: sent.company,
        calendar: sent.calendar,
        days: 4,
      });
      const sold = sellKit(advanced.company, advanced.inventory, depot, "water-canteen");
      return buyKit(sold.company, sold.inventory, depot, "charleville-musket");
    };

    const first = run();
    const second = run();
    expect(first.company).toEqual(second.company);
    expect(first.inventory).toEqual(second.inventory);
    // Fee 60 out + reward 300 in + sale 30 in − musket 320 out.
    expect(first.company.crowns).toBe(500 - 60 + 300 + 30 - 320);
    expect(inventoryCount(first.inventory, "charleville-musket")).toBe(1);
  });
});
