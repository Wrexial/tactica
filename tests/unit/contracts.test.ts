import { describe, expect, it } from "vitest";

import {
  CONTRACT_KEYS,
  CONTRACT_LIST,
  CONTRACTS,
  contractsForChapter,
  contractsForRegion,
  contractsOfKind,
  getContract,
  isContractKey,
  requirementsOf,
  type ContractKey,
} from "../../src/data/contracts";
import { EQUIPMENT_KEYS } from "../../src/data/equipment";
import { POST_KEYS } from "../../src/data/posts";
import { CONTRACT_KINDS, ContractDefSchema } from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T070 — Contract definitions
 *
 * Pins the task's "done when": Battle, Skirmish, Detachment and Pacification
 * contracts with **fees**, **requirements** and **rewards**, authored as
 * validated data (`src/data/contracts.ts`) with no engine import.
 * ------------------------------------------------------------------------ */

/** Markers that mean "content not authored yet" (mirrors the T009 sweep). */
const PLACEHOLDER = /\b(TBD|TBC|TODO|FIXME|XXX)\b|placeholder|lorem\s+ipsum|\?{3,}/i;

/** Every authored contract must carry authored, non-placeholder display prose. */
function expectCleanDisplay(contract: { id: string; name: string; description: string; flavour: string }) {
  for (const field of ["name", "description", "flavour"] as const) {
    const text = contract[field];
    expect(text.trim(), `${contract.id}.${field} must be non-empty`).not.toBe("");
    expect(PLACEHOLDER.test(text), `${contract.id}.${field} contains a placeholder`).toBe(false);
  }
}

describe("contracts — registry integrity (T070)", () => {
  it("authors a parsed definition for every canonical key", () => {
    expect(CONTRACT_LIST).toHaveLength(CONTRACT_KEYS.length);
    expect(new Set(CONTRACT_KEYS).size).toBe(CONTRACT_KEYS.length);

    for (const key of CONTRACT_KEYS) {
      const contract = CONTRACTS[key];
      expect(contract, key).toBeDefined();
      expect(contract.id).toBe(key);
      // Parsed at module load, so a bad field would have thrown already.
      expect(ContractDefSchema.safeParse(contract).success).toBe(true);
      expectCleanDisplay(contract);
    }
  });

  it("covers all four FFTA mission kinds", () => {
    for (const kind of CONTRACT_KINDS) {
      expect(contractsOfKind(kind).length, kind).toBeGreaterThan(0);
    }

    const byKind = CONTRACT_KINDS.flatMap((kind) => contractsOfKind(kind));
    expect(byKind).toHaveLength(CONTRACT_LIST.length);
  });

  it("authors non-negative fees and at least one reward per contract", () => {
    for (const contract of CONTRACT_LIST) {
      expect(contract.fee, contract.id).toBeGreaterThanOrEqual(0);
      expect(contract.reward.crowns, contract.id).toBeGreaterThan(0);
      expect(contract.reward.ap, contract.id).toBeGreaterThanOrEqual(0);
      expect(contract.reward.experience, contract.id).toBeGreaterThanOrEqual(0);
      expect(contract.reward.honours, contract.id).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives every detachment a positive duration and gives no other kind one", () => {
    for (const contract of CONTRACT_LIST) {
      if (contract.kind === "detachment") {
        expect(contract.duration, contract.id).toBeDefined();
        expect(contract.duration, contract.id).toBeGreaterThan(0);
      } else {
        expect(contract.duration, contract.id).toBeUndefined();
      }
    }
  });

  it("ties every pacification to a region", () => {
    for (const contract of contractsOfKind("pacification")) {
      expect(contract.regionId, contract.id).toBeDefined();
      expect(contract.regionId?.length, contract.id).toBeGreaterThan(0);
    }
  });

  it("exercises all four requirement kinds", () => {
    const kinds = new Set(CONTRACT_LIST.flatMap((c) => c.requires.map((r) => r.kind)));
    for (const kind of ["item", "post", "unit", "honour"] as const) {
      expect(kinds.has(kind), `no contract requires a ${kind}`).toBe(true);
    }
  });
});

describe("contracts — requirement & reward references (T070)", () => {
  it("names authored posts and items in requirements", () => {
    const posts = new Set<string>(POST_KEYS);
    const items = new Set<string>(EQUIPMENT_KEYS);

    for (const contract of CONTRACT_LIST) {
      for (const requirement of contract.requires) {
        expect(requirement.count, `${contract.id} requirement count`).toBeGreaterThanOrEqual(1);
        if (requirement.kind === "item") {
          expect(requirement.id, `${contract.id} item id`).toBeDefined();
          expect(items.has(requirement.id as string), `${contract.id}: unknown item ${requirement.id}`).toBe(true);
        }
        if (requirement.kind === "post") {
          expect(requirement.id, `${contract.id} post id`).toBeDefined();
          expect(posts.has(requirement.id as string), `${contract.id}: unknown post ${requirement.id}`).toBe(true);
        }
        if (requirement.kind === "unit" || requirement.kind === "honour") {
          expect(requirement.id, `${contract.id} ${requirement.kind} has no id`).toBeUndefined();
        }
      }
    }
  });

  it("names only authored items in reward loot", () => {
    const items = new Set<string>(EQUIPMENT_KEYS);
    for (const contract of CONTRACT_LIST) {
      for (const itemId of contract.reward.itemIds) {
        expect(items.has(itemId), `${contract.id}: unknown reward item ${itemId}`).toBe(true);
      }
    }
  });
});

describe("contracts — lookups and filters (T070)", () => {
  it("guards and resolves canonical keys", () => {
    expect(isContractKey("break-the-bridge")).toBe(true);
    expect(isContractKey("no-such-contract")).toBe(false);
    expect(isContractKey(42)).toBe(false);
    expect(getContract("break-the-bridge").kind).toBe("battle");
    expect(() => getContract("no-such-contract" as ContractKey)).toThrow(RangeError);
  });

  it("filters by kind", () => {
    expect(contractsOfKind("skirmish").map((c) => c.id)).toEqual([
      "crossed-sabres",
      "the-rival-foragers",
      "pistols-at-dawn",
      "the-roadside-ambush",
      "the-deserters-camp",
      "sabres-at-the-ford",
      "the-foragers-quarrel",
    ]);
    expect(contractsOfKind("detachment")).toHaveLength(7);
  });

  it("filters by region in canonical order", () => {
    expect(contractsForRegion("blackwood").map((c) => c.id)).toEqual([
      "storm-the-farmhouse",
      "the-roadside-ambush",
      "clear-the-forest-bands",
    ]);
    expect(contractsForRegion("sainte-colombe").map((c) => c.id)).toEqual([
      "break-the-bridge",
      "hold-the-redoubt",
      "take-the-mill",
      "sabres-at-the-ford",
    ]);
    expect(contractsForRegion("nowhere")).toEqual([]);
  });

  it("unlocks ungated contracts plus those at or below the story chapter", () => {
    // The four story battles and the highland pacification are chapter-gated;
    // every other contract is posted from the start.
    const ungated = CONTRACT_LIST.filter((contract) => contract.chapter === undefined).length;
    expect(contractsForChapter(0)).toHaveLength(ungated);
    expect(contractsForChapter(1).map((c) => c.id)).toContain("break-the-bridge");
    expect(contractsForChapter(1)).toHaveLength(ungated + 1);
    expect(contractsForChapter(4)).toHaveLength(CONTRACT_LIST.length - 1);
    expect(contractsForChapter(5)).toHaveLength(CONTRACT_LIST.length);

    expect(() => contractsForChapter(-1)).toThrow(RangeError);
    expect(() => contractsForChapter(1.5)).toThrow(RangeError);
  });

  it("exposes requirement lists through the convenience lookup", () => {
    expect(requirementsOf("break-the-bridge")).toEqual([{ kind: "unit", count: 4 }]);
    expect(requirementsOf("storm-the-farmhouse")).toEqual([
      { kind: "item", id: "sappers-tools", count: 1 },
      { kind: "post", id: "grenadier", count: 1 },
      { kind: "unit", count: 5 },
    ]);
  });
});

describe("contracts — schema enforcement (T070)", () => {
  it("rejects an unknown kind and a negative fee", () => {
    const display = { name: "Raid", description: "A raid.", flavour: "Steal the stores." };
    expect(ContractDefSchema.safeParse({ id: "x", kind: "raid", reward: {}, ...display }).success).toBe(false);
    expect(
      ContractDefSchema.safeParse({ id: "x", kind: "battle", fee: -1, reward: {}, ...display }).success,
    ).toBe(false);
  });

  it("defaults omitted requirements, fee and reward fields", () => {
    const parsed = ContractDefSchema.parse({
      id: "x",
      kind: "skirmish",
      reward: {},
      name: "Raid",
      description: "A raid.",
      flavour: "Steal the stores.",
    });
    expect(parsed.fee).toBe(0);
    expect(parsed.requires).toEqual([]);
    expect(parsed.reward).toEqual({
      crowns: 0,
      ap: 0,
      experience: 0,
      honours: 0,
      itemIds: [],
    });
  });
});
