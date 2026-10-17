import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import { executeAbility, type AbilitySpec } from "../../src/engine/actions/ability";
import { createBattle, findUnit, type BattleState } from "../../src/engine/battle";
import { coord } from "../../src/engine/grid";
import {
  asAbilityId,
  asConditionId,
  asEquipmentId,
  asPostId,
  asUnitId,
} from "../../src/engine/ids";
import { Rng } from "../../src/engine/rng";
import { createTerrainMap } from "../../src/engine/terrain";
import {
  applyCritRate,
  applyDamageTaken,
  applyElanCost,
  applyElementAffinity,
  applyEvasion,
  applyExtraAttacks,
  applyHitRate,
  applyPower,
  allowsEquip,
  CONSTITUTION_RESISTS,
  COLD_STEEL_BONUS,
  equippedTrait,
  equippedTraitKinds,
  equippedTraits,
  learnsAbility,
  makeTraitContext,
  POWDER_DISCIPLINE_BONUS,
  protectsEquipment,
  resistsCondition,
  STEADY_AIM_BONUS,
  THRIFT_COST_DIVISOR,
  TRAITS,
  TRAIT_IDS,
  traitDefinitionFor,
  traitKindOf,
  TWO_HANDED_GRIP_BONUS,
  withTraits,
  type TraitContext,
  type TraitOptions,
} from "../../src/engine/traits";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T043 — Support traits
 *
 * Pins the task's "done when": passive modifiers (**Thrift**, **Drilled
 * Guards**, **Two-Handed Grip**, ...) resolved through composable hooks
 * (mapping §6). The tests cover trait identity, the loadout/composition layer,
 * each hook resolver, the `withTraits` spec transformer and purity — all
 * deterministically and without mutating inputs (`agents.md` §2).
 * ------------------------------------------------------------------------ */

const BEARER_ID = asUnitId("unit-bearer");
const FOE_ID = asUnitId("unit-foe");

const STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 20,
  def: 8,
  mag: 30,
  res: 10,
  spd: 12,
  move: 4,
  jump: 2,
};

function makeUnit(overrides: Partial<UnitInit> = {}): Unit {
  return createUnit({
    id: BEARER_ID,
    name: "Bearer",
    power: "france",
    postId: asPostId("fusilier"),
    side: "company",
    level: 1,
    at: coord(1, 1),
    stats: { ...STATS },
    ...overrides,
  });
}

/** A soldier with an occupied offhand, so Two-Handed Grip does not apply. */
function makeShieldedUnit(): Unit {
  return makeUnit({
    equipment: { offhand: asEquipmentId("buckler") },
  });
}

function context(bearer: Unit, overrides: Partial<TraitContext> = {}): TraitContext {
  return makeTraitContext({ unit: bearer, role: "attacker", channel: "steel", ...overrides });
}

function loadoutFor(kind: string): TraitOptions {
  return { loadout: { [BEARER_ID]: kind as never } };
}

/* --------------------------------------------------------------------------
 * Identity
 * ------------------------------------------------------------------------ */

describe("traits — identity", () => {
  it("maps every FFTA id to its retheme kind", () => {
    expect(traitKindOf(TRAIT_IDS.thrift)).toBe("thrift");
    expect(traitKindOf("drilled-guards")).toBe("drilledGuards");
    expect(traitKindOf(TRAIT_IDS.twoHandedGrip)).toBe("twoHandedGrip");
    expect(traitKindOf(asAbilityId("not-a-trait"))).toBeUndefined();
  });

  it("gives every trait a Napoleonic name and description", () => {
    for (const kind of Object.keys(TRAITS) as (keyof typeof TRAITS)[]) {
      const def = TRAITS[kind];
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.id).toBe(TRAIT_IDS[kind]);
    }
  });

  it("uses the mapping's names for the named traits", () => {
    expect(TRAITS.thrift.name).toBe("Thrift");
    expect(TRAITS.drilledGuards.name).toBe("Drilled Guards");
    expect(TRAITS.twoHandedGrip.name).toBe("Two-Handed Grip");
  });
});

/* --------------------------------------------------------------------------
 * Loadout and composition
 * ------------------------------------------------------------------------ */

describe("traits — loadout & composition", () => {
  it("reads a single equipped trait by kind or id", () => {
    const soldier = makeUnit();
    expect(equippedTrait(soldier, loadoutFor("thrift"))).toBe("thrift");
    expect(equippedTrait(soldier, { loadout: { [BEARER_ID]: TRAIT_IDS.coldSteel } })).toBe(
      "coldSteel",
    );
    expect(equippedTrait(soldier)).toBeUndefined();
  });

  it("reads several traits and deduplicates them in order", () => {
    const soldier = makeUnit();
    const kinds = equippedTraitKinds(soldier, {
      loadoutMany: { [BEARER_ID]: ["thrift", TRAIT_IDS.thrift, "coldSteel"] },
    });
    expect(kinds).toEqual(["thrift", "coldSteel"]);
  });

  it("prefers traitsOf over the loadouts and ignores unknown ids", () => {
    const soldier = makeUnit();
    const kinds = equippedTraitKinds(soldier, {
      loadout: { [BEARER_ID]: "thrift" },
      traitsOf: () => ["twinBlades", asAbilityId("ghost-trait")],
    });
    expect(kinds).toEqual(["twinBlades"]);
  });

  it("applies per-resolution hook overrides without touching the base def", () => {
    const soldier = makeUnit();
    const options: TraitOptions = {
      loadout: { [BEARER_ID]: "coldSteel" },
      overrides: { coldSteel: { power: (base) => base + 7 } },
    };
    expect(traitDefinitionFor("coldSteel", options).hooks.power?.(100, context(soldier))).toBe(107);
    // The shared definition is untouched.
    expect(TRAITS.coldSteel.hooks.power?.(100, context(soldier))).toBe(125);
  });

  it("composes hooks in loadout order", () => {
    const soldier = makeUnit();
    const options: TraitOptions = {
      loadoutMany: { [BEARER_ID]: ["thrift", "deathOrGlory"] },
      overrides: {
        thrift: { elanCost: (base) => base - 3 },
        deathOrGlory: { elanCost: (base) => base * 2 },
      },
    };
    // (10 − 3) × 2 = 14
    expect(applyElanCost(10, context(soldier), options)).toBe(14);
    // Reversed order: 10 × 2 − 3 = 17
    expect(
      applyElanCost(10, context(soldier), {
        ...options,
        loadoutMany: { [BEARER_ID]: ["deathOrGlory", "thrift"] },
      }),
    ).toBe(17);
  });

  it("exposes the composed trait definitions", () => {
    const soldier = makeUnit();
    const defs = equippedTraits(soldier, loadoutFor("constitution"));
    expect(defs).toHaveLength(1);
    expect(defs[0]?.kind).toBe("constitution");
  });
});

/* --------------------------------------------------------------------------
 * Élan cost — Thrift / Death or Glory
 * ------------------------------------------------------------------------ */

describe("traits — Élan cost", () => {
  it("Thrift halves a cost, keeping a positive cost at 1", () => {
    const soldier = makeUnit();
    const options = loadoutFor("thrift");
    expect(applyElanCost(10, context(soldier), options)).toBe(10 / THRIFT_COST_DIVISOR);
    expect(applyElanCost(9, context(soldier), options)).toBe(4);
    expect(applyElanCost(1, context(soldier), options)).toBe(1);
    expect(applyElanCost(0, context(soldier), options)).toBe(0);
  });

  it("Death or Glory doubles the cost", () => {
    const soldier = makeUnit();
    expect(applyElanCost(10, context(soldier), loadoutFor("deathOrGlory"))).toBe(20);
  });

  it("leaves the cost alone with no trait equipped", () => {
    const soldier = makeUnit();
    expect(applyElanCost(10, context(soldier))).toBe(10);
  });
});

/* --------------------------------------------------------------------------
 * Accuracy and criticals — Steady Aim / Death or Glory
 * ------------------------------------------------------------------------ */

describe("traits — accuracy & criticals", () => {
  it("Steady Aim adds its flat bonus to the hit rate", () => {
    const soldier = makeUnit();
    expect(applyHitRate(70, context(soldier), loadoutFor("steadyAim"))).toBe(70 + STEADY_AIM_BONUS);
  });

  it("clamps the hit rate into [0, 100]", () => {
    const soldier = makeUnit();
    expect(applyHitRate(95, context(soldier), loadoutFor("steadyAim"))).toBe(100);
  });

  it("Death or Glory improves accuracy as well as power", () => {
    const soldier = makeUnit();
    expect(applyHitRate(70, context(soldier), loadoutFor("deathOrGlory"))).toBe(90);
  });

  it("routes crit-rate through overridable hooks", () => {
    const soldier = makeUnit();
    expect(applyCritRate(0, context(soldier))).toBe(0);
    expect(
      applyCritRate(0, context(soldier), {
        loadout: { [BEARER_ID]: "thrift" },
        overrides: { thrift: { critRate: (base) => base + 15 } },
      }),
    ).toBe(15);
  });
});

/* --------------------------------------------------------------------------
 * Power — Cold Steel / Powder Discipline / Two-Handed Grip
 * ------------------------------------------------------------------------ */

describe("traits — power", () => {
  it("Cold Steel boosts only the Steel channel", () => {
    const soldier = makeUnit();
    const options = loadoutFor("coldSteel");
    expect(applyPower(100, context(soldier, { channel: "steel" }), options)).toBe(
      100 + COLD_STEEL_BONUS,
    );
    expect(applyPower(100, context(soldier, { channel: "powder" }), options)).toBe(100);
    expect(applyPower(100, context(soldier, { channel: "none" }), options)).toBe(100);
  });

  it("Powder Discipline boosts only the Powder channel", () => {
    const soldier = makeUnit();
    const options = loadoutFor("powderDiscipline");
    expect(applyPower(100, context(soldier, { channel: "powder" }), options)).toBe(
      100 + POWDER_DISCIPLINE_BONUS,
    );
    expect(applyPower(100, context(soldier, { channel: "steel" }), options)).toBe(100);
  });

  it("Two-Handed Grip boosts Steel only with a free offhand", () => {
    const free = makeUnit();
    const shielded = makeShieldedUnit();
    const options = loadoutFor("twoHandedGrip");
    expect(applyPower(100, context(free, { channel: "steel" }), options)).toBe(
      100 + TWO_HANDED_GRIP_BONUS,
    );
    expect(applyPower(100, context(shielded, { channel: "steel" }), options)).toBe(100);
    expect(applyPower(100, context(free, { channel: "powder" }), options)).toBe(100);
  });

  it("does not fire for a defender's own trait", () => {
    const soldier = makeUnit();
    expect(applyPower(100, context(soldier, { role: "defender" }), loadoutFor("coldSteel"))).toBe(
      100,
    );
  });
});

/* --------------------------------------------------------------------------
 * Defence, evasion and strokes — Drilled Guards / Twin Blades
 * ------------------------------------------------------------------------ */

describe("traits — defence & strokes", () => {
  it("Drilled Guards reduces incoming Steel for the defender", () => {
    const soldier = makeUnit();
    const options = loadoutFor("drilledGuards");
    expect(
      applyDamageTaken(100, context(soldier, { role: "defender", channel: "steel" }), options),
    ).toBe(75);
    expect(
      applyDamageTaken(100, context(soldier, { role: "defender", channel: "powder" }), options),
    ).toBe(100);
    expect(
      applyDamageTaken(100, context(soldier, { role: "attacker", channel: "steel" }), options),
    ).toBe(100);
  });

  it("never reduces damage below zero", () => {
    const soldier = makeUnit();
    const options: TraitOptions = {
      loadout: { [BEARER_ID]: "drilledGuards" },
      overrides: { drilledGuards: { damageTaken: () => -50 } },
    };
    expect(applyDamageTaken(10, context(soldier, { role: "defender" }), options)).toBe(0);
  });

  it("Twin Blades adds an extra weapon stroke", () => {
    const soldier = makeUnit();
    expect(applyExtraAttacks(1, context(soldier), loadoutFor("twinBlades"))).toBe(2);
    expect(applyExtraAttacks(1, context(soldier))).toBe(1);
  });

  it("routes evasion through overridable hooks", () => {
    const soldier = makeUnit();
    expect(applyEvasion(5, context(soldier, { role: "defender" }))).toBe(5);
    expect(
      applyEvasion(5, context(soldier, { role: "defender" }), {
        loadout: { [BEARER_ID]: "drilledGuards" },
        overrides: { drilledGuards: { evasion: (base) => base + 3 } },
      }),
    ).toBe(8);
  });
});

/* --------------------------------------------------------------------------
 * Conditions and elements — Constitution / Elemental Knowledge
 * ------------------------------------------------------------------------ */

describe("traits — conditions & elements", () => {
  it("Constitution resists every listed ailment and nothing else", () => {
    const soldier = makeUnit();
    const options = loadoutFor("constitution");
    for (const id of CONSTITUTION_RESISTS) {
      expect(resistsCondition(id, context(soldier), options)).toBe(true);
    }
    expect(resistsCondition(asConditionId("pinned"), context(soldier), options)).toBe(false);
    expect(resistsCondition(asConditionId("bleeding"), context(soldier))).toBe(false);
  });

  it("Elemental Knowledge downgrades the target's affinity by one level", () => {
    const soldier = makeUnit();
    const options = loadoutFor("elementalKnowledge");
    const ctx = context(soldier, { channel: "powder", element: "fire" });
    expect(applyElementAffinity("resist", "fire", ctx, options)).toBe("weak");
    expect(applyElementAffinity("absorb", "fire", ctx, options)).toBe("immune");
    expect(applyElementAffinity("neutral", "fire", ctx, options)).toBe("weak");
    expect(applyElementAffinity("weak", "fire", ctx, options)).toBe("weak");
  });

  it("does not alter affinity for a defender's own trait", () => {
    const soldier = makeUnit();
    expect(
      applyElementAffinity(
        "resist",
        "fire",
        context(soldier, { role: "defender" }),
        loadoutFor("elementalKnowledge"),
      ),
    ).toBe("resist");
  });
});

/* --------------------------------------------------------------------------
 * Equipment & meta — Shield Drill / Light Grip / Kit Care / Foreign Drill
 * ------------------------------------------------------------------------ */

describe("traits — equipment & meta", () => {
  it("Shield Drill grants the use of a shield in the offhand", () => {
    const soldier = makeUnit();
    const options = loadoutFor("shieldDrill");
    expect(allowsEquip({ slot: "offhand", shield: true }, context(soldier), options)).toBe(true);
    expect(allowsEquip({ slot: "offhand", shield: false }, context(soldier), options)).toBe(false);
    expect(allowsEquip({ slot: "offhand", shield: true }, context(soldier))).toBe(false);
  });

  it("Light Grip grants one-handed use of a two-handed weapon", () => {
    const soldier = makeUnit();
    const options = loadoutFor("lightGrip");
    expect(
      allowsEquip(
        { slot: "weapon", weaponType: "musket", twoHanded: true },
        context(soldier),
        options,
      ),
    ).toBe(true);
    expect(
      allowsEquip(
        { slot: "weapon", weaponType: "sabre", twoHanded: false },
        context(soldier),
        options,
      ),
    ).toBe(false);
  });

  it("Kit Care protects the bearer's equipment", () => {
    const soldier = makeUnit();
    expect(protectsEquipment(context(soldier), loadoutFor("kitCare"))).toBe(true);
    expect(protectsEquipment(context(soldier))).toBe(false);
  });

  it("Foreign Drill lets the bearer learn an enemy action", () => {
    const soldier = makeUnit();
    expect(
      learnsAbility(asAbilityId("enemy-charge"), context(soldier), loadoutFor("foreignDrill")),
    ).toBe(true);
    expect(learnsAbility(asAbilityId("enemy-charge"), context(soldier))).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Applying traits to an action spec
 * ------------------------------------------------------------------------ */

describe("withTraits", () => {
  function spec(): AbilitySpec {
    return {
      id: asAbilityId("test-action"),
      mpCost: 10,
      chargeTime: 0,
      range: 4,
      power: 100,
      target: "enemy",
      hitRate: 70,
      effects: [
        { kind: "steel", power: 100 },
        { kind: "powder", power: 100, element: "lightning" },
        { kind: "heal", power: 40 },
      ],
    };
  }

  it("adjusts cost, accuracy and only the matching effect powers", () => {
    const soldier = makeUnit();
    const aimed = withTraits(spec(), soldier, {
      loadoutMany: { [BEARER_ID]: ["steadyAim", "coldSteel"] },
    });

    expect(aimed.mpCost).toBe(10);
    expect(aimed.hitRate).toBe(90);
    expect(aimed.effects[0]).toMatchObject({ kind: "steel", power: 125 });
    expect(aimed.effects[1]).toMatchObject({ kind: "powder", power: 100 });
    expect(aimed.effects[2]).toMatchObject({ kind: "heal", power: 40 });
  });

  it("applies Death or Glory's cost, accuracy and power together", () => {
    const soldier = makeUnit();
    const aimed = withTraits(spec(), soldier, loadoutFor("deathOrGlory"));

    expect(aimed.mpCost).toBe(20);
    expect(aimed.hitRate).toBe(90);
    expect(aimed.effects[0]).toMatchObject({ kind: "steel", power: 150 });
    expect(aimed.effects[1]).toMatchObject({ kind: "powder", power: 150 });
    expect(aimed.effects[2]).toMatchObject({ kind: "heal", power: 40 });
  });

  it("does not mutate the original spec", () => {
    const original = spec();
    const before = JSON.stringify(original);
    withTraits(original, makeUnit(), loadoutFor("twoHandedGrip"));
    expect(JSON.stringify(original)).toBe(before);
  });

  it("produces a spec the executor still resolves", () => {
    const map = createTerrainMap(6, 6, "field");
    const bearer = makeUnit();
    const foe = createUnit({
      id: FOE_ID,
      name: "Foe",
      power: "prussia",
      postId: asPostId("line-grenadier"),
      side: "enemy",
      level: 1,
      at: coord(3, 1),
      stats: { ...STATS },
    });
    const battle: BattleState = createBattle(1815, { map, units: [bearer, foe] });
    const aimed = withTraits({ ...spec(), hitRate: 100 }, bearer, loadoutFor("twoHandedGrip"));

    const result = executeAbility(
      battle,
      findUnit(battle, BEARER_ID)!,
      aimed,
      { kind: "unit", unitId: FOE_ID },
      new Rng("traits"),
      { evasionOf: () => 0 },
    );

    expect(result.ok).toBe(true);
    expect(result.events.some((event) => event.kind === "damaged")).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * Purity and determinism
 * ------------------------------------------------------------------------ */

describe("traits — purity & determinism", () => {
  it("does not mutate the bearer or the context", () => {
    const soldier = makeUnit();
    const before = JSON.stringify(soldier);
    const ctx = context(soldier, { channel: "steel", element: "fire" });
    applyPower(100, ctx, loadoutFor("coldSteel"));
    applyDamageTaken(100, ctx, loadoutFor("drilledGuards"));
    applyElanCost(10, ctx, loadoutFor("thrift"));
    expect(JSON.stringify(soldier)).toBe(before);
  });

  it("produces byte-identical results for the same inputs", () => {
    const play = (): string => {
      const soldier = makeUnit();
      return JSON.stringify([
        applyElanCost(10, context(soldier), loadoutFor("thrift")),
        applyPower(100, context(soldier), loadoutFor("coldSteel")),
        applyDamageTaken(100, context(soldier, { role: "defender" }), loadoutFor("drilledGuards")),
      ]);
    };
    expect(play()).toBe(play());
  });

  it("is a no-op with no traits equipped", () => {
    const soldier = makeUnit();
    const ctx = context(soldier);
    expect(applyElanCost(10, ctx)).toBe(10);
    expect(applyHitRate(70, ctx)).toBe(70);
    expect(applyCritRate(5, ctx)).toBe(5);
    expect(applyPower(100, ctx)).toBe(100);
    expect(applyDamageTaken(100, ctx)).toBe(100);
    expect(applyEvasion(5, ctx)).toBe(5);
    expect(applyExtraAttacks(1, ctx)).toBe(1);
  });
});
