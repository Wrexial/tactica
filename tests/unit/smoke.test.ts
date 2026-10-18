import { describe, expect, it } from "vitest";

import { asUnitId, isValidId } from "../../src/engine/ids";

/**
 * T003 — Vitest unit-test setup smoke test.
 *
 * Deliberately tiny. Its job is to prove the runner, the TypeScript transform
 * and imports from `src/engine` resolve end to end, so a broken test harness
 * fails loudly at the foundation instead of surfacing inside a feature suite.
 * Real coverage lives in the feature specs.
 */
describe("vitest setup", () => {
  it("runs a TypeScript unit test", () => {
    const total: number = 1 + 1;
    expect(total).toBe(2);
  });

  it("resolves the engine layer from a test", () => {
    expect(isValidId(asUnitId("unit-smoke"))).toBe(true);
  });
});
