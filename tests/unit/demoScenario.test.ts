import { describe, expect, it } from "vitest";

import {
  advanceDemoBattle,
  createDemoBattle,
  demoAiHoldsTurn,
  runDemoTurn,
} from "../../src/app/demoScenario";
import { createSkirmishBattle, fieldAiHoldsTurn } from "../../src/app/skirmishScenario";
import { step, type BattleState } from "../../src/engine/battle";

/**
 * T143 — the opening sandbox Field runs the hostile pickets through the same
 * Field-AI driver as Quick Battle and the campaign.
 *
 * The demo action deliberately starts on a company soldier (Sgt. Aubry), so
 * these tests pass the company's opening turns and then prove the shared gate
 * hands control to the AI, that one paced step advances exactly one hostile
 * turn with its events, and that the full phase returns the Field to a company
 * soldier.
 */

/** Pass company turns until an AI-controlled picket holds the Orders Tempo. */
function passUntilAiHoldsTurn(battle: BattleState): BattleState {
  let current = battle;
  for (
    let guard = 0;
    guard < 12 && current.phase === "active" && !fieldAiHoldsTurn(current);
    guard++
  ) {
    const actorId = current.currentActorId;
    if (actorId === null) break;
    const result = step(current, { kind: "wait", unitId: actorId });
    if (result.rejection !== undefined) break;
    current = result.state;
  }
  return current;
}

describe("demo scenario Field AI", () => {
  it("fields the opening company and hands it the first turn", () => {
    const battle = createDemoBattle();
    expect(battle.units.filter((unit) => unit.side === "company")).toHaveLength(3);
    expect(battle.units.filter((unit) => unit.side === "enemy")).toHaveLength(3);

    const actor = battle.units.find((unit) => unit.id === battle.currentActorId);
    expect(actor?.name).toBe("Sgt. Aubry");
    expect(actor?.side).toBe("company");
    expect(demoAiHoldsTurn(battle)).toBe(false);
  });

  it("does not act while a company soldier holds the turn", () => {
    const battle = createDemoBattle();
    expect(runDemoTurn(battle)).toBeNull();
    expect(advanceDemoBattle(battle)).toBeNull();
  });

  it("gives the turn to a hostile picket after the company passes", () => {
    const battle = passUntilAiHoldsTurn(createDemoBattle());
    const actor = battle.units.find((unit) => unit.id === battle.currentActorId);

    expect(demoAiHoldsTurn(battle)).toBe(true);
    expect(fieldAiHoldsTurn(battle)).toBe(true);
    expect(actor?.side).toBe("enemy");
    expect(actor?.name).toMatch(/Picket|Watch/);
  });

  it("takes exactly one hostile turn and emits its AI events", () => {
    const battle = passUntilAiHoldsTurn(createDemoBattle());
    const update = runDemoTurn(battle);

    expect(update).not.toBeNull();
    if (update === null) return;

    expect(update.battle).not.toBe(battle);
    expect(update.events.length).toBeGreaterThan(0);
    expect(update.events.some((event) => event.kind === "turnEnded")).toBe(true);
    // One paced call closes exactly one Orders Tempo turn, so the Field loop can
    // animate each hostile action before asking the driver for the next.
    expect(update.events.filter((event) => event.kind === "turnEnded")).toHaveLength(1);
    expect(
      update.events.some(
        (event) =>
          event.kind === "moved" ||
          event.kind === "abilityUsed" ||
          event.kind === "abilityResolved",
      ),
    ).toBe(true);
  });

  it("runs the whole hostile phase and hands control back to the company", () => {
    const battle = passUntilAiHoldsTurn(createDemoBattle());
    const update = advanceDemoBattle(battle);

    expect(update).not.toBeNull();
    if (update === null) return;

    expect(update.events.length).toBeGreaterThan(0);
    const actor = update.battle.units.find((unit) => unit.id === update.battle.currentActorId);
    expect(actor?.side).toBe("company");
    expect(fieldAiHoldsTurn(update.battle)).toBe(false);
  });

  it("uses the same gate for the demo and Quick Battle boards", () => {
    // Neither board opens on an AI turn, and both expose the identical shared
    // predicate — the Field loop never needs a mode-specific "skip AI" branch.
    expect(fieldAiHoldsTurn(createDemoBattle())).toBe(false);
    expect(fieldAiHoldsTurn(createSkirmishBattle())).toBe(false);

    const demo = passUntilAiHoldsTurn(createDemoBattle());
    const skirmish = passUntilAiHoldsTurn(createSkirmishBattle());
    expect(fieldAiHoldsTurn(demo)).toBe(true);
    expect(fieldAiHoldsTurn(skirmish)).toBe(true);
  });
});
