import { describe, expect, it } from "vitest";

import { asUnitId } from "../../src/engine/ids";
import type { UnitId } from "../../src/engine/ids";
import {
  TEMPO_THRESHOLD,
  advanceTick,
  advanceToNextTurn,
  cancelCharge,
  chargeOf,
  createOrdersTempo,
  previewTurns,
  readyActorIds,
  scheduleCharge,
  speedLookup,
  spendTurn,
  takeTurn,
  tempoSpeed,
} from "../../src/engine/turn";
import type { OrdersTempo, TempoSpeedOf, TempoTurn } from "../../src/engine/turn";

/* --------------------------------------------------------------------------
 * T019 — Orders Tempo (CTB scheduler)
 *
 * These tests pin the task's "done when": charge and time are **integer ticks**,
 * higher Speed acts **sooner and more often**, and the whole order is
 * **deterministic given a seed**. They also cover the supporting contract the
 * battle loop (T022) and the Orders Tempo tray (T083) rely on: pure updates,
 * JSON round-tripping, seeded tie-breaks and delayed (charging) effects.
 * ------------------------------------------------------------------------ */

const A = asUnitId("unit-a");
const B = asUnitId("unit-b");
const C = asUnitId("unit-c");

/** Build a fresh scheduler over the standard three soldiers. */
function makeState(
  unitIds: readonly UnitId[] = [A, B, C],
  options: Parameters<typeof createOrdersTempo>[1] = {},
): OrdersTempo {
  return createOrdersTempo(unitIds, options);
}

/** Run turns until `count` actions have been taken, returning the turn log. */
function runTurns(
  state: OrdersTempo,
  speedOf: TempoSpeedOf,
  count: number,
): { state: OrdersTempo; turns: TempoTurn[] } {
  let current = state;
  const turns: TempoTurn[] = [];
  for (let i = 0; i < count; i++) {
    const turn = takeTurn(current, speedOf);
    if (turn === null) break;
    turns.push(turn);
    current = turn.state;
  }
  return { state: current, turns };
}

describe("Orders Tempo — construction", () => {
  it("starts every soldier at zero charge on tick zero", () => {
    const state = makeState();
    expect(state.threshold).toBe(TEMPO_THRESHOLD);
    expect(state.tick).toBe(0);
    expect(state.entries.map((entry) => entry.unitId)).toEqual([A, B, C]);
    expect(state.entries.every((entry) => entry.charge === 0)).toBe(true);
    expect(state.entries.every((entry) => entry.pending.length === 0)).toBe(true);
  });

  it("honours the initial charge table and a custom threshold", () => {
    const state = createOrdersTempo([A, B], {
      threshold: 60,
      initialCharge: { [A]: 30 },
    });
    expect(state.threshold).toBe(60);
    expect(chargeOf(state, A)).toBe(30);
    expect(chargeOf(state, B)).toBe(0);
  });

  it("rejects malformed setups at the boundary", () => {
    expect(() => createOrdersTempo([A, A])).toThrow(/duplicate/);
    expect(() => createOrdersTempo([A], { threshold: 0 })).toThrow(/threshold/);
    expect(() => createOrdersTempo([A], { initialCharge: { [A]: -1 } })).toThrow(/initialCharge/);
    expect(() => createOrdersTempo([A], { initialCharge: { [A]: 1.5 } })).toThrow(/initialCharge/);
  });

  it("round-trips through JSON for saves and replays", () => {
    const state = makeState();
    const revived = JSON.parse(JSON.stringify(state)) as OrdersTempo;
    expect(revived).toEqual(state);
  });
});

describe("Orders Tempo — Speed", () => {
  it("doubles under Haste and halves (rounded down) under Slow", () => {
    expect(tempoSpeed(10)).toBe(10);
    expect(tempoSpeed(10, { haste: true })).toBe(20);
    expect(tempoSpeed(15, { slow: true })).toBe(7);
    expect(tempoSpeed(10, { haste: true, slow: true })).toBe(10);
  });

  it("throws for missing or malformed speeds", () => {
    const lookup = speedLookup({ [A]: 12 });
    expect(lookup(A)).toBe(12);
    expect(() => lookup(B)).toThrow(/no Orders Tempo speed/);
    expect(() => tempoSpeed(-1)).toThrow(/baseSpeed/);
  });
});

describe("Orders Tempo — integer ticking", () => {
  it("adds Speed and increments the clock by exactly one integer per tick", () => {
    const state = makeState([A, B]);
    const speedOf = speedLookup({ [A]: 10, [B]: 25 });

    const first = advanceTick(state, speedOf);
    expect(first.state.tick).toBe(1);
    expect(first.resolved).toEqual([]);
    expect(chargeOf(first.state, A)).toBe(10);
    expect(chargeOf(first.state, B)).toBe(25);
    expect(Number.isInteger(chargeOf(first.state, A))).toBe(true);

    const second = advanceTick(first.state, speedOf);
    expect(chargeOf(second.state, A)).toBe(20);
    expect(chargeOf(second.state, B)).toBe(50);

    // Purity: the original snapshot is untouched.
    expect(chargeOf(state, A)).toBe(0);
    expect(state.tick).toBe(0);
  });

  it("resolves charging effects when their integer timer elapses", () => {
    const state = makeState([A]);
    const speedOf = speedLookup({ [A]: 10 });
    const charged = scheduleCharge(state, { chargeId: "shot-1", unitId: A, remaining: 3 });

    const one = advanceTick(charged, speedOf);
    const two = advanceTick(one.state, speedOf);
    expect(one.resolved).toEqual([]);
    expect(two.resolved).toEqual([]);

    const three = advanceTick(two.state, speedOf);
    expect(three.resolved).toEqual([{ chargeId: "shot-1", unitId: A }]);
    expect(three.state.entries[0].pending).toEqual([]);
  });

  it("rejects duplicate, unknown or malformed charges", () => {
    const state = makeState([A]);
    const charged = scheduleCharge(state, { chargeId: "shot-1", unitId: A, remaining: 2 });
    expect(() => scheduleCharge(charged, { chargeId: "shot-1", unitId: A, remaining: 2 })).toThrow(
      /duplicate charge/,
    );
    expect(() => scheduleCharge(state, { chargeId: "x", unitId: B, remaining: 2 })).toThrow(
      /unknown unit/,
    );
    expect(() => scheduleCharge(state, { chargeId: "x", unitId: A, remaining: 0 })).toThrow(
      /charge.remaining/,
    );
  });

  it("cancels a pending charge and reports a no-op by identity", () => {
    const state = makeState([A]);
    const charged = scheduleCharge(state, { chargeId: "shot-1", unitId: A, remaining: 5 });
    const cancelled = cancelCharge(charged, "shot-1");
    expect(cancelled.entries[0].pending).toEqual([]);
    expect(cancelCharge(cancelled, "missing")).toBe(cancelled);
  });
});

describe("Orders Tempo — Speed decides when and how often", () => {
  it("lets the faster soldier act sooner", () => {
    const state = makeState([A, B]);
    const speedOf = speedLookup({ [A]: 10, [B]: 30 });

    const turn = takeTurn(state, speedOf);
    expect(turn).not.toBeNull();
    expect(turn?.actorId).toBe(B);
    // 100 charge at 30/tick needs 4 ticks (120 accumulated).
    expect(turn?.ticks).toBe(4);
  });

  it("lets the faster soldier act more often over a window", () => {
    const state = makeState([A, B]);
    const speedOf = speedLookup({ [A]: 10, [B]: 30 });

    const order = previewTurns(state, speedOf, 40);
    const fast = order.filter((id) => id === B).length;
    const slow = order.filter((id) => id === A).length;
    expect(fast).toBeGreaterThan(slow);
  });

  it("keeps the excess charge as progress toward the next turn", () => {
    const state = makeState([A]);
    const speedOf = speedLookup({ [A]: 30 });

    const first = takeTurn(state, speedOf);
    expect(first?.ticks).toBe(4);
    expect(chargeOf(first?.state as OrdersTempo, A)).toBe(20);

    const second = takeTurn(first?.state as OrdersTempo, speedOf);
    expect(second?.ticks).toBe(3);
    expect(chargeOf(second?.state as OrdersTempo, A)).toBe(10);
  });

  it("acts immediately when someone is already charged", () => {
    const state = createOrdersTempo([A], { initialCharge: { [A]: TEMPO_THRESHOLD } });
    expect(readyActorIds(state)).toEqual([A]);
    const turn = takeTurn(state, speedLookup({ [A]: 10 }));
    expect(turn?.ticks).toBe(0);
  });

  it("never drops charge below zero", () => {
    const state = createOrdersTempo([A], { initialCharge: { [A]: 50 } });
    const spent = spendTurn(state, A, 100);
    expect(chargeOf(spent, A)).toBe(0);
    expect(() => spendTurn(state, B)).toThrow(/unknown unit/);
  });

  it("stalls instead of looping when nobody can charge", () => {
    const state = makeState([A], { initialCharge: { [A]: 0 } });
    expect(advanceToNextTurn(state, speedLookup({ [A]: 0 }))).toBeNull();
  });

  it("respects a maximum wait", () => {
    const state = makeState([A]);
    const speedOf = speedLookup({ [A]: 1 });
    expect(advanceToNextTurn(state, speedOf, 10)).toBeNull();
    expect(advanceToNextTurn(state, speedOf, 100)?.actorId).toBe(A);
  });
});

describe("Orders Tempo — determinism", () => {
  it("breaks same-charge ties with the seeded stream only", () => {
    const state = makeState([A, B, C]);
    const speedOf = speedLookup({ [A]: 20, [B]: 20, [C]: 20 });

    const first = advanceToNextTurn(state, speedOf);
    expect(first?.state.rng.calls).toBe(1);
    expect(first?.state.rng.calls).toBeGreaterThan(state.rng.calls);

    // Distinct charges mean no tie, so the RNG stream is never touched.
    const spread = makeState([A, B]);
    const spreadTurn = advanceToNextTurn(spread, speedLookup({ [A]: 10, [B]: 30 }));
    expect(spreadTurn?.state.rng.calls).toBe(0);
  });

  it("produces identical orders for the same seed", () => {
    const speedOf = speedLookup({ [A]: 20, [B]: 20, [C]: 20 });
    const first = previewTurns(makeState([A, B, C], { seed: "quatre-bras" }), speedOf, 12);
    const second = previewTurns(makeState([A, B, C], { seed: "quatre-bras" }), speedOf, 12);
    expect(second).toEqual(first);
  });

  it("produces varied (but reproducible) orders across seeds", () => {
    const speedOf = speedLookup({ [A]: 20, [B]: 20, [C]: 20 });
    const sequences = ["a", "b", "c", "d"].map((seed) =>
      previewTurns(makeState([A, B, C], { seed }), speedOf, 10).join(","),
    );
    expect(new Set(sequences).size).toBeGreaterThan(1);
  });

  it("replays a scripted run byte-for-byte from the same seed", () => {
    const speedOf = speedLookup({ [A]: 12, [B]: 24, [C]: 24 });
    const run = () => runTurns(makeState([A, B, C], { seed: 1815 }), speedOf, 25).state;
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("previews without advancing the caller's state", () => {
    const state = makeState([A, B]);
    const speedOf = speedLookup({ [A]: 10, [B]: 30 });
    const before = JSON.stringify(state);
    previewTurns(state, speedOf, 6);
    expect(JSON.stringify(state)).toBe(before);
  });
});
