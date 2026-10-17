/**
 * Post (role / class) definitions (T046, mapping §3).
 *
 * A **post** is FFTA's *job*: it fixes a soldier's **power** restriction (the
 * military school that may hold it), its per-level **stat growth**, the **kit**
 * it is trained to use (equip slots and weapon families) and the **skillsets**
 * it commands. Secondary posts are gated by FFTA-style **unlock requirements**
 * — "master N action abilities from post X" (mapping §3, the *2× Soldier
 * A-Abilities* rule).
 *
 * ## Ids, names and powers
 *
 * As everywhere in `src/data/`, the **id stays FFTA-shaped and stable**
 * (`fusilier`, `rifleman`, `line-grenadier`) while the display fields carry the
 * Napoleonic fiction (`src/data/README.md`, mapping §1). The five powers are the
 * five great-power military schools (mapping §2): France, Britain, Prussia,
 * Russia and Austria. **Common posts** (Surgeon, Artilleryman, Forager, Staff
 * Officer) set `common: true` and may be taken by any power from that power's
 * depot; `power` still names the variant's home school.
 *
 * ## Growth numbers
 *
 * Every growth value below is **re-authored balance data** — inspired by the
 * scraped FFTA job tables
 * (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_jobs.md`, the stat-growth
 * sections) but rounded and rebalanced for our detachment-scale game
 * (`agents.md` §3, §10). No balance constant lives in code: the engine reads
 * these blocks through `deriveStats` (`src/engine/stats.ts`, T018).
 *
 * This module authors the **foundational roster** — a starting post for each
 * power, a first unlock chain and the four common posts. The remaining role
 * trees are added on top of the same registry (T047).
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse. Ids stay plain strings (branded at the engine
 *   boundary, T012).
 * - **Validated at load.** Every entry is parsed with {@link PostDefSchema}, so
 *   a malformed growth block or a bad weapon family fails loudly.
 * - **No placeholders.** Every post carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import type { z } from "zod";

import {
  PostDefSchema,
  type EquipSlot,
  type PostDef,
  type PostRequirement,
  type PowerKey,
} from "./schema";

/* --------------------------------------------------------------------------
 * The roster
 * ------------------------------------------------------------------------ */

/**
 * The canonical post keys, grouped by power with the common posts last. Typed
 * as a tuple so the compiler rejects a missing key in {@link POST_DATA} and the
 * engine can iterate the roster in a stable order.
 */
export const POST_KEYS = [
  // France — combined arms (Hume)
  "fusilier",
  "grenadier",
  // Britain — light troops and rifles (Viera)
  "rifleman",
  "sharpshooter",
  // Prussia — disciplined shock infantry (Bangaa)
  "line-grenadier",
  "cuirassier",
  // Russia — artillery, engineers and resilience (Nu mou)
  "partisan",
  // Austria — defensive lines and technical support (Moogle)
  "scout",
  "engineer",
  // Common posts (shared across every power)
  "surgeon",
  "artilleryman",
  "forager",
  "staff-officer",
] as const;

/** A known post id (an FFTA-shaped, stable string). */
export type PostKey = (typeof POST_KEYS)[number];

/** Raw authoring shape: parsed {@link PostDef} fields with `id` supplied by the key. */
type PostInput = z.input<typeof PostDefSchema>;

/* --------------------------------------------------------------------------
 * Kit templates (usable equip slots)
 * ------------------------------------------------------------------------ */

/** Full kit: every equip slot, for troops that fight blade-and-firearm. */
const FULL_KIT: EquipSlot[] = ["weapon", "offhand", "armour", "head", "accessory"];

/** Shoulder-arms kit: both hands serve the piece, so no off-hand. */
const SHOULDER_KIT: EquipSlot[] = ["weapon", "armour", "head", "accessory"];

/* --------------------------------------------------------------------------
 * Authored posts (our balance data, inspired by the reference tables)
 * ------------------------------------------------------------------------ */

/**
 * Unparsed post data. Typed against every {@link PostKey} so the compiler
 * rejects a missing or extra post; parsed into {@link POSTS} below.
 */
const POST_DATA = {
  /* ----- France: combined arms (Hume) --------------------------------- */

  fusilier: {
    name: "Fusilier",
    description:
      "Line infantry drilled to fire by volley and hold with the bayonet; balanced growth and the broadest kit.",
    flavour:
      "The fusilier is the army's anvil: steady under fire and dangerous at the point of the bayonet.",
    power: "france",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["musket", "blade"],
    growth: { hp: 8.4, mp: 1.1, atk: 8.8, def: 8.8, mag: 6.0, res: 7.2, spd: 1.1 },
    skillsetIds: ["fusilier-kit"],
  },
  grenadier: {
    name: "Grenadier",
    description:
      "Heavy shock infantry built for the assault; trades finesse for raw strength and a punishing charge.",
    flavour: "Grenadiers go first over the breach, tall men chosen for the worst work of the day.",
    power: "france",
    equipSlots: FULL_KIT,
    weaponTypes: ["musket", "blade"],
    growth: { hp: 7.2, mp: 1.1, atk: 9.2, def: 8.1, mag: 5.6, res: 6.8, spd: 1.1 },
    skillsetIds: ["grenadier-kit"],
    requires: [{ postId: "fusilier", abilities: 2 }],
  },

  /* ----- Britain: light troops and rifles (Viera) --------------------- */

  rifleman: {
    name: "Rifleman",
    description:
      "Light troops with a rifled piece; long-range fire, loose order and an eye for broken ground.",
    flavour: "A rifleman fights from cover and shadow, and makes every shot tell.",
    power: "britain",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["rifle"],
    growth: { hp: 7.2, mp: 1.6, atk: 8.1, def: 6.8, mag: 7.2, res: 7.6, spd: 1.6 },
    skillsetIds: ["rifleman-kit"],
  },
  sharpshooter: {
    name: "Sharpshooter",
    description:
      "A marksman of the light companies; extreme-range precision and a talent for picking officers out of the line.",
    flavour: "One round, one officer, and the enemy's advance loses its head.",
    power: "britain",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["rifle"],
    growth: { hp: 6.2, mp: 2.4, atk: 9.4, def: 6.8, mag: 7.6, res: 7.6, spd: 1.8 },
    skillsetIds: ["sharpshooter-kit"],
    requires: [{ postId: "rifleman", abilities: 2 }],
  },

  /* ----- Prussia: disciplined shock infantry (Bangaa) ----------------- */

  "line-grenadier": {
    name: "Line Grenadier",
    description:
      "Disciplined heavy infantry that advances in step and breaks a line with the bayonet.",
    flavour: "The Prussian line moves like a wall, and a wall does not flinch.",
    power: "prussia",
    equipSlots: FULL_KIT,
    weaponTypes: ["musket", "blade"],
    growth: { hp: 9.2, mp: 2.1, atk: 9.2, def: 8.4, mag: 6.2, res: 6.8, spd: 0.9 },
    skillsetIds: ["line-grenadier-kit"],
  },
  cuirassier: {
    name: "Cuirassier",
    description:
      "Armoured heavy cavalry; a shock trooper who closes with the sabre and shrugs off small-arms fire.",
    flavour: "Breastplate and big horse: when the cuirassiers come, infantry had best form square.",
    power: "prussia",
    equipSlots: FULL_KIT,
    weaponTypes: ["blade", "lance"],
    growth: { hp: 8.4, mp: 1.1, atk: 8.8, def: 9.2, mag: 6.5, res: 7.2, spd: 0.9 },
    skillsetIds: ["cuirassier-kit"],
    requires: [{ postId: "line-grenadier", abilities: 2 }],
  },

  /* ----- Russia: artillery, engineers and resilience (Nu mou) --------- */

  partisan: {
    name: "Partisan",
    description:
      "Irregular officer who raises and directs local levies, hounds and bands of auxiliaries.",
    flavour:
      "A partisan knows every ford and farm track, and turns a whole countryside into a trap.",
    power: "russia",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["sabre", "instrument"],
    growth: { hp: 7.4, mp: 2.1, atk: 8.8, def: 8.8, mag: 6.8, res: 8.4, spd: 1.2 },
    skillsetIds: ["partisan-kit"],
  },

  /* ----- Austria: defensive lines and technical support (Moogle) ------ */

  scout: {
    name: "Scout",
    description:
      "Light support who calls up hounds and skirmishers; status-craft, horns and field signals.",
    flavour: "The horn sounds, and the woods answer with friends.",
    power: "austria",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["instrument", "bow"],
    growth: { hp: 7.2, mp: 2.6, atk: 7.6, def: 8.8, mag: 7.2, res: 8.8, spd: 1.2 },
    skillsetIds: ["scout-kit"],
  },
  engineer: {
    name: "Engineer",
    description:
      "Technical support with gadgets, charges and improvised devices; utility effects with an element of chance.",
    flavour: "If it can be built, an engineer can also take it apart — usually with a bang.",
    power: "austria",
    equipSlots: FULL_KIT,
    weaponTypes: ["tool", "gun"],
    growth: { hp: 7.2, mp: 2.4, atk: 8.2, def: 9.6, mag: 8.3, res: 10.2, spd: 0.9 },
    skillsetIds: ["engineer-kit"],
    requires: [{ postId: "forager", abilities: 2 }],
  },

  /* ----- Common posts (shared across every power) --------------------- */

  surgeon: {
    name: "Surgeon",
    description:
      "Medical specialist who heals wounds, steadies nerve and cleanses conditions. A common post open to every power.",
    flavour: "Under the lantern's edge, the surgeon is worth more than a squadron.",
    power: "france",
    equipSlots: FULL_KIT,
    weaponTypes: ["staff", "tool"],
    growth: { hp: 6.1, mp: 4.8, atk: 6.2, def: 7.3, mag: 8.4, res: 8.2, spd: 1.2 },
    skillsetIds: ["surgeon-kit"],
    common: true,
  },
  artilleryman: {
    name: "Artilleryman",
    description:
      "Gun crew who deliver elemental fire, concussion and case shot at range. A common post open to every power.",
    flavour: "The gunners speak last, and the field goes quiet to listen.",
    power: "france",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["gun"],
    growth: { hp: 5.6, mp: 4.4, atk: 6.4, def: 6.8, mag: 8.8, res: 9.6, spd: 1.1 },
    skillsetIds: ["artilleryman-kit"],
    common: true,
  },
  forager: {
    name: "Forager",
    description:
      "Light-fingered scrounger who steals kit, disarms a foe and slips away. A common post open to every power.",
    flavour: "Armies march on their stomachs, and foragers know exactly whose stomach.",
    power: "austria",
    equipSlots: FULL_KIT,
    weaponTypes: ["sabre", "carbine"],
    growth: { hp: 6.6, mp: 1.1, atk: 7.6, def: 7.6, mag: 7.6, res: 6.8, spd: 1.8 },
    skillsetIds: ["forager-kit"],
    common: true,
  },
  "staff-officer": {
    name: "Staff Officer",
    description:
      "Signals and dispatch specialist who bends the tempo of battle; hastens allies and delays enemies. A common post open to every power.",
    flavour: "An order sent in time is worth a battery sent late.",
    power: "russia",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["staff"],
    growth: { hp: 5.2, mp: 3.6, atk: 5.6, def: 6.8, mag: 10.2, res: 9.6, spd: 1.2 },
    skillsetIds: ["staff-officer-kit"],
    common: true,
  },
} satisfies Record<PostKey, Omit<PostInput, "id">>;

/**
 * Every post, keyed by the stable FFTA-shaped id and validated at module load.
 * Read this instead of branching on post ids anywhere in the engine.
 */
export const POSTS: Record<PostKey, PostDef> = Object.fromEntries(
  Object.entries(POST_DATA).map(([id, def]) => [id, PostDefSchema.parse({ id, ...def })]),
) as Record<PostKey, PostDef>;

/**
 * The posts in their canonical order ({@link POST_KEYS}). Handy for menus,
 * post-change screens and tests that need a stable iteration order.
 */
export const POST_LIST: readonly PostDef[] = POST_KEYS.map((id) => POSTS[id]);

/* --------------------------------------------------------------------------
 * Lookups & power restriction
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical post key. */
export function isPostKey(value: unknown): value is PostKey {
  return typeof value === "string" && (POST_KEYS as readonly string[]).includes(value);
}

/** Look up a post by its canonical key. Throws on an unknown key. */
export function getPost(id: PostKey): PostDef {
  const post = POSTS[id];
  if (post === undefined) {
    throw new RangeError(`unknown post: ${String(id)}`);
  }
  return post;
}

/** The common posts any power may take (Surgeon, Artilleryman, Forager, Staff Officer). */
export function commonPosts(): readonly PostDef[] {
  return POST_LIST.filter((post) => post.common);
}

/**
 * Every post a given power may take: its home-school posts **and** the common
 * posts. Order follows {@link POST_LIST}.
 */
export function postsForPower(power: PowerKey): readonly PostDef[] {
  return POST_LIST.filter((post) => post.power === power || post.common);
}

/**
 * `true` when a power may hold a post — either because the post belongs to that
 * school or because it is a common post. Backs the post-change screen's gating
 * (T052).
 */
export function canTakePost(postId: PostKey, power: PowerKey): boolean {
  const post = getPost(postId);
  return post.power === power || post.common;
}

/* --------------------------------------------------------------------------
 * Unlock requirements (FFTA "master N abilities from post X")
 * ------------------------------------------------------------------------ */

/**
 * How many abilities a soldier has mastered, grouped by the post that taught
 * them. Until the ability collection lands (T089) this is the smallest shape
 * that answers "do you meet the prerequisite?", and it keeps the check pure.
 *
 * ```ts
 * const mastered = { fusilier: ["bayonet-charge", "volley-fire"] };
 * meetsPostRequirement({ postId: "fusilier", abilities: 2 }, mastered); // true
 * ```
 */
export type MasteredByPost = Readonly<Record<string, readonly string[]>>;

/** `true` when the soldier has mastered enough abilities from the named post. */
export function meetsPostRequirement(
  requirement: PostRequirement,
  mastered: MasteredByPost,
): boolean {
  const learned = mastered[requirement.postId];
  return (learned?.length ?? 0) >= requirement.abilities;
}

/** `true` when every unlock prerequisite for a post is satisfied. */
export function meetsPostRequirements(post: PostDef, mastered: MasteredByPost): boolean {
  return post.requires.every((requirement) => meetsPostRequirement(requirement, mastered));
}

/**
 * The posts a power can currently unlock: its own and common posts (see
 * {@link postsForPower}) whose prerequisites are met. A starting post has no
 * prerequisites and is always included.
 */
export function unlockablePosts(power: PowerKey, mastered: MasteredByPost): readonly PostDef[] {
  return postsForPower(power).filter((post) => meetsPostRequirements(post, mastered));
}
