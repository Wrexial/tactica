import { describe, expect, it } from "vitest";

import { coord } from "../../src/engine/grid";
import {
  EVENT_KINDS,
  EventError,
  deserializeEvent,
  eventUnitId,
  isBattleEvent,
  isEventKind,
  isEventOfKind,
  parseEvent,
  serializeEvent,
} from "../../src/engine/events";
import type { BattleEvent } from "../../src/engine/events";
import {
  asAbilityId,
  asArticleId,
  asConditionId,
  asEquipmentId,
  asGuardSortieId,
  asPostId,
  asUnitId,
} from "../../src/engine/ids";

/* --------------------------------------------------------------------------
 * T021 — Event types
 *
 * These tests pin the task's "done when": there is a named event for every
 * thing the renderer must react to (movement, damage, conditions, Articles of
 * War, learned abilities, ...), each is a discriminated union member that
 * round-trips through JSON, and untrusted input is validated at the boundary.
 * ------------------------------------------------------------------------ */

const HERO = asUnitId("unit-hero");
const FOE = asUnitId("unit-foe");
const RIFLE = asAbilityId("rifle-volley");
const OLD_GUARD = asGuardSortieId("old-guard");
const BLEEDING = asConditionId("bleeding");
const NO_INCENDIARY = asArticleId("no-incendiary");
const MUSKET = asEquipmentId("musket-1777");
const RIFLEMAN = asPostId("rifleman");

const T0 = 0;

/** One representative instance of every event kind. */
const EXAMPLES: readonly BattleEvent[] = [
  { kind: "battleStarted", tick: T0 },
  { kind: "battleEnded", tick: 40, outcome: "companyVictory" },

  { kind: "unitDeployed", tick: 0, unitId: HERO, at: coord(1, 2), side: "company" },
  { kind: "unitRemoved", tick: 40, unitId: FOE, reason: "captured" },

  { kind: "turnStarted", tick: 3, unitId: HERO },
  { kind: "turnEnded", tick: 5, unitId: HERO },

  {
    kind: "chargeStarted",
    tick: 5,
    unitId: HERO,
    chargeId: "charge-1",
    abilityId: RIFLE,
    ticks: 3,
  },
  { kind: "chargeResolved", tick: 8, unitId: HERO, chargeId: "charge-1", abilityId: RIFLE },

  {
    kind: "moved",
    tick: 6,
    unitId: HERO,
    from: coord(1, 1),
    to: coord(3, 1),
    path: [coord(1, 1), coord(2, 1), coord(3, 1)],
    facing: "east",
  },
  { kind: "faced", tick: 6, unitId: HERO, from: "north", to: "east" },
  { kind: "shoved", tick: 9, unitId: FOE, from: coord(3, 1), to: coord(4, 1) },

  {
    kind: "abilityUsed",
    tick: 5,
    unitId: HERO,
    abilityId: RIFLE,
    at: coord(6, 2),
    targetId: FOE,
    chargeTime: 3,
  },
  {
    kind: "abilityResolved",
    tick: 8,
    unitId: HERO,
    abilityId: RIFLE,
    at: coord(6, 2),
    targetId: FOE,
  },
  { kind: "itemUsed", tick: 7, unitId: HERO, itemId: MUSKET, at: coord(2, 2) },

  {
    kind: "reactionTriggered",
    tick: 8,
    unitId: FOE,
    abilityId: RIFLE,
    sourceId: HERO,
    at: coord(2, 2),
  },

  {
    kind: "volleyStarted",
    tick: 10,
    unitId: HERO,
    abilityId: RIFLE,
    at: coord(6, 2),
    targetId: FOE,
    honour: 3,
  },
  {
    kind: "volleyChained",
    tick: 10,
    unitId: FOE,
    abilityId: RIFLE,
    at: coord(6, 2),
    targetId: FOE,
  },
  { kind: "guardSortieCalled", tick: 20, unitId: HERO, guardSortieId: OLD_GUARD },

  {
    kind: "damaged",
    tick: 8,
    unitId: FOE,
    sourceId: HERO,
    abilityId: RIFLE,
    amount: 42,
    hpAfter: 8,
    damageType: "steel",
    element: "fire",
    critical: true,
    fatal: false,
  },
  { kind: "healed", tick: 9, unitId: HERO, sourceId: FOE, amount: 15, hpAfter: 60 },
  { kind: "missed", tick: 9, unitId: FOE, sourceId: HERO, abilityId: RIFLE },
  { kind: "outOfAction", tick: 11, unitId: FOE, sourceId: HERO },
  { kind: "revived", tick: 12, unitId: FOE, sourceId: HERO, hpAfter: 10 },

  { kind: "mpChanged", tick: 5, unitId: HERO, delta: -4, mpAfter: 6, reason: "spent" },
  {
    kind: "honourChanged",
    tick: 11,
    unitId: HERO,
    delta: 1,
    honourAfter: 4,
    reason: "legalKo",
  },

  {
    kind: "conditionApplied",
    tick: 8,
    unitId: FOE,
    conditionId: BLEEDING,
    duration: 5,
    sourceId: HERO,
  },
  { kind: "conditionRemoved", tick: 13, unitId: FOE, conditionId: BLEEDING, reason: "expired" },

  {
    kind: "drillGained",
    tick: 11,
    unitId: HERO,
    abilityId: RIFLE,
    amount: 5,
    drillAfter: 100,
    mastered: true,
  },
  { kind: "abilityLearned", tick: 11, unitId: HERO, abilityId: RIFLE },
  { kind: "experienceGained", tick: 11, unitId: HERO, amount: 20, experienceAfter: 20 },
  { kind: "levelUp", tick: 11, unitId: HERO, level: 2 },
  { kind: "postUnlocked", tick: 11, unitId: HERO, postId: RIFLEMAN },

  { kind: "articleBroken", tick: 7, unitId: HERO, articleId: NO_INCENDIARY, severity: "reprimand" },
  { kind: "reprimandIssued", tick: 7, unitId: HERO, articleId: NO_INCENDIARY, reprimands: 1 },
  { kind: "courtMartialIssued", tick: 7, unitId: HERO, articleId: NO_INCENDIARY },
  { kind: "commended", tick: 11, unitId: HERO, honour: 1 },

  { kind: "rewardGranted", tick: 41, crowns: 250, equipmentIds: [MUSKET] },
];

describe("Events — shapes", () => {
  it("covers every declared event kind", () => {
    expect(EXAMPLES.map((event) => event.kind).sort()).toEqual([...EVENT_KINDS].sort());
  });

  it("reads the unit an event concerns, or undefined for field-wide events", () => {
    expect(
      eventUnitId({
        kind: "damaged",
        tick: 0,
        unitId: HERO,
        amount: 1,
        hpAfter: 1,
        damageType: "steel",
        critical: false,
        fatal: false,
      }),
    ).toBe(HERO);
    expect(eventUnitId({ kind: "battleStarted", tick: 0 })).toBeUndefined();
    expect(eventUnitId({ kind: "rewardGranted", tick: 0, crowns: 0 })).toBeUndefined();
  });

  it("narrows by kind", () => {
    const event: BattleEvent = {
      kind: "moved",
      tick: 1,
      unitId: HERO,
      from: coord(0, 0),
      to: coord(1, 0),
      path: [coord(0, 0), coord(1, 0)],
      facing: "east",
    };
    expect(isEventOfKind(event, "moved")).toBe(true);
    if (isEventOfKind(event, "moved")) {
      expect(event.path).toHaveLength(2);
    }
  });
});

describe("Events — serialisability", () => {
  it.each(EXAMPLES)("round-trips a $kind event through JSON", (event) => {
    const restored = JSON.parse(JSON.stringify(event)) as BattleEvent;
    expect(restored).toEqual(event);
    expect(isBattleEvent(restored)).toBe(true);
  });

  it("round-trips through serializeEvent / deserializeEvent", () => {
    for (const event of EXAMPLES) {
      const json = serializeEvent(event);
      expect(typeof json).toBe("string");
      expect(deserializeEvent(json)).toEqual(event);
    }
  });

  it("returns a detached clone from parseEvent", () => {
    const source = {
      kind: "moved",
      tick: 1,
      unitId: HERO,
      from: coord(0, 0),
      to: coord(2, 0),
      path: [coord(0, 0), coord(2, 0)],
      facing: "east",
    } as const;
    const parsed = parseEvent(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    if (parsed.kind === "moved") {
      expect(parsed.path).not.toBe(source.path);
      expect(parsed.path[0]).not.toBe(source.path[0]);
    }
  });
});

describe("Events — validation", () => {
  it("accepts every example", () => {
    for (const event of EXAMPLES) {
      expect(isBattleEvent(event)).toBe(true);
    }
  });

  it.each([
    null,
    undefined,
    42,
    "moved",
    [],
    {},
    { kind: "moved", tick: 0 }, // missing fields
    {
      kind: "moved",
      tick: -1,
      unitId: HERO,
      from: coord(0, 0),
      to: coord(1, 0),
      path: [],
      facing: "east",
    }, // negative tick
    {
      kind: "moved",
      tick: 0,
      unitId: HERO,
      from: coord(0, 0),
      to: coord(1, 0),
      path: [{ x: 0.5, y: 0 }],
      facing: "east",
    }, // fractional tile
    {
      kind: "moved",
      tick: 0,
      unitId: HERO,
      from: coord(0, 0),
      to: coord(1, 0),
      path: [],
      facing: "up",
    }, // bad facing
    {
      kind: "damaged",
      tick: 0,
      unitId: HERO,
      amount: -1,
      hpAfter: 0,
      damageType: "steel",
      critical: false,
      fatal: false,
    }, // negative amount
    {
      kind: "damaged",
      tick: 0,
      unitId: HERO,
      amount: 1,
      hpAfter: 0,
      damageType: "laser",
      critical: false,
      fatal: false,
    }, // bad type
    {
      kind: "damaged",
      tick: 0,
      unitId: HERO,
      amount: 1,
      hpAfter: 0,
      damageType: "steel",
      element: "plasma",
      critical: false,
      fatal: false,
    }, // bad element
    {
      kind: "drillGained",
      tick: 0,
      unitId: HERO,
      abilityId: RIFLE,
      amount: 0,
      drillAfter: 0,
      mastered: false,
    }, // zero award
    { kind: "conditionApplied", tick: 0, unitId: HERO, conditionId: BLEEDING, duration: 1.5 }, // fractional duration
    { kind: "honourChanged", tick: 0, unitId: HERO, delta: -1, honourAfter: 0, reason: "bribed" }, // bad reason
    { kind: "battleEnded", tick: 0, outcome: "maybe" }, // bad outcome
    { kind: "abilityLearned", tick: 0, unitId: HERO }, // missing ability
    { kind: "courtMartialIssued", tick: 0, unitId: HERO }, // missing article
    { kind: "volleyStarted", tick: 0, unitId: HERO, abilityId: RIFLE, at: coord(0, 0), honour: -1 }, // negative honour
    { kind: "teleport", tick: 0, unitId: HERO }, // unknown kind
    { kind: "turnStarted", tick: 0, unitId: "" }, // empty unit id
  ])("rejects malformed value %#", (value) => {
    expect(isBattleEvent(value)).toBe(false);
    expect(() => parseEvent(value)).toThrow(EventError);
  });

  it("describes the rejected label in the error", () => {
    expect(() => parseEvent({ kind: "turnStarted", tick: 0, unitId: "" }, "replay[7]")).toThrow(
      /replay\[7\]/,
    );
  });

  it("rejects unparseable JSON", () => {
    expect(() => deserializeEvent("{not json")).toThrow(EventError);
  });

  it("guards event kinds", () => {
    for (const kind of EVENT_KINDS) {
      expect(isEventKind(kind)).toBe(true);
    }
    expect(isEventKind("teleport")).toBe(false);
    expect(isEventKind(3)).toBe(false);
  });
});
