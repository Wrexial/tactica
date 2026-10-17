import { describe, expect, it } from "vitest";

import {
  AbilityDefSchema,
  ArticleDefSchema,
  ConditionDefSchema,
  ContractDefSchema,
  DataBundleSchema,
  ElementDefSchema,
  EnemyDefSchema,
  EquipmentDefSchema,
  PostDefSchema,
} from "../../src/data/schema";
import type { DataBundle } from "../../src/data/schema";
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
    expect(cleanWikiText("{{LA|Blood Sword (weapon)|Blood Sword}}<br/>[[File:FFTABloodsword.PNG]]")).toBe(
      "Blood Sword",
    );
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
    expect(parseSkillLines("Soldier/Warrior: First Aid (100)\nDragoon: Wyrmkiller (300)\nNone")).toEqual(
      [
        { jobs: ["Soldier", "Warrior"], name: "First Aid", ap: 100 },
        { jobs: ["Dragoon"], name: "Wyrmkiller", ap: 300 },
      ],
    );
  });
});

describe("wiki → data converter — re-authored balance", () => {
  it("scales reference numerals down instead of copying them", () => {
    const stats = deriveStats({ atk: 100, def: 100, mag: 0, res: 0, spd: 0, eva: 0, jump: 0, range: 0 });
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
