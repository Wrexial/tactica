/**
 * Authored-content schemas (Zod).
 *
 * Naming contract (see `agents.md` §8 and `docs/NAPOLEONIC_MAPPING.md` §1):
 *   - **Type names are rethemed** (`PostDef`, not `JobDef`) so the data layer
 *     reads like the game we are building.
 *   - **Mechanical keys stay FFTA-shaped** (`mpCost`, `ap`, `power`, `range`,
 *     `chargeTime`, `element`, ...) so engine formulas and the reference mirror
 *     map 1:1 and the retheme remains a skin over preserved mechanics.
 *   - **Display fields are Napoleonic**: every authored definition carries
 *     `name`, `description` and `flavour` strings (mapping §14, D6).
 *
 * Nothing here executes or mutates data: these are pure validators. Content
 * lives in sibling modules (`posts.ts`, `equipment.ts`, ...) and is parsed at
 * load/test time. The engine brands the string ids in `src/engine/ids.ts` (T012);
 * until then ids are validated as non-empty strings.
 */

import { z } from "zod";

/* --------------------------------------------------------------------------
 * Shared primitives
 * ------------------------------------------------------------------------ */

/** Non-empty content id. Branded at the engine boundary in T012. */
export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

/**
 * The three display strings every definition must carry. `name` is the
 * player-facing Napoleonic label; `description` is the mechanical rules text;
 * `flavour` is the in-world prose (mapping §14, D6/D8).
 */
export const DisplayFields = {
  name: z.string().min(1).describe("Player-facing Napoleonic name"),
  description: z.string().min(1).describe("Mechanical rules text"),
  flavour: z.string().min(1).describe("In-world prose"),
} as const;

/** The five great-power military schools that replace FFTA's races (mapping §2). */
export const POWER_KEYS = ["france", "britain", "prussia", "russia", "austria"] as const;
export const PowerKeySchema = z.enum(POWER_KEYS);
export type PowerKey = z.infer<typeof PowerKeySchema>;

/**
 * The eight reflavoured FFTA elements (mapping §7, decision D5). The id stays
 * the FFTA element key; `name` carries the Napoleonic reading (Fire →
 * Incendiary, Holy → Colours, Dark → Terror...).
 */
export const ELEMENT_KEYS = [
  "fire",
  "ice",
  "lightning",
  "earth",
  "water",
  "wind",
  "holy",
  "dark",
] as const;
export const ElementKeySchema = z.enum(ELEMENT_KEYS);
export type ElementKey = z.infer<typeof ElementKeySchema>;

/** Elemental affinity used by enemies and gear (weak / resist / immune / absorb). */
export const AffinitySchema = z.enum(["weak", "resist", "immune", "absorb"]);
export type Affinity = z.infer<typeof AffinitySchema>;

/** Equip slots, using FFTA's layout (primary hand, off hand, body, head, trinket). */
export const EQUIP_SLOTS = ["weapon", "offhand", "armour", "head", "accessory"] as const;
export const EquipSlotSchema = z.enum(EQUIP_SLOTS);
export type EquipSlot = z.infer<typeof EquipSlotSchema>;

/** FFTA weapon families, rethemed. Drives the variant damage formula (T035). */
export const WEAPON_TYPES = [
  "sabre",
  "blade",
  "lance",
  "musket",
  "carbine",
  "rifle",
  "bow",
  "gun",
  "staff",
  "instrument",
  "tool",
  "shield",
] as const;
export const WeaponTypeSchema = z.enum(WEAPON_TYPES);
export type WeaponType = z.infer<typeof WeaponTypeSchema>;

/** Per-level growth (mapping §5: `mp` is Élan; `ap`/Drill lives on abilities). */
export const StatGrowthSchema = z.object({
  hp: z.number().nonnegative(),
  mp: z.number().nonnegative(),
  atk: z.number().nonnegative(),
  def: z.number().nonnegative(),
  mag: z.number().nonnegative(),
  res: z.number().nonnegative(),
  spd: z.number().nonnegative(),
});
export type StatGrowth = z.infer<typeof StatGrowthSchema>;

/** Absolute stat block for a unit/enemy at a given level (FFTA stat names). */
export const StatBlockSchema = z.object({
  hp: z.number().int().nonnegative(),
  mp: z.number().int().nonnegative(),
  atk: z.number().int().nonnegative(),
  def: z.number().int().nonnegative(),
  mag: z.number().int().nonnegative(),
  res: z.number().int().nonnegative(),
  spd: z.number().int().nonnegative(),
  move: z.number().int().nonnegative(),
  jump: z.number().int().nonnegative(),
});
export type StatBlock = z.infer<typeof StatBlockSchema>;

/** Signed equipment modifiers; absent stats default to 0. */
export const StatModsSchema = z.object({
  hp: z.number().int().default(0),
  mp: z.number().int().default(0),
  atk: z.number().int().default(0),
  def: z.number().int().default(0),
  mag: z.number().int().default(0),
  res: z.number().int().default(0),
  spd: z.number().int().default(0),
  move: z.number().int().default(0),
  jump: z.number().int().default(0),
});
export type StatMods = z.infer<typeof StatModsSchema>;

/* --------------------------------------------------------------------------
 * Element (mapping §7)
 * ------------------------------------------------------------------------ */

export const ElementDefSchema = z.object({
  id: ElementKeySchema,
  ...DisplayFields,
  /** Opposing element in the weakness cycle, if any. */
  opposedTo: ElementKeySchema.optional(),
});
export type ElementDef = z.infer<typeof ElementDefSchema>;

/* --------------------------------------------------------------------------
 * Condition (mapping §8 — all 43 FFTA statuses are re-authored here)
 * ------------------------------------------------------------------------ */

export const CONDITION_KINDS = ["ailment", "buff", "debuff", "special"] as const;
export const ConditionKindSchema = z.enum(CONDITION_KINDS);
export type ConditionKind = z.infer<typeof ConditionKindSchema>;

export const ConditionDefSchema = z.object({
  id: IdSchema.describe("FFTA-shaped status key, e.g. poison/haste/protect"),
  ...DisplayFields,
  kind: ConditionKindSchema,
  /** Deals/reverses damage each tempo tick (Poison → Bleeding). */
  ticks: z.boolean().default(false),
  /** Duration in tempo ticks; 0 means indefinite until cured. */
  duration: z.number().int().nonnegative().default(0),
  /** Whether a hit wakes/cures it (Sleep → Unconscious). */
  removedOnHit: z.boolean().default(false),
  /** Conditions this one replaces or cancels (Haste ↔ Slow, Regen...). */
  cancels: z.array(IdSchema).default([]),
});
export type ConditionDef = z.infer<typeof ConditionDefSchema>;

/* --------------------------------------------------------------------------
 * Ability (mapping §6 — A / R / S / C abilities)
 * ------------------------------------------------------------------------ */

/** FFTA ability classes: A-Action, R-Reaction, S-Support (Trait), C-Combo (Volley). */
export const ABILITY_CLASSES = ["action", "reaction", "support", "combo"] as const;
export const AbilityClassSchema = z.enum(ABILITY_CLASSES);
export type AbilityClass = z.infer<typeof AbilityClassSchema>;

export const ABILITY_TARGETS = ["self", "ally", "enemy", "any", "tile"] as const;
export const AbilityTargetSchema = z.enum(ABILITY_TARGETS);
export type AbilityTarget = z.infer<typeof AbilityTargetSchema>;

export const AOE_SHAPES = ["single", "cross", "line", "square", "field"] as const;
export const AoeShapeSchema = z.enum(AOE_SHAPES);
export type AoeShape = z.infer<typeof AoeShapeSchema>;

export const AbilityDefSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  /** A/R/S/C (mapping §6). */
  abilityClass: AbilityClassSchema,
  /** FFTA skillset (command) this ability belongs to, e.g. a post's kit. */
  skillsetId: IdSchema,
  /** Post/role that unlocks it; omitted for shared/common abilities. */
  postId: IdSchema.optional(),
  /** Élan cost (formerly MP). */
  mpCost: z.number().int().nonnegative().default(0),
  /** Orders Tempo charge time in ticks (mapping §12). */
  chargeTime: z.number().int().nonnegative().default(0),
  /** Formula power term, data-driven (T033/T034). */
  power: z.number().int().default(0),
  /** Success chance percentage. */
  hitRate: z.number().int().min(0).max(100).default(100),
  /** Targeting reach in tiles. */
  range: z.number().int().nonnegative().default(1),
  aoeShape: AoeShapeSchema.default("single"),
  aoeSize: z.number().int().nonnegative().default(0),
  element: ElementKeySchema.optional(),
  target: AbilityTargetSchema.default("enemy"),
  /** Conditions applied on a successful hit (by condition id). */
  inflicts: z.array(IdSchema).default([]),
  /** Conditions removed on a successful use (by condition id). */
  cleanses: z.array(IdSchema).default([]),
  /** Drill (AP) bound to this ability when taught by equipment (T048). */
  ap: z.number().int().nonnegative().optional(),
});
export type AbilityDef = z.infer<typeof AbilityDefSchema>;

/* --------------------------------------------------------------------------
 * Post (mapping §3 — FFTA jobs → Napoleonic roles)
 * ------------------------------------------------------------------------ */

/** FFTA job-unlock prerequisite: master N abilities from a given post. */
export const PostRequirementSchema = z.object({
  postId: IdSchema,
  abilities: z.number().int().positive().default(1),
});
export type PostRequirement = z.infer<typeof PostRequirementSchema>;

export const PostDefSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  /** Restricting power (FFTA race restriction). */
  power: PowerKeySchema,
  /** Equip slots the post may fill. */
  equipSlots: z.array(EquipSlotSchema).default([]),
  /** Per-level stat growth (mapping §3 tables inspire these values). */
  growth: StatGrowthSchema,
  /** Skillsets usable from this post (primary or attached, T051). */
  skillsetIds: z.array(IdSchema).default([]),
  /** Unlock prerequisites, mirroring FFTA's "2× Soldier A-Abilities". */
  requires: z.array(PostRequirementSchema).default([]),
  /** Shared across powers (Surgeon, Artilleryman, Forager, Staff Officer). */
  common: z.boolean().default(false),
});
export type PostDef = z.infer<typeof PostDefSchema>;

/* --------------------------------------------------------------------------
 * Equipment (mapping §3 kit; FFTA weapons/armour/accessories)
 * ------------------------------------------------------------------------ */

/** An ability taught while the item is equipped, with its Drill (AP) cost. */
export const EquipmentTeachSchema = z.object({
  abilityId: IdSchema,
  /** Drill required to master the ability from this item (FFTA AP cost). */
  ap: z.number().int().nonnegative(),
});
export type EquipmentTeach = z.infer<typeof EquipmentTeachSchema>;

export const EquipmentDefSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  slot: EquipSlotSchema,
  /** Weapon family for the variant damage formula; weapon slots only. */
  weaponType: WeaponTypeSchema.optional(),
  /** Crowns cost in depots; null for unique/quest kit (FFTA "N/A"). */
  cost: z.number().int().nonnegative().nullable().default(null),
  /** Power-specific depot discount (mapping §2). */
  power: PowerKeySchema.optional(),
  /** Innate element of attacks/hits from this item. */
  element: ElementKeySchema.optional(),
  stats: StatModsSchema.prefault({}),
  /** Abilities learned by drilling with this kit (T048). */
  teaches: z.array(EquipmentTeachSchema).default([]),
  /** Conditions inflicted on a successful hit. */
  inflicts: z.array(IdSchema).default([]),
  /** Powers barred from equipping it (default: none). */
  restrictedTo: z.array(PowerKeySchema).default([]),
});
export type EquipmentDef = z.infer<typeof EquipmentDefSchema>;

/* --------------------------------------------------------------------------
 * Enemy (mapping §11 — FFTA monsters → irregular / auxiliary troops)
 * ------------------------------------------------------------------------ */

export const EnemyDropSchema = z.object({
  itemId: IdSchema,
  /** Drop weight as an integer; re-authored balance, not wiki gospel. */
  weight: z.number().int().positive().default(1),
});
export type EnemyDrop = z.infer<typeof EnemyDropSchema>;

export const EnemyDefSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  /** Irregular-troop family (FFTA monster archetype). */
  family: IdSchema,
  level: z.number().int().positive().default(1),
  stats: StatBlockSchema,
  /** Innate element affinity applied to attacks. */
  element: ElementKeySchema.optional(),
  /** Per-element defensive affinity (only non-neutral entries needed). */
  affinities: z.partialRecord(ElementKeySchema, AffinitySchema).default({}),
  /** Enemy troop actions (FFTA enemy abilities) by ability id. */
  abilities: z.array(IdSchema).default([]),
  /** Loot table (T091). */
  drops: z.array(EnemyDropSchema).default([]),
  /** Capturable for the Auxiliary Barracks (T078). */
  capturable: z.boolean().default(false),
  /** Key into the AI profiles in `src/ai` (T095). */
  aiProfile: IdSchema.default("default"),
  /** Experience and Drill awarded on defeat. */
  exp: z.number().int().nonnegative().default(0),
  ap: z.number().int().nonnegative().default(0),
});
export type EnemyDef = z.infer<typeof EnemyDefSchema>;

/* --------------------------------------------------------------------------
 * Article of War (mapping §9 — FFTA laws → daily standing orders)
 * ------------------------------------------------------------------------ */

/** What an Article forbids or commends. */
export const ARTICLE_TARGETS = [
  "action",
  "element",
  "weapon",
  "post",
  "condition",
  "move",
  "item",
] as const;
export const ArticleTargetSchema = z.enum(ARTICLE_TARGETS);
export type ArticleTarget = z.infer<typeof ArticleTargetSchema>;

export const ARTICLE_KINDS = ["forbid", "commend"] as const;
export const ArticleKindSchema = z.enum(ARTICLE_KINDS);
export type ArticleKind = z.infer<typeof ArticleKindSchema>;

export const ArticleDefSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  kind: ArticleKindSchema,
  target: ArticleTargetSchema,
  /** Specific values the Article names; empty means "any of the target class". */
  keys: z.array(IdSchema).default([]),
  /** Honour (JP) granted for a commended act. */
  honour: z.number().int().nonnegative().default(0),
  /** Card issued on a first breach (mapping §9). */
  severity: z.enum(["reprimand", "court-martial"]).default("reprimand"),
  /** Weight for the seeded daily article pool (T055). */
  weight: z.number().nonnegative().default(1),
  /** Only active in No-Man's Land-style regions (mapping §9). */
  regionId: IdSchema.optional(),
});
export type ArticleDef = z.infer<typeof ArticleDefSchema>;

/* --------------------------------------------------------------------------
 * Contract (mapping §10 — FFTA missions → Officers' Mess contracts)
 * ------------------------------------------------------------------------ */

export const CONTRACT_KINDS = ["battle", "skirmish", "detachment", "pacification"] as const;
export const ContractKindSchema = z.enum(CONTRACT_KINDS);
export type ContractKind = z.infer<typeof ContractKindSchema>;

export const ContractRequirementSchema = z.object({
  /** Gate kind, mirroring the FFTA pub (item / post / unit / Honour). */
  kind: z.enum(["item", "post", "unit", "honour"]),
  id: IdSchema.optional(),
  count: z.number().int().positive().default(1),
});
export type ContractRequirement = z.infer<typeof ContractRequirementSchema>;

export const ContractRewardSchema = z.object({
  crowns: z.number().int().nonnegative().default(0),
  /** Drill (AP) awarded to participants. */
  ap: z.number().int().nonnegative().default(0),
  experience: z.number().int().nonnegative().default(0),
  /** Regimental Honours (clan-title analogue) granted. */
  honours: z.number().int().nonnegative().default(0),
  itemIds: z.array(IdSchema).default([]),
});
export type ContractReward = z.infer<typeof ContractRewardSchema>;

export const ContractDefSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  kind: ContractKindSchema,
  /** Entry fee in Crowns. */
  fee: z.number().int().nonnegative().default(0),
  /** Posting requirements checked by the Officers' Mess. */
  requires: z.array(ContractRequirementSchema).default([]),
  reward: ContractRewardSchema,
  /** Campaign-map region/marker the contract belongs to. */
  regionId: IdSchema.optional(),
  /** Days a Detachment is away (kind === "detachment"). */
  duration: z.number().int().positive().optional(),
  /** Story chapter that gates the contract (T077). */
  chapter: z.number().int().positive().optional(),
});
export type ContractDef = z.infer<typeof ContractDefSchema>;

/* --------------------------------------------------------------------------
 * Bundle — validates every authored collection in one pass (T009/T094)
 * ------------------------------------------------------------------------ */

export const DataBundleSchema = z.object({
  elements: z.array(ElementDefSchema).default([]),
  conditions: z.array(ConditionDefSchema).default([]),
  abilities: z.array(AbilityDefSchema).default([]),
  posts: z.array(PostDefSchema).default([]),
  equipment: z.array(EquipmentDefSchema).default([]),
  enemies: z.array(EnemyDefSchema).default([]),
  articles: z.array(ArticleDefSchema).default([]),
  contracts: z.array(ContractDefSchema).default([]),
});
export type DataBundle = z.infer<typeof DataBundleSchema>;
