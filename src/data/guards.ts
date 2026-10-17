/**
 * Guard Sorties (T062, mapping §4) — the five national elite formations.
 *
 * FFTA ends the *Final Fantasy* summon tradition with the **Totema**: five
 * race-guardian summons (Mateus, Exodus, Adrammelech, Ultima, Famfrit) that
 * each race may call once unlocked by beating it in the story. The retheme keeps
 * the mechanic exactly (mapping §4):
 *
 * | FFTA race | Power   | FFTA Totema | Tactica Guard Sortie            | Effect preserved            |
 * | --------- | ------- | ----------- | ------------------------------- | --------------------------- |
 * | Hume      | France  | Mateus      | **The Old Guard**               | Devastating all-enemy assault |
 * | Viera     | Britain | Exodus      | **The Heavy Brigade**           | Draining charge (Élan drain) |
 * | Bangaa    | Prussia | Adrammelech | **The Death's Head Hussars**    | Piercing shock attack       |
 * | Nu mou    | Russia  | Ultima      | **The Grand Battery**           | Massive artillery barrage   |
 * | Moogle    | Austria | Famfrit     | **The Kaiser's Bombardiers**    | Multi-hit explosive fire    |
 *
 * Every Guard Sortie:
 * - **hits the whole battlefield** (all enemies, no range and no line of sight);
 * - costs a fixed **10 Honour** (FFTA's ten Judge Points, mapping §4/§5 — the
 *   engine owns that cost in `src/engine/rules/honour.ts`, `GUARD_SORTIE_COST`);
 * - is **unlocked by story progress**, not bought. This module records the
 *   `chapter` at which each formation answers the call, so the campaign story
 *   (T077) can gate them without a hard-coded list in the engine.
 *
 * ## Grounded fiction (mapping §14, D9)
 *
 * There is no literal summoning. A Guard Sortie is the free company calling in
 * a national formation already present on the field's flanks — the Old Guard
 * going in with the bayonet, heavy dragoons riding down the line, hussars
 * breaking through, a grand battery firing in unison, or bombardiers walking
 * their shells across the enemy front. The mechanical effect (a whole-field
 * strike that cannot be evaded) is preserved; the cause is mundane.
 *
 * ## Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`)
 *
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse. The effect shapes mirror the engine's
 *   `AbilityEffect` union structurally, exactly as `weapons.ts` mirrors
 *   `WeaponFormula`.
 * - **Validated at load.** Every definition is parsed with
 *   {@link GuardSortieDefSchema}, so a mistyped element, power or effect fails
 *   loudly at module load rather than skewing a battle.
 * - **No placeholders.** Every formation carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { z } from "zod";

import { DisplayFields, ElementKeySchema, IdSchema, PowerKeySchema } from "./schema";

/* --------------------------------------------------------------------------
 * Schema
 * ------------------------------------------------------------------------ */

/**
 * One effect a Guard Sortie lands on every enemy. Mirrors the engine's
 * `AbilityEffect` (`src/engine/actions/ability.ts`) for the three families a
 * formation uses — Steel, Powder and a drain — without importing the engine.
 * The `power` term feeds the shared Steel/Powder kernel (T033/T034).
 */
export const GuardSortieEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("steel"),
    power: z.number().int().describe("Steel formula power term"),
    element: ElementKeySchema.optional(),
    inflicts: z.array(IdSchema).default([]),
  }),
  z.object({
    kind: z.literal("powder"),
    power: z.number().int().describe("Powder formula power term"),
    element: ElementKeySchema.optional(),
    inflicts: z.array(IdSchema).default([]),
  }),
  z.object({
    kind: z.literal("drain"),
    resource: z.enum(["hp", "mp"]),
    power: z.number().int().nonnegative(),
    element: ElementKeySchema.optional(),
  }),
]);
export type GuardSortieEffect = z.infer<typeof GuardSortieEffectSchema>;

/**
 * A national Guard Sortie. `id` is the stable FFTA-shaped handle used by the
 * `guardSortie` command (`src/engine/commands.ts`); `power` ties it to one of
 * the five military schools (mapping §2, §4); `chapter` is the earliest story
 * chapter at which it answers the call.
 */
export const GuardSortieDefSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  /** The great-power school the formation belongs to (mapping §2). */
  power: PowerKeySchema,
  /** Story chapter that unlocks it (T077); 1 = available from the start. */
  chapter: z.number().int().positive(),
  /** Number of passes the formation makes (multi-hit fire). Defaults to one. */
  hits: z.number().int().positive().default(1),
  /** The effects landed on every enemy, in order (at least one). */
  effects: z.array(GuardSortieEffectSchema).min(1),
});
export type GuardSortieDef = z.infer<typeof GuardSortieDefSchema>;

/* --------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/**
 * The canonical Guard Sortie ids in mapping order (France → Austria). Typed as
 * a tuple so the compiler rejects a missing key in {@link GUARD_SORTIE_DATA}.
 */
export const GUARD_SORTIE_KEYS = [
  "old-guard",
  "heavy-brigade",
  "deaths-head-hussars",
  "grand-battery",
  "kaisers-bombardiers",
] as const;
export type GuardSortieKey = (typeof GUARD_SORTIE_KEYS)[number];

/** The schema's *input* type: defaulted fields may be omitted when authoring. */
type GuardSortieInput = z.input<typeof GuardSortieDefSchema>;

/** A single formation as authored, before {@link GuardSortieDefSchema} stamps its id. */
export type GuardSortieData = Omit<GuardSortieInput, "id">;

/**
 * Unparsed Guard Sortie data, keyed by the stable id. `satisfies` enforces that
 * every {@link GuardSortieKey} is authored; only fields that differ from the
 * schema defaults need to appear.
 */
const GUARD_SORTIE_DATA = {
  "old-guard": {
    name: "The Old Guard",
    description:
      "The Old Guard goes in with the bayonet; every enemy on the field is struck in one general assault.",
    flavour: "They advance without haste or shouting, and the ground they cross is already theirs.",
    power: "france",
    chapter: 2,
    effects: [{ kind: "steel", power: 320, element: "holy" }],
  },
  "heavy-brigade": {
    name: "The Heavy Brigade",
    description:
      "The heavy dragoons ride down the whole enemy line, breaking its order and draining its Élan.",
    flavour: "At a walk, then a trot, then a weight no line of infantry can hold.",
    power: "britain",
    chapter: 3,
    effects: [
      { kind: "steel", power: 140 },
      { kind: "drain", resource: "mp", power: 4 },
    ],
  },
  "deaths-head-hussars": {
    name: "The Death's Head Hussars",
    description:
      "Black-uniformed hussars break through with a concussive shock, piercing every enemy at once.",
    flavour: "They wear the skull and crossed bones, and they have earned the right to.",
    power: "prussia",
    chapter: 4,
    effects: [{ kind: "powder", power: 260, element: "lightning" }],
  },
  "grand-battery": {
    name: "The Grand Battery",
    description:
      "The massed artillery park opens fire as one, battering every enemy on the field with case and roundshot.",
    flavour: "Two hundred guns speak together, and for a moment the earth itself answers.",
    power: "russia",
    chapter: 5,
    effects: [{ kind: "powder", power: 360, element: "lightning" }],
  },
  "kaisers-bombardiers": {
    name: "The Kaiser's Bombardiers",
    description:
      "Bombardiers walk explosive shell across the enemy front in three passes, striking every enemy each time.",
    flavour:
      "The bombardment is not meant to kill a man; it is meant to erase the ground he stands on.",
    power: "austria",
    chapter: 6,
    hits: 3,
    effects: [{ kind: "powder", power: 120, element: "fire" }],
  },
} satisfies Record<GuardSortieKey, GuardSortieData>;

/**
 * Every Guard Sortie, keyed by the stable id and validated at module load.
 * Read this instead of branching on formation ids anywhere in the engine.
 */
export const GUARD_SORTIES: Record<GuardSortieKey, GuardSortieDef> = Object.fromEntries(
  Object.entries(GUARD_SORTIE_DATA).map(([id, def]) => [
    id,
    GuardSortieDefSchema.parse({ id, ...def }),
  ]),
) as Record<GuardSortieKey, GuardSortieDef>;

/**
 * The Guard Sorties in their canonical mapping order ({@link GUARD_SORTIE_KEYS}).
 * Handy for menus, the story spine and tests that need a stable order.
 */
export const GUARD_SORTIE_LIST: readonly GuardSortieDef[] = GUARD_SORTIE_KEYS.map(
  (id) => GUARD_SORTIES[id],
);

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical Guard Sortie key. */
export function isGuardSortieKey(value: unknown): value is GuardSortieKey {
  return typeof value === "string" && (GUARD_SORTIE_KEYS as readonly string[]).includes(value);
}

/** Look up a Guard Sortie by its canonical key. Throws on an unknown key. */
export function getGuardSortie(id: GuardSortieKey): GuardSortieDef {
  const guard = GUARD_SORTIES[id];
  if (guard === undefined) {
    throw new RangeError(`unknown guard sortie: ${String(id)}`);
  }
  return guard;
}

/** Every Guard Sortie belonging to a great-power school, in canonical order. */
export function guardSortiesForPower(power: GuardSortieDef["power"]): readonly GuardSortieDef[] {
  return GUARD_SORTIE_LIST.filter((guard) => guard.power === power);
}

/**
 * The Guard Sorties a story at `chapter` has unlocked: every formation whose
 * `chapter` is at or below the party's progress. Used by the story spine (T077)
 * and by the engine's helper of the same purpose.
 */
export function guardSortiesForChapter(chapter: number): readonly GuardSortieDef[] {
  if (!Number.isInteger(chapter) || chapter < 0) {
    throw new RangeError(
      `story chapter must be a non-negative integer, received ${String(chapter)}`,
    );
  }
  return GUARD_SORTIE_LIST.filter((guard) => guard.chapter <= chapter);
}
