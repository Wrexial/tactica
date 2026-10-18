import { describe, expect, it } from "vitest";

import { coord } from "../../src/engine/grid";
import type { BattleEvent } from "../../src/engine/events";
import {
  asAbilityId,
  asArticleId,
  asEquipmentId,
  asGuardSortieId,
  asUnitId,
} from "../../src/engine/ids";
import {
  SFX_CATEGORIES,
  SFX_LIBRARY,
  SFX_NAMES,
  clampVolume,
  createSfxPlayer,
  sfxForEvent,
  sfxGain,
  type SfxBackend,
  type SfxRecipe,
} from "../../src/audio/sfx";

/* --------------------------------------------------------------------------
 * T107 — Royalty-free SFX
 *
 * The bank is pure, authored synthesis data, so it can be pinned entirely in
 * Node: recipe integrity, the master-volume maths, the {@link SfxPlayer} façade
 * (against a fake backend) and the engine-event→cue bridge. No browser, no
 * assets.
 * ------------------------------------------------------------------------ */

const HERO = asUnitId("unit-hero");
const FOE = asUnitId("unit-foe");
const RIFLE = asAbilityId("musket-fire");
const CASE_SHOT = asAbilityId("case-shot");
const PETARD = asEquipmentId("petard");
const NO_INCENDIARY = asArticleId("no-incendiary");
const OLD_GUARD = asGuardSortieId("old-guard");

/** A recording backend so tests can observe what would have played. */
function recordingBackend(options: { supported?: boolean } = {}): {
  backend: SfxBackend;
  played: { recipe: SfxRecipe; gain: number }[];
  resumed: () => number;
  disposed: () => number;
} {
  const played: { recipe: SfxRecipe; gain: number }[] = [];
  let resumes = 0;
  let disposes = 0;
  const backend: SfxBackend = {
    supported: options.supported ?? true,
    play(recipe, gain) {
      played.push({ recipe, gain });
    },
    async resume() {
      resumes += 1;
    },
    dispose() {
      disposes += 1;
    },
  };
  return {
    backend,
    played,
    resumed: () => resumes,
    disposed: () => disposes,
  };
}

describe("T107 — SFX library", () => {
  it("has a recipe for every declared name, keyed by that name", () => {
    const declared = [...SFX_NAMES].sort();
    const authored = Object.keys(SFX_LIBRARY).sort();
    expect(authored).toEqual(declared);
    for (const name of SFX_NAMES) {
      expect(SFX_LIBRARY[name].name).toBe(name);
    }
  });

  it("gives every recipe a real category, a positive trim and audible nodes", () => {
    for (const name of SFX_NAMES) {
      const recipe = SFX_LIBRARY[name];
      expect(SFX_CATEGORIES).toContain(recipe.category);
      expect(recipe.gain).toBeGreaterThan(0);
      expect(recipe.gain).toBeLessThanOrEqual(1);
      expect(recipe.nodes.length).toBeGreaterThan(0);

      for (const node of recipe.nodes) {
        expect(node.at).toBeGreaterThanOrEqual(0);
        expect(node.duration).toBeGreaterThan(0);
        expect(node.gain).toBeGreaterThan(0);
        expect(node.gain).toBeLessThanOrEqual(1);
        if (node.kind === "tone") {
          expect(node.from).toBeGreaterThan(0);
        } else {
          expect(node.cutoff).toBeGreaterThan(0);
        }
      }
    }
  });

  it("covers each family the task names: UI, volleys, guns and cards", () => {
    for (const category of ["ui", "volley", "gun", "card"] as const) {
      expect(SFX_NAMES.some((name) => SFX_LIBRARY[name].category === category)).toBe(true);
    }
    // The Provost's two enforcement cards must sound distinct.
    expect(SFX_LIBRARY["card-reprimand"]).not.toEqual(SFX_LIBRARY["card-court-martial"]);
  });
});

describe("T107 — master volume", () => {
  it("clamps an arbitrary master volume to a whole 0–100", () => {
    expect(clampVolume(-10)).toBe(0);
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(70.4)).toBe(70);
    expect(clampVolume(70.6)).toBe(71);
    expect(clampVolume(1000)).toBe(100);
    expect(clampVolume(Number.NaN)).toBe(0);
  });

  it("scales a cue's trim by the master volume, and mutes to silence", () => {
    expect(sfxGain(1, 100)).toBeCloseTo(1, 5);
    expect(sfxGain(1, 50)).toBeCloseTo(0.5, 5);
    expect(sfxGain(0.5, 70)).toBeCloseTo(0.35, 5);
    expect(sfxGain(1, 100, true)).toBe(0);
    expect(sfxGain(2, 100)).toBe(1);
  });
});

describe("T107 — SfxPlayer", () => {
  it("resolves a name to its recipe and forwards the effective gain", () => {
    const { backend, played } = recordingBackend();
    const player = createSfxPlayer({ backend, volume: 50 });

    expect(player.supported).toBe(true);
    expect(player.play("gun-cannon")).toBe(true);

    expect(played).toHaveLength(1);
    expect(played[0].recipe.name).toBe("gun-cannon");
    expect(played[0].gain).toBeCloseTo(sfxGain(SFX_LIBRARY["gun-cannon"].gain, 50), 5);
  });

  it("is silent — and reports it — when muted, at zero volume or unsupported", () => {
    const { backend, played } = recordingBackend();
    const player = createSfxPlayer({ backend, volume: 80 });

    player.setMuted(true);
    expect(player.play("ui-confirm")).toBe(false);
    player.setMuted(false);
    player.setVolume(0);
    expect(player.play("ui-confirm")).toBe(false);
    expect(played).toHaveLength(0);

    const unsupported = createSfxPlayer({
      backend: recordingBackend({ supported: false }).backend,
    });
    expect(unsupported.supported).toBe(false);
    expect(unsupported.play("gun-musket")).toBe(false);
  });

  it("clamps updates and resumes/disposes through the backend", async () => {
    const { backend, resumed, disposed } = recordingBackend();
    const player = createSfxPlayer({ backend, volume: 70 });

    player.setVolume(250);
    expect(player.volume).toBe(100);
    player.setVolume(-5);
    expect(player.volume).toBe(0);

    await player.unlock();
    expect(resumed()).toBe(1);

    player.dispose();
    expect(disposed()).toBe(1);
  });

  it("degrades to an unsupported no-op player in a plain Node run", () => {
    const player = createSfxPlayer();
    expect(player.supported).toBe(false);
    expect(player.play("volley-start")).toBe(false);
    expect(() => player.dispose()).not.toThrow();
  });
});

describe("T107 — engine event bridge", () => {
  it("plays the massed volley on start and a single crack on each chain", () => {
    const started: BattleEvent = {
      kind: "volleyStarted",
      tick: 10,
      unitId: HERO,
      abilityId: RIFLE,
      at: coord(6, 2),
      targetId: FOE,
      honour: 3,
    };
    const chained: BattleEvent = {
      kind: "volleyChained",
      tick: 10,
      unitId: FOE,
      abilityId: RIFLE,
      at: coord(6, 2),
      targetId: FOE,
    };
    expect(sfxForEvent(started)).toBe("volley-start");
    expect(sfxForEvent(chained)).toBe("volley-chain");
  });

  it("booms for Powder ordnance but stays quiet for small-arms actions", () => {
    const artillery: BattleEvent = {
      kind: "abilityResolved",
      tick: 8,
      unitId: HERO,
      abilityId: CASE_SHOT,
      at: coord(6, 2),
    };
    const smallArms: BattleEvent = {
      kind: "abilityResolved",
      tick: 8,
      unitId: HERO,
      abilityId: RIFLE,
      at: coord(6, 2),
    };
    const thrown: BattleEvent = {
      kind: "itemUsed",
      tick: 9,
      unitId: HERO,
      itemId: PETARD,
      at: coord(6, 2),
    };
    expect(sfxForEvent(artillery)).toBe("gun-cannon");
    expect(sfxForEvent(smallArms)).toBeNull();
    expect(sfxForEvent(thrown)).toBe("gun-cannon");
  });

  it("picks the hit cue from the damage type and casualty", () => {
    const hit = (damageType: "steel" | "powder" | "none", fatal: boolean): BattleEvent => ({
      kind: "damaged",
      tick: 8,
      unitId: FOE,
      amount: fatal ? 60 : 12,
      hpAfter: fatal ? 0 : 8,
      damageType,
      critical: false,
      fatal,
    });
    expect(sfxForEvent(hit("powder", false))).toBe("gun-musket");
    expect(sfxForEvent(hit("steel", false))).toBe("combat-clash");
    expect(sfxForEvent(hit("none", false))).toBe("combat-hit");
    expect(sfxForEvent(hit("steel", true))).toBe("combat-defeat");
    expect(sfxForEvent({ kind: "outOfAction", tick: 11, unitId: FOE })).toBe("combat-defeat");
    expect(sfxForEvent({ kind: "missed", tick: 9, unitId: FOE })).toBe("combat-miss");
    expect(sfxForEvent({ kind: "healed", tick: 9, unitId: HERO, amount: 5, hpAfter: 40 })).toBe(
      "combat-heal",
    );
  });

  it("sounds the Provost's cards and worthy acts", () => {
    expect(
      sfxForEvent({
        kind: "articleBroken",
        tick: 7,
        unitId: HERO,
        articleId: NO_INCENDIARY,
        severity: "reprimand",
      }),
    ).toBe("card-article");
    expect(
      sfxForEvent({
        kind: "reprimandIssued",
        tick: 7,
        unitId: HERO,
        articleId: NO_INCENDIARY,
        reprimands: 1,
      }),
    ).toBe("card-reprimand");
    expect(
      sfxForEvent({ kind: "courtMartialIssued", tick: 7, unitId: HERO, articleId: NO_INCENDIARY }),
    ).toBe("card-court-martial");
    expect(sfxForEvent({ kind: "commended", tick: 11, unitId: HERO, honour: 1 })).toBe(
      "card-commend",
    );
    expect(
      sfxForEvent({ kind: "guardSortieCalled", tick: 20, unitId: HERO, guardSortieId: OLD_GUARD }),
    ).toBe("card-sortie");
  });

  it("stays quiet for lifecycle and bookkeeping events", () => {
    expect(sfxForEvent({ kind: "battleStarted", tick: 0 })).toBeNull();
    expect(sfxForEvent({ kind: "turnStarted", tick: 1, unitId: HERO })).toBeNull();
  });
});
