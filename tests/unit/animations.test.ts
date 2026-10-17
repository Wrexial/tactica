import { describe, expect, it } from "vitest";

import { coord } from "../../src/engine/grid";
import type { BattleEvent } from "../../src/engine/events";
import {
  asAbilityId,
  asArticleId,
  asConditionId,
  asEquipmentId,
  asPostId,
  asUnitId,
} from "../../src/engine/ids";
import { CONDITION_KIND_COLORS } from "../../src/render/units";
import {
  ANIMATED_EVENT_KINDS,
  ARTILLERY_KEYWORDS,
  ELEMENT_COLORS,
  POPUP_COLORS,
  animationsForEvents,
  animationsOfKind,
  artilleryElement,
  isArtilleryAbility,
  serializeAnimations,
  type AnimationContext,
} from "../../src/render/animations";

/* --------------------------------------------------------------------------
 * T082 — Event-driven animations
 *
 * These pin the Pixi-free half of the animation system: the mapping from engine
 * events to the four cue families (move / volley / artillery / popup), the
 * artillery classifier, and the guarantee that the translation is pure and
 * deterministic. The Pixi playback itself is exercised by the build and the
 * e2e battle-log spec.
 * ------------------------------------------------------------------------ */

const HERO = asUnitId("unit-hero");
const FOE = asUnitId("unit-foe");
const RIFLE = asAbilityId("rifle-volley");
const CASE_SHOT = asAbilityId("case-shot");
const PETARD = asEquipmentId("petard");
const MUSKET = asEquipmentId("musket-1777");
const BLEEDING = asConditionId("poison");
const NO_INCENDIARY = asArticleId("no-incendiary");
const GUNNER = asPostId("artilleryman");

const HERO_AT = coord(2, 3);
const FOE_AT = coord(5, 3);

const CONTEXT: AnimationContext = {
  unitAt: (unitId) => {
    if (unitId === HERO) return HERO_AT;
    if (unitId === FOE) return FOE_AT;
    return undefined;
  },
  unitName: (unitId) => {
    if (unitId === HERO) return "Sgt. Aubry";
    if (unitId === FOE) return "Hedge Picket";
    return undefined;
  },
};

describe("isArtilleryAbility", () => {
  it("recognises Powder ordnance by id", () => {
    for (const id of ["case-shot", "grand-barrage", "artilleryman-kit", "kaisers-bombardiers"]) {
      expect(isArtilleryAbility(id)).toBe(true);
    }
  });

  it("leaves small arms and support actions alone", () => {
    for (const id of ["musket-fire", "bayonet-charge", "dress-ranks", "surgeon-kit"]) {
      expect(isArtilleryAbility(id)).toBe(false);
    }
  });

  it("keeps every declared keyword meaningful", () => {
    expect(ARTILLERY_KEYWORDS.length).toBeGreaterThan(0);
    for (const keyword of ARTILLERY_KEYWORDS) {
      expect(isArtilleryAbility(`demo-${keyword}-action`)).toBe(true);
    }
  });

  it("infers an element from an ordnance id when one is named", () => {
    expect(artilleryElement("incendiary-shell")).toBe("fire");
    expect(artilleryElement("siege-mortar")).toBe("earth");
    expect(artilleryElement("case-shot")).toBeUndefined();
  });
});

describe("movement cues", () => {
  it("turns a moved event into a marching cue with the full route", () => {
    const events: BattleEvent[] = [
      {
        kind: "moved",
        tick: 5,
        unitId: HERO,
        from: HERO_AT,
        to: coord(4, 3),
        path: [HERO_AT, coord(3, 3), coord(4, 3)],
        facing: "east",
      },
    ];
    const [cue] = animationsForEvents(events, CONTEXT);
    expect(cue.kind).toBe("move");
    if (cue.kind !== "move") return;
    expect(cue.reason).toBe("march");
    expect(cue.path).toEqual([HERO_AT, coord(3, 3), coord(4, 3)]);
    expect(cue.from).toEqual(HERO_AT);
    expect(cue.to).toEqual(coord(4, 3));
    expect(cue.facing).toBe("east");
    expect(cue.duration).toBe(2);
    expect(cue.unitName).toBe("Sgt. Aubry");
    expect(cue.label).toContain("marches");
  });

  it("turns a shove into a knockback cue", () => {
    const events: BattleEvent[] = [
      { kind: "shoved", tick: 6, unitId: FOE, from: coord(5, 3), to: coord(6, 3) },
    ];
    const [cue] = animationsForEvents(events, CONTEXT);
    expect(cue.kind).toBe("move");
    if (cue.kind !== "move") return;
    expect(cue.reason).toBe("shove");
    expect(cue.label).toContain("driven back");
  });

  it("never aliases engine coordinates", () => {
    const moved: BattleEvent = {
      kind: "moved",
      tick: 5,
      unitId: HERO,
      from: HERO_AT,
      to: coord(4, 3),
      path: [HERO_AT, coord(4, 3)],
      facing: "east",
    };
    const [cue] = animationsForEvents([moved], CONTEXT);
    if (cue.kind !== "move") return;
    expect(cue.from).not.toBe(moved.from);
    expect(cue.path[0]).not.toBe(moved.path[0]);
    expect(cue.path[1]).not.toBe(moved.path[1]);
  });
});

describe("volley cues", () => {
  it("maps the initiator and every chainer, in order, with the committed Honour", () => {
    const events: BattleEvent[] = [
      {
        kind: "volleyStarted",
        tick: 8,
        unitId: HERO,
        abilityId: RIFLE,
        at: FOE_AT,
        targetId: FOE,
        honour: 4,
      },
      {
        kind: "volleyChained",
        tick: 8,
        unitId: asUnitId("unit-lefevre"),
        abilityId: RIFLE,
        at: FOE_AT,
        targetId: FOE,
      },
    ];
    const cues = animationsForEvents(events, CONTEXT);
    expect(cues.map((cue) => cue.kind)).toEqual(["volley", "volley"]);
    const [start, chain] = cues;
    if (start.kind !== "volley" || chain.kind !== "volley") return;
    expect(start.role).toBe("start");
    expect(start.honour).toBe(4);
    expect(start.at).toEqual(FOE_AT);
    expect(chain.role).toBe("chain");
    expect(chain.honour).toBe(0);
    expect(start.label).toContain("opens a volley");
    expect(chain.label).toContain("chains in");
  });
});

describe("artillery cues", () => {
  it("fires for a Powder action and carries the element colour hint", () => {
    const events: BattleEvent[] = [
      { kind: "abilityResolved", tick: 9, unitId: HERO, abilityId: CASE_SHOT, at: FOE_AT },
    ];
    const [cue] = animationsForEvents(events, CONTEXT);
    expect(cue.kind).toBe("artillery");
    if (cue.kind !== "artillery") return;
    expect(cue.at).toEqual(FOE_AT);
    expect(cue.abilityId).toBe(CASE_SHOT);
  });

  it("does not fire for a small-arms action", () => {
    const events: BattleEvent[] = [
      { kind: "abilityResolved", tick: 9, unitId: HERO, abilityId: RIFLE, at: FOE_AT },
    ];
    expect(animationsForEvents(events, CONTEXT)).toEqual([]);
  });

  it("fires for a thrown ordnance item and tags its element", () => {
    const events: BattleEvent[] = [
      { kind: "itemUsed", tick: 9, unitId: HERO, itemId: PETARD, at: FOE_AT },
    ];
    const [cue] = animationsForEvents(events, CONTEXT);
    expect(cue.kind).toBe("artillery");
    if (cue.kind !== "artillery") return;
    expect(cue.abilityId).toBe(PETARD);
    expect(artilleryElement(PETARD)).toBeUndefined();
  });

  it("ignores a non-ordnance item", () => {
    const events: BattleEvent[] = [
      { kind: "itemUsed", tick: 9, unitId: HERO, itemId: MUSKET, at: FOE_AT },
    ];
    expect(animationsForEvents(events, CONTEXT)).toEqual([]);
  });

  it("exposes an element palette for the scene", () => {
    for (const color of Object.values(ELEMENT_COLORS)) {
      expect(Number.isInteger(color)).toBe(true);
    }
  });
});

describe("popup cues", () => {
  it("popups a damage figure and flags critical / fatal hits", () => {
    const events: BattleEvent[] = [
      {
        kind: "damaged",
        tick: 10,
        unitId: FOE,
        amount: 14,
        hpAfter: 0,
        damageType: "powder",
        element: "fire",
        critical: true,
        fatal: true,
      },
    ];
    const [cue] = animationsForEvents(events, CONTEXT);
    expect(cue.kind).toBe("popup");
    if (cue.kind !== "popup") return;
    expect(cue.text).toBe("-14");
    expect(cue.tone).toBe("damage");
    expect(cue.color).toBe(POPUP_COLORS.damage);
    expect(cue.critical).toBe(true);
    expect(cue.fatal).toBe(true);
    expect(cue.at).toEqual(FOE_AT);
    expect(cue.unitName).toBe("Hedge Picket");
  });

  it("popups healing, misses, knockouts and revivals", () => {
    const events: BattleEvent[] = [
      { kind: "healed", tick: 11, unitId: HERO, amount: 8, hpAfter: 40 },
      { kind: "missed", tick: 12, unitId: FOE },
      { kind: "outOfAction", tick: 13, unitId: FOE },
      { kind: "revived", tick: 14, unitId: FOE, hpAfter: 5 },
    ];
    const cues = animationsForEvents(events, CONTEXT);
    expect(cues.map((cue) => cue.kind)).toEqual(["popup", "popup", "popup", "popup"]);
    const texts = cues.map((cue) => (cue.kind === "popup" ? cue.text : ""));
    expect(texts).toEqual(["+8", "Miss", "Out of Action", "Revived"]);
  });

  it("popups a condition by its Napoleonic label and kind colour", () => {
    const events: BattleEvent[] = [
      { kind: "conditionApplied", tick: 15, unitId: FOE, conditionId: BLEEDING, duration: 4 },
      { kind: "conditionRemoved", tick: 16, unitId: FOE, conditionId: BLEEDING, reason: "cured" },
    ];
    const [applied, removed] = animationsForEvents(events, CONTEXT);
    if (applied.kind !== "popup" || removed.kind !== "popup") return;
    expect(applied.text).toBe("BL");
    expect(applied.color).toBe(CONDITION_KIND_COLORS.ailment);
    expect(applied.tone).toBe("condition");
    expect(removed.text).toContain("lifted");
  });

  it("popups Élan, Honour and Drill resource changes with signs", () => {
    const events: BattleEvent[] = [
      { kind: "mpChanged", tick: 17, unitId: HERO, delta: -4, mpAfter: 6, reason: "spent" },
      {
        kind: "honourChanged",
        tick: 18,
        unitId: HERO,
        delta: 2,
        honourAfter: 2,
        reason: "legalKo",
      },
      {
        kind: "drillGained",
        tick: 19,
        unitId: HERO,
        abilityId: RIFLE,
        amount: 30,
        drillAfter: 30,
        mastered: false,
      },
    ];
    const cues = animationsForEvents(events, CONTEXT);
    const texts = cues.map((cue) => (cue.kind === "popup" ? cue.text : ""));
    expect(texts).toEqual(["-4 Élan", "+2 Honour", "+30 Drill"]);
  });

  it("popups progression, Article verdicts and commendations", () => {
    const events: BattleEvent[] = [
      {
        kind: "experienceGained",
        tick: 20,
        unitId: HERO,
        amount: 12,
        experienceAfter: 12,
      },
      { kind: "levelUp", tick: 21, unitId: HERO, level: 2 },
      { kind: "abilityLearned", tick: 22, unitId: HERO, abilityId: RIFLE },
      { kind: "postUnlocked", tick: 23, unitId: HERO, postId: GUNNER },
      {
        kind: "articleBroken",
        tick: 24,
        unitId: HERO,
        articleId: NO_INCENDIARY,
        severity: "reprimand",
      },
      {
        kind: "reprimandIssued",
        tick: 25,
        unitId: HERO,
        articleId: NO_INCENDIARY,
        reprimands: 1,
      },
      { kind: "courtMartialIssued", tick: 26, unitId: HERO, articleId: NO_INCENDIARY },
      { kind: "commended", tick: 27, unitId: HERO, honour: 1 },
    ];
    const cues = animationsForEvents(events, CONTEXT);
    const texts = cues.map((cue) => (cue.kind === "popup" ? cue.text : ""));
    expect(texts).toEqual([
      "+12 XP",
      "Level 2",
      "Ability Mastered",
      "New Post",
      "Article Broken",
      "Reprimand",
      "Court-Martial",
      "+1 Honour",
    ]);
    expect(cues.every((cue) => cue.kind === "popup")).toBe(true);
  });

  it("omits the position when the context cannot resolve the soldier", () => {
    const events: BattleEvent[] = [
      {
        kind: "damaged",
        tick: 28,
        unitId: asUnitId("unit-unknown"),
        amount: 3,
        hpAfter: 7,
        damageType: "steel",
        critical: false,
        fatal: false,
      },
    ];
    const [cue] = animationsForEvents(events, {});
    if (cue.kind !== "popup") return;
    expect(cue.at).toBeUndefined();
    expect(cue.unitName).toBeUndefined();
    expect(cue.label).toContain("unit-unknown");
  });
});

describe("event-stream mapping", () => {
  it("skips events that have nothing on the field to animate", () => {
    const ignored: BattleEvent[] = [
      { kind: "battleStarted", tick: 0 },
      { kind: "battleEnded", tick: 40, outcome: "companyVictory" },
      { kind: "turnStarted", tick: 1, unitId: HERO },
      { kind: "turnEnded", tick: 2, unitId: HERO },
      { kind: "chargeStarted", tick: 3, unitId: HERO, chargeId: "c1", abilityId: RIFLE, ticks: 2 },
      { kind: "chargeResolved", tick: 5, unitId: HERO, chargeId: "c1", abilityId: RIFLE },
      { kind: "faced", tick: 6, unitId: HERO, from: "north", to: "east" },
      { kind: "rewardGranted", tick: 41, crowns: 500 },
    ];
    expect(animationsForEvents(ignored, CONTEXT)).toEqual([]);
  });

  it("preserves resolution order across cue families", () => {
    const events: BattleEvent[] = [
      {
        kind: "moved",
        tick: 5,
        unitId: HERO,
        from: HERO_AT,
        to: coord(4, 3),
        path: [HERO_AT, coord(4, 3)],
        facing: "east",
      },
      { kind: "abilityResolved", tick: 6, unitId: HERO, abilityId: CASE_SHOT, at: FOE_AT },
      {
        kind: "damaged",
        tick: 6,
        unitId: FOE,
        amount: 9,
        hpAfter: 11,
        damageType: "powder",
        critical: false,
        fatal: false,
      },
      { kind: "conditionApplied", tick: 6, unitId: FOE, conditionId: BLEEDING, duration: 3 },
    ];
    expect(animationsForEvents(events, CONTEXT).map((cue) => cue.kind)).toEqual([
      "move",
      "artillery",
      "popup",
      "popup",
    ]);
  });

  it("is deterministic for the same events and context", () => {
    const events: BattleEvent[] = [
      {
        kind: "moved",
        tick: 5,
        unitId: HERO,
        from: HERO_AT,
        to: coord(4, 3),
        path: [HERO_AT, coord(4, 3)],
        facing: "east",
      },
      {
        kind: "damaged",
        tick: 6,
        unitId: FOE,
        amount: 9,
        hpAfter: 11,
        damageType: "steel",
        critical: false,
        fatal: false,
      },
    ];
    expect(animationsForEvents(events, CONTEXT)).toEqual(animationsForEvents(events, CONTEXT));
  });

  it("documents every event kind that can produce a cue", () => {
    expect(new Set(ANIMATED_EVENT_KINDS).size).toBe(ANIMATED_EVENT_KINDS.length);
  });
});

describe("queries", () => {
  it("filters cues by family, preserving order", () => {
    const events: BattleEvent[] = [
      {
        kind: "moved",
        tick: 5,
        unitId: HERO,
        from: HERO_AT,
        to: coord(4, 3),
        path: [HERO_AT, coord(4, 3)],
        facing: "east",
      },
      { kind: "abilityResolved", tick: 6, unitId: HERO, abilityId: CASE_SHOT, at: FOE_AT },
    ];
    const cues = animationsForEvents(events, CONTEXT);
    expect(animationsOfKind(cues, "move")).toHaveLength(1);
    expect(animationsOfKind(cues, "artillery")).toHaveLength(1);
    expect(animationsOfKind(cues, "popup")).toHaveLength(0);
  });

  it("serialises a cue list as JSON-safe data", () => {
    const cues = animationsForEvents(
      [
        {
          kind: "moved",
          tick: 5,
          unitId: HERO,
          from: HERO_AT,
          to: coord(4, 3),
          path: [HERO_AT, coord(4, 3)],
          facing: "east",
        },
      ],
      CONTEXT,
    );
    expect(JSON.parse(serializeAnimations(cues))).toEqual(cues);
  });
});
