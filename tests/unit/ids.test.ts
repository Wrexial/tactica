import { describe, expect, it } from "vitest";

import {
  IdError,
  asAbilityId,
  asCompanyId,
  asConditionId,
  asContractId,
  asEnemyId,
  asEquipmentId,
  asGuardSortieId,
  asMapTokenId,
  asPostId,
  asRegionId,
  asUnitId,
  assertId,
  createIdGenerator,
  isValidId,
  parseId,
} from "../../src/engine/ids";

/* --------------------------------------------------------------------------
 * T012 — Branded id types
 *
 * The brand is compile-time only, so at runtime ids must behave exactly like
 * the strings they wrap. The tests below lock down that runtime shape plus the
 * two helpers the rest of the engine will rely on:
 *   - validation at the untrusted boundary (`isValidId` / `assertId` / `parseId`)
 *   - deterministic, counter-based generation (`createIdGenerator`)
 * ------------------------------------------------------------------------ */

describe("branded ids — runtime shape", () => {
  it("preserves the underlying string for every id kind", () => {
    expect(asCompanyId("free-company")).toBe("free-company");
    expect(asUnitId("unit-1")).toBe("unit-1");
    expect(asPostId("fusilier")).toBe("fusilier");
    expect(asAbilityId("volley-fire")).toBe("volley-fire");
    expect(asEquipmentId("baker-rifle")).toBe("baker-rifle");
    expect(asConditionId("bleeding")).toBe("bleeding");
    expect(asContractId("bridge-at-dawn")).toBe("bridge-at-dawn");
    expect(asGuardSortieId("colours")).toBe("colours");
    expect(asMapTokenId("redoubt")).toBe("redoubt");
    expect(asEnemyId("cossack-scout")).toBe("cossack-scout");
    expect(asRegionId("no-mans-land")).toBe("no-mans-land");
  });

  it("survives a JSON round-trip unchanged", () => {
    const id = asUnitId("unit-7");
    expect(JSON.parse(JSON.stringify({ id })).id).toBe(id);
    expect(typeof id).toBe("string");
  });
});

describe("isValidId", () => {
  it("accepts non-empty strings", () => {
    expect(isValidId("unit")).toBe(true);
    expect(isValidId("  padded  ")).toBe(true);
  });

  it("rejects empty, whitespace-only and non-string values", () => {
    expect(isValidId("")).toBe(false);
    expect(isValidId("   ")).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(undefined)).toBe(false);
    expect(isValidId(42)).toBe(false);
    expect(isValidId({})).toBe(false);
  });
});

describe("assertId", () => {
  it("returns normally and narrows valid strings", () => {
    const value: unknown = "unit-1";
    assertId(value);
    // If the assertion narrowed this to `string`, this expression type-checks.
    expect(value.toUpperCase()).toBe("UNIT-1");
  });

  it("throws an IdError naming the offending field", () => {
    expect(() => assertId("", "leaderId")).toThrowError(IdError);
    expect(() => assertId(null, "leaderId")).toThrowError(/leaderId/);
  });
});

describe("parseId", () => {
  it("returns the value as a branded id", () => {
    expect(parseId<"unit">("unit-1")).toBe("unit-1");
  });

  it("throws on invalid input", () => {
    expect(() => parseId<"unit">(undefined, "unitId")).toThrowError(IdError);
  });
});

describe("createIdGenerator", () => {
  it("mints deterministic, prefixed ids from a counter", () => {
    const next = createIdGenerator<"unit">("unit");
    expect(next.next()).toBe("unit-1");
    expect(next.next()).toBe("unit-2");
    expect(next.issued).toBe(2);
    expect(next.prefix).toBe("unit");
  });

  it("resumes from a startAt without collisions", () => {
    const resumed = createIdGenerator<"unit">("unit", 4);
    expect(resumed.next()).toBe("unit-5");
  });

  it("keeps independent generators isolated", () => {
    const units = createIdGenerator<"unit">("unit");
    const posts = createIdGenerator<"post">("post");
    expect(units.next()).toBe("unit-1");
    expect(posts.next()).toBe("post-1");
    expect(units.next()).toBe("unit-2");
  });

  it("rejects a bad prefix or startAt", () => {
    expect(() => createIdGenerator("")).toThrowError(IdError);
    expect(() => createIdGenerator("   ")).toThrowError(IdError);
    expect(() => createIdGenerator("unit", -1)).toThrowError(IdError);
    expect(() => createIdGenerator("unit", 1.5)).toThrowError(IdError);
  });
});
