import { describe, expect, it } from "vitest";

import { createDemoBattle } from "../../src/app/demoScenario";
import { step } from "../../src/engine/battle";
import { chargeOf } from "../../src/engine/turn";
import { upcomingTurnOrder } from "../../src/ui/tempoOrder";

/**
 * T083 / T131 — Orders Tempo tray projection.
 *
 * The tray itself is a thin React view; the parts worth pinning in Node are the
 * pure projection `upcomingTurnOrder`, which must agree with the engine's
 * deterministic `previewTurns` forecast (T019), expose each soldier's current
 * charge for the bar (T131, peer lesson L13) and never mutate the battle.
 */

describe("T083 — Orders Tempo tray", () => {
  it("heads the tray with the soldier whose turn it is", () => {
    const battle = createDemoBattle();
    const order = upcomingTurnOrder(battle, 4);

    expect(order).toHaveLength(4);
    expect(order[0].unitId).toBe(battle.currentActorId);
    expect(order[0].unit.name).toBe("Sgt. Aubry");
    expect(order[0].isCurrent).toBe(true);

    // Speed decides the order (Sgt. Aubry 42, Cpl. Lefèvre 34); only the head
    // of the tray is the current turn.
    expect(order[1].unit.name).toBe("Cpl. Lefèvre");
    expect(order[1].isCurrent).toBe(false);
  });

  it("ranks the entries from one and flags exactly one current turn", () => {
    const order = upcomingTurnOrder(createDemoBattle(), 8);

    expect(order.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(order.filter((entry) => entry.isCurrent)).toHaveLength(1);
    // A fast soldier can appear more than once in the window; that repeat is
    // not the current turn.
    expect(new Set(order.map((entry) => entry.unitId)).size).toBeLessThan(8);
  });

  it("clamps the count and never mutates the battle", () => {
    const battle = createDemoBattle();
    const before = JSON.stringify(battle);

    expect(upcomingTurnOrder(battle, 0)).toEqual([]);
    expect(upcomingTurnOrder(battle, 2.9)).toHaveLength(2);

    expect(JSON.stringify(battle)).toBe(before);
  });
});

describe("T131 — charge bars in the Orders Tempo rail", () => {
  it("carries each soldier's current charge and its bar fraction", () => {
    const battle = createDemoBattle();
    const order = upcomingTurnOrder(battle, 6);

    for (const entry of order) {
      // The charge is read straight from the scheduler, never recomputed.
      expect(entry.charge).toBe(chargeOf(battle.tempo, entry.unitId));
      expect(entry.threshold).toBe(battle.tempo.threshold);
      expect(entry.chargeRatio).toBeGreaterThanOrEqual(0);
      expect(entry.chargeRatio).toBeLessThanOrEqual(1);
    }

    // The soldier on turn is ready, so their bar is full. A ready soldier may
    // carry overshoot (charge > threshold), which the ratio clamps to 1.
    expect(order[0].charge).toBeGreaterThanOrEqual(order[0].threshold);
    expect(order[0].chargeRatio).toBe(1);

    // A soldier appearing more than once in the window reports the same
    // *current* charge on every row — the projection runs no extra tempo maths.
    const chargeByUnit = new Map(order.map((entry) => [entry.unitId, entry.charge]));
    for (const entry of order) {
      expect(entry.charge).toBe(chargeByUnit.get(entry.unitId));
    }
  });

  it("re-sorts and re-derives the charge clock after every step", () => {
    const battle = createDemoBattle();
    const actorId = battle.currentActorId;
    expect(actorId).not.toBeNull();
    if (actorId === null) return;

    const before = upcomingTurnOrder(battle, 6);
    const chargeBefore = chargeOf(battle.tempo, actorId);
    expect(chargeBefore).toBeDefined();
    if (chargeBefore === undefined) return;
    expect(chargeBefore).toBeGreaterThanOrEqual(battle.tempo.threshold);

    const next = step(battle, { kind: "wait", unitId: actorId }).state;
    const after = upcomingTurnOrder(next, 6);

    // The tray re-sorts after the step: the spent soldier no longer heads it.
    expect(after.map((entry) => entry.unitId)).not.toEqual(before.map((entry) => entry.unitId));
    expect(after[0].unitId).not.toBe(actorId);

    // Charges are the post-step ones, read from the advanced scheduler, and
    // the soldier who just acted has spent a threshold.
    for (const entry of after) {
      expect(entry.charge).toBe(chargeOf(next.tempo, entry.unitId));
    }
    const chargeAfter = chargeOf(next.tempo, actorId);
    expect(chargeAfter).toBeDefined();
    if (chargeAfter === undefined) return;
    expect(chargeAfter).toBeLessThan(chargeBefore);
  });
});
