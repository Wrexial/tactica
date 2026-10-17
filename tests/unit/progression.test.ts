import { describe, expect, it } from "vitest";

import { EQUIPMENT, EQUIPMENT_LIST } from "../../src/data/equipment";
import {
  POST_LIST,
  POSTS,
  canTakePost,
  meetsPostRequirements,
  unlockablePosts,
  type MasteredByPost,
} from "../../src/data/posts";
import { EquipmentDefSchema, EQUIP_SLOTS } from "../../src/data/schema";
import { isBattleEvent } from "../../src/engine/events";
import { coord } from "../../src/engine/grid";
import {
  asAbilityId,
  asEquipmentId,
  asPostId,
  asSkillsetId,
  asUnitId,
  type AbilityId,
} from "../../src/engine/ids";
import {
  awardDrill,
  drillProgress,
  equippedTeaches,
  isMastered,
  learnedAbilityOf,
  unmasteredEquippedTeaches,
} from "../../src/engine/progression/drill";
import {
  MAX_LEVEL,
  awardExperience,
  experienceForAction,
  levelUpStatGains,
} from "../../src/engine/progression/level";
import {
  assignActionSkillset,
  availableSkillsets,
  canEquipItem,
  createPostAssignment,
  derivePostStats,
  equippableItems,
  primaryPostGrowth,
} from "../../src/engine/progression/posts";
import { deriveStats } from "../../src/engine/stats";
import { createUnit, withEquipment, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T053 — Progression validation + tests
 *
 * This is the **integration** suite for the Phase 4 progression loop. The
 * individual pieces are already tested piecemeal (T046–T051); here they are
 * driven end to end, in the order a campaign meets them:
 *
 * ```text
 *   kit.teaches ──► equippedTeaches      (T048)  which abilities are trained?
 *                        │
 *                        ▼
 *   awardDrill (T048) ──► mastery        (LearnedAbility on the unit)
 *                        │
 *                        ▼
 *   MasteredByPost ──► meetsPostRequirements / unlockablePosts (T046/T047)
 *                        │
 *                        ▼
 *   createPostAssignment (T051) ──► canEquipItem  (primary post gates kit)
 *                        │
 *                        ▼
 *   derivePostStats / awardExperience (T018/T049)  growth along the post
 * ```
 *
 * It pins the task's "done when": **unlock rules**, **Drill distribution**,
 * **growth** and **equip legality** are all covered, and the layers agree. It
 * also re-checks the engine contracts where they meet — purity,
 * determinism and well-formed events (`agents.md` §2).
 *
 * Note on attribution: the ability collection (T089) will author the
 * ability → post link on `AbilityDef.postId`. Until then the suite spells out
 * the small subset it drills ({@link ATTRIBUTION}) so a `MasteredByPost` map
 * can be derived from a real `awardDrill` result rather than hand-waved.
 * ------------------------------------------------------------------------ */

/* --------------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------------ */

/** The Fusilier's authored growth (France, `src/data/posts/france.ts`). */
const FUSILIER_GROWTH = POSTS.fusilier.growth;

const FUSILIER_KIT = asSkillsetId("fusilier-kit");
const GRENADIER_KIT = asSkillsetId("grenadier-kit");

/**
 * Which post teaches each ability. The authored ability collection lands in
 * T089; this is the minimal map needed to turn a unit's `mastered` flags into
 * the `MasteredByPost` unlock currency the data layer consumes.
 */
const ATTRIBUTION: Readonly<Record<string, readonly AbilityId[]>> = {
  fusilier: [asAbilityId("volley-fire"), asAbilityId("parry"), asAbilityId("range-the-ground")],
  grenadier: [asAbilityId("bayonet-charge")],
};

/**
 * A France Fusilier wearing teaching kit: the Charleville musket binds
 * `volley-fire` (100 Drill), the pavise binds `parry` (70) and the spyglass
 * binds `range-the-ground` (70). Armour and headgear teach nothing.
 */
function makeSoldier(overrides: Partial<UnitInit> = {}): Unit {
  return createUnit({
    id: asUnitId("unit-soldier"),
    name: "Sgt. Aubry",
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    experience: 0,
    at: coord(2, 3),
    stats: deriveStats({ level: 1, growth: FUSILIER_GROWTH }),
    equipment: {
      weapon: asEquipmentId("charleville-musket"),
      offhand: asEquipmentId("pavise-shield"),
      armour: asEquipmentId("line-uniform"),
      head: asEquipmentId("shako"),
      accessory: asEquipmentId("spyglass"),
    },
    ...overrides,
  });
}

/** Derive the `MasteredByPost` unlock currency from a soldier's Drill mastery. */
function masteredFromDrill(
  unit: Unit,
  attribution: Readonly<Record<string, readonly AbilityId[]>>,
): MasteredByPost {
  const result: Record<string, string[]> = {};
  for (const [postId, abilityIds] of Object.entries(attribution)) {
    const mastered = abilityIds.filter((abilityId) => isMastered(unit, abilityId));
    if (mastered.length > 0) result[postId] = [...mastered];
  }
  return result;
}

/* ==========================================================================
 * Unlock rules (T046/T047)
 * ======================================================================== */

describe("unlock rules", () => {
  it("leaves a starting post open and gates the rest on mastery", () => {
    expect(meetsPostRequirements(POSTS.fusilier, {})).toBe(true);
    expect(meetsPostRequirements(POSTS.grenadier, {})).toBe(false);
    expect(meetsPostRequirements(POSTS.grenadier, { fusilier: ["a", "b"] })).toBe(true);

    const empty = unlockablePosts("france", {}).map((post) => post.id);
    expect(empty).toContain("fusilier");
    expect(empty).not.toContain("grenadier");
  });

  it("opens the whole first tier when the starter's abilities are mastered", () => {
    const unlocked = unlockablePosts("france", { fusilier: ["a", "b", "c"] }).map(
      (post) => post.id,
    );
    expect(unlocked).toContain("grenadier"); // 2× fusilier
    expect(unlocked).toContain("marksman"); // 2× fusilier
    expect(unlocked).toContain("colour-guard"); // 3× fusilier
    // Second-tier posts need mastery in their own prerequisite post.
    expect(unlocked).not.toContain("hussar");
    expect(unlocked).not.toContain("chasseur");
    expect(unlocked).not.toContain("bombardier");
  });

  it("charges each unlock against the post it names", () => {
    const tier2 = unlockablePosts("france", {
      fusilier: ["a", "b", "c"],
      marksman: ["a", "b"],
    }).map((post) => post.id);
    expect(tier2).toContain("hussar"); // 2× marksman
    expect(tier2).not.toContain("chasseur"); // 3× marksman

    const bombardier = unlockablePosts("france", {
      fusilier: ["a", "b", "c"],
      grenadier: ["a", "b", "c"],
    }).map((post) => post.id);
    expect(bombardier).toContain("bombardier"); // 3× grenadier
  });

  it("never lets one school's mastery unlock another school's post", () => {
    const britain = unlockablePosts("britain", { fusilier: ["a", "b", "c"] }).map(
      (post) => post.id,
    );
    expect(britain).toContain("rifleman");
    expect(britain).not.toContain("grenadier");
  });

  it("gates the assignment itself by power, not just the unlock list", () => {
    expect(() =>
      createPostAssignment({ primaryPostId: asPostId("fusilier"), power: "britain" }),
    ).toThrow(RangeError);
    expect(canTakePost("surgeon", "britain")).toBe(true); // common posts are open
    expect(() =>
      createPostAssignment({ primaryPostId: asPostId("surgeon"), power: "britain" }),
    ).not.toThrow();
  });
});

/* ==========================================================================
 * Drill distribution (T048)
 * ======================================================================== */

describe("Drill distribution", () => {
  it("credits every equipped, unmastered ability the full award", () => {
    const soldier = makeSoldier();
    expect(equippedTeaches(soldier).map((teach) => teach.abilityId)).toEqual([
      "volley-fire",
      "parry",
      "range-the-ground",
    ]);

    const award = awardDrill(soldier, 40, 1);
    expect(award.trained).toBe(3);
    expect(award.mastered).toBe(0);
    for (const learned of award.unit.abilities) {
      expect(learned.drill).toBe(40); // the whole award, not a split
    }
    // The input is untouched.
    expect(soldier.abilities).toEqual([]);
  });

  it("masters abilities in parallel and caps each at its authored cost", () => {
    const award = awardDrill(makeSoldier(), 100, 2);
    expect(award.mastered).toBe(3);
    expect(learnedAbilityOf(award.unit, asAbilityId("volley-fire"))).toEqual({
      abilityId: "volley-fire",
      drill: 100,
      mastered: true,
    });
    expect(learnedAbilityOf(award.unit, asAbilityId("parry"))).toEqual({
      abilityId: "parry",
      drill: 70,
      mastered: true,
    });
    expect(unmasteredEquippedTeaches(award.unit)).toEqual([]);
  });

  it("resumes banked Drill after the teaching item is re-equipped", () => {
    const trained = awardDrill(makeSoldier(), 40).unit; // parry at 40/70
    const disarmed = withEquipment(trained, "offhand", null);
    const rearmed = withEquipment(disarmed, "offhand", asEquipmentId("pavise-shield"));

    expect(learnedAbilityOf(disarmed, asAbilityId("parry"))?.drill).toBe(40);
    expect(awardDrill(rearmed, 30).unit.abilities.find((a) => a.abilityId === "parry")).toEqual({
      abilityId: "parry",
      drill: 70,
      mastered: true,
    });
  });

  it("turns mastered Drill into unlock currency end to end", () => {
    const mastered = masteredFromDrill(awardDrill(makeSoldier(), 100, 1).unit, ATTRIBUTION);
    expect(mastered.fusilier).toHaveLength(3);

    const unlocked = unlockablePosts("france", mastered).map((post) => post.id);
    expect(unlocked).toContain("grenadier");
    expect(unlocked).toContain("marksman");
    expect(unlocked).toContain("colour-guard");
  });

  it("reports the barracks Drill progress for the equipped kit", () => {
    const soldier = awardDrill(makeSoldier(), 30, 4).unit;
    const progress = drillProgress(soldier);
    expect(progress.map((entry) => entry.abilityId)).toEqual([
      "volley-fire",
      "parry",
      "range-the-ground",
    ]);
    expect(progress[0]).toMatchObject({ drill: 30, requiredDrill: 100, mastered: false });
    // A duplicate teaching of the same ability does not double the rate.
    const duplicated = makeSoldier({
      equipment: {
        weapon: asEquipmentId("charleville-musket"),
        offhand: asEquipmentId("charleville-musket"),
        armour: null,
        head: null,
        accessory: null,
      },
    });
    expect(awardDrill(duplicated, 30).trained).toBe(1);
  });
});

/* ==========================================================================
 * Growth (T018/T049)
 * ======================================================================== */

describe("growth", () => {
  it("derives stats from the primary post's growth at the soldier's level", () => {
    const assignment = createPostAssignment({ primaryPostId: asPostId("fusilier") });
    expect(derivePostStats({ level: 10, assignment })).toEqual(
      deriveStats({ level: 10, growth: POSTS.fusilier.growth }),
    );
  });

  it("leaves stats unchanged when a mastered post is attached", () => {
    const base = createPostAssignment({ primaryPostId: asPostId("fusilier") });
    const attached = assignActionSkillset(base, GRENADIER_KIT, {
      grenadier: ["bayonet-charge"],
    });
    expect(attached.attachedPostId).toBe(asPostId("grenadier"));
    expect(availableSkillsets(base, { grenadier: ["bayonet-charge"] })).toEqual([
      FUSILIER_KIT,
      GRENADIER_KIT,
    ]);
    expect(derivePostStats({ level: 12, assignment: attached })).toEqual(
      derivePostStats({ level: 12, assignment: base }),
    );
  });

  it("levels a soldier along the primary post's growth, matching deriveStats", () => {
    const assignment = createPostAssignment({ primaryPostId: asPostId("fusilier") });
    const postMods = { hp: 50, move: 4, jump: 2 };
    const growth = primaryPostGrowth(assignment);
    const level1 = derivePostStats({ level: 1, assignment, postMods });
    const soldier = makeSoldier({ stats: level1 });

    const award = awardExperience(soldier, 100, growth, 1);
    expect(award.unit.level).toBe(2);
    expect(award.unit.stats).toEqual(derivePostStats({ level: 2, assignment, postMods }));
  });

  it("stays consistent with deriveStats level after level", () => {
    let soldier = makeSoldier({ stats: deriveStats({ level: 1, growth: FUSILIER_GROWTH }) });
    for (let level = 1; level < 10; level += 1) {
      soldier = awardExperience(soldier, 100, FUSILIER_GROWTH).unit;
      expect(soldier.level).toBe(level + 1);
      expect(soldier.stats).toEqual(deriveStats({ level: level + 1, growth: FUSILIER_GROWTH }));
    }
  });

  it("telescopes the per-level gains into the derived table", () => {
    for (const level of [1, 5, 20, 50] as const) {
      let total = 0;
      for (let l = 1; l < level; l += 1) total += levelUpStatGains(FUSILIER_GROWTH, l).hp;
      expect(deriveStats({ level: 1, growth: FUSILIER_GROWTH }).hp + total).toBe(
        deriveStats({ level, growth: FUSILIER_GROWTH }).hp,
      );
    }
  });

  it("caps at the level cap and discards further Experience", () => {
    const stats = deriveStats({ level: MAX_LEVEL, growth: FUSILIER_GROWTH });
    const capped = makeSoldier({ level: MAX_LEVEL, stats, hp: stats.hp });
    const award = awardExperience(capped, 999, FUSILIER_GROWTH);
    expect(award.gained).toBe(0);
    expect(award.unit).toBe(capped);
  });

  it("scales action Experience by the target's level", () => {
    expect(experienceForAction(10, 10)).toBe(10);
    expect(experienceForAction(10, 15)).toBe(20);
  });
});

/* ==========================================================================
 * Equip legality (T050/T051)
 * ======================================================================== */

describe("equip legality", () => {
  it("gates by the post's declared equip slots", () => {
    // Riflemen fight from the shoulder: no off-hand slot.
    expect(canEquipItem(POSTS.rifleman, EQUIPMENT["baker-rifle"], "britain")).toBe(true);
    expect(canEquipItem(POSTS.rifleman, EQUIPMENT["pavise-shield"], "britain")).toBe(false);
    // Grenadiers carry the full kit.
    expect(canEquipItem(POSTS.grenadier, EQUIPMENT["pavise-shield"], "france")).toBe(true);
  });

  it("gates weapons by the post's trained families", () => {
    expect(canEquipItem(POSTS.rifleman, EQUIPMENT["baker-rifle"], "britain")).toBe(true);
    expect(canEquipItem(POSTS.rifleman, EQUIPMENT["charleville-musket"], "britain")).toBe(false);
    expect(canEquipItem(POSTS.artilleryman, EQUIPMENT["six-pounder"], "france")).toBe(true);
    expect(canEquipItem(POSTS.artilleryman, EQUIPMENT["baker-rifle"], "france")).toBe(false);
  });

  it("never lets a soldier carry another school's signature arm", () => {
    expect(canEquipItem(POSTS.fusilier, EQUIPMENT["charleville-musket"], "france")).toBe(true);
    expect(canEquipItem(POSTS.fusilier, EQUIPMENT["baker-rifle"], "france")).toBe(false);
    expect(canEquipItem(POSTS["colour-guard"], EQUIPMENT["grenadier-broadsword"], "france")).toBe(
      true,
    );
    expect(canEquipItem(POSTS["colour-guard"], EQUIPMENT["baker-rifle"], "france")).toBe(false);
    expect(canEquipItem(POSTS["master-gunner"], EQUIPMENT["six-pounder"], "russia")).toBe(true);
    expect(canEquipItem(POSTS["master-gunner"], EQUIPMENT["baker-rifle"], "russia")).toBe(false);
  });

  it("honours an item's power restriction when a power is supplied", () => {
    const restricted = EquipmentDefSchema.parse({
      id: "fixture-rifle",
      name: "Fixture Rifle",
      description: "A test-only arm.",
      flavour: "A test-only arm.",
      slot: "weapon",
      weaponType: "rifle",
      restrictedTo: ["britain"],
    });
    expect(canEquipItem(POSTS.marksman, restricted, "britain")).toBe(false);
    expect(canEquipItem(POSTS.marksman, restricted, "france")).toBe(true);
    // With no soldier, the item restriction does not apply.
    expect(canEquipItem(POSTS.marksman, restricted)).toBe(true);
  });

  it("finds legal kit in every slot each post declares", () => {
    for (const post of POST_LIST) {
      for (const slot of post.equipSlots) {
        const inSlot = EQUIPMENT_LIST.filter((item) => item.slot === slot);
        expect(
          equippableItems(post, inSlot, post.power).length,
          `${post.id} has no legal ${slot}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("draws the equip screen's kit from the post's own legality", () => {
    const legal = equippableItems(POSTS.fusilier, EQUIPMENT_LIST, "france");
    const ids = legal.map((item) => item.id);
    expect(ids).toContain("charleville-musket");
    expect(ids).not.toContain("baker-rifle");
    expect(ids).not.toContain("pavise-shield"); // no off-hand slot
    for (const item of legal) {
      expect(POSTS.fusilier.equipSlots).toContain(item.slot);
      if (item.slot === "weapon") {
        expect(POSTS.fusilier.weaponTypes).toContain(item.weaponType);
      }
    }
  });

  it("keeps the authored equip slots on the canonical set", () => {
    for (const post of POST_LIST) {
      for (const slot of post.equipSlots) expect(EQUIP_SLOTS).toContain(slot);
    }
  });
});

/* ==========================================================================
 * Cross-layer contracts
 * ======================================================================== */

describe("progression purity & determinism", () => {
  it("never mutates a soldier across the pipeline and replays identically", () => {
    const soldier = makeSoldier();
    const before = JSON.parse(JSON.stringify(soldier)) as Unit;

    const run = (): Unit => {
      const drilled = awardDrill(soldier, 100, 1).unit;
      return awardExperience(drilled, 250, FUSILIER_GROWTH, 2).unit;
    };

    const first = run();
    const second = run();

    expect(JSON.parse(JSON.stringify(soldier))).toEqual(before);
    expect(first).not.toBe(soldier);
    expect(first).toEqual(second);
  });

  it("emits structurally valid events across Drill and Experience awards", () => {
    const drillEvents = awardDrill(makeSoldier(), 100, 1).events;
    const levelEvents = awardExperience(makeSoldier(), 250, FUSILIER_GROWTH, 1).events;
    const events = [...drillEvents, ...levelEvents];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(isBattleEvent)).toBe(true);
  });

  it("is deterministic for the same assignment inputs", () => {
    const first = createPostAssignment({ primaryPostId: asPostId("fusilier"), power: "france" });
    const second = createPostAssignment({ primaryPostId: asPostId("fusilier"), power: "france" });
    expect(first).toEqual(second);
    expect(derivePostStats({ level: 7, assignment: first })).toEqual(
      derivePostStats({ level: 7, assignment: second }),
    );
  });
});
