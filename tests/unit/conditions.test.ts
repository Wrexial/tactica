import { describe, expect, it } from "vitest";

import {
  CONDITION_KEYS,
  CONDITION_LIST,
  CONDITIONS,
  getCondition as getAuthoredCondition,
  isConditionKey,
  type ConditionKey,
} from "../../src/data/conditions";
import { ConditionDefSchema, type StatBlock } from "../../src/data/schema";
import { coord } from "../../src/engine/grid";
import { asConditionId, asPostId, asUnitId } from "../../src/engine/ids";
import {
  ADJUTANTS_ORDERS,
  activeConditionKeys,
  applyCondition,
  applyConditions,
  canAct,
  canMove,
  canUseAbilities,
  conditionAlias,
  conditionCritModifier,
  conditionDefOf,
  conditionHitModifier,
  conditionStatMods,
  cureCondition,
  hasActiveCondition,
  isAbilityBlocked,
  isActBlocked,
  isMoveBlocked,
  removeConditionsOnHit,
  resolveConditionKey,
  tickConditions,
  tryResolveConditionKey,
} from "../../src/engine/rules/conditions";
import { createUnit, getCondition, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T039 — Condition (status) engine
 *
 * Pins the task's "done when": **apply / stack / expire / tick** for every
 * mapped condition (Bleeding, Dazed, Deafened, Pinned, Formed, Braced, ...).
 * The authored definitions are the data contract (`src/data/conditions.ts`,
 * mapping §8); the engine (`src/engine/rules/conditions.ts`) turns them into
 * unit changes and battle events. The tests also pin purity and determinism,
 * because a battle replays from a seed plus a command log (`agents.md` §2).
 * ------------------------------------------------------------------------ */

const STATS: StatBlock = {
  hp: 80,
  mp: 20,
  atk: 20,
  def: 20,
  mag: 20,
  res: 20,
  spd: 20,
  move: 4,
  jump: 2,
};

function makeUnit(overrides: Partial<UnitInit> = {}): Unit {
  return createUnit({
    id: asUnitId("unit-soldier"),
    name: "Sgt. Aubry",
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at: coord(2, 3),
    stats: { ...STATS },
    ...overrides,
  });
}

/* --------------------------------------------------------------------------
 * Data — the authored conditions
 * ------------------------------------------------------------------------ */

describe("authored conditions (data/conditions.ts)", () => {
  it("authors the full mapped set plus the two Élan morale conditions", () => {
    // 41 FFTA-mapped statuses (mapping §8) + Shaken/Routed from D4 (T040).
    expect(CONDITION_KEYS).toHaveLength(43);
    expect(CONDITION_LIST).toHaveLength(43);
    expect(Object.keys(CONDITIONS)).toHaveLength(43);
    expect(CONDITION_LIST.map((def) => def.id)).toEqual([...CONDITION_KEYS]);
  });

  it("carries the mapping §8 Napoleonic name for every condition", () => {
    // A representative sample of the mapping table; the rest are checked for
    // non-empty authored prose below.
    const expected: Partial<Record<ConditionKey, string>> = {
      poison: "Bleeding",
      blind: "Dazed",
      silence: "Deafened",
      immobilize: "Pinned",
      protect: "Formed",
      shell: "Braced",
      doom: "Mortally Wounded",
      regen: "Steadied",
      haste: "Double-Quick",
      slow: "Bogged",
      addle: "Bewildered",
      advice: "Counsel",
    };

    for (const id of CONDITION_KEYS) {
      const def = CONDITIONS[id];
      expect(def.id, id).toBe(id);
      expect(def.name.trim(), id).not.toBe("");
      expect(def.description.trim(), id).not.toBe("");
      expect(def.flavour.trim(), id).not.toBe("");
      // The parsed definition round-trips through the schema untouched.
      expect(ConditionDefSchema.parse(def), id).toEqual(def);
    }
    for (const [id, name] of Object.entries(expected)) {
      expect(CONDITIONS[id as ConditionKey].name, id).toBe(name);
    }
  });

  it("keeps the FFTA-shaped id but not the FFTA display name", () => {
    expect(CONDITIONS.poison.id).toBe("poison");
    expect(CONDITIONS.poison.name).toBe("Bleeding");
    expect(CONDITIONS.poison.name).not.toBe("Poison");
    expect(CONDITIONS.shell.name).toBe("Braced");
    expect(isConditionKey("poison")).toBe(true);
    expect(isConditionKey("bleeding")).toBe(false);
  });

  it("flags tick, countdown and action-gating conditions", () => {
    expect(CONDITIONS.poison.ticks).toBe(true);
    expect(CONDITIONS.poison.tickDamage).toBeGreaterThan(0);
    expect(CONDITIONS.regen.ticks).toBe(true);
    expect(CONDITIONS.regen.tickHealing).toBeGreaterThan(0);
    expect(CONDITIONS.doom.countdown).toBe(true);
    expect(CONDITIONS.sleep.removedOnHit).toBe(true);
    expect(CONDITIONS.immobilize.blocksMove).toBe(true);
    expect(CONDITIONS.stop.blocksAct).toBe(true);
    expect(CONDITIONS.silence.blocksAbilities).toBe(true);
    expect(CONDITIONS.protect.statMods.def).toBeGreaterThan(0);
    expect(CONDITIONS.shell.statMods.res).toBeGreaterThan(0);
    expect(CONDITIONS.blind.hitModifier).toBeLessThan(0);
  });

  it("looks up definitions and rejects unknown ids", () => {
    expect(getAuthoredCondition("poison")).toEqual(CONDITIONS.poison);
    expect(() => getAuthoredCondition("aether" as ConditionKey)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Ids and aliases
 * ------------------------------------------------------------------------ */

describe("condition ids and Napoleonic aliases", () => {
  it("normalises authored names into deterministic kebab aliases", () => {
    expect(conditionAlias("Bleeding")).toBe("bleeding");
    expect(conditionAlias("Double-Quick")).toBe("double-quick");
    expect(conditionAlias("Adjutant's Orders")).toBe("adjutants-orders");
    expect(conditionAlias("Mortally Wounded")).toBe("mortally-wounded");
  });

  it("resolves a canonical key or an alias to one canonical key", () => {
    expect(resolveConditionKey(asConditionId("poison"))).toBe("poison");
    expect(resolveConditionKey("bleeding")).toBe("poison");
    expect(resolveConditionKey("braced")).toBe("shell");
    expect(resolveConditionKey("formed")).toBe("protect");
    expect(resolveConditionKey("pinned")).toBe("immobilize");
    expect(resolveConditionKey("dazed")).toBe("blind");
    expect(conditionDefOf("braced").name).toBe("Braced");
  });

  it("rejects unknown conditions and reports misses with the try variant", () => {
    expect(() => resolveConditionKey(asConditionId("moonstruck"))).toThrow(RangeError);
    expect(tryResolveConditionKey(asConditionId("moonstruck"))).toBeUndefined();
    expect(tryResolveConditionKey(asConditionId("poison"))).toBe("poison");
  });
});

/* --------------------------------------------------------------------------
 * Applying, stacking and cancelling
 * ------------------------------------------------------------------------ */

describe("applyCondition — apply, stack and cancel", () => {
  it("applies a condition with its authored duration and reports it", () => {
    const unit = makeUnit();
    const source = asUnitId("unit-foe");
    const result = applyCondition(unit, "poison", { tick: 5, sourceId: source });

    expect(result.applied).toBe(true);
    expect(hasActiveCondition(result.unit, "poison")).toBe(true);
    expect(getCondition(result.unit, asConditionId("poison"))?.duration).toBe(
      CONDITIONS.poison.duration,
    );
    expect(result.events).toEqual([
      {
        kind: "conditionApplied",
        tick: 5,
        unitId: unit.id,
        conditionId: "poison",
        duration: CONDITIONS.poison.duration,
        sourceId: source,
      },
    ]);
  });

  it("honours an explicit duration and source", () => {
    const source = asUnitId("unit-captain");
    const result = applyCondition(makeUnit(), "protect", {
      duration: 7,
      sourceId: source,
      tick: 2,
    });
    const active = getCondition(result.unit, asConditionId("protect"));
    expect(active?.duration).toBe(7);
    expect(active?.sourceId).toBe(source);
  });

  it("stores the canonical key even when addressed by an alias", () => {
    const result = applyCondition(makeUnit(), "braced");
    expect(result.unit.conditions).toHaveLength(1);
    expect(result.unit.conditions[0].conditionId).toBe("shell");
    expect(hasActiveCondition(result.unit, "shell")).toBe(true);
    expect(hasActiveCondition(result.unit, "braced")).toBe(true);
  });

  it("does not stack: a second application refreshes to the longer span", () => {
    const first = applyCondition(makeUnit(), "protect", { duration: 4 });
    const refreshed = applyCondition(first.unit, "formed", { duration: 9 });

    const instances = refreshed.unit.conditions.filter((c) => c.conditionId === "protect");
    expect(instances).toHaveLength(1);
    expect(instances[0].duration).toBe(9);
    expect(refreshed.events.some((event) => event.kind === "conditionApplied")).toBe(true);
  });

  it("lets an indefinite application win the merge", () => {
    const first = applyCondition(makeUnit(), "poison", { duration: 5 });
    const merged = applyCondition(first.unit, "bleeding", { duration: 0 });
    expect(merged.unit.conditions).toHaveLength(1);
    expect(merged.unit.conditions[0].duration).toBe(0);
  });

  it("cancels the conditions it replaces (Haste ↔ Slow)", () => {
    const hasted = applyCondition(makeUnit(), "haste", { duration: 6 });
    const slowed = applyCondition(hasted.unit, "slow", { duration: 6, tick: 3 });

    expect(hasActiveCondition(slowed.unit, "haste")).toBe(false);
    expect(hasActiveCondition(slowed.unit, "slow")).toBe(true);
    const removed = slowed.events.find((event) => event.kind === "conditionRemoved");
    expect(removed?.kind === "conditionRemoved" && removed.reason).toBe("replaced");
  });

  it("applies several inflicts in order", () => {
    const result = applyConditions(makeUnit(), ["slow", "dazed"], { tick: 1 });
    expect(result.applied).toEqual(["slow", "blind"]);
    expect(activeConditionKeys(result.unit)).toEqual(["slow", "blind"]);
  });

  it("Adjutant's Orders absorbs one hostile condition and is consumed", () => {
    const shielded = applyCondition(makeUnit(), "astra").unit;
    expect(hasActiveCondition(shielded, ADJUTANTS_ORDERS)).toBe(true);

    const blocked = applyCondition(shielded, "poison", { tick: 2 });
    expect(blocked.applied).toBe(false);
    expect(hasActiveCondition(blocked.unit, "poison")).toBe(false);
    expect(hasActiveCondition(blocked.unit, ADJUTANTS_ORDERS)).toBe(false);
    expect(
      blocked.events.some(
        (event) =>
          event.kind === "conditionRemoved" &&
          event.conditionId === ADJUTANTS_ORDERS &&
          event.reason === "cured",
      ),
    ).toBe(true);

    // The shield is spent: the next hostile condition lands.
    const landed = applyCondition(blocked.unit, "poison", { tick: 3 });
    expect(landed.applied).toBe(true);
    expect(hasActiveCondition(landed.unit, "poison")).toBe(true);
  });

  it("does not shield a friendly buff", () => {
    const shielded = applyCondition(makeUnit(), "astra").unit;
    const buffed = applyCondition(shielded, "protect");
    expect(buffed.applied).toBe(true);
    expect(hasActiveCondition(buffed.unit, ADJUTANTS_ORDERS)).toBe(true);
  });

  it("never mutates the input unit", () => {
    const unit = makeUnit();
    const before = JSON.stringify(unit);
    applyCondition(unit, "poison", { duration: 3 });
    applyConditions(unit, ["haste", "slow"]);
    expect(JSON.stringify(unit)).toBe(before);
  });

  it("rejects unknown ids and malformed options", () => {
    expect(() => applyCondition(makeUnit(), "moonstruck")).toThrow(RangeError);
    expect(() => applyCondition(makeUnit(), "poison", { duration: -1 })).toThrow(RangeError);
    expect(() => applyCondition(makeUnit(), "poison", { duration: 1.5 })).toThrow(RangeError);
    expect(() => applyCondition(makeUnit(), "poison", { tick: -2 })).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Ticking and expiry
 * ------------------------------------------------------------------------ */

describe("tickConditions — tick effects and expiry", () => {
  it("Bleeding deals its tick damage as condition damage", () => {
    const bleeding = applyCondition(makeUnit(), "poison").unit;
    const ticked = tickConditions(bleeding, 7);

    const damage = ticked.events.find((event) => event.kind === "damaged");
    expect(damage?.kind).toBe("damaged");
    if (damage?.kind !== "damaged") return;
    expect(damage.amount).toBe(CONDITIONS.poison.tickDamage);
    expect(damage.damageType).toBe("none");
    expect(damage.fatal).toBe(false);
    expect(ticked.unit.hp).toBe(bleeding.hp - CONDITIONS.poison.tickDamage);
  });

  it("Steadied heals each tick and never overshoots max HP", () => {
    const wounded = applyCondition(makeUnit({ hp: 60 }), "regen").unit;
    const ticked = tickConditions(wounded, 1);

    const heal = ticked.events.find((event) => event.kind === "healed");
    expect(heal?.kind).toBe("healed");
    if (heal?.kind !== "healed") return;
    expect(heal.amount).toBe(CONDITIONS.regen.tickHealing);
    expect(ticked.unit.hp).toBe(60 + CONDITIONS.regen.tickHealing);

    let current = ticked.unit;
    for (let tick = 2; tick <= 6; tick += 1) current = tickConditions(current, tick).unit;
    expect(current.hp).toBe(STATS.hp);
  });

  it("expires a finite condition after its duration and reports it", () => {
    const pinned = applyCondition(makeUnit(), "pinned", { duration: 2 }).unit;
    expect(hasActiveCondition(pinned, "pinned")).toBe(true);

    const first = tickConditions(pinned, 1);
    expect(hasActiveCondition(first.unit, "pinned")).toBe(true);
    expect(getCondition(first.unit, asConditionId("immobilize"))?.duration).toBe(1);

    const second = tickConditions(first.unit, 2);
    expect(hasActiveCondition(second.unit, "pinned")).toBe(false);
    expect(
      second.events.some(
        (event) => event.kind === "conditionRemoved" && event.reason === "expired",
      ),
    ).toBe(true);
  });

  it("never expires an indefinite condition", () => {
    let current = applyCondition(makeUnit(), "poison").unit;
    for (let tick = 0; tick < 20; tick += 1) current = tickConditions(current, tick).unit;
    expect(hasActiveCondition(current, "poison")).toBe(true);
  });

  it("knocks the soldier out on a fatal tick", () => {
    const bleeding = applyCondition(makeUnit({ hp: 5 }), "poison").unit;
    const ticked = tickConditions(bleeding, 3);

    expect(ticked.unit.hp).toBe(0);
    const damage = ticked.events.find((event) => event.kind === "damaged");
    expect(damage?.kind === "damaged" && damage.fatal).toBe(true);
    expect(ticked.events.some((event) => event.kind === "outOfAction")).toBe(true);
  });

  it("Mortally Wounded counts down and knocks out at zero", () => {
    const doomed = applyCondition(makeUnit(), "doom", { duration: 2 }).unit;

    const first = tickConditions(doomed, 1);
    expect(first.unit.hp).toBe(STATS.hp);
    expect(getCondition(first.unit, asConditionId("doom"))?.duration).toBe(1);

    const second = tickConditions(first.unit, 2);
    expect(second.unit.hp).toBe(0);
    const fatal = second.events.find((event) => event.kind === "damaged");
    expect(fatal?.kind === "damaged" && fatal.amount).toBe(STATS.hp);
    expect(second.events.some((event) => event.kind === "outOfAction")).toBe(true);
    expect(hasActiveCondition(second.unit, "doom")).toBe(false);
  });

  it("does not tick a soldier already out of action", () => {
    const downed = applyCondition(makeUnit({ hp: 0 }), "poison").unit;
    const ticked = tickConditions(downed, 1);
    expect(ticked.unit).toBe(downed);
    expect(ticked.events).toEqual([]);
  });

  it("is deterministic", () => {
    const bleeding = applyCondition(makeUnit(), "poison").unit;
    expect(tickConditions(bleeding, 4)).toEqual(tickConditions(bleeding, 4));
  });
});

/* --------------------------------------------------------------------------
 * Queries — action gates, modifiers and cures
 * ------------------------------------------------------------------------ */

describe("condition queries", () => {
  it("Pinned blocks movement but not action", () => {
    const unit = applyCondition(makeUnit(), "pinned").unit;
    expect(isMoveBlocked(unit)).toBe(true);
    expect(isActBlocked(unit)).toBe(false);
    expect(canMove(unit)).toBe(false);
    expect(canAct(unit)).toBe(true);
  });

  it("Stunned blocks movement, action and abilities", () => {
    const unit = applyCondition(makeUnit(), "stop").unit;
    expect(isMoveBlocked(unit)).toBe(true);
    expect(isActBlocked(unit)).toBe(true);
    expect(canMove(unit)).toBe(false);
    expect(canAct(unit)).toBe(false);
    expect(canUseAbilities(unit)).toBe(false);
  });

  it("Deafened bars abilities but allows move and basic attack", () => {
    const unit = applyCondition(makeUnit(), "silence").unit;
    expect(isAbilityBlocked(unit)).toBe(true);
    expect(canUseAbilities(unit)).toBe(false);
    expect(canAct(unit)).toBe(true);
    expect(canMove(unit)).toBe(true);
  });

  it("sums the stat modifiers of active conditions", () => {
    const unit = applyConditions(makeUnit(), ["protect", "boost"]).unit;
    const mods = conditionStatMods(unit);
    expect(mods.def).toBe(CONDITIONS.protect.statMods.def);
    expect(mods.atk).toBe(CONDITIONS.boost.statMods.atk);
    expect(mods.hp).toBe(0);
    expect(mods.mp).toBe(0);
  });

  it("reports to-hit and critical modifiers", () => {
    expect(conditionHitModifier(makeUnit())).toBe(0);
    const dazed = applyCondition(makeUnit(), "blind").unit;
    expect(conditionHitModifier(dazed)).toBe(CONDITIONS.blind.hitModifier);
    const counselled = applyCondition(makeUnit(), "advice").unit;
    expect(conditionCritModifier(counselled)).toBe(20);
  });

  it("lists active keys canonically, from either id", () => {
    const unit = applyConditions(makeUnit(), ["braced", "poison", "pinned"]).unit;
    expect(activeConditionKeys(unit)).toEqual(["shell", "poison", "immobilize"]);
  });

  it("removes waking conditions on a hit", () => {
    const unit = applyConditions(makeUnit(), ["sleep", "protect"]).unit;
    const woken = removeConditionsOnHit(unit, 9);

    expect(hasActiveCondition(woken.unit, "sleep")).toBe(false);
    expect(hasActiveCondition(woken.unit, "protect")).toBe(true);
    expect(woken.removed).toEqual(["sleep"]);
    const event = woken.events[0];
    expect(event?.kind).toBe("conditionRemoved");
    if (event?.kind === "conditionRemoved") expect(event.reason).toBe("removed");
  });

  it("cures a specific condition and reports it", () => {
    const poisoned = applyCondition(makeUnit(), "poison").unit;
    const cured = cureCondition(poisoned, "bleeding", { tick: 3 });

    expect(cured.cured).toBe(true);
    expect(hasActiveCondition(cured.unit, "poison")).toBe(false);
    expect(cured.events[0]?.kind).toBe("conditionRemoved");

    const again = cureCondition(cured.unit, "poison");
    expect(again.cured).toBe(false);
    expect(again.unit).toBe(cured.unit);
    expect(again.events).toEqual([]);
  });
});
