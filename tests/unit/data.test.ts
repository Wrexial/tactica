import { describe, expect, it } from "vitest";

import {
  AbilityDefSchema,
  ArticleDefSchema,
  ConditionDefSchema,
  ContractDefSchema,
  DataBundleSchema,
  ELEMENT_KEYS,
  EQUIP_SLOTS,
  ElementDefSchema,
  EnemyDefSchema,
  EquipmentDefSchema,
  POWER_KEYS,
  PostDefSchema,
  WEAPON_TYPES,
} from "../../src/data/schema";
import type { DataBundle } from "../../src/data/schema";
import {
  ABILITIES,
  ABILITY_KEYS,
  ABILITY_LIST,
  SHARED_SKILLSET_IDS,
  actionAbilitiesForSkillset,
  abilitiesForPost,
  abilitiesForSkillset,
  findAbility,
  getAbility,
  isAbilityKey,
  isKnownSkillset,
  postActionSet,
} from "../../src/data/abilities";
import {
  ARTICLE_KEYS,
  ARTICLE_LIST,
  ARTICLES,
  COMMEND_ARTICLE_LIST,
  FORBID_ARTICLE_LIST,
  articleCommends,
  articleForbids,
  articlesForTarget,
  articlesOfKind,
  getArticle,
  isArticleKey,
} from "../../src/data/articles";
import { CONDITION_KEYS } from "../../src/data/conditions";
import {
  CONTRACT_KEYS,
  CONTRACT_LIST,
  CONTRACTS,
  contractsForRegion,
  contractsOfKind,
  getContract,
  isContractKey,
  requirementsOf,
} from "../../src/data/contracts";
import {
  AI_PROFILES,
  AI_PROFILE_KEYS,
  AI_PROFILE_LIST,
  ENEMIES,
  ENEMY_KEYS,
  ENEMY_LIST,
  EnemyAiProfileDefSchema,
  capturableEnemies,
  dropsFor,
  enemyFamilies,
  enemiesAtLevel,
  enemiesForAiProfile,
  enemiesForFamily,
  enemiesUpToLevel,
  findEnemy,
  getEnemy,
  isAiProfileKey,
  isEnemyKey,
} from "../../src/data/enemies";
import {
  EQUIPMENT,
  EQUIPMENT_KEYS,
  EQUIPMENT_LIST,
  equipmentForSlot,
} from "../../src/data/equipment";
import { POSTS, POST_LIST } from "../../src/data/posts";
import { irregularDefOf } from "../../src/engine/barracks";
import { REACTION_IDS } from "../../src/engine/reactions";
import {
  cleanWikiText,
  convertWikiSources,
  deriveCost,
  deriveStats,
  loadReferenceSources,
  parseSkillLines,
  parseWikiTable,
  reauthorDrill,
  validateConverted,
} from "../../scripts/wiki_to_data.mjs";

/** Every definition shares the same three display fields (mapping §14). */
const display = {
  name: "Rifleman",
  description: "Fires a rifled musket at long range.",
  flavour: "A steady hand and a Baker rifle win the day.",
};

const growth = { hp: 7.2, mp: 1.1, atk: 7.2, def: 7.2, mag: 6.4, res: 8.1, spd: 1.4 };
const stats = { hp: 60, mp: 10, atk: 34, def: 28, mag: 12, res: 20, spd: 42, move: 4, jump: 1 };

function expectRejected(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
) {
  expect(schema.safeParse(value).success).toBe(false);
}

/* --------------------------------------------------------------------------
 * T009 — data integrity sweep
 *
 * The Zod schemas only enforce non-empty display strings; they cannot tell a
 * finished name from a placeholder. This sweep is the guard that every loaded
 * definition carries authored Napoleonic prose and no left-over scaffolding
 * (`TBD`, `TODO`, `placeholder`, ...). It runs against the loaded `DataBundle`
 * and is re-used by the fixture/mutation tests below.
 * ------------------------------------------------------------------------ */

/** Markers that mean "content not authored yet" (checked case-insensitively). */
const PLACEHOLDER_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "TBD", re: /\bTBD\b/i },
  { label: "TBC", re: /\bTBC\b/i },
  { label: "TODO", re: /\bTODO\b/i },
  { label: "FIXME", re: /\bFIXME\b/i },
  { label: "XXX", re: /\bXXX\b/i },
  { label: "placeholder", re: /\bplaceholder\b/i },
  { label: "lorem ipsum", re: /lorem\s+ipsum/i },
  { label: "question marks", re: /\?{3,}/ },
];

/** Returns the first placeholder marker found in `text`, or `null` if clean. */
function findPlaceholder(text: string): string | null {
  for (const { label, re } of PLACEHOLDER_PATTERNS) {
    if (re.test(text)) return label;
  }
  return null;
}

/** Every definition shape shares these three authored display fields. */
interface DisplayDef {
  id: string;
  name: string;
  description: string;
  flavour: string;
}

/**
 * Fails if any loaded definition has a blank or placeholder `name`,
 * `description` or `flavour`. Every authored def across every collection is
 * checked, so new content is covered automatically once it is wired into the
 * bundle.
 */
function assertDisplayIntegrity(bundle: DataBundle): void {
  const collections: ReadonlyArray<[string, ReadonlyArray<DisplayDef>]> = [
    ["elements", bundle.elements],
    ["conditions", bundle.conditions],
    ["abilities", bundle.abilities],
    ["posts", bundle.posts],
    ["equipment", bundle.equipment],
    ["enemies", bundle.enemies],
    ["articles", bundle.articles],
    ["contracts", bundle.contracts],
  ];

  for (const [collection, defs] of collections) {
    for (const def of defs) {
      const where = `${collection}/${def.id}`;
      for (const field of ["name", "description", "flavour"] as const) {
        const text = def[field];
        expect(text.trim(), `${where}.${field} must be non-empty`).not.toBe("");
        expect(findPlaceholder(text), `${where}.${field} contains a placeholder`).toBeNull();
      }
    }
  }
}

describe("data schema — display fields", () => {
  it("requires a non-empty name, description and flavour on every def", () => {
    const good = ElementDefSchema.safeParse({ id: "fire", ...display });
    expect(good.success).toBe(true);
    if (good.success) {
      expect(good.data.name).toBe("Rifleman");
      expect(good.data.description).toContain("rifled");
      expect(good.data.flavour).toContain("Baker");
    }

    for (const missing of ["name", "description", "flavour"] as const) {
      const value: Record<string, unknown> = { id: "fire", ...display };
      delete value[missing];
      expectRejected(ElementDefSchema, value);
      expectRejected(ElementDefSchema, { id: "fire", ...display, [missing]: "" });
    }
  });
});

describe("data schema — Element (mapping §7, D5)", () => {
  it("accepts the eight FFTA-shaped element keys", () => {
    for (const id of [
      "fire",
      "ice",
      "lightning",
      "earth",
      "water",
      "wind",
      "holy",
      "dark",
    ] as const) {
      expect(ElementDefSchema.safeParse({ id, ...display }).success).toBe(true);
    }
  });

  it("rejects an unknown element key", () => {
    expectRejected(ElementDefSchema, { id: "aether", ...display });
  });
});

describe("data schema — Condition (mapping §8)", () => {
  it("defaults duration to indefinite and ticks to false", () => {
    const parsed = ConditionDefSchema.parse({
      id: "poison",
      kind: "ailment",
      ...display,
    });
    expect(parsed.ticks).toBe(false);
    expect(parsed.duration).toBe(0);
    expect(parsed.cancels).toEqual([]);
  });

  it("rejects an unknown condition kind", () => {
    expectRejected(ConditionDefSchema, { id: "poison", kind: "curse", ...display });
  });
});

describe("data schema — Ability (mapping §6, A/R/S/C)", () => {
  it("accepts all four FFTA ability classes and applies mechanical defaults", () => {
    for (const abilityClass of ["action", "reaction", "support", "combo"] as const) {
      const parsed = AbilityDefSchema.parse({
        id: "bayonet-charge",
        abilityClass,
        skillsetId: "fusilier-kit",
        ...display,
      });
      expect(parsed.abilityClass).toBe(abilityClass);
      expect(parsed.mpCost).toBe(0);
      expect(parsed.chargeTime).toBe(0);
      expect(parsed.range).toBe(1);
      expect(parsed.aoeShape).toBe("single");
      expect(parsed.target).toBe("enemy");
    }
  });

  it("keeps the FFTA-shaped mechanic keys (mpCost, ap, power, range, chargeTime)", () => {
    const parsed = AbilityDefSchema.parse({
      id: "canister",
      abilityClass: "action",
      skillsetId: "artillery-kit",
      mpCost: 8,
      ap: 200,
      power: 45,
      range: 4,
      chargeTime: 20,
      element: "lightning",
      inflicts: ["dazed"],
      ...display,
    });
    expect(parsed.mpCost).toBe(8);
    expect(parsed.ap).toBe(200);
    expect(parsed.power).toBe(45);
    expect(parsed.range).toBe(4);
    expect(parsed.chargeTime).toBe(20);
    expect(parsed.element).toBe("lightning");
    expect(parsed.inflicts).toEqual(["dazed"]);
  });

  it("rejects an out-of-range hit rate and an unknown class", () => {
    expectRejected(AbilityDefSchema, {
      id: "x",
      abilityClass: "action",
      skillsetId: "s",
      hitRate: 120,
      ...display,
    });
    expectRejected(AbilityDefSchema, {
      id: "x",
      abilityClass: "spell",
      skillsetId: "s",
      ...display,
    });
  });
});

describe("data schema — Post (mapping §3)", () => {
  it("accepts a post tied to one of the five powers", () => {
    const parsed = PostDefSchema.parse({
      id: "rifleman",
      power: "britain",
      growth,
      ...display,
    });
    expect(parsed.power).toBe("britain");
    expect(parsed.requires).toEqual([]);
    expect(parsed.equipSlots).toEqual([]);
    expect(parsed.common).toBe(false);
  });

  it("supports FFTA-style unlock prerequisites", () => {
    const parsed = PostDefSchema.parse({
      id: "sharpshooter",
      power: "britain",
      growth,
      requires: [{ postId: "rifleman", abilities: 2 }],
      ...display,
    });
    expect(parsed.requires[0]).toEqual({ postId: "rifleman", abilities: 2 });
  });

  it("rejects a power outside the five military schools", () => {
    expectRejected(PostDefSchema, { id: "x", power: "spain", growth, ...display });
  });
});

describe("data schema — Equipment (mapping §3, T050)", () => {
  it("validates a weapon with taught abilities and Drill costs", () => {
    const parsed = EquipmentDefSchema.parse({
      id: "baker-rifle",
      slot: "weapon",
      weaponType: "rifle",
      cost: 1200,
      element: "fire",
      stats: { atk: 12, spd: 2 },
      teaches: [{ abilityId: "aim-vitals", ap: 100 }],
      ...display,
    });
    expect(parsed.slot).toBe("weapon");
    expect(parsed.weaponType).toBe("rifle");
    expect(parsed.stats.atk).toBe(12);
    expect(parsed.stats.hp).toBe(0);
    expect(parsed.teaches[0]).toEqual({ abilityId: "aim-vitals", ap: 100 });
  });

  it("allows unique kit with a null cost (FFTA 'N/A')", () => {
    const parsed = EquipmentDefSchema.parse({ id: "eagle-standard", slot: "offhand", ...display });
    expect(parsed.cost).toBeNull();
  });

  it("rejects an unknown equip slot", () => {
    expectRejected(EquipmentDefSchema, { id: "x", slot: "tail", ...display });
  });
});

describe("data schema — Enemy (mapping §11)", () => {
  it("validates an irregular troop with affinities and drops", () => {
    const parsed = EnemyDefSchema.parse({
      id: "guerrilla-band",
      family: "guerrilla",
      level: 3,
      stats,
      affinities: { fire: "weak", water: "resist" },
      abilities: ["ambush", "scatter"],
      drops: [{ itemId: "sabre", weight: 2 }],
      capturable: true,
      ...display,
    });
    expect(parsed.family).toBe("guerrilla");
    expect(parsed.affinities.fire).toBe("weak");
    expect(parsed.drops[0]).toEqual({ itemId: "sabre", weight: 2 });
    expect(parsed.aiProfile).toBe("default");
    expect(parsed.exp).toBe(0);
  });

  it("rejects an invalid affinity", () => {
    expectRejected(EnemyDefSchema, {
      id: "x",
      family: "f",
      stats,
      affinities: { fire: "melts" },
      ...display,
    });
  });
});

describe("data schema — Article of War (mapping §9)", () => {
  it("validates a forbidding Article and a commending Article", () => {
    const forbid = ArticleDefSchema.parse({
      id: "no-incendiary",
      kind: "forbid",
      target: "element",
      keys: ["fire"],
      ...display,
    });
    expect(forbid.kind).toBe("forbid");
    expect(forbid.keys).toEqual(["fire"]);
    expect(forbid.severity).toBe("reprimand");
    expect(forbid.weight).toBe(1);

    const commend = ArticleDefSchema.parse({
      id: "resist-shock",
      kind: "commend",
      target: "element",
      keys: ["lightning"],
      honour: 2,
      ...display,
    });
    expect(commend.honour).toBe(2);
  });

  it("rejects an unknown article target", () => {
    expectRejected(ArticleDefSchema, {
      id: "x",
      kind: "forbid",
      target: "grammar",
      ...display,
    });
  });
});

describe("data schema — Contract (mapping §10)", () => {
  it("validates the four contract kinds and defaults the reward", () => {
    for (const kind of ["battle", "skirmish", "detachment", "pacification"] as const) {
      const parsed = ContractDefSchema.parse({ id: `c-${kind}`, kind, reward: {}, ...display });
      expect(parsed.kind).toBe(kind);
      expect(parsed.fee).toBe(0);
      expect(parsed.reward.crowns).toBe(0);
      expect(parsed.reward.ap).toBe(0);
      expect(parsed.reward.itemIds).toEqual([]);
    }
  });

  it("validates posting requirements and a detachment duration", () => {
    const parsed = ContractDefSchema.parse({
      id: "break-the-bridge",
      kind: "detachment",
      fee: 200,
      duration: 5,
      requires: [{ kind: "unit", count: 2 }],
      reward: { crowns: 900, ap: 50, honours: 1, itemIds: ["sabre"] },
      ...display,
    });
    expect(parsed.duration).toBe(5);
    expect(parsed.requires[0]).toEqual({ kind: "unit", count: 2 });
    expect(parsed.reward.honours).toBe(1);
  });

  it("rejects an unknown contract kind", () => {
    expectRejected(ContractDefSchema, { id: "x", kind: "raid", reward: {}, ...display });
  });
});

describe("data integrity — content sweep (T009)", () => {
  it("recognises the placeholder markers a reviewer might leave behind", () => {
    for (const marker of [
      "TBD",
      "todo: add flavour",
      "FIXME rifle",
      "XXX",
      "a placeholder name",
      "Lorem ipsum dolor sit amet",
      "???",
    ]) {
      expect(findPlaceholder(marker), marker).not.toBeNull();
    }

    for (const clean of ["Rifleman", "Fires a rifled musket.", "A steady hand wins the day."]) {
      expect(findPlaceholder(clean), clean).toBeNull();
    }
  });

  it("passes on the loaded bundle (empty until content collections land)", () => {
    const bundle = DataBundleSchema.parse({});
    expect(() => assertDisplayIntegrity(bundle)).not.toThrow();
    expect(bundle.posts).toEqual([]);
  });

  it("accepts a fully-authored fixture bundle", () => {
    const bundle = DataBundleSchema.parse({
      elements: [{ id: "dark", ...display }],
      conditions: [{ id: "poison", kind: "ailment", ...display }],
      abilities: [{ id: "volley", abilityClass: "combo", skillsetId: "volley", ...display }],
      posts: [{ id: "fusilier", power: "france", growth, ...display }],
      equipment: [{ id: "charleville", slot: "weapon", weaponType: "musket", ...display }],
      enemies: [{ id: "militia", family: "militia", stats, ...display }],
      articles: [{ id: "no-night-attack", kind: "forbid", target: "action", ...display }],
      contracts: [{ id: "take-the-farm", kind: "battle", reward: {}, ...display }],
    });

    expect(() => assertDisplayIntegrity(bundle)).not.toThrow();
  });

  it("rejects a placeholder in name, description or flavour", () => {
    for (const field of ["name", "description", "flavour"] as const) {
      const bundle = DataBundleSchema.parse({
        elements: [{ id: "fire", ...display, [field]: "TBD" }],
      });
      expect(() => assertDisplayIntegrity(bundle), field).toThrow();
    }
  });

  it("rejects a whitespace-only name, which the schema's .min(1) allows", () => {
    const bundle = DataBundleSchema.parse({
      elements: [{ id: "fire", ...display, name: "   " }],
    });
    expect(() => assertDisplayIntegrity(bundle)).toThrow();
  });
});

describe("data schema — DataBundle", () => {
  it("defaults every collection to empty", () => {
    const parsed = DataBundleSchema.parse({});
    expect(parsed.posts).toEqual([]);
    expect(parsed.equipment).toEqual([]);
    expect(parsed.elements).toEqual([]);
  });

  it("parses a mixed bundle of validated definitions", () => {
    const parsed = DataBundleSchema.parse({
      elements: [{ id: "dark", ...display }],
      conditions: [{ id: "poison", kind: "ailment", ...display }],
      abilities: [{ id: "volley", abilityClass: "combo", skillsetId: "volley", ...display }],
      posts: [{ id: "fusilier", power: "france", growth, ...display }],
      equipment: [{ id: "charleville", slot: "weapon", weaponType: "musket", ...display }],
      enemies: [{ id: "militia", family: "militia", stats, ...display }],
      articles: [{ id: "no-night-attack", kind: "forbid", target: "action", ...display }],
      contracts: [{ id: "take-the-farm", kind: "battle", reward: {}, ...display }],
    });
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.contracts[0].kind).toBe("battle");
  });
});

/* --------------------------------------------------------------------------
 * T088 — Wiki → data converter
 *
 * The converter reads the scraped mirror under `docs/wiki/raw/`, strips its
 * markup, re-authors the mechanics as our own balance data and validates the
 * result with the schemas above. These tests pin the parsing primitives, the
 * end-to-end conversion, and the two contracts that matter most: the output
 * passes Zod, and no reference prose or trademarked name leaks through
 * (`agents.md` §3, §10).
 * ------------------------------------------------------------------------ */

/** A hand-written table exercising rowspan/colspan and element/flavour rows. */
const TABLE_FIXTURE = `{| class="wikitable"
|-
! Name !! Atk !! Cost
|-
! rowspan="2" | Alpha
| 10
| 100
|-
| colspan="2" | flavour text
|-
! rowspan="2" | Beta
| 20
| 200
|-
| colspan="2" | '''Element:''' Fire
|}`;

/**
 * A miniature reference file used to prove the legal contract: the reference's
 * italic flavour line and its (trademarked) item name must never reach our data.
 */
const LEGAL_FIXTURE = `
== Swords ==
{| class="wikitable"
|-
! Sword
! Atk
! Cost
! Skills (AP)
|-
! rowspan="2" | {{LA|Test Blade}}
| 20
| 400
| Soldier: First Aid (100)
|-
| colspan="3" | '''Element:''' Fire<br/>''A stolen flavour line that must not ship.''
|}
`;

/** Tokens that would betray a direct copy from the FFTA mirror. */
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
];

describe("wiki → data converter — markup", () => {
  it("strips templates, links, files and emphasis to plain text", () => {
    expect(
      cleanWikiText("{{LA|Blood Sword (weapon)|Blood Sword}}<br/>[[File:FFTABloodsword.PNG]]"),
    ).toBe("Blood Sword");
    expect(cleanWikiText("'''Element:''' Fire")).toBe("Element: Fire");
    expect(cleanWikiText("[[Soldier (Tactics Advance)|Soldier]]")).toBe("Soldier");
    expect(cleanWikiText("{{LA|Maintenance}}")).toBe("Maintenance");
    expect(cleanWikiText("{{note|Mythril Sword gives +1 to Jump}}")).toBe("");
  });

  it("reads a MediaWiki table into a rowspan/colspan-aware grid", () => {
    const table = parseWikiTable(TABLE_FIXTURE);
    expect(table).not.toBeNull();
    if (!table) return;
    expect(table.headers).toEqual(["Name", "Atk", "Cost"]);
    expect(table.rows).toEqual([
      ["Alpha", "10", "100"],
      ["Alpha", "flavour text", ""],
      ["Beta", "20", "200"],
      ["Beta", "Element: Fire", ""],
    ]);
    expect(table.cont).toEqual([false, true, false, true]);
  });

  it("parses skill lines with shared jobs, AP suffixes and 'None'", () => {
    expect(
      parseSkillLines("Soldier/Warrior: First Aid (100)\nDragoon: Wyrmkiller (300)\nNone"),
    ).toEqual([
      { jobs: ["Soldier", "Warrior"], name: "First Aid", ap: 100 },
      { jobs: ["Dragoon"], name: "Wyrmkiller", ap: 300 },
    ]);
  });
});

describe("wiki → data converter — re-authored balance", () => {
  it("scales reference numerals down instead of copying them", () => {
    const stats = deriveStats({
      atk: 100,
      def: 100,
      mag: 0,
      res: 0,
      spd: 0,
      eva: 0,
      jump: 0,
      range: 0,
    });
    expect(stats.atk).toBe(40);
    expect(stats.def).toBe(40);
    expect(stats.atk).toBeLessThan(100);
  });

  it("bounds the authored cost and Drill regardless of the reference values", () => {
    expect(reauthorDrill(100)).toBe(40);
    expect(reauthorDrill(300)).toBe(80);
    expect(reauthorDrill(100000)).toBe(400);
    const cost = deriveCost({ atk: 40, def: 40, mag: 0, res: 0, spd: 0 });
    expect(cost).toBeGreaterThanOrEqual(40);
    expect(cost).toBeLessThanOrEqual(2500);
  });
});

describe("wiki → data converter — legal contract (agents.md §3)", () => {
  const converted = convertWikiSources({ weapons: LEGAL_FIXTURE, armor: "" });
  const serialized = JSON.stringify(converted);

  it("emits one validated item and its ability", () => {
    expect(converted.equipment).toHaveLength(1);
    expect(converted.abilities).toHaveLength(1);
    expect(() => validateConverted(converted)).not.toThrow();
  });

  it("never copies the reference flavour prose", () => {
    expect(serialized).not.toContain("stolen flavour line");
  });

  it("never writes the FFTA item/ability name into our data", () => {
    expect(serialized).not.toContain("Test Blade");
    expect(converted.equipment[0].name).not.toContain("Test Blade");
  });

  it("still reads mechanical facts (element, weapon family, teaches)", () => {
    expect(converted.equipment[0].weaponType).toBe("blade");
    expect(converted.equipment[0].element).toBe("fire");
    expect(converted.equipment[0].teaches).toHaveLength(1);
    expect(converted.equipment[0].teaches[0].abilityId).toBe(converted.abilities[0].id);
  });
});

describe("wiki → data converter — full mirror (T088)", () => {
  const sources = loadReferenceSources();
  const converted = convertWikiSources(sources);

  it("converts the weapons and armour tables into a dataset", () => {
    expect(converted.equipment.length).toBeGreaterThan(200);
    expect(converted.abilities.length).toBeGreaterThan(100);
  });

  it("validates every converted item and ability with the content schemas", () => {
    const validated = validateConverted(converted);
    expect(validated.equipment).toHaveLength(converted.equipment.length);
    expect(validated.abilities).toHaveLength(converted.abilities.length);
  });

  it("passes the display-integrity sweep (names, descriptions, flavours)", () => {
    const bundle = DataBundleSchema.parse({
      equipment: converted.equipment,
      abilities: converted.abilities,
    });
    expect(() => assertDisplayIntegrity(bundle)).not.toThrow();
  });

  it("gives every item and ability a unique id", () => {
    const equipmentIds = new Set(converted.equipment.map((item) => item.id));
    const abilityIds = new Set(converted.abilities.map((ability) => ability.id));
    expect(equipmentIds.size).toBe(converted.equipment.length);
    expect(abilityIds.size).toBe(converted.abilities.length);
  });

  it("resolves every taught ability reference", () => {
    const abilityIds = new Set(converted.abilities.map((ability) => ability.id));
    for (const item of converted.equipment) {
      for (const teach of item.teaches) {
        expect(abilityIds.has(teach.abilityId), `${item.id} → ${teach.abilityId}`).toBe(true);
      }
    }
  });

  it("is deterministic: the same mirror always yields identical data", () => {
    expect(JSON.stringify(convertWikiSources(sources))).toBe(JSON.stringify(converted));
  });

  it("contains no FFTA trademarks or copied prose", () => {
    const text = [...converted.equipment, ...converted.abilities]
      .flatMap((def) => [def.name, def.description, def.flavour])
      .join(" ")
      .toLowerCase();
    for (const marker of FFTA_MARKERS) {
      expect(text, `converted data must not contain "${marker}"`).not.toContain(marker);
    }
    expect(text).not.toContain("stained by the blood");
  });
});

/* --------------------------------------------------------------------------
 * T089 — Ability sets per post
 *
 * Pins the task's "done when": *every post has a complete, validated action
 * set*. The catalogue lives under `src/data/abilities/` (one module per power
 * plus the shared Reaction/Trait/Volley sets). These tests check that the
 * action sets are complete, that every ability is validated and well-keyed,
 * and that the ids other content already binds to (equipment Drill, Articles
 * of War, the engine's reaction ids) resolve.
 * ------------------------------------------------------------------------ */

describe("authored abilities (data/abilities, T089)", () => {
  it("authors a unique, validated catalogue in the documented order", () => {
    expect(ABILITY_LIST).toHaveLength(ABILITY_KEYS.length);
    expect(ABILITY_LIST.length).toBeGreaterThanOrEqual(100);
    expect(new Set(ABILITY_KEYS).size).toBe(ABILITY_KEYS.length);
    for (const id of ABILITY_KEYS) {
      expect(AbilityDefSchema.parse(ABILITIES[id])).toEqual(ABILITIES[id]);
    }
  });

  it("gives every post a complete action set", () => {
    for (const post of POST_LIST) {
      const actions = postActionSet(post.id);
      expect(actions.length, `${post.id} needs an action set`).toBeGreaterThanOrEqual(3);
      for (const ability of actions) {
        expect(ability.abilityClass, ability.id).toBe("action");
        expect(ability.postId, ability.id).toBe(post.id);
        expect(post.skillsetIds, `${ability.id} skillset`).toContain(ability.skillsetId);
      }
    }
  });

  it("binds every action ability to its post's skillset", () => {
    for (const ability of ABILITY_LIST) {
      if (ability.abilityClass !== "action") continue;
      expect(ability.postId, `${ability.id} must name a post`).toBeDefined();
      const post = POSTS[ability.postId as keyof typeof POSTS];
      expect(post, `${ability.id} names an unknown post`).toBeDefined();
      expect(post?.skillsetIds, `${ability.id} skillset mismatch`).toContain(ability.skillsetId);
    }
  });

  it("assigns every ability to a known skillset", () => {
    for (const ability of ABILITY_LIST) {
      expect(isKnownSkillset(ability.skillsetId), `${ability.id} → ${ability.skillsetId}`).toBe(
        true,
      );
    }
  });

  it("notes the three shared command sets explicitly", () => {
    expect(SHARED_SKILLSET_IDS).toHaveLength(3);
    for (const skillsetId of SHARED_SKILLSET_IDS) {
      const shared = abilitiesForSkillset(skillsetId);
      expect(shared.length, skillsetId).toBeGreaterThan(0);
      expect(shared.every((ability) => ability.postId === undefined)).toBe(true);
    }
  });

  it("authors the engine's reaction ids as reaction abilities", () => {
    for (const id of Object.values(REACTION_IDS)) {
      const ability = findAbility(id);
      expect(ability, `reaction ${id} is not authored`).toBeDefined();
      expect(ability?.abilityClass).toBe("reaction");
    }
  });

  it("resolves every equipment-taught ability", () => {
    for (const item of EQUIPMENT_LIST) {
      for (const teach of item.teaches) {
        expect(findAbility(teach.abilityId), `${item.id} → ${teach.abilityId}`).toBeDefined();
      }
    }
  });

  it("resolves every action key named by an Article of War", () => {
    const actionArticles = ARTICLE_LIST.filter((article) => article.target === "action");
    expect(actionArticles.length).toBeGreaterThan(0);
    for (const article of actionArticles) {
      for (const key of article.keys) {
        expect(findAbility(key), `${article.id} → ${key}`).toBeDefined();
      }
    }
  });

  it("looks abilities up by id and rejects unknown ones", () => {
    expect(isAbilityKey("volley-fire")).toBe(true);
    expect(isAbilityKey("not-an-ability")).toBe(false);
    expect(getAbility("volley-fire").name).toBe("Volley Fire");
    expect(() => getAbility("missing" as never)).toThrow(RangeError);
    expect(abilitiesForPost("fusilier").map((ability) => ability.id)).toContain("bayonet-charge");
    expect(actionAbilitiesForSkillset("fusilier-kit").map((a) => a.id)).toEqual([
      "volley-fire",
      "bayonet-charge",
      "close-order-drill",
    ]);
  });

  it("passes the display-integrity sweep", () => {
    const bundle = DataBundleSchema.parse({ abilities: ABILITY_LIST });
    expect(() => assertDisplayIntegrity(bundle)).not.toThrow();
  });

  it("carries no FFTA trademarks in ability display text", () => {
    const text = ABILITY_LIST.flatMap((ability) => [
      ability.name,
      ability.description,
      ability.flavour,
    ])
      .join(" ")
      .toLowerCase();
    for (const marker of FFTA_MARKERS) {
      expect(text, `ability text must not contain "${marker}"`).not.toContain(marker);
    }
  });
});

/* --------------------------------------------------------------------------
 * T090 — Equipment tables
 *
 * Pins the task's "done when": *full weapon/armour/accessory tables with Drill
 * costs and taught abilities*. The kit lives under `src/data/equipment/` (one
 * module per slot). These tests check that every slot is substantially filled,
 * every weapon family has real choice, and every Drill binding resolves to an
 * authored ability with a sane, positive cost.
 * ------------------------------------------------------------------------ */

/** A floor for each slot's table, so a slot cannot silently be emptied. */
const SLOT_MINIMUMS: Readonly<Record<string, number>> = {
  weapon: 20,
  offhand: 4,
  armour: 8,
  head: 6,
  accessory: 8,
};

describe("authored equipment (data/equipment, T090)", () => {
  it("authors a unique, validated full kit catalogue in canonical order", () => {
    expect(EQUIPMENT_LIST).toHaveLength(EQUIPMENT_KEYS.length);
    expect(Object.keys(EQUIPMENT)).toHaveLength(EQUIPMENT_KEYS.length);
    expect(new Set(EQUIPMENT_KEYS).size).toBe(EQUIPMENT_KEYS.length);
    expect(EQUIPMENT_LIST.map((item) => item.id)).toEqual([...EQUIPMENT_KEYS]);
    for (const id of EQUIPMENT_KEYS) {
      expect(EquipmentDefSchema.parse(EQUIPMENT[id])).toEqual(EQUIPMENT[id]);
    }
  });

  it("fills every equip slot with a substantial table", () => {
    for (const slot of EQUIP_SLOTS) {
      expect(equipmentForSlot(slot).length, `${slot} table`).toBeGreaterThanOrEqual(
        SLOT_MINIMUMS[slot] ?? 1,
      );
    }
  });

  it("covers every weapon family with more than one real option", () => {
    for (const weaponType of WEAPON_TYPES) {
      const options = EQUIPMENT_LIST.filter((item) => item.weaponType === weaponType);
      expect(options.length, `weapon family ${weaponType}`).toBeGreaterThanOrEqual(2);
      expect(options.every((item) => item.slot === "weapon" || item.slot === "offhand")).toBe(true);
    }
  });

  it("represents all five powers with depot-discount kit", () => {
    for (const power of POWER_KEYS) {
      expect(
        EQUIPMENT_LIST.some((item) => item.power === power),
        `no kit carries the ${power} discount`,
      ).toBe(true);
    }
  });

  it("gives every taught ability a positive, bounded Drill cost", () => {
    let authored = 0;
    for (const item of EQUIPMENT_LIST) {
      const seen = new Set<string>();
      for (const teach of item.teaches) {
        expect(teach.abilityId, item.id).not.toMatch(/\s/);
        expect(Number.isInteger(teach.ap), `${item.id} → ${teach.abilityId}`).toBe(true);
        expect(teach.ap, `${item.id} → ${teach.abilityId}`).toBeGreaterThan(0);
        expect(teach.ap, `${item.id} → ${teach.abilityId}`).toBeLessThanOrEqual(400);
        expect(seen.has(teach.abilityId), `${item.id} teaches ${teach.abilityId} twice`).toBe(
          false,
        );
        seen.add(teach.abilityId);
        authored += 1;
      }
    }
    expect(authored).toBeGreaterThanOrEqual(20);
  });

  it("resolves every taught ability to the authored catalogue", () => {
    const abilityIds = new Set(ABILITY_LIST.map((ability) => ability.id));
    for (const item of EQUIPMENT_LIST) {
      for (const teach of item.teaches) {
        expect(abilityIds.has(teach.abilityId), `${item.id} → ${teach.abilityId}`).toBe(true);
      }
    }
  });

  it("uses only known elements and on-hit conditions", () => {
    for (const item of EQUIPMENT_LIST) {
      if (item.element !== undefined) {
        expect(ELEMENT_KEYS, item.id).toContain(item.element);
      }
      for (const conditionId of item.inflicts) {
        expect(
          (CONDITION_KEYS as readonly string[]).includes(conditionId),
          `${item.id} inflicts unknown condition ${conditionId}`,
        ).toBe(true);
      }
    }
  });

  it("passes the display-integrity sweep", () => {
    const bundle = DataBundleSchema.parse({ equipment: EQUIPMENT_LIST });
    expect(() => assertDisplayIntegrity(bundle)).not.toThrow();
  });

  it("carries no FFTA trademarks in equipment display text", () => {
    const text = EQUIPMENT_LIST.flatMap((item) => [item.name, item.description, item.flavour])
      .join(" ")
      .toLowerCase();
    for (const marker of FFTA_MARKERS) {
      expect(text, `equipment text must not contain "${marker}"`).not.toContain(marker);
    }
  });
});

/* --------------------------------------------------------------------------
 * T091 — Enemy roster + drops
 *
 * Pins the task's "done when": *irregular/auxiliary troop roster with stats,
 * actions, drops and AI profiles*. The roster lives under `src/data/enemies/`
 * (one module per mapping §11 archetype plus the AI temperaments). These tests
 * check the roster is complete and validated, that every action and drop
 * resolves to authored content, that every AI profile resolves, and that the
 * engine's barracks seam can project an authored troop without complaint.
 * ------------------------------------------------------------------------ */

/** The mapping §11 archetype families the roster must cover. */
const REQUIRED_ENEMY_FAMILIES = [
  "militia",
  "guerrilla",
  "petard",
  "battery",
  "cavalry",
  "observer",
  "command",
] as const;

describe("authored enemies (data/enemies, T091)", () => {
  it("authors a unique, validated roster in canonical order", () => {
    expect(ENEMY_LIST).toHaveLength(ENEMY_KEYS.length);
    expect(Object.keys(ENEMIES)).toHaveLength(ENEMY_KEYS.length);
    expect(new Set(ENEMY_KEYS).size).toBe(ENEMY_KEYS.length);
    expect(ENEMY_LIST.map((enemy) => enemy.id)).toEqual([...ENEMY_KEYS]);
    expect(ENEMY_LIST.length).toBeGreaterThanOrEqual(20);
    for (const id of ENEMY_KEYS) {
      expect(EnemyDefSchema.parse(ENEMIES[id])).toEqual(ENEMIES[id]);
      expect(ENEMIES[id].stats.hp, `${id} must have hit points`).toBeGreaterThan(0);
      expect(ENEMIES[id].stats.spd, `${id} must have speed`).toBeGreaterThan(0);
    }
  });

  it("covers every mapping §11 archetype family", () => {
    const families = enemyFamilies();
    for (const family of REQUIRED_ENEMY_FAMILIES) {
      expect(families, `no troop in family ${family}`).toContain(family);
      expect(enemiesForFamily(family).length, family).toBeGreaterThanOrEqual(1);
    }
  });

  it("resolves every troop action to an authored action ability", () => {
    for (const enemy of ENEMY_LIST) {
      expect(enemy.abilities.length, `${enemy.id} has no actions`).toBeGreaterThanOrEqual(1);
      for (const abilityId of enemy.abilities) {
        const ability = findAbility(abilityId);
        expect(ability, `${enemy.id} → ${abilityId}`).toBeDefined();
        expect(ability?.abilityClass, `${enemy.id} → ${abilityId}`).toBe("action");
      }
    }
  });

  it("resolves every drop to authored kit with a positive weight", () => {
    for (const enemy of ENEMY_LIST) {
      for (const drop of dropsFor(enemy.id)) {
        expect(
          EQUIPMENT[drop.itemId as keyof typeof EQUIPMENT],
          `${enemy.id} → ${drop.itemId}`,
        ).toBeDefined();
        expect(Number.isInteger(drop.weight), `${enemy.id} → ${drop.itemId}`).toBe(true);
        expect(drop.weight, `${enemy.id} → ${drop.itemId}`).toBeGreaterThan(0);
      }
    }
  });

  it("resolves every AI profile and keeps the fallback first", () => {
    for (const enemy of ENEMY_LIST) {
      expect(isAiProfileKey(enemy.aiProfile), `${enemy.id} → ${enemy.aiProfile}`).toBe(true);
    }
    expect(AI_PROFILE_LIST.length).toBeGreaterThanOrEqual(8);
    expect(AI_PROFILE_KEYS[0]).toBe("default");
    for (const key of AI_PROFILE_KEYS) {
      expect(EnemyAiProfileDefSchema.parse(AI_PROFILES[key])).toEqual(AI_PROFILES[key]);
    }
  });

  it("fields both capturable irregulars and troops that never surrender", () => {
    expect(capturableEnemies().length).toBeGreaterThan(0);
    expect(capturableEnemies().length).toBeLessThan(ENEMY_LIST.length);
    expect(ENEMY_LIST.some((enemy) => !enemy.capturable)).toBe(true);
  });

  it("looks troops up by id and rejects unknown ones", () => {
    const first = ENEMY_KEYS[0];
    expect(isEnemyKey(first)).toBe(true);
    expect(isEnemyKey("not-a-troop")).toBe(false);
    expect(getEnemy(first).id).toBe(first);
    expect(() => getEnemy("missing" as never)).toThrow(RangeError);
    expect(findEnemy(first)?.id).toBe(first);
    expect(findEnemy("missing")).toBeUndefined();
  });

  it("queries by family, level and profile", () => {
    const level = ENEMY_LIST[0].level;
    expect(enemiesAtLevel(level).every((enemy) => enemy.level === level)).toBe(true);
    expect(enemiesUpToLevel(level).every((enemy) => enemy.level <= level)).toBe(true);
    const family = enemyFamilies()[0];
    expect(enemiesForFamily(family).every((enemy) => enemy.family === family)).toBe(true);
    expect(enemiesForAiProfile("default").every((enemy) => enemy.aiProfile === "default")).toBe(
      true,
    );
  });

  it("projects an authored troop through the engine barracks seam", () => {
    const enemy = ENEMY_LIST.find((candidate) => candidate.capturable);
    expect(enemy, "the roster needs at least one capturable troop").toBeDefined();
    if (enemy === undefined) return;
    const band = irregularDefOf(enemy);
    expect(band.id).toBe(enemy.id);
    expect(band.level).toBe(enemy.level);
    expect(band.abilities).toEqual(enemy.abilities);
    expect(band.capturable).toBe(true);
  });

  it("passes the display-integrity sweep", () => {
    const bundle = DataBundleSchema.parse({ enemies: ENEMY_LIST });
    expect(() => assertDisplayIntegrity(bundle)).not.toThrow();
  });

  it("carries no FFTA trademarks in troop display text", () => {
    const text = ENEMY_LIST.flatMap((enemy) => [enemy.name, enemy.description, enemy.flavour])
      .join(" ")
      .toLowerCase();
    for (const marker of FFTA_MARKERS) {
      expect(text, `enemy text must not contain "${marker}"`).not.toContain(marker);
    }
  });
});

/* --------------------------------------------------------------------------
 * T093 — Article & contract pools
 *
 * Pins the task's "done when": *full Article-of-War card pool and contract list
 * (main + side + dispatch + pacification).* The Article pool lives under
 * `src/data/articles/` (forbidding orders + commended acts) and the contract
 * board under `src/data/contracts/` (battles, skirmishes, detachments,
 * pacifications). These tests check the pools are complete and validated, that
 * every named key resolves to an authored id of its target class, and that no
 * cross-reference to a post, item, ability or campaign region dangles.
 * ------------------------------------------------------------------------ */

/** The five target classes the original T054 pool had to cover with both kinds. */
const REQUIRED_ARTICLE_TARGETS = ["action", "element", "weapon", "post", "condition"] as const;

/** The four FFTA mission kinds the board must fill (mapping §10). */
const REQUIRED_CONTRACT_KINDS = ["battle", "skirmish", "detachment", "pacification"] as const;

/** The known-valid ids an Article's `keys` may reference, by target class. */
const ARTICLE_TARGET_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  action: new Set(ABILITY_KEYS),
  element: new Set(ELEMENT_KEYS),
  weapon: new Set(WEAPON_TYPES),
  post: new Set(POST_LIST.map((post) => post.id)),
  condition: new Set(CONDITION_KEYS),
  move: new Set(["move"]),
  item: new Set(EQUIPMENT_KEYS),
};

describe("authored Articles (data/articles, T093)", () => {
  it("authors a unique, validated full card pool in canonical order", () => {
    expect(ARTICLE_LIST).toHaveLength(ARTICLE_KEYS.length);
    expect(Object.keys(ARTICLES)).toHaveLength(ARTICLE_KEYS.length);
    expect(new Set(ARTICLE_KEYS).size).toBe(ARTICLE_KEYS.length);
    expect(ARTICLE_LIST.map((article) => article.id)).toEqual([...ARTICLE_KEYS]);
    expect(ARTICLE_LIST.length).toBeGreaterThanOrEqual(40);
    expect(FORBID_ARTICLE_LIST.length).toBeGreaterThanOrEqual(20);
    expect(COMMEND_ARTICLE_LIST.length).toBeGreaterThanOrEqual(12);
    for (const id of ARTICLE_KEYS) {
      expect(ArticleDefSchema.parse(ARTICLES[id])).toEqual(ARTICLES[id]);
    }
  });

  it("orders every forbidding Article before every commended one", () => {
    expect(ARTICLE_LIST).toEqual([...FORBID_ARTICLE_LIST, ...COMMEND_ARTICLE_LIST]);
    expect(FORBID_ARTICLE_LIST.every((article) => article.kind === "forbid")).toBe(true);
    expect(COMMEND_ARTICLE_LIST.every((article) => article.kind === "commend")).toBe(true);
  });

  it("covers every target class, with both kinds where the fiction warrants it", () => {
    for (const target of REQUIRED_ARTICLE_TARGETS) {
      expect(articlesForTarget(target).length, `${target} pool`).toBeGreaterThan(0);
      expect(
        articlesForTarget(target).some((article) => article.kind === "forbid"),
        `forbid ${target}`,
      ).toBe(true);
      expect(
        articlesForTarget(target).some((article) => article.kind === "commend"),
        `commend ${target}`,
      ).toBe(true);
    }
    // Movement and item use are observable too, so the pool covers them as well.
    expect(articlesForTarget("move").length).toBeGreaterThan(0);
    expect(articlesForTarget("item").length).toBeGreaterThan(0);
  });

  it("names only authored ids of the Article's own target class", () => {
    for (const article of ARTICLE_LIST) {
      const valid = ARTICLE_TARGET_KEYS[article.target];
      expect(valid, `${article.id} target ${article.target}`).toBeDefined();
      expect(article.keys.length, `${article.id} names no key`).toBeGreaterThan(0);
      for (const key of article.keys) {
        expect(valid?.has(key), `${article.id} names unknown ${article.target} "${key}"`).toBe(
          true,
        );
      }
    }
  });

  it("grants Honour only on commended Articles, with a positive draw weight", () => {
    for (const article of ARTICLE_LIST) {
      if (article.kind === "forbid") {
        expect(article.honour, article.id).toBe(0);
      } else {
        expect(article.honour, article.id).toBeGreaterThan(0);
      }
      expect(article.weight, article.id).toBeGreaterThan(0);
    }
  });

  it("matches forbids and commends through the data-side helpers", () => {
    const noFire = ARTICLES["no-fire"];
    expect(articleForbids(noFire, "element", "fire")).toBe(true);
    expect(articleForbids(noFire, "element", "ice")).toBe(false);
    expect(articleCommends(ARTICLES["commend-colours"], "element", "holy")).toBe(true);
    expect(articleCommends(noFire, "element", "fire")).toBe(false);
    expect(articlesOfKind("forbid").every((article) => article.kind === "forbid")).toBe(true);
    expect(articlesOfKind("commend").every((article) => article.kind === "commend")).toBe(true);
  });

  it("looks Articles up and rejects unknown ids", () => {
    const first = ARTICLE_KEYS[0] as (typeof ARTICLE_KEYS)[number];
    expect(isArticleKey(first)).toBe(true);
    expect(isArticleKey("not-an-article")).toBe(false);
    expect(getArticle(first).id).toBe(first);
    expect(() => getArticle("missing" as never)).toThrow(RangeError);
  });

  it("passes the display-integrity sweep and carries no FFTA trademarks", () => {
    const bundle = DataBundleSchema.parse({ articles: ARTICLE_LIST });
    expect(() => assertDisplayIntegrity(bundle)).not.toThrow();
    const text = ARTICLE_LIST.flatMap((article) => [
      article.name,
      article.description,
      article.flavour,
    ])
      .join(" ")
      .toLowerCase();
    for (const marker of FFTA_MARKERS) {
      expect(text, `article text must not contain "${marker}"`).not.toContain(marker);
    }
  });
});

describe("authored contracts (data/contracts, T093)", () => {
  it("authors a unique, validated board in canonical order", () => {
    expect(CONTRACT_LIST).toHaveLength(CONTRACT_KEYS.length);
    expect(Object.keys(CONTRACTS)).toHaveLength(CONTRACT_KEYS.length);
    expect(new Set(CONTRACT_KEYS).size).toBe(CONTRACT_KEYS.length);
    expect(CONTRACT_LIST.map((contract) => contract.id)).toEqual([...CONTRACT_KEYS]);
    expect(CONTRACT_LIST.length).toBeGreaterThanOrEqual(24);
    for (const id of CONTRACT_KEYS) {
      expect(ContractDefSchema.parse(CONTRACTS[id])).toEqual(CONTRACTS[id]);
      expect(CONTRACTS[id].reward.crowns, id).toBeGreaterThan(0);
    }
  });

  it("fills all four mission kinds: main, side, dispatch and pacification", () => {
    for (const kind of REQUIRED_CONTRACT_KINDS) {
      expect(contractsOfKind(kind).length, kind).toBeGreaterThanOrEqual(6);
    }
  });

  it("gates battles and pacifications to the campaign map", () => {
    for (const kind of ["battle", "pacification"] as const) {
      for (const contract of contractsOfKind(kind)) {
        expect(contract.regionId, contract.id).toBeDefined();
        expect(contractsForRegion(contract.regionId as string)).toContain(contract);
      }
    }
  });

  it("gives detachments a duration and no other kind one", () => {
    for (const contract of CONTRACT_LIST) {
      if (contract.kind === "detachment") {
        expect(contract.duration, contract.id).toBeGreaterThan(0);
      } else {
        expect(contract.duration, contract.id).toBeUndefined();
      }
    }
  });

  it("resolves every requirement and reward reference", () => {
    const posts = new Set(POST_LIST.map((post) => post.id));
    const items = new Set<string>(EQUIPMENT_KEYS);
    for (const contract of CONTRACT_LIST) {
      expect(Number.isInteger(contract.fee) && contract.fee >= 0, contract.id).toBe(true);
      for (const requirement of contract.requires) {
        expect(requirement.count, `${contract.id} ${requirement.kind}`).toBeGreaterThan(0);
        if (requirement.kind === "item") {
          expect(items.has(requirement.id as string), `${contract.id} → ${requirement.id}`).toBe(
            true,
          );
        }
        if (requirement.kind === "post") {
          expect(posts.has(requirement.id as string), `${contract.id} → ${requirement.id}`).toBe(
            true,
          );
        }
        if (requirement.kind === "unit" || requirement.kind === "honour") {
          expect(requirement.id, `${contract.id} ${requirement.kind} has no id`).toBeUndefined();
        }
      }
      for (const itemId of contract.reward.itemIds) {
        expect(items.has(itemId), `${contract.id} → ${itemId}`).toBe(true);
      }
    }
  });

  it("exercises all four requirement kinds", () => {
    const kinds = new Set(CONTRACT_LIST.flatMap((c) => c.requires.map((r) => r.kind)));
    for (const kind of ["item", "post", "unit", "honour"] as const) {
      expect(kinds.has(kind), `no contract requires a ${kind}`).toBe(true);
    }
  });

  it("looks contracts up and rejects unknown ids", () => {
    const first = CONTRACT_KEYS[0] as (typeof CONTRACT_KEYS)[number];
    expect(isContractKey(first)).toBe(true);
    expect(isContractKey(42)).toBe(false);
    expect(getContract(first).id).toBe(first);
    expect(() => getContract("missing" as never)).toThrow(RangeError);
    expect(requirementsOf(first)).toEqual(getContract(first).requires);
  });

  it("passes the display-integrity sweep and carries no FFTA trademarks", () => {
    const bundle = DataBundleSchema.parse({ contracts: CONTRACT_LIST });
    expect(() => assertDisplayIntegrity(bundle)).not.toThrow();
    const text = CONTRACT_LIST.flatMap((contract) => [
      contract.name,
      contract.description,
      contract.flavour,
    ])
      .join(" ")
      .toLowerCase();
    for (const marker of FFTA_MARKERS) {
      expect(text, `contract text must not contain "${marker}"`).not.toContain(marker);
    }
  });
});
