import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONTROL_POLICY, autoBattleAllies } from "../../src/app/autoBattle";
import { AGGRESSIVE_FIELD_AI, runAiUntilPlayer } from "../../src/app/battleRunner";
import { createSkirmishBattle } from "../../src/app/skirmishScenario";
import { chooseTurn } from "../../src/ai/utility";
import { step } from "../../src/engine/battle";
import { executeAbility, type AbilitySpec } from "../../src/engine/actions/ability";
import { Rng } from "../../src/engine/rng";

describe("debug", () => {
  it("logs", () => {
    const lines: string[] = [];
    const policy = autoBattleAllies(DEFAULT_CONTROL_POLICY, "all");
    let battle = createSkirmishBattle();
    for (let i = 0; i < 60 && battle.phase !== "finished"; i++) {
      const run = runAiUntilPlayer(battle, { policy, ai: AGGRESSIVE_FIELD_AI, maxTurns: 24 });
      if (run.state === battle) {
        lines.push(`STALLED at ${i} ${battle.phase} ${battle.currentActorId}`);
        break;
      }
      battle = run.state;
      lines.push(
        `iter ${i} ${battle.phase} ${battle.currentActorId} ` +
          battle.units
            .map(
              (u) =>
                `${u.name} ${u.at.x},${u.at.y} h${battle.map.tiles[u.at.y * battle.map.grid.width + u.at.x]?.height} hp${u.hp} mp${u.mp} cond[${u.conditions.map((c) => c.id).join(",")}] facing${u.facing}`,
            )
            .join(" | "),
      );
    }
    lines.push(`done ${battle.phase} ${battle.outcome}`);
    if (battle.phase === "active" && battle.currentActorId !== null) {
      const plan = chooseTurn(battle, battle.currentActorId, AGGRESSIVE_FIELD_AI);
      lines.push(`plan ${JSON.stringify(plan)}`);
      let work = battle;
      for (const command of plan.commands) {
        const result = step(work, command);
        lines.push(
          `cmd ${JSON.stringify(command)} rejection ${JSON.stringify(result.rejection)} events ${JSON.stringify(result.events)}`,
        );
        work = result.state;
      }
      lines.push(
        `after ${work.units.map((u) => `${u.name} hp${u.hp}`).join(" | ")} actor ${work.currentActorId}`,
      );
      const spec = battle.abilities["bayonet-charge"]!;
      const sapper = battle.units.find((u) => u.id === battle.currentActorId)!;
      const aubry = battle.units.find((u) => u.name === "Sgt. Aubry")!;
      const abilitySpec: AbilitySpec = {
        ...spec,
        target: spec.target ?? "enemy",
        effects: spec.effects ?? [{ kind: "steel", power: spec.power }],
      };
      const exec = executeAbility(
        battle,
        sapper,
        abilitySpec,
        { kind: "unit", unitId: aubry.id },
        new Rng("debug"),
      );
      lines.push(
        `exec ${JSON.stringify({ spec: abilitySpec, ok: exec.ok, affected: exec.targeting.affected.length, events: exec.events })}`,
      );
    }
    writeFileSync("debug-log.txt", lines.join("\n"));
    expect(true).toBe(true);
  });
});
