import { describe, expect, it } from "vitest";

import { DEFAULT_CONTROL_POLICY, autoBattleAllies } from "../../src/app/autoBattle";
import { AGGRESSIVE_FIELD_AI, runAiUntilPlayer } from "../../src/app/battleRunner";
import { advanceSkirmishBattle, createSkirmishBattle } from "../../src/app/skirmishScenario";
import { step } from "../../src/engine/battle";

/**
 * Quick Battle — the preset two-team scene.
 *
 * `createSkirmishBattle` is authored content assembled through the public
 * engine factories, so these tests pin the *scene contract*: two full teams, an
 * annihilation objective, the company on the opening turn, determinism, and —
 * most importantly — that it is a real fight the AI can play to a decisive end.
 */
describe("quick battle scene", () => {
  it("fields two preset teams of four", () => {
    const battle = createSkirmishBattle();
    const company = battle.units.filter((unit) => unit.side === "company");
    const enemies = battle.units.filter((unit) => unit.side === "enemy");
    expect(company).toHaveLength(4);
    expect(enemies).toHaveLength(4);
    expect(company.map((unit) => unit.name)).toEqual([
      "Sgt. Aubry",
      "Cpl. Bouvet",
      "Pte. Okafor",
      "Dr. Marchand",
    ]);
    expect(battle.objective?.objective.kind).toBe("annihilation");
    expect(battle.phase).toBe("active");
  });

  it("hands the opening turn to the company", () => {
    const battle = createSkirmishBattle();
    const actor = battle.units.find((unit) => unit.id === battle.currentActorId);
    expect(actor?.side).toBe("company");
    expect(actor?.name).toBe("Pte. Okafor");
  });

  it("is deterministic for a fixed seed", () => {
    const shape = (battle: ReturnType<typeof createSkirmishBattle>) =>
      JSON.stringify(
        battle.units.map((unit) => ({ id: unit.id, at: unit.at, hp: unit.hp, side: unit.side })),
      );
    expect(shape(createSkirmishBattle())).toBe(shape(createSkirmishBattle()));
  });

  it("does not act while the company holds the turn", () => {
    expect(advanceSkirmishBattle(createSkirmishBattle())).toBeNull();
  });

  it("takes enemy turns and hands control back to the company", () => {
    // Pass the company's opening turns until an enemy holds the turn.
    let battle = createSkirmishBattle();
    for (let guard = 0; guard < 8 && battle.phase === "active"; guard++) {
      const actor = battle.units.find((unit) => unit.id === battle.currentActorId);
      if (actor === undefined || actor.side === "enemy") break;
      battle = step(battle, { kind: "wait", unitId: actor.id }).state;
    }

    const update = advanceSkirmishBattle(battle);
    expect(update).not.toBeNull();
    const actor = update!.battle.units.find((unit) => unit.id === update!.battle.currentActorId);
    expect(actor === undefined || actor.side === "company").toBe(true);
  });

  it("plays to a decisive objective under full auto-battle", () => {
    const policy = autoBattleAllies(DEFAULT_CONTROL_POLICY, "all");
    let battle = createSkirmishBattle();
    for (let i = 0; i < 60 && battle.phase !== "finished"; i++) {
      const run = runAiUntilPlayer(battle, { policy, ai: AGGRESSIVE_FIELD_AI, maxTurns: 24 });
      if (run.state === battle) break; // stalled or no actor — bail rather than spin
      battle = run.state;
    }
    expect(battle.phase).toBe("finished");
    expect(["companyVictory", "companyDefeat", "draw"]).toContain(battle.outcome);
  });
});
