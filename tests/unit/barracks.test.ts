import { describe, expect, it } from "vitest";

import type { EnemyDef, StatBlock } from "../../src/data/schema";

import {
  AUXILIARY_POST_ID,
  BARRACKS_CAPACITY,
  CAJOLE_MAX,
  CAJOLE_MIN,
  CAJOLE_STEP,
  CAPTURE_BASE_CHANCE,
  CAPTURE_LEVEL_PENALTY,
  CAPTURE_MAX_CHANCE,
  CAPTURE_MIN_CHANCE,
  CAPTURE_WEAK_BONUS,
  DEFAULT_IRREGULAR_POWER,
  BarracksError,
  attemptCapture,
  barracksSize,
  cajoleBlockers,
  cajoleIrregular,
  canCapture,
  canCajole,
  canDeploy,
  canLearnFromEnemy,
  captiveOf,
  captivesOfEnemy,
  captureBlockers,
  captureChance,
  captureIrregular,
  createBarracks,
  createCaptive,
  createIrregularDef,
  deployBlockers,
  deployIrregular,
  deployParty,
  deployableCaptives,
  foreignDrillBlockers,
  foreignDrillCandidates,
  hasCaptive,
  hasMasteredAbility,
  irregularDefOf,
  isBarracks,
  isIrregularDef,
  isWilling,
  learnFromEnemy,
  parseBarracks,
  type AuxiliaryBarracks,
  type CaptiveInit,
  type DeployRequest,
  type IrregularDef,
} from "../../src/engine/barracks";
import { coord } from "../../src/engine/grid";
import {
  asAbilityId,
  asEnemyId,
  asPostId,
  asUnitId,
  type UnitId,
} from "../../src/engine/ids";
import { Rng } from "../../src/engine/rng";
import type { TraitOptions } from "../../src/engine/traits";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T078 — Auxiliary Barracks
 *
 * Pins the task's "done when": **capture/cajole irregulars and deploy them**,
 * and **Foreign Drill learns enemy actions**. The tests cover the irregular
 * projection, the three-loop policy (capture → cajole → deploy), the
 * trait-aware Foreign Drill seam, the save boundary and purity/determinism.
 * ------------------------------------------------------------------------ */

const STATS: StatBlock = {
  hp: 48,
  mp: 0,
  atk: 12,
  def: 7,
  mag: 3,
  res: 5,
  spd: 24,
  move: 4,
  jump: 2,
};

const AMBUSH = asAbilityId("ambush");
const SCATTER = asAbilityId("scatter");
const BAND_ID = asEnemyId("guerrilla-band");

function makeBand(overrides: Partial<IrregularDef> = {}): IrregularDef {
  return createIrregularDef({
    id: BAND_ID,
    name: "Blackwood Guerrillas",
    level: 3,
    stats: STATS,
    abilities: [AMBUSH, SCATTER],
    capturable: true,
    ...overrides,
  });
}

function makeCaptiveInit(id: string, overrides: Partial<CaptiveInit> = {}): CaptiveInit {
  return {
    id: asUnitId(id),
    irregular: makeBand(),
    name: `Band ${id}`,
    capturedOnDay: 1,
    ...overrides,
  };
}

function makeBarracks(captives: readonly CaptiveInit[] = []): AuxiliaryBarracks {
  return createBarracks({ captives });
}

function makeUnit(overrides: Partial<UnitInit> = {}): Unit {
  return createUnit({
    id: asUnitId("unit-officer"),
    name: "Lt. Moreau",
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at: coord(1, 1),
    stats: { ...STATS },
    ...overrides,
  });
}

function foreignDrillFor(unit: Unit): TraitOptions {
  return { loadout: { [unit.id]: "foreignDrill" } };
}

/** Cajole a captive until it is willing to deploy, and return the pen. */
function makeWilling(barracks: AuxiliaryBarracks, captiveId: UnitId): AuxiliaryBarracks {
  let pen = barracks;
  while (canCajole(pen, captiveId)) pen = cajoleIrregular(pen, captiveId);
  return pen;
}

/* --------------------------------------------------------------------------
 * Irregular projection
 * ------------------------------------------------------------------------ */

describe("irregulars — the engine-facing projection of an EnemyDef", () => {
  it("builds a valid irregular with sensible defaults", () => {
    const band = createIrregularDef({
      id: BAND_ID,
      name: "Blackwood Guerrillas",
      level: 2,
      stats: STATS,
    });
    expect(band.abilities).toEqual([]);
    expect(band.capturable).toBe(false);
    expect(band.element).toBeUndefined();
    expect(band.power).toBe(DEFAULT_IRREGULAR_POWER);
    expect(isIrregularDef(band)).toBe(true);
  });

  it("keeps an authored power school and rejects an unknown one", () => {
    const russian = makeBand({ power: "russia" });
    expect(russian.power).toBe("russia");
    expect(() =>
      createIrregularDef({
        id: BAND_ID,
        name: "x",
        level: 1,
        stats: STATS,
        power: "ottoman" as never,
      }),
    ).toThrow();
  });

  it("rejects a band with no hit points, a bad level or a bad element", () => {
    expect(() =>
      createIrregularDef({
        id: BAND_ID,
        name: "x",
        level: 1,
        stats: { ...STATS, hp: 0 },
      }),
    ).toThrow();
    expect(() =>
      createIrregularDef({ id: BAND_ID, name: "x", level: 0, stats: STATS }),
    ).toThrow();
    expect(() =>
      createIrregularDef({
        id: BAND_ID,
        name: "x",
        level: 1,
        stats: STATS,
        element: "cheese" as never,
      }),
    ).toThrow();
  });

  it("projects an authored EnemyDef down to a slim irregular def", () => {
    const enemy: EnemyDef = {
      id: "guerrilla-band",
      name: "Blackwood Guerrillas",
      description: "Irregular skirmishers.",
      flavour: "They know every deer track in the wood.",
      family: "guerrilla",
      level: 3,
      stats: STATS,
      affinities: {},
      abilities: ["ambush", "scatter"],
      drops: [],
      capturable: true,
      aiProfile: "default",
      exp: 0,
      ap: 0,
    };
    const band = irregularDefOf(enemy);
    expect(band.id).toBe("guerrilla-band");
    expect(band.level).toBe(3);
    expect(band.abilities).toEqual([AMBUSH, SCATTER]);
    expect(band.capturable).toBe(true);
    // The projection copies the stat block, so mutating the source cannot leak.
    expect(band.stats).not.toBe(enemy.stats);
  });
});

/* --------------------------------------------------------------------------
 * Captives & barracks creation
 * ------------------------------------------------------------------------ */

describe("createBarracks — the pen", () => {
  it("starts empty", () => {
    const pen = createBarracks();
    expect(pen.captives).toEqual([]);
    expect(barracksSize(pen)).toBe(0);
  });

  it("keeps the captives it is given and reports them", () => {
    const pen = makeBarracks([makeCaptiveInit("band-1", { willingness: 10 })]);
    expect(barracksSize(pen)).toBe(1);
    expect(hasCaptive(pen, asUnitId("band-1"))).toBe(true);
    expect(captiveOf(pen, asUnitId("band-2"))).toBeUndefined();
    expect(captiveOf(pen, asUnitId("band-1"))?.willingness).toBe(10);
  });

  it("defaults a captive's name to the band name and its day to the campaign day", () => {
    const captive = createCaptive({ id: asUnitId("band-7"), irregular: makeBand() });
    expect(captive.name).toBe("Blackwood Guerrillas");
    expect(captive.capturedOnDay).toBe(1);
    expect(captive.willingness).toBe(CAJOLE_MIN);
  });

  it("rejects duplicates and overflow past capacity", () => {
    expect(() =>
      createBarracks({
        captives: [makeCaptiveInit("band-1"), makeCaptiveInit("band-1")],
      }),
    ).toThrow();
    const tooMany = Array.from({ length: BARRACKS_CAPACITY + 1 }, (_, index) =>
      makeCaptiveInit(`band-${index + 1}`),
    );
    expect(() => createBarracks({ captives: tooMany })).toThrow();
  });

  it("rejects an out-of-range willingness", () => {
    expect(() => createCaptive({ id: asUnitId("b"), irregular: makeBand(), willingness: -1 })).toThrow();
    expect(() =>
      createCaptive({ id: asUnitId("b"), irregular: makeBand(), willingness: CAJOLE_MAX + 1 }),
    ).toThrow();
  });

  it("filters captives by their source band", () => {
    const pen = makeBarracks([
      makeCaptiveInit("band-1"),
      makeCaptiveInit("band-2", { irregular: makeBand({ id: asEnemyId("militia") }) }),
    ]);
    expect(captivesOfEnemy(pen, BAND_ID).map((c) => c.id)).toEqual(["band-1"]);
    expect(captivesOfEnemy(pen, asEnemyId("militia")).map((c) => c.id)).toEqual(["band-2"]);
  });
});

/* --------------------------------------------------------------------------
 * Capture
 * ------------------------------------------------------------------------ */

describe("capture — taking an irregular prisoner", () => {
  it("refuses a band that is not flagged capturable", () => {
    const band = makeBand({ capturable: false });
    expect(captureBlockers(makeBarracks(), band, { id: asUnitId("band-1") })).toEqual([
      "not-capturable",
    ]);
    expect(canCapture(makeBarracks(), band, { id: asUnitId("band-1") })).toBe(false);
    expect(() => captureIrregular(makeBarracks(), band, { id: asUnitId("band-1") })).toThrow();
  });

  it("refuses a duplicate captive and a full pen", () => {
    const pen = makeBarracks([makeCaptiveInit("band-1")]);
    expect(captureBlockers(pen, makeBand(), { id: asUnitId("band-1") })).toEqual([
      "duplicate-captive",
    ]);

    const full = makeBarracks(
      Array.from({ length: BARRACKS_CAPACITY }, (_, index) => makeCaptiveInit(`held-${index + 1}`)),
    );
    expect(captureBlockers(full, makeBand(), { id: asUnitId("fresh") })).toEqual([
      "barracks-full",
    ]);
  });

  it("pens a captured band at zero willingness", () => {
    const pen = captureIrregular(makeBarracks(), makeBand(), {
      id: asUnitId("band-1"),
      name: "The Blackwood Boys",
      capturedOnDay: 4,
    });
    expect(barracksSize(pen)).toBe(1);
    const captive = captiveOf(pen, asUnitId("band-1"));
    expect(captive?.name).toBe("The Blackwood Boys");
    expect(captive?.capturedOnDay).toBe(4);
    expect(captive?.willingness).toBe(CAJOLE_MIN);
  });

  it("derives capture odds from weakness and level", () => {
    const green = makeBand({ level: 1 });
    expect(captureChance(green, 1)).toBeCloseTo(CAPTURE_BASE_CHANCE);
    expect(captureChance(green, 0.1)).toBeCloseTo(CAPTURE_BASE_CHANCE + CAPTURE_WEAK_BONUS);

    const veteran = makeBand({ level: 6 });
    expect(captureChance(veteran, 1)).toBeCloseTo(
      CAPTURE_BASE_CHANCE - 5 * CAPTURE_LEVEL_PENALTY,
    );

    const ancient = makeBand({ level: 50 });
    expect(captureChance(ancient, 1)).toBe(CAPTURE_MIN_CHANCE);
    expect(captureChance(ancient, 0.1)).toBeLessThanOrEqual(CAPTURE_MAX_CHANCE);

    expect(() => captureChance(green, 1.5)).toThrow();
  });

  it("does not consume the Rng when a gate blocks the attempt", () => {
    const band = makeBand({ capturable: false });
    const rng = new Rng(1809);
    const attempt = attemptCapture(makeBarracks(), band, { id: asUnitId("band-1") }, rng);
    expect(attempt.captured).toBe(false);
    expect(attempt.blockers).toEqual(["not-capturable"]);
    expect(rng.calls).toBe(0);
  });

  it("resolves a seeded attempt deterministically, succeeding and failing", () => {
    const band = makeBand({ level: 1 });
    let sawSuccess = false;
    let sawFailure = false;
    for (let seed = 0; seed < 40 && !(sawSuccess && sawFailure); seed++) {
      const rng = new Rng(seed);
      const attempt = attemptCapture(makeBarracks(), band, { id: asUnitId("band-1") }, rng, 0.1);
      if (attempt.captured) {
        sawSuccess = true;
        expect(hasCaptive(attempt.barracks, asUnitId("band-1"))).toBe(true);
      } else {
        sawFailure = true;
        expect(attempt.barracks).toEqual(makeBarracks());
      }
    }
    expect(sawSuccess).toBe(true);
    expect(sawFailure).toBe(true);
  });

  it("replays the same seed to the same pen", () => {
    const band = makeBand({ level: 1 });
    const first = attemptCapture(makeBarracks(), band, { id: asUnitId("band-1") }, new Rng(7), 0.1);
    const second = attemptCapture(makeBarracks(), band, { id: asUnitId("band-1") }, new Rng(7), 0.1);
    expect(first.captured).toBe(second.captured);
    expect(first.barracks).toEqual(second.barracks);
  });
});

/* --------------------------------------------------------------------------
 * Cajole (FFTA Affection)
 * ------------------------------------------------------------------------ */

describe("cajole — winning an irregular over", () => {
  it("reports unknown and fully-cajoled captives", () => {
    const pen = makeBarracks([makeCaptiveInit("band-1", { willingness: CAJOLE_MAX })]);
    expect(cajoleBlockers(pen, asUnitId("missing"))).toEqual(["unknown-captive"]);
    expect(cajoleBlockers(pen, asUnitId("band-1"))).toEqual(["fully-cajoled"]);
    expect(canCajole(pen, asUnitId("band-1"))).toBe(false);
  });

  it("raises willingness by the step and clamps at the maximum", () => {
    let pen = makeBarracks([makeCaptiveInit("band-1")]);
    pen = cajoleIrregular(pen, asUnitId("band-1"));
    expect(captiveOf(pen, asUnitId("band-1"))?.willingness).toBe(CAJOLE_STEP);
    pen = cajoleIrregular(pen, asUnitId("band-1"), CAJOLE_MAX);
    expect(captiveOf(pen, asUnitId("band-1"))?.willingness).toBe(CAJOLE_MAX);
    // Already full: the pen is returned untouched rather than throwing.
    expect(cajoleIrregular(pen, asUnitId("band-1"))).toBe(pen);
  });

  it("throws on an unknown captive or a bad amount", () => {
    const pen = makeBarracks([makeCaptiveInit("band-1")]);
    expect(() => cajoleIrregular(pen, asUnitId("missing"))).toThrow();
    expect(() => cajoleIrregular(pen, asUnitId("band-1"), 0)).toThrow();
  });

  it("never mutates the input pen", () => {
    const pen = makeBarracks([makeCaptiveInit("band-1", { willingness: 10 })]);
    const next = cajoleIrregular(pen, asUnitId("band-1"));
    expect(captiveOf(pen, asUnitId("band-1"))?.willingness).toBe(10);
    expect(captiveOf(next, asUnitId("band-1"))?.willingness).toBe(10 + CAJOLE_STEP);
  });
});

/* --------------------------------------------------------------------------
 * Deploy
 * ------------------------------------------------------------------------ */

describe("deploy — fielding a cajoled band", () => {
  it("refuses an unknown or unwilling captive", () => {
    const pen = makeBarracks([makeCaptiveInit("band-1")]);
    expect(deployBlockers(pen, asUnitId("missing"))).toEqual(["unknown-captive"]);
    expect(deployBlockers(pen, asUnitId("band-1"))).toEqual(["not-cajoled"]);
    expect(canDeploy(pen, asUnitId("band-1"))).toBe(false);
    expect(() =>
      deployIrregular(pen, { id: asUnitId("band-1"), at: coord(0, 0) }),
    ).toThrow();
  });

  it("fields a willing captive with the band's stats, level and actions", () => {
    const pen = makeWilling(makeBarracks([makeCaptiveInit("band-1", { name: "The Blackwood Boys" })]), asUnitId("band-1"));
    const unit = deployIrregular(pen, { id: asUnitId("band-1"), at: coord(3, 4) });
    expect(unit.id).toBe("band-1");
    expect(unit.name).toBe("The Blackwood Boys");
    expect(unit.side).toBe("company");
    expect(unit.postId).toBe(AUXILIARY_POST_ID);
    expect(unit.power).toBe(DEFAULT_IRREGULAR_POWER);
    expect(unit.level).toBe(3);
    expect(unit.stats).toEqual(STATS);
    expect(unit.at).toEqual(coord(3, 4));
    expect(unit.facing).toBe("north");
    expect(unit.abilities.map((ability) => ability.abilityId).sort()).toEqual(
      [AMBUSH, SCATTER].sort(),
    );
    expect(unit.abilities.every((ability) => ability.mastered)).toBe(true);
  });

  it("honours a facing and side override and keeps the pen unchanged", () => {
    const pen = makeWilling(makeBarracks([makeCaptiveInit("band-1")]), asUnitId("band-1"));
    const before = pen;
    const unit = deployIrregular(pen, {
      id: asUnitId("band-1"),
      at: coord(2, 2),
      facing: "east",
      side: "enemy",
      name: "Pressed Band",
    });
    expect(unit.facing).toBe("east");
    expect(unit.side).toBe("enemy");
    expect(unit.name).toBe("Pressed Band");
    expect(pen).toBe(before);
  });

  it("lists only the deployable, willing captives", () => {
    let pen = makeBarracks([makeCaptiveInit("band-1"), makeCaptiveInit("band-2")]);
    pen = makeWilling(pen, asUnitId("band-1"));
    expect(deployableCaptives(pen).map((c) => c.id)).toEqual(["band-1"]);
    expect(isWilling(captiveOf(pen, asUnitId("band-1"))!)).toBe(true);
    expect(isWilling(captiveOf(pen, asUnitId("band-2"))!)).toBe(false);
  });

  it("deploys a party of cajoled captives up to the limit", () => {
    let pen = makeBarracks([
      makeCaptiveInit("band-1"),
      makeCaptiveInit("band-2"),
      makeCaptiveInit("band-3"),
      makeCaptiveInit("band-4"),
    ]);
    for (const id of ["band-1", "band-2", "band-3", "band-4"]) {
      pen = makeWilling(pen, asUnitId(id));
    }
    const requests: DeployRequest[] = [
      { id: asUnitId("band-1"), at: coord(0, 0) },
      { id: asUnitId("band-2"), at: coord(1, 0) },
      { id: asUnitId("band-3"), at: coord(2, 0) },
    ];
    const party = deployParty(pen, requests);
    expect(party.map((unit) => unit.id)).toEqual(["band-1", "band-2", "band-3"]);

    expect(() => deployParty(pen, [...requests, { id: asUnitId("band-4"), at: coord(3, 0) }])).toThrow();
    expect(() => deployParty(pen, [])).toThrow();
    expect(() =>
      deployParty(pen, [
        { id: asUnitId("band-1"), at: coord(0, 0) },
        { id: asUnitId("band-2"), at: coord(0, 0) },
      ]),
    ).toThrow();
  });
});

/* --------------------------------------------------------------------------
 * Foreign Drill (FFTA Blue Magic)
 * ------------------------------------------------------------------------ */

describe("Foreign Drill — copying an enemy action", () => {
  it("blocks a soldier with no Foreign Drill trait", () => {
    const band = makeBand();
    expect(foreignDrillBlockers(makeUnit(), band, AMBUSH)).toEqual(["no-foreign-drill"]);
    expect(canLearnFromEnemy(makeUnit(), band, AMBUSH)).toBe(false);
  });

  it("blocks an action the band never uses", () => {
    const officer = makeUnit();
    expect(
      foreignDrillBlockers(officer, makeBand(), asAbilityId("cavalry-charge"), foreignDrillFor(officer)),
    ).toEqual(["not-an-enemy-action"]);
  });

  it("learns a foreign action as a mastered ability with Foreign Drill", () => {
    const officer = makeUnit();
    const band = makeBand();
    const options = foreignDrillFor(officer);
    expect(canLearnFromEnemy(officer, band, AMBUSH, options)).toBe(true);

    const learned = learnFromEnemy(officer, band, AMBUSH, options);
    expect(hasMasteredAbility(learned, AMBUSH)).toBe(true);
    expect(hasMasteredAbility(officer, AMBUSH)).toBe(false);
    // Re-learning is a no-op, not an error.
    expect(learnFromEnemy(learned, band, AMBUSH, options)).toEqual(learned);
    expect(foreignDrillBlockers(learned, band, AMBUSH, options)).toEqual(["already-mastered"]);
  });

  it("throws only when the band does not know the action at all", () => {
    const officer = makeUnit();
    expect(() =>
      learnFromEnemy(officer, makeBand(), asAbilityId("cavalry-charge"), foreignDrillFor(officer)),
    ).toThrow();
    // A known but already-mastered action is not a caller bug.
    const options = foreignDrillFor(officer);
    const learned = learnFromEnemy(officer, makeBand(), AMBUSH, options);
    expect(() => learnFromEnemy(learned, makeBand(), AMBUSH, options)).not.toThrow();
  });

  it("offers the band's actions as candidates, minus those already known", () => {
    const officer = makeUnit();
    const band = makeBand();
    const options = foreignDrillFor(officer);
    expect(foreignDrillCandidates(officer, band, options)).toEqual([AMBUSH, SCATTER]);
    const learned = learnFromEnemy(officer, band, AMBUSH, options);
    expect(foreignDrillCandidates(learned, band, options)).toEqual([SCATTER]);
    expect(foreignDrillCandidates(officer, band)).toEqual([]);
  });
});

/* --------------------------------------------------------------------------
 * Save boundary & purity
 * ------------------------------------------------------------------------ */

describe("parseBarracks — the save boundary", () => {
  it("round-trips a barracks through JSON", () => {
    const pen = createBarracks({
      captives: [
        { id: asUnitId("band-1"), irregular: makeBand(), capturedOnDay: 2, willingness: 25 },
      ],
    });
    const parsed = parseBarracks(JSON.parse(JSON.stringify(pen)));
    expect(parsed).toEqual(pen);
    expect(isBarracks(pen)).toBe(true);
  });

  it("rejects malformed values with a BarracksError", () => {
    expect(() => parseBarracks(null)).toThrow(BarracksError);
    expect(() => parseBarracks([1, 2, 3])).toThrow(BarracksError);
    expect(isBarracks({ captives: "nope" })).toBe(false);
  });
});

describe("purity — capture and cajole never mutate the input", () => {
  it("leaves the original pen and captives untouched", () => {
    const pen = makeBarracks([makeCaptiveInit("band-1", { willingness: 10 })]);
    const captured = captureIrregular(pen, makeBand(), { id: asUnitId("band-2") });
    expect(barracksSize(pen)).toBe(1);
    expect(barracksSize(captured)).toBe(2);
    const cajoled = cajoleIrregular(pen, asUnitId("band-1"));
    expect(captiveOf(pen, asUnitId("band-1"))?.willingness).toBe(10);
    expect(captiveOf(cajoled, asUnitId("band-1"))?.willingness).toBe(10 + CAJOLE_STEP);
  });
});
