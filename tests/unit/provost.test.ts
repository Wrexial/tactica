import { describe, expect, it } from "vitest";

import { ARTICLES } from "../../src/data/articles";
import type { StatBlock } from "../../src/data/schema";
import { isBattleEvent } from "../../src/engine/events";
import { coord } from "../../src/engine/grid";
import { IdError, asConditionId, asPostId, asRegionId, asUnitId } from "../../src/engine/ids";
import {
  CASUALTY_CLEAR_RANGE,
  PETRIFIED_CONDITION_ID,
  PROVOST_NAME,
  PROVOST_POST_ID,
  PROVOST_STATS,
  createProvost,
  findClearTile,
  findProvost,
  isCasualty,
  isCasualtyClearRefusal,
  isNonCombatant,
  isProvostAbsenceReason,
  isProvostUnit,
  issueCard,
  moveCasualty,
  type ProvostContext,
} from "../../src/engine/provost";
import { commission } from "../../src/engine/rules/articles";
import { createArticlesField, createNoMansLand } from "../../src/engine/rules/noMansLand";
import { createTerrainMap, withTile } from "../../src/engine/terrain";
import {
  addCondition,
  createUnit,
  type ActiveCondition,
  type Unit,
  type UnitSide,
} from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T066 — Provost entity
 *
 * Pins the task's "done when": a **neutral, non-combatant unit that issues
 * cards and moves casualties** (mapping §9). The entity lives in
 * `src/engine/provost.ts`; it reuses the T057/T058 escalation and removal
 * primitives and gates itself on the T065 field regime. The tests cover the
 * entity's identity, the Reprimand / Court-Martial rulings (with Commissions
 * and the commander game-over rule), and clearing KO'd / Petrified soldiers out
 * of the way.
 * ------------------------------------------------------------------------ */

const BASE_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 12,
  def: 8,
  mag: 4,
  res: 6,
  spd: 10,
  move: 4,
  jump: 2,
};

/** A neutral Provost Marshal on a fresh field. */
function marshal(x = 0, y = 0): Unit {
  return createProvost({
    id: asUnitId("provost"),
    power: "france",
    at: coord(x, y),
  });
}

/** A minimal valid soldier fixture. */
function soldier(
  id: string,
  x: number,
  y: number,
  side: UnitSide = "company",
  hp = BASE_STATS.hp,
): Unit {
  return createUnit({
    id: asUnitId(id),
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    side,
    level: 1,
    at: coord(x, y),
    stats: { ...BASE_STATS },
    hp,
  });
}

/** A casualty: either out of action or Petrified ("Broken", mapping §8). */
function casualty(id: string, x: number, y: number): Unit {
  return soldier(id, x, y, "company", 0);
}

function context(units: readonly Unit[], overrides: Partial<ProvostContext> = {}): ProvostContext {
  return {
    field: createArticlesField(asRegionId("peninsula")),
    units,
    map: createTerrainMap(5, 5, "field"),
    ...overrides,
  };
}

/* --------------------------------------------------------------------------
 * The entity
 * ------------------------------------------------------------------------ */

describe("Provost entity (T066)", () => {
  describe("identity", () => {
    it("creates a neutral, non-combatant marshal", () => {
      const provost = marshal(2, 3);

      expect(provost.id).toBe(asUnitId("provost"));
      expect(provost.name).toBe(PROVOST_NAME);
      expect(provost.side).toBe("neutral");
      expect(provost.postId).toBe(PROVOST_POST_ID);
      expect(provost.at).toEqual(coord(2, 3));
      expect(provost.stats).toEqual(PROVOST_STATS);
      // A non-combatant does not fight.
      expect(provost.stats.atk).toBe(0);
    });

    it("honours caller-supplied name, level, facing and stats", () => {
      const provost = createProvost({
        id: asUnitId("provost"),
        power: "britain",
        at: coord(1, 1),
        name: "Marshal Grey",
        level: 3,
        facing: "east",
        stats: { ...PROVOST_STATS, hp: 99 },
      });

      expect(provost.name).toBe("Marshal Grey");
      expect(provost.level).toBe(3);
      expect(provost.facing).toBe("east");
      expect(provost.stats.hp).toBe(99);
      // The powered school is fiction; neutrality is forced regardless.
      expect(provost.power).toBe("britain");
      expect(provost.side).toBe("neutral");
    });

    it.each([
      ["a null init", null],
      ["a non-object init", 7],
    ])("rejects %s", (_label, value) => {
      expect(() => createProvost(value as never)).toThrow(RangeError);
    });

    it("rejects an empty id and an unknown power through createUnit", () => {
      expect(() => createProvost({ id: "" as never, power: "france", at: coord(0, 0) })).toThrow(
        IdError,
      );
      expect(() =>
        createProvost({ id: asUnitId("p"), power: "spain" as never, at: coord(0, 0) }),
      ).toThrow(RangeError);
    });

    it("recognises only the neutral marshal as the Provost", () => {
      const provost = marshal();
      const company = soldier("a", 1, 0);
      const enemy = soldier("b", 2, 0, "enemy");
      const otherNeutral = createUnit({
        id: asUnitId("envoy"),
        name: "Envoys",
        power: "austria",
        postId: asPostId("surgeon"),
        side: "neutral",
        level: 1,
        at: coord(3, 0),
        stats: { ...BASE_STATS },
      });

      expect(isProvostUnit(provost)).toBe(true);
      expect(isProvostUnit(company)).toBe(false);
      expect(isProvostUnit(enemy)).toBe(false);
      expect(isProvostUnit(otherNeutral)).toBe(false);

      expect(findProvost([company, enemy, provost])).toBe(provost);
      expect(findProvost([company, enemy])).toBeUndefined();
    });

    it("marks every neutral unit non-combatant, and no one else", () => {
      expect(isNonCombatant(marshal())).toBe(true);
      expect(isNonCombatant({ side: "neutral" })).toBe(true);
      expect(isNonCombatant(soldier("a", 1, 0))).toBe(false);
      expect(isNonCombatant(soldier("b", 1, 0, "enemy"))).toBe(false);
    });

    it("recognises both KO'd and Petrified soldiers as casualties", () => {
      const downed = casualty("downed", 1, 1);
      const petrified = addCondition(soldier("stone", 2, 2), {
        conditionId: PETRIFIED_CONDITION_ID,
        duration: 0,
      } satisfies ActiveCondition);
      const standing = soldier("standing", 3, 3);
      const bleeding = addCondition(standing, {
        conditionId: asConditionId("poison"),
        duration: 3,
      });

      expect(isCasualty(downed)).toBe(true);
      expect(isCasualty(petrified)).toBe(true);
      expect(isCasualty(standing)).toBe(false);
      expect(isCasualty(bleeding)).toBe(false);
    });
  });
});

/* --------------------------------------------------------------------------
 * Issuing cards
 * ------------------------------------------------------------------------ */

describe("Provost issues cards", () => {
  it("gives a Reprimand for a first, non-lethal breach", () => {
    const provost = marshal();
    const offender = soldier("offender", 1, 1);

    const result = issueCard(context([provost, offender], { tick: 4 }), {
      unitId: offender.id,
      article: ARTICLES["no-fire"],
      record: { reprimands: 0 },
    });

    expect(result.ok).toBe(true);
    expect(result.card).toEqual({ severity: "reprimand", reprimands: 1 });
    expect(result.reprimands).toBe(1);
    expect(result.removed).toBeUndefined();
    expect(result.units).toEqual([provost, offender]);
    expect(result.events).toEqual([
      {
        kind: "articleBroken",
        tick: 4,
        unitId: offender.id,
        articleId: "no-fire",
        severity: "reprimand",
      },
      {
        kind: "reprimandIssued",
        tick: 4,
        unitId: offender.id,
        articleId: "no-fire",
        reprimands: 1,
      },
    ]);
  });

  it("gives a Court-Martial on a second offence and removes the soldier", () => {
    const provost = marshal();
    const offender = soldier("offender", 1, 1);
    const ally = soldier("ally", 2, 1);

    const result = issueCard(context([provost, offender, ally]), {
      unitId: offender.id,
      article: ARTICLES["no-fire"],
      record: { reprimands: 1 },
    });

    expect(result.card?.severity).toBe("courtMartial");
    expect(result.removed).toBe(offender);
    expect(result.units.map((unit) => unit.id)).toEqual([provost.id, ally.id]);
    expect(result.events.map((event) => event.kind)).toEqual([
      "articleBroken",
      "courtMartialIssued",
      "unitRemoved",
    ]);
  });

  it("gives a Court-Martial for an illegal knockout and for a grave Article", () => {
    const provost = marshal();
    const offender = soldier("offender", 1, 1);

    const illegalKo = issueCard(context([provost, offender]), {
      unitId: offender.id,
      article: ARTICLES["no-fire"],
      record: { reprimands: 0, illegalKo: true },
    });
    expect(illegalKo.card?.severity).toBe("courtMartial");

    const grave = issueCard(context([provost, offender]), {
      unitId: offender.id,
      article: ARTICLES["no-poison"],
      record: { reprimands: 0 },
    });
    expect(grave.card?.severity).toBe("courtMartial");
  });

  it("ends the action in defeat when the commander is court-martialled", () => {
    const provost = marshal();
    const commander = soldier("commander", 1, 1);
    const ally = soldier("ally", 2, 1);

    const result = issueCard(
      context([provost, commander, ally], { tick: 3, commanderId: commander.id }),
      {
        unitId: commander.id,
        article: ARTICLES["no-fire"],
        record: { reprimands: 1 },
      },
    );

    expect(result.commander).toBe(true);
    expect(result.outcome).toBe("companyDefeat");
    expect(result.finished).toBe(true);
    expect(result.events).toEqual([
      {
        kind: "articleBroken",
        tick: 3,
        unitId: commander.id,
        articleId: "no-fire",
        severity: "courtMartial",
      },
      { kind: "courtMartialIssued", tick: 3, unitId: commander.id, articleId: "no-fire" },
      { kind: "unitRemoved", tick: 3, unitId: commander.id, reason: "courtMartial" },
      { kind: "battleEnded", tick: 3, outcome: "companyDefeat" },
    ]);
  });

  it("caps a commissioned hero at a Reprimand, however grave the breach", () => {
    const provost = marshal();
    const hero = soldier("hero", 1, 1);

    const result = issueCard(context([provost, hero], { commissions: [commission(hero.id)] }), {
      unitId: hero.id,
      article: ARTICLES["no-poison"],
      record: { reprimands: 5 },
    });

    expect(result.card?.severity).toBe("reprimand");
    expect(result.immune).toBe(true);
    expect(result.removed).toBeUndefined();
    expect(result.units).toEqual([provost, hero]);
    expect(result.events.map((event) => event.kind)).toEqual(["articleBroken", "reprimandIssued"]);
  });

  it("refuses every card in a No-Man's Land", () => {
    const provost = marshal();
    const offender = soldier("offender", 1, 1);
    const units = [provost, offender];

    const result = issueCard(
      context(units, { field: createNoMansLand(asRegionId("jagd-dorsa")) }),
      { unitId: offender.id, article: ARTICLES["no-fire"], record: { reprimands: 0 } },
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("lawless");
    expect(result.events).toEqual([]);
    // The input roster is returned untouched (same array).
    expect(result.units).toBe(units);
  });

  it("refuses when no marshal is deployed", () => {
    const offender = soldier("offender", 1, 1);

    const result = issueCard(context([offender]), {
      unitId: offender.id,
      article: ARTICLES["no-fire"],
      record: { reprimands: 0 },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-provost");
    expect(result.events).toEqual([]);
  });

  it("rejects an unknown offender, a commend Article and a malformed tick", () => {
    const provost = marshal();
    const offender = soldier("offender", 1, 1);
    const units = [provost, offender];

    expect(() =>
      issueCard(context(units), {
        unitId: asUnitId("ghost"),
        article: ARTICLES["no-fire"],
        record: { reprimands: 0 },
      }),
    ).toThrow(RangeError);

    expect(() =>
      issueCard(context(units), {
        unitId: offender.id,
        article: ARTICLES["commend-colours"],
        record: { reprimands: 0 },
      }),
    ).toThrow(RangeError);

    expect(() =>
      issueCard(context(units, { tick: -1 }), {
        unitId: offender.id,
        article: ARTICLES["no-fire"],
        record: { reprimands: 0 },
      }),
    ).toThrow(RangeError);
  });

  it("emits only well-formed battle events and never mutates its inputs", () => {
    const provost = marshal();
    const offender = soldier("offender", 1, 1);
    const units = [provost, offender];

    const result = issueCard(context(units), {
      unitId: offender.id,
      article: ARTICLES["no-fire"],
      record: { reprimands: 1 },
    });

    for (const event of result.events) {
      expect(isBattleEvent(event), JSON.stringify(event)).toBe(true);
    }
    // The offender was removed in the result, but the input roster is intact.
    expect(units).toHaveLength(2);
    expect(units[1]).toBe(offender);
  });

  it("exposes runtime guards over its closed reason sets", () => {
    expect(isProvostAbsenceReason("lawless")).toBe(true);
    expect(isProvostAbsenceReason("no-provost")).toBe(true);
    expect(isProvostAbsenceReason("blocked")).toBe(false);
    expect(isCasualtyClearRefusal("blocked")).toBe(true);
    expect(isCasualtyClearRefusal("no-provost")).toBe(true);
    expect(isCasualtyClearRefusal("nonsense")).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Moving casualties
 * ------------------------------------------------------------------------ */

describe("Provost moves casualties", () => {
  it("clears a KO'd soldier to the nearest free tile", () => {
    const provost = marshal(0, 0);
    const downed = casualty("downed", 2, 2);

    const result = moveCasualty(context([provost, downed], { tick: 7 }), {
      unitId: downed.id,
    });

    expect(result.ok).toBe(true);
    expect(result.from).toEqual(coord(2, 2));
    // Nearest free tile, ties broken north→south then west→east: (2, 1).
    expect(result.to).toEqual(coord(2, 1));
    expect(result.moved?.at).toEqual(coord(2, 1));
    expect(result.events).toEqual([
      { kind: "shoved", tick: 7, unitId: downed.id, from: coord(2, 2), to: coord(2, 1) },
    ]);
    const relocated = result.units.find((unit) => unit.id === downed.id);
    expect(relocated?.at).toEqual(coord(2, 1));
    // The input roster is not mutated.
    expect(downed.at).toEqual(coord(2, 2));
  });

  it("clears a Petrified soldier too", () => {
    const provost = marshal(0, 0);
    const petrified = addCondition(soldier("stone", 2, 2), {
      conditionId: PETRIFIED_CONDITION_ID,
      duration: 0,
    });

    const result = moveCasualty(context([provost, petrified]), {
      unitId: petrified.id,
    });
    expect(result.ok).toBe(true);
    expect(result.moved?.at).toEqual(coord(2, 1));
  });

  it("honours an explicit destination", () => {
    const provost = marshal(0, 0);
    const downed = casualty("downed", 2, 2);

    const result = moveCasualty(context([provost, downed]), {
      unitId: downed.id,
      to: coord(0, 4),
    });

    expect(result.ok).toBe(true);
    expect(result.to).toEqual(coord(0, 4));
    expect(result.moved?.at).toEqual(coord(0, 4));
  });

  it("treats an explicit request to the casualty's own tile as a no-op", () => {
    const provost = marshal(0, 0);
    const downed = casualty("downed", 2, 2);

    const result = moveCasualty(context([provost, downed]), {
      unitId: downed.id,
      to: coord(2, 2),
    });

    expect(result.ok).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.moved).toBe(downed);
    expect(result.from).toEqual(coord(2, 2));
    expect(result.to).toEqual(coord(2, 2));
  });

  it("refuses to clear a casualty in a No-Man's Land or with no marshal", () => {
    const provost = marshal(0, 0);
    const downed = casualty("downed", 2, 2);

    const lawless = moveCasualty(
      context([provost, downed], { field: createNoMansLand(asRegionId("jagd")) }),
      { unitId: downed.id },
    );
    expect(lawless.ok).toBe(false);
    expect(lawless.reason).toBe("lawless");

    const marshalless = moveCasualty(context([downed]), { unitId: downed.id });
    expect(marshalless.ok).toBe(false);
    expect(marshalless.reason).toBe("no-provost");
  });

  it("refuses an occupied, impassable or off-map destination", () => {
    const provost = marshal(0, 0);
    const downed = casualty("downed", 2, 2);
    const map = withTile(createTerrainMap(5, 5, "field"), coord(1, 0), "wall");
    const ctx = context([provost, downed], { map });

    expect(moveCasualty(ctx, { unitId: downed.id, to: coord(0, 0) }).reason).toBe("occupied");
    expect(moveCasualty(ctx, { unitId: downed.id, to: coord(1, 0) }).reason).toBe("impassable");
    expect(moveCasualty(ctx, { unitId: downed.id, to: coord(9, 9) }).reason).toBe("out-of-bounds");
  });

  it("reports 'blocked' when no free tile is within clearing range", () => {
    // A 2×1 field: the marshal holds one tile, the casualty's own tile is
    // excluded, so there is nowhere to clear the body to.
    const provost = marshal(0, 0);
    const downed = casualty("downed", 1, 0);
    const ctx = context([provost, downed], { map: createTerrainMap(2, 1, "field") });

    const result = moveCasualty(ctx, { unitId: downed.id });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("blocked");
    expect(result.units).toBe(ctx.units);
  });

  it("stays within its clearing range", () => {
    const downed = casualty("downed", 4, 4);

    // Cordon the casualty with soldiers out to the full clearing range, but
    // leave (4, 7) — exactly three steps south — free.
    const ring: Unit[] = [];
    let n = 0;
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const distance = Math.abs(x - 4) + Math.abs(y - 4);
        if (distance === 0 || distance > CASUALTY_CLEAR_RANGE) continue;
        if (x === 4 && y === 7) continue;
        ring.push(soldier(`ring-${n++}`, x, y));
      }
    }
    const map = createTerrainMap(9, 9, "field");

    expect(findClearTile(context([downed, ...ring], { map }), downed)).toEqual(coord(4, 7));

    // Close the last gap: the nearest free tile is now four steps away, beyond
    // the Provost's reach.
    const sealed = [...ring, soldier("ring-close", 4, 7)];
    expect(findClearTile(context([downed, ...sealed], { map }), downed)).toBeUndefined();
    expect(
      moveCasualty(context([marshal(0, 0), downed, ...sealed], { map }), {
        unitId: downed.id,
      }).reason,
    ).toBe("blocked");
    expect(CASUALTY_CLEAR_RANGE).toBe(3);
  });

  it("rejects a non-casualty, an unknown soldier and a malformed tick", () => {
    const provost = marshal(0, 0);
    const standing = soldier("standing", 1, 1);
    const downed = casualty("downed", 2, 2);
    const units = [provost, standing, downed];

    expect(() => moveCasualty(context(units), { unitId: standing.id })).toThrow(RangeError);
    expect(() => moveCasualty(context(units), { unitId: asUnitId("ghost") })).toThrow(RangeError);
    expect(() => moveCasualty(context(units, { tick: 1.5 }), { unitId: downed.id })).toThrow(
      RangeError,
    );
  });

  it("is deterministic and emits only well-formed events", () => {
    const build = () => context([marshal(0, 0), casualty("downed", 3, 3)], { tick: 2 });
    const first = moveCasualty(build(), { unitId: asUnitId("downed") });
    const second = moveCasualty(build(), { unitId: asUnitId("downed") });

    expect(first).toEqual(second);
    for (const event of first.events) {
      expect(isBattleEvent(event), JSON.stringify(event)).toBe(true);
    }
  });
});
