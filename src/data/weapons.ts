/**
 * Weapon families (T035) — the variant damage recipes behind each
 * {@link WeaponType}.
 *
 * FFTA's own physical section gives a single shared formula, so the
 * weapon-type variants come from the **Final Fantasy Tactics** list on the same
 * reference page (`docs/wiki/pages/Attack_(command).md`), the tactical series
 * FFTA descends from. There the damage is `offense(attacker stats) × weapon
 * power`, and the offense factor differs per weapon family. We keep those
 * shapes and re-author the numbers as our own balance data (`agents.md` §3,
 * §10):
 *
 * | Reference family            | Offense factor        | Tactica families            |
 * | --------------------------- | --------------------- | --------------------------- |
 * | Swords / spears / blades    | `PA × WP`             | sabre, blade, lance, musket |
 * | Knives / longbows           | `(PA + Spd) / 2 × WP` | carbine, rifle, bow, tool   |
 * | Staves / rods               | `MA × WP`             | staff                       |
 * | Instruments                 | `(PA + MA) / 2 × WP`  | instrument                  |
 * | Physical guns               | `WP²`                 | gun                         |
 *
 * A `shield` is included for completeness as an off-hand bash (`PA × WP`). The
 * shared halved-defence subtraction and `Power/100` multiplier are the Steel
 * kernel in `src/engine/rules/damage.ts`; only the offense basis changes here.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** The formula shape is declared locally and
 *   is structurally assignable to the engine's `WeaponFormula`, so the data
 *   layer stays free of `src/engine` imports.
 * - **Validated at load.** Entries are parsed with Zod, so a malformed
 *   coefficient fails loudly rather than skewing a battle.
 * - **No placeholders.** Every family carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { z } from "zod";

import { WeaponTypeSchema, type WeaponType } from "./schema";

/* --------------------------------------------------------------------------
 * Schema
 * ------------------------------------------------------------------------ */

/** How a family combines its offense factor with weapon power (T035). */
export const WeaponPowerModeSchema = z.enum(["multiply", "square"]);
export type WeaponPowerMode = z.infer<typeof WeaponPowerModeSchema>;

/**
 * A weapon family's damage recipe. Mirrors the engine's `WeaponFormula`
 * (`src/engine/rules/damage.ts`) structurally — the data layer does not import
 * the engine, but the shapes line up.
 */
export const WeaponFamilyFormulaSchema = z.object({
  /** Divisor applied to the defender's Weapon Def (shared Steel kernel). */
  defenseDivisor: z.number().int().min(1),
  /** Divisor applied to the action's Power term (shared Steel kernel). */
  powerDivisor: z.number().int().min(1),
  /** Weight on the attacker's `atk` (FFTA `PA`). */
  atkWeight: z.number().int().nonnegative(),
  /** Weight on the attacker's `spd` (FFTA `Sp`). */
  spdWeight: z.number().int().nonnegative(),
  /** Weight on the attacker's `mag` (FFTA `MA`). */
  magWeight: z.number().int().nonnegative(),
  /** Divisor applied to the weighted stat sum (the `/2` in `(PA+Spd)/2`). */
  offenseDivisor: z.number().int().min(1),
  /** `multiply` = factor × weapon power; `square` = weapon power squared. */
  weaponPowerMode: WeaponPowerModeSchema,
});
export type WeaponFamilyFormula = z.infer<typeof WeaponFamilyFormulaSchema>;

export const WeaponFamilyDefSchema = z.object({
  id: WeaponTypeSchema,
  name: z.string().min(1).describe("Player-facing Napoleonic weapon family"),
  description: z.string().min(1).describe("Mechanical rules text"),
  flavour: z.string().min(1).describe("In-world prose"),
  formula: WeaponFamilyFormulaSchema,
});
export type WeaponFamilyDef = z.infer<typeof WeaponFamilyDefSchema>;

/* --------------------------------------------------------------------------
 * Authored formulas (our balance data, inspired by the reference)
 * ------------------------------------------------------------------------ */

/** `PA × WP` — the common melee/line-infantry shape. */
const MELEE_FORMULA: WeaponFamilyFormula = {
  defenseDivisor: 2,
  powerDivisor: 100,
  atkWeight: 1,
  spdWeight: 0,
  magWeight: 0,
  offenseDivisor: 1,
  weaponPowerMode: "multiply",
};

/** `(PA + Spd) / 2 × WP` — light, quick, sighted weapons. */
const PRECISION_FORMULA: WeaponFamilyFormula = {
  defenseDivisor: 2,
  powerDivisor: 100,
  atkWeight: 1,
  spdWeight: 1,
  magWeight: 0,
  offenseDivisor: 2,
  weaponPowerMode: "multiply",
};

/** `MA × WP` — implements that channel a bearer's wits (Powder flavour). */
const ARCANE_FORMULA: WeaponFamilyFormula = {
  defenseDivisor: 2,
  powerDivisor: 100,
  atkWeight: 0,
  spdWeight: 0,
  magWeight: 1,
  offenseDivisor: 1,
  weaponPowerMode: "multiply",
};

/** `(PA + MA) / 2 × WP` — instruments and calls that rouse or direct troops. */
const SUPPORT_FORMULA: WeaponFamilyFormula = {
  defenseDivisor: 2,
  powerDivisor: 100,
  atkWeight: 1,
  spdWeight: 0,
  magWeight: 1,
  offenseDivisor: 2,
  weaponPowerMode: "multiply",
};

/** `WP²` — ordnance that ignores the bearer's stats and punishes armour. */
const ORDNANCE_FORMULA: WeaponFamilyFormula = {
  defenseDivisor: 2,
  powerDivisor: 100,
  atkWeight: 0,
  spdWeight: 0,
  magWeight: 0,
  offenseDivisor: 1,
  weaponPowerMode: "square",
};

/* --------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/**
 * Unparsed family data. Typed against every {@link WeaponType} so the compiler
 * rejects a missing or extra family; parsed into {@link WEAPON_FAMILIES}
 * below.
 */
const WEAPON_FAMILY_DATA = {
  sabre: {
    name: "Sabre",
    description: "A light curved blade; the bearer's strength drives every cut.",
    flavour: "The officer's sidearm: quick to the draw and quicker to the throat.",
    formula: MELEE_FORMULA,
  },
  blade: {
    name: "Broadsword",
    description: "A heavy straight blade that trades finesse for cleaving force.",
    flavour: "Grenadiers favour the weight; a single blow settles most arguments.",
    formula: MELEE_FORMULA,
  },
  lance: {
    name: "Lance",
    description: "A long reach weapon whose whole power arrives at the point.",
    flavour: "Couched in a charge, a lance turns a rider into a single thunderbolt.",
    formula: MELEE_FORMULA,
  },
  musket: {
    name: "Musket",
    description: "A smoothbore shoulder arm; raw powder behind a heavy ball.",
    flavour: "Three ranks, one crashing volley — the Queen of Battles speaks.",
    formula: MELEE_FORMULA,
  },
  carbine: {
    name: "Carbine",
    description: "A short firearm that rewards a swift, sure hand over raw power.",
    flavour: "Light cavalry carry it slung; it answers fast in a running fight.",
    formula: PRECISION_FORMULA,
  },
  rifle: {
    name: "Rifle",
    description: "Grooved barrel and steady aim turn pace and strength into accuracy.",
    flavour: "A Baker rifle in still hands can pick a man from the enemy line.",
    formula: PRECISION_FORMULA,
  },
  bow: {
    name: "Hunting Bow",
    description: "A drawn bow: the shot's weight comes from strength and quickness alike.",
    flavour: "Irregulars and foresters still trust the bow when powder runs wet.",
    formula: PRECISION_FORMULA,
  },
  gun: {
    name: "Cannon",
    description: "A served field piece whose effect scales with the piece, not the crew.",
    flavour: "A nine-pounder cares nothing for the gunner's arm, only for the aim.",
    formula: ORDNANCE_FORMULA,
  },
  staff: {
    name: "Signal Staff",
    description: "A tall staff and map case; the bearer's judgement shapes the effect.",
    flavour: "Flags, mirrors and rockets speak where the voice cannot reach.",
    formula: ARCANE_FORMULA,
  },
  instrument: {
    name: "Hunting Horn",
    description: "A call that rouses allies and directs hounds; mind and arm together.",
    flavour: "The horn carries further than any order shouted into the smoke.",
    formula: SUPPORT_FORMULA,
  },
  tool: {
    name: "Sapper's Tools",
    description: "Picks, charges and wire: nimbleness and strength set the working.",
    flavour: "A sapper's kit opens walls that a battery could not crack.",
    formula: PRECISION_FORMULA,
  },
  shield: {
    name: "Shield",
    description: "An off-hand shield used to bash; the bearer's strength is the blow.",
    flavour: "In the press of a breach, the boss of a shield is as good as a sword.",
    formula: MELEE_FORMULA,
  },
} satisfies Record<WeaponType, Omit<WeaponFamilyDef, "id">>;

/**
 * Every weapon family, keyed by the stable {@link WeaponType} id and validated
 * at module load. Read this instead of branching on weapon ids anywhere in the
 * engine — pass a family's `formula` to `computeWeaponDamage`.
 */
export const WEAPON_FAMILIES: Record<WeaponType, WeaponFamilyDef> = Object.fromEntries(
  Object.entries(WEAPON_FAMILY_DATA).map(([id, def]) => [
    id,
    WeaponFamilyDefSchema.parse({ id, ...def }),
  ]),
) as Record<WeaponType, WeaponFamilyDef>;

/** Look up a family's authored definition. Throws on an unknown id. */
export function getWeaponFamily(type: WeaponType): WeaponFamilyDef {
  const family = WEAPON_FAMILIES[type];
  if (family === undefined) {
    throw new RangeError(`unknown weapon family: ${String(type)}`);
  }
  return family;
}
