/**
 * Shared authoring helpers and cross-post abilities for the action catalogue
 * (T089, mapping §6).
 *
 * Every post owns an **action set** — the FFTA job's A-Abilities, rethemed as
 * black-powder drill (`Volley Fire`, `Bayonet Charge`, `Canister Shot`, …).
 * Alongside those, the retheme keeps FFTA's three non-action classes and makes
 * them available to any soldier who masters the slot:
 *
 * | Class | FFTA | Tactica | Lives here as |
 * | ----- | ---- | ------- | ------------- |
 * | R | Reaction | **Riposte / Return Fire / Dodge / Field Dressing** | {@link SHARED_ABILITIES} |
 * | S | Support | **Traits** (Thrift, Drilled Guards, …) | {@link SHARED_ABILITIES} |
 * | C | Combo | **Volley** (Honour-fuelled chained fire) | {@link SHARED_ABILITIES} |
 *
 * The per-power modules (`france.ts`, `britain.ts`, …) author the action sets;
 * this module owns the pieces they share. {@link parseAbilities} stamps the
 * stable id onto each entry and validates it with {@link AbilityDefSchema}, so
 * a mistyped class, range or element fails **at module load** (`agents.md`
 * §2, §3, §9) rather than skewing a battle.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse. Ids stay plain strings (branded at the engine
 *   boundary, T012).
 * - **No placeholders.** Every ability carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 * - **Ids stay FFTA-shaped.** `riposte`, `return-fire`, `dodge` and
 *   `field-dressing` match `REACTION_IDS` in `src/engine/reactions.ts`; every
 *   equipment `teaches.abilityId` resolves to an entry in this catalogue.
 */

import type { z } from "zod";

import { AbilityDefSchema, type AbilityDef } from "../schema";

/** Raw authoring shape: an ability's fields with the `id` supplied by its key. */
export type AbilityInput = z.input<typeof AbilityDefSchema>;

/** An ability entry as authored, before {@link parseAbilities} stamps its id on. */
export type AbilityData = Omit<AbilityInput, "id">;

/**
 * Validate a module's authored abilities and key them by their stable id.
 *
 * ```ts
 * export const FRANCE_ABILITIES = parseAbilities({
 *   "volley-fire": { name: "Volley Fire", ... },
 * });
 * ```
 *
 * The `const` type parameter preserves the literal keys, so the returned
 * record's `keyof` is exactly the authored ability ids and the aggregate
 * catalogue in `./index.ts` stays exhaustively typed.
 */
export function parseAbilities<const T extends Record<string, AbilityData>>(
  data: T,
): { readonly [K in keyof T]: AbilityDef } {
  const parsed = {} as { [K in keyof T]: AbilityDef };
  for (const key of Object.keys(data) as (keyof T)[]) {
    parsed[key] = AbilityDefSchema.parse({ id: String(key), ...data[key] });
  }
  return parsed;
}

/**
 * The skillset ids that do not belong to a post. Action abilities always name a
 * post's `*-kit`; shared reactions, traits and Volleys belong to one of these
 * cross-post command sets (mapping §6).
 */
export const REACTION_SKILLSET = "reactions-kit";
export const TRAIT_SKILLSET = "traits-kit";
export const VOLLEY_SKILLSET = "volleys-kit";

/**
 * Reactions, traits and Volleys shared by every power — the FFTA R/S/C
 * abilities, rethemed (mapping §6). They carry no `postId`: a soldier may slot
 * one once the matching ability slot is open (`src/engine/progression/posts.ts`,
 * `ABILITY_SLOT_CLASSES`).
 */
export const SHARED_ABILITIES = parseAbilities({
  /* ----- R-Abilities: Reactions ---------------------------------------- */

  riposte: {
    name: "Riposte",
    description: "Answer a melee blow with an immediate counter-cut at half power.",
    flavour: "Parry, then punish: the riposte is the whole reason a blade is held.",
    abilityClass: "reaction",
    skillsetId: REACTION_SKILLSET,
    power: 50,
    range: 1,
    target: "enemy",
  },

  parry: {
    name: "Parry",
    description: "Turn an incoming blade aside, greatly reducing the blow's damage.",
    flavour: "A good parry is not a block; it is a promise the enemy's edge will not arrive.",
    abilityClass: "reaction",
    skillsetId: REACTION_SKILLSET,
    target: "self",
  },

  "return-fire": {
    name: "Return Fire",
    description: "Answer incoming small-arms fire with an immediate volley of your own.",
    flavour: "Steady, present, fire — the line does not wait for the order twice.",
    abilityClass: "reaction",
    skillsetId: REACTION_SKILLSET,
    power: 100,
    range: 4,
    target: "enemy",
    element: "lightning",
  },

  dodge: {
    name: "Dodge",
    description: "Throw yourself aside; a chance to completely negate an incoming attack.",
    flavour: "The shot you never heard is the one that missed you.",
    abilityClass: "reaction",
    skillsetId: REACTION_SKILLSET,
    target: "self",
  },

  "field-dressing": {
    name: "Field Dressing",
    description: "Bind a wound on the spot once reduced to half strength.",
    flavour: "A clean strip of linen and a firm hand save more men than any surgeon's tent.",
    abilityClass: "reaction",
    skillsetId: REACTION_SKILLSET,
    power: 100,
    target: "self",
  },

  /* ----- S-Abilities: Traits ------------------------------------------- */

  thrift: {
    name: "Thrift",
    description: "Halve the Élan cost of every action by stretching powder and rations.",
    flavour: "An army marches on its stomach, and the wise quartermaster hoards both.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "drilled-guards": {
    name: "Drilled Guards",
    description: "Fight behind a wall of bayonets; reduce incoming weapon damage.",
    flavour: "The guard position is drilled into the arm until it answers before the mind does.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "two-handed-grip": {
    name: "Two-Handed Grip",
    description: "Put both hands on a one-handed piece for extra striking power.",
    flavour: "One hand guides, the other drives; the blade lands with twice the argument.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "steady-aim": {
    name: "Steady Aim",
    description: "Breathe, then fire; improves accuracy with every shot.",
    flavour: "Between the heartbeats, the whole world goes still and the target grows large.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "cold-steel": {
    name: "Cold Steel",
    description: "Sharpen the blade and drive it home; increases melee power.",
    flavour: "A dull edge is a broken promise to the man holding it.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "powder-discipline": {
    name: "Powder Discipline",
    description: "Measure the charge rather than guess it; increases artillery power.",
    flavour: "Gunners who survive to grow old are the ones who never hurry a charge.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "death-or-glory": {
    name: "Death or Glory",
    description:
      "Double the powder, risk the barrel: more power and accuracy, at a steeper Élan cost.",
    flavour: "The forlorn hope volunteers because the other options are worse.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  constitution: {
    name: "Constitution",
    description: "Shrug off the camp fevers; resist many ailments and debilitations.",
    flavour: "Some men are simply too stubborn to take to their bed.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "elemental-knowledge": {
    name: "Elemental Knowledge",
    description: "Read how a target's cover burns, floods or shatters; exploit its weaknesses.",
    flavour: "Know what the ground and the weather will do, and the ground fights for you.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "twin-blades": {
    name: "Twin Blades",
    description: "Fight with a weapon in each hand, striking twice with one exchange.",
    flavour: "Two blades, two strokes, and no time between them for a reply.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "kit-care": {
    name: "Kit Care",
    description: "Your kit is never stolen or ruined by the enemy.",
    flavour: "Oil the lock, roll the cartridge, and your musket will never betray you.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "shield-drill": {
    name: "Shield Drill",
    description: "Carry a shield with any post, whatever the drill normally allows.",
    flavour: "The pavise does not care which colour coat stands behind it.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "light-grip": {
    name: "Light Grip",
    description: "Handle a two-handed piece in one hand, freeing the other for kit.",
    flavour: "Strength is useful; leverage is what wins the press.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  "foreign-drill": {
    name: "Foreign Drill",
    description: "Study the enemy in the field and copy their methods as your own.",
    flavour: "A captured order, read aloud, teaches the whole company something new.",
    abilityClass: "support",
    skillsetId: TRAIT_SKILLSET,
    target: "self",
  },

  /* ----- C-Abilities: Volleys ------------------------------------------ */

  "massed-volley": {
    name: "Massed Volley",
    description: "Adjacent allies chain their fire into one rolling, Honour-fuelled crash.",
    flavour: "Three ranks, one word of command, and the smoke closes the field.",
    abilityClass: "combo",
    skillsetId: VOLLEY_SKILLSET,
    power: 60,
    range: 4,
    target: "enemy",
  },

  "rolling-fire": {
    name: "Rolling Fire",
    description: "A volley that advances down the line, adding each ally's contribution in turn.",
    flavour: "The fire rolls from file to file like a wave breaking along a shingle beach.",
    abilityClass: "combo",
    skillsetId: VOLLEY_SKILLSET,
    power: 45,
    range: 4,
    target: "enemy",
  },

  "closing-fire": {
    name: "Closing Fire",
    description: "Hold the volley until the enemy is close, then spend the full Honour pool.",
    flavour: "Fire at a hundred paces wastes powder; fire at thirty wins the day.",
    abilityClass: "combo",
    skillsetId: VOLLEY_SKILLSET,
    power: 80,
    range: 3,
    target: "enemy",
  },
});
