import { describe, expect, it } from "vitest";

import { createDemoBattle } from "../../src/app/demoScenario";
import { upcomingTurnOrder } from "../../src/ui/tempoOrder";

/**
 * T083 — Orders Tempo tray projection.
 *
 * The tray itself is a thin React view; the part worth pinning in Node is the
 * pure projection `upcomingTurnOrder`, which must agree with the engine's
 * deterministic `previewTurns` forecast (T019) and never mutate the battle.
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
