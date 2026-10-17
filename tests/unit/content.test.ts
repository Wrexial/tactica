import { describe, expect, it } from "vitest";

import {
  ABILITY_LIST,
  SHARED_SKILLSET_IDS,
  findAbility,
  isKnownSkillset,
  postActionSet,
} from "../../src/data/abilities";
import { ARTICLE_LIST } from "../../src/data/articles";
import { CONDITION_KEYS, CONDITION_LIST } from "../../src/data/conditions";
import { CONTRACT_LIST } from "../../src/data/contracts";
import { ELEMENT_LIST } from "../../src/data/elements";
import { AI_PROFILE_LIST, ENEMY_LIST } from "../../src/data/enemies";
import { EQUIPMENT_LIST } from "../../src/data/equipment";
import { GUARD_SORTIE_LIST } from "../../src/data/guards";
import { BATTLE_MAP_LIST, LOCATION_LIST } from "../../src/data/maps";
import { POST_LIST } from "../../src/data/posts";
import { ELEMENT_KEYS, POWER_KEYS, WEAPON_TYPES, type ArticleTarget } from "../../src/data/schema";
import { MAX_STORY_CHAPTER, STORY_CHAPTER_LIST } from "../../src/data/story";
import { WEAPON_FAMILIES } from "../../src/data/weapons";

/* --------------------------------------------------------------------------
 * T094 — Content integrity test
 *
 * Pins the task's "done when" for the whole authored corpus: **all
 * cross-references resolve, no ID dangles, and every definition carries an
 * authored Napoleonic name.** Later features (T089–T093) each proved their own
 * slice; this suite is the single end-to-end sweep over every collection at
 * once, so a future piece of content cannot break a reference somewhere else
 * without a red test here.
 *
 * It checks three things, in order:
 *
 * 1. **Registry hygiene** — every collection is keyed uniquely and is
 *    non-empty, and the canonical `*_LIST` agrees with its `*_KEYS`.
 * 2. **Authored display** — every definition has a non-empty, non-placeholder
 *    Napoleonic `name` (plus `description`/`flavour`) with no FFTA trademark
 *    leaking through (`agents.md` §3, mapping §14 D6/D8).
 * 3. **Cross-references** — every id authored in one collection resolves to a
 *    real entry in the collection that owns it, and the reverse back-links
 *    (location ↔ battle map, story spine ↔ contracts/Guard Sorties) agree.
 *
 * This file intentionally re-states a few invariants also pinned in
 * `data.test.ts` (T089–T093) so it stands alone as the content gate.
 * ------------------------------------------------------------------------ */

/** Every authored definition shares the three display fields (mapping §14). */
interface DisplayDef {
  id: string;
  name: string;
  description: string;
  flavour: string;
}

/** The curated FFTA vocabulary that must never appear in our display text. */
const FFTA_MARKERS = [
  "mythril",
  "genji",
  "chocobo",
  "moogle",
  "bangaa",
  "viera",
  "hume",
  "ivalice",
  "malboro",
  "tonberry",
  "ifrit",
  "shiva",
  "sephiroth",
] as const;

/** Markers that mean "content not authored yet" (mirrors the T009 sweep). */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\bTBD\b/i,
  /\bTBC\b/i,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bXXX\b/i,
  /\bplaceholder\b/i,
  /lorem\s+ipsum/i,
  /\?{3,}/,
];

/** Returns the first placeholder marker found in `text`, or `null` if clean. */
function findPlaceholder(text: string): string | null {
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(text)) return pattern.source;
  }
  return null;
}

/**
 * Every authored collection, paired with its player-facing label. Typed as
 * `DisplayDef[]` so the naming sweep below covers all of them uniformly — even
 * the collections that live outside `src/data/schema.ts` (weapon families, AI
 * profiles, maps, the story spine).
 */
const COLLECTIONS: ReadonlyArray<[string, readonly DisplayDef[]]> = [
  ["elements", ELEMENT_LIST],
  ["conditions", CONDITION_LIST],
  ["abilities", ABILITY_LIST],
  ["posts", POST_LIST],
  ["equipment", EQUIPMENT_LIST],
  ["enemies", ENEMY_LIST],
  ["articles", ARTICLE_LIST],
  ["contracts", CONTRACT_LIST],
  ["guard sorties", GUARD_SORTIE_LIST],
  ["story chapters", STORY_CHAPTER_LIST],
  ["locations", LOCATION_LIST],
  ["battle maps", BATTLE_MAP_LIST],
  ["weapon families", WEAPON_TYPES.map((type) => WEAPON_FAMILIES[type])],
  ["AI profiles", AI_PROFILE_LIST],
];

/* --------------------------------------------------------------------------
 * Resolution indexes — the "known ids" each cross-reference is checked against
 * ------------------------------------------------------------------------ */

const elementIds = new Set<string>(ELEMENT_KEYS);
const conditionIds = new Set<string>(CONDITION_KEYS);
const abilityIds = new Set<string>(ABILITY_LIST.map((ability) => ability.id));
const postIds = new Set<string>(POST_LIST.map((post) => post.id));
const equipmentIds = new Set<string>(EQUIPMENT_LIST.map((item) => item.id));
const aiProfileIds = new Set<string>(AI_PROFILE_LIST.map((profile) => profile.id));
const weaponTypeIds = new Set<string>(WEAPON_TYPES);
const contractIds = new Set<string>(CONTRACT_LIST.map((contract) => contract.id));
const guardSortieIds = new Set<string>(GUARD_SORTIE_LIST.map((guard) => guard.id));
const locationIds = new Set<string>(LOCATION_LIST.map((location) => location.id));
const battleMapIds = new Set<string>(BATTLE_MAP_LIST.map((map) => map.id));
const regionIds = new Set<string>(LOCATION_LIST.map((location) => location.regionId));

const locationById = new Map(LOCATION_LIST.map((location) => [location.id, location]));

/** The contracts a story chapter opens, and the formations it unlocks. */
const chapterContractIds = new Set(STORY_CHAPTER_LIST.flatMap((chapter) => chapter.contractIds));
const chapterGuardIds = new Set(STORY_CHAPTER_LIST.flatMap((chapter) => chapter.guardSortieIds));

/** Assert an id resolves inside the collection that owns it. */
function expectResolves(known: ReadonlySet<string>, id: string, where: string): void {
  expect(known.has(id), `${where} → dangling id "${id}"`).toBe(true);
}

/* --------------------------------------------------------------------------
 * 1 — Registry hygiene
 * ------------------------------------------------------------------------ */

describe("content integrity — registry hygiene (T094)", () => {
  it("authors at least one definition in every collection", () => {
    for (const [label, defs] of COLLECTIONS) {
      expect(defs.length, `${label} is empty`).toBeGreaterThan(0);
    }
  });

  it("gives every collection unique, non-empty ids", () => {
    for (const [label, defs] of COLLECTIONS) {
      const ids = defs.map((def) => def.id);
      for (const id of ids) {
        expect(id.trim(), `${label} has a blank id`).not.toBe("");
      }
      expect(new Set(ids).size, `${label} has duplicate ids`).toBe(ids.length);
    }
  });

  it("keeps every canonical key list and its definition list aligned", () => {
    const pairs: ReadonlyArray<readonly [string, readonly string[], readonly DisplayDef[]]> = [
      ["abilities", ABILITY_LIST.map((def) => def.id), ABILITY_LIST],
      ["posts", POST_LIST.map((def) => def.id), POST_LIST],
      ["equipment", EQUIPMENT_LIST.map((def) => def.id), EQUIPMENT_LIST],
      ["conditions", CONDITION_LIST.map((def) => def.id), CONDITION_LIST],
    ];
    for (const [label, ids, defs] of pairs) {
      expect(ids, label).toEqual(defs.map((def) => def.id));
    }
  });

  it("keeps `findAbility` and the ability catalogue in agreement", () => {
    for (const ability of ABILITY_LIST) {
      expect(findAbility(ability.id), ability.id).toBe(ability);
    }
    expect(findAbility("not-an-ability")).toBeUndefined();
  });
});

/* --------------------------------------------------------------------------
 * 2 — Authored Napoleonic display text
 * ------------------------------------------------------------------------ */

describe("content integrity — authored Napoleonic names (T094)", () => {
  it("gives every definition a non-empty name, description and flavour", () => {
    for (const [label, defs] of COLLECTIONS) {
      for (const def of defs) {
        const where = `${label}/${def.id}`;
        for (const field of ["name", "description", "flavour"] as const) {
          const text = def[field];
          expect(text.trim(), `${where}.${field} is blank`).not.toBe("");
          expect(text, `${where}.${field} is padded`).toBe(text.trim());
        }
      }
    }
  });

  it("rejects any placeholder scaffolding left in the display text", () => {
    for (const [label, defs] of COLLECTIONS) {
      for (const def of defs) {
        const where = `${label}/${def.id}`;
        for (const field of ["name", "description", "flavour"] as const) {
          expect(
            findPlaceholder(def[field]),
            `${where}.${field} contains ${findPlaceholder(def[field])}`,
          ).toBeNull();
        }
      }
    }
  });

  it("keeps the FFTA trademark vocabulary out of every authored field", () => {
    for (const [label, defs] of COLLECTIONS) {
      for (const def of defs) {
        const text = `${def.name} ${def.description} ${def.flavour}`.toLowerCase();
        for (const marker of FFTA_MARKERS) {
          expect(text, `${label}/${def.id} leaks the FFTA term "${marker}"`).not.toContain(marker);
        }
      }
    }
  });
});

/* --------------------------------------------------------------------------
 * 3 — Cross-references
 * ------------------------------------------------------------------------ */

describe("content integrity — conditions & elements (T094)", () => {
  it("resolves every condition cancellation to an authored condition", () => {
    for (const condition of CONDITION_LIST) {
      for (const cancelId of condition.cancels) {
        expectResolves(conditionIds, cancelId, `condition ${condition.id}.cancels`);
      }
      // A condition must never cancel itself out.
      expect(condition.cancels, `${condition.id} cancels itself`).not.toContain(condition.id);
    }
  });

  it("resolves every element's opposition partner", () => {
    for (const element of ELEMENT_LIST) {
      if (element.opposedTo !== undefined) {
        expectResolves(elementIds, element.opposedTo, `element ${element.id}.opposedTo`);
        expect(element.opposedTo, `${element.id} opposes itself`).not.toBe(element.id);
      }
    }
  });
});

describe("content integrity — abilities (T094)", () => {
  it("resolves every ability skillset, post, element and condition", () => {
    for (const ability of ABILITY_LIST) {
      expect(
        isKnownSkillset(ability.skillsetId),
        `ability ${ability.id} → unknown skillset "${ability.skillsetId}"`,
      ).toBe(true);

      if (ability.postId !== undefined) {
        const post = POST_LIST.find((candidate) => candidate.id === ability.postId);
        expect(post, `ability ${ability.id} → unknown post "${ability.postId}"`).toBeDefined();
        expect(
          post?.skillsetIds,
          `ability ${ability.id} skillset does not belong to post ${ability.postId}`,
        ).toContain(ability.skillsetId);
      }

      if (ability.element !== undefined) {
        expectResolves(elementIds, ability.element, `ability ${ability.id}.element`);
      }
      for (const inflictId of ability.inflicts) {
        expectResolves(conditionIds, inflictId, `ability ${ability.id}.inflicts`);
      }
      for (const cleanseId of ability.cleanses) {
        expectResolves(conditionIds, cleanseId, `ability ${ability.id}.cleanses`);
      }
    }
  });

  it("gives every post skillset a complete, resolvable action set", () => {
    for (const post of POST_LIST) {
      expect(post.skillsetIds.length, `${post.id} names no skillset`).toBeGreaterThan(0);
      const actions = postActionSet(post.id);
      expect(actions.length, `${post.id} has no action abilities`).toBeGreaterThan(0);
      for (const ability of actions) {
        expectResolves(abilityIds, ability.id, `post ${post.id} action`);
      }
    }
  });

  it("keeps every ability bound to a known post when it names one", () => {
    for (const ability of ABILITY_LIST) {
      if (ability.postId === undefined) continue;
      expectResolves(postIds, ability.postId, `ability ${ability.id}.postId`);
    }
  });

  it("documents the three shared skillsets as real, non-empty sets", () => {
    for (const skillsetId of SHARED_SKILLSET_IDS) {
      expect(isKnownSkillset(skillsetId), skillsetId).toBe(true);
      expect(
        ABILITY_LIST.filter((ability) => ability.skillsetId === skillsetId).length,
        `${skillsetId} has no abilities`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("content integrity — posts (T094)", () => {
  it("resolves every post unlock requirement and restriction", () => {
    for (const post of POST_LIST) {
      expect(POWER_KEYS, `${post.id}.power`).toContain(post.power);
      for (const requirement of post.requires) {
        expectResolves(postIds, requirement.postId, `post ${post.id}.requires`);
        expect(requirement.abilities, `${post.id} requires no abilities`).toBeGreaterThan(0);
      }
      for (const weaponType of post.weaponTypes) {
        expectResolves(weaponTypeIds, weaponType, `post ${post.id}.weaponTypes`);
      }
    }
  });
});

describe("content integrity — equipment (T094)", () => {
  it("resolves every taught ability, element, infliction and weapon family", () => {
    for (const item of EQUIPMENT_LIST) {
      if (item.element !== undefined) {
        expectResolves(elementIds, item.element, `equipment ${item.id}.element`);
      }
      if (item.weaponType !== undefined) {
        expect(WEAPON_FAMILIES[item.weaponType], `equipment ${item.id}.weaponType`).toBeDefined();
      }
      for (const teach of item.teaches) {
        expectResolves(abilityIds, teach.abilityId, `equipment ${item.id}.teaches`);
        expect(teach.ap, `${item.id} → ${teach.abilityId} Drill`).toBeGreaterThan(0);
      }
      for (const inflictId of item.inflicts) {
        expectResolves(conditionIds, inflictId, `equipment ${item.id}.inflicts`);
      }
    }
  });

  it("gives every weapon family a real definition with a formula", () => {
    for (const weaponType of WEAPON_TYPES) {
      const family = WEAPON_FAMILIES[weaponType];
      expect(family, weaponType).toBeDefined();
      expect(family.id).toBe(weaponType);
      expect(family.formula.defenseDivisor, weaponType).toBeGreaterThan(0);
      expect(family.formula.powerDivisor, weaponType).toBeGreaterThan(0);
    }
  });
});

describe("content integrity — enemies (T094)", () => {
  it("resolves every enemy action, drop, element and AI profile", () => {
    for (const enemy of ENEMY_LIST) {
      if (enemy.element !== undefined) {
        expectResolves(elementIds, enemy.element, `enemy ${enemy.id}.element`);
      }
      for (const abilityId of enemy.abilities) {
        const ability = findAbility(abilityId);
        expect(ability, `enemy ${enemy.id} → dangling ability "${abilityId}"`).toBeDefined();
        expect(ability?.abilityClass, `enemy ${enemy.id} → ${abilityId}`).toBe("action");
      }
      for (const drop of enemy.drops) {
        expectResolves(equipmentIds, drop.itemId, `enemy ${enemy.id}.drops`);
      }
      expectResolves(aiProfileIds, enemy.aiProfile, `enemy ${enemy.id}.aiProfile`);
      for (const [element, affinity] of Object.entries(enemy.affinities)) {
        expectResolves(elementIds, element, `enemy ${enemy.id}.affinities`);
        expect(affinity, `enemy ${enemy.id} affinity`).toBeDefined();
      }
    }
  });
});

describe("content integrity — Articles of War (T094)", () => {
  it("resolves every Article key to an id of its own target class", () => {
    const keysByTarget: Readonly<Record<ArticleTarget, ReadonlySet<string>>> = {
      action: abilityIds,
      element: elementIds,
      weapon: weaponTypeIds,
      post: postIds,
      condition: conditionIds,
      move: new Set(["move"]),
      item: equipmentIds,
    };

    for (const article of ARTICLE_LIST) {
      const valid = keysByTarget[article.target];
      expect(valid, `article ${article.id} target ${article.target}`).toBeDefined();
      for (const key of article.keys) {
        expectResolves(valid, key, `article ${article.id} (${article.target})`);
      }
      if (article.regionId !== undefined) {
        expectResolves(regionIds, article.regionId, `article ${article.id}.regionId`);
      }
    }
  });
});

describe("content integrity — contracts (T094)", () => {
  it("resolves every requirement, reward item, region and chapter gate", () => {
    for (const contract of CONTRACT_LIST) {
      if (contract.regionId !== undefined) {
        expectResolves(regionIds, contract.regionId, `contract ${contract.id}.regionId`);
      }

      if (contract.chapter !== undefined) {
        expect(contract.chapter, `${contract.id}.chapter`).toBeGreaterThanOrEqual(1);
        expect(contract.chapter, `${contract.id}.chapter`).toBeLessThanOrEqual(MAX_STORY_CHAPTER);
        expect(
          chapterContractIds.has(contract.id),
          `contract ${contract.id} is chapter-gated but no story chapter opens it`,
        ).toBe(true);
      }

      for (const requirement of contract.requires) {
        if (requirement.kind === "item") {
          if (requirement.id !== undefined) {
            expectResolves(equipmentIds, requirement.id, `contract ${contract.id} item`);
          }
        } else if (requirement.kind === "post") {
          if (requirement.id !== undefined) {
            expectResolves(postIds, requirement.id, `contract ${contract.id} post`);
          }
        } else {
          expect(requirement.id, `contract ${contract.id} ${requirement.kind}`).toBeUndefined();
        }
      }

      for (const itemId of contract.reward.itemIds) {
        expectResolves(equipmentIds, itemId, `contract ${contract.id}.reward`);
      }
    }
  });

  it("places every contract on a known region when it needs a battlefield", () => {
    for (const contract of CONTRACT_LIST) {
      if (contract.kind === "battle" || contract.kind === "pacification") {
        expect(contract.regionId, `${contract.id} has no region`).toBeDefined();
      }
    }
  });
});

describe("content integrity — Guard Sorties & the story spine (T094)", () => {
  it("resolves every Guard Sortie element, condition and chapter", () => {
    for (const guard of GUARD_SORTIE_LIST) {
      expect(POWER_KEYS, `${guard.id}.power`).toContain(guard.power);
      expect(guard.chapter, `${guard.id}.chapter`).toBeGreaterThanOrEqual(1);
      expect(guard.chapter, `${guard.id}.chapter`).toBeLessThanOrEqual(MAX_STORY_CHAPTER);
      expect(
        chapterGuardIds.has(guard.id),
        `Guard Sortie ${guard.id} is gated but no story chapter unlocks it`,
      ).toBe(true);

      for (const effect of guard.effects) {
        if (effect.element !== undefined) {
          expectResolves(elementIds, effect.element, `guard ${guard.id}.effects.element`);
        }
        if (effect.kind !== "drain") {
          for (const inflictId of effect.inflicts) {
            expectResolves(conditionIds, inflictId, `guard ${guard.id}.effects.inflicts`);
          }
        }
      }
    }
  });

  it("resolves every chapter's contracts, formations and trigger", () => {
    for (const chapter of STORY_CHAPTER_LIST) {
      for (const contractId of chapter.contractIds) {
        expectResolves(contractIds, contractId, `chapter ${chapter.id}.contractIds`);
      }
      for (const guardSortieId of chapter.guardSortieIds) {
        expectResolves(guardSortieIds, guardSortieId, `chapter ${chapter.id}.guardSortieIds`);
      }
      if (chapter.trigger.kind === "complete-contract") {
        expectResolves(contractIds, chapter.trigger.contractId, `chapter ${chapter.id}.trigger`);
      }
    }
  });

  it("leaves no chapter-gated content orphaned from the spine", () => {
    for (const contract of CONTRACT_LIST) {
      if (contract.chapter !== undefined) {
        expect(
          chapterContractIds.has(contract.id),
          `contract ${contract.id} gates a chapter nobody reaches`,
        ).toBe(true);
      }
    }
    for (const guard of GUARD_SORTIE_LIST) {
      expect(
        chapterGuardIds.has(guard.id),
        `Guard Sortie ${guard.id} is never unlocked by the story`,
      ).toBe(true);
    }
  });
});

describe("content integrity — campaign map (T094)", () => {
  it("resolves every location's maps and every map's location back", () => {
    for (const location of LOCATION_LIST) {
      for (const mapId of location.battleMapIds) {
        expectResolves(battleMapIds, mapId, `location ${location.id}.battleMapIds`);
      }
      if (location.chapter !== undefined) {
        expect(location.chapter, `${location.id}.chapter`).toBeGreaterThanOrEqual(1);
        expect(location.chapter, `${location.id}.chapter`).toBeLessThanOrEqual(MAX_STORY_CHAPTER);
      }
    }

    for (const map of BATTLE_MAP_LIST) {
      expectResolves(locationIds, map.locationId, `battle map ${map.id}.locationId`);
      const location = locationById.get(map.locationId);
      expect(location, `battle map ${map.id} → ${map.locationId}`).toBeDefined();
      expect(
        location?.battleMapIds,
        `battle map ${map.id} is not listed by its location ${map.locationId}`,
      ).toContain(map.id);

      if (map.contractId !== undefined) {
        expectResolves(contractIds, map.contractId, `battle map ${map.id}.contractId`);
      }
    }
  });
});
