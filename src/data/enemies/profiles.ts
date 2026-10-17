/**
 * Enemy **AI profiles** (T091).
 *
 * Every authored troop names an `aiProfile` (`EnemyDefSchema.aiProfile`). The
 * profile is the data half of the Phase 9 utility AI (T095): it holds the
 * **policy knobs** a decision-maker reads when scoring targets, positions and
 * abilities. Keeping them here — not in engine code — means a troops'
 * behaviour is content, tuned without touching `src/ai/` (`agents.md` §2).
 *
 * The knobs are deliberately coarse: they describe *temperament* (how hard it
 * pushes, how far it prefers to fight, whether it flanks, whether it holds
 * terrain, how it picks a target and when it quits) rather than scripting
 * specific moves. T095 turns them into weights; the Phase 13 balance pass
 * retunes them.
 *
 * | Knob               | Meaning                                                    |
 * | ------------------ | ---------------------------------------------------------- |
 * | `aggression`       | 0–100; how readily the troop closes to melee               |
 * | `rangedBias`       | 0–100; how strongly it prefers a ranged action in reach    |
 * | `flankBias`        | 0–100; how much it values a flank/rear tile                |
 * | `holdGround`       | it digests terrain and refuses to advance needlessly       |
 * | `focusFire`        | it concentrates with its allies rather than spreading      |
 * | `targetPreference` | `nearest` / `weakest` / `strongest` / `leader` / `marked`  |
 * | `withdrawBelow`    | HP fraction below which it disengages (0 = never)          |
 *
 * Reference: mapping §11 ("irregular and auxiliary troops"), §12 (Orders Tempo
 * and the tactical AI's inputs).
 */

import { z } from "zod";

import { DisplayFields, IdSchema } from "../schema";

/** How a profile selects its preferred target. */
export const AI_TARGET_PREFERENCES = [
  "nearest",
  "weakest",
  "strongest",
  "leader",
  "marked",
] as const;
export const AiTargetPreferenceSchema = z.enum(AI_TARGET_PREFERENCES);
export type AiTargetPreference = z.infer<typeof AiTargetPreferenceSchema>;

/**
 * A troop temperament. Every knob is bounded so a hand-authored profile cannot
 * ask for an impossible behaviour (e.g. 150% aggression or a negative
 * withdrawal threshold).
 */
export const EnemyAiProfileDefSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  /** 0–100: how readily the troop closes to melee. */
  aggression: z.number().int().min(0).max(100).default(50),
  /** 0–100: preference for a ranged action when one is in reach. */
  rangedBias: z.number().int().min(0).max(100).default(50),
  /** 0–100: value placed on a flank or rear tile. */
  flankBias: z.number().int().min(0).max(100).default(0),
  /** Dig in and refuse a needless advance. */
  holdGround: z.boolean().default(false),
  /** Concentrate fire with allies instead of spreading damage. */
  focusFire: z.boolean().default(false),
  /** Which enemy the profile prefers to engage. */
  targetPreference: AiTargetPreferenceSchema.default("nearest"),
  /** HP fraction below which the troop disengages; `0` means it never does. */
  withdrawBelow: z.number().min(0).max(1).default(0),
});
export type EnemyAiProfileDef = z.infer<typeof EnemyAiProfileDefSchema>;

/** Raw authoring shape: a profile's fields with the `id` supplied by its key. */
export type AiProfileData = Omit<z.input<typeof EnemyAiProfileDefSchema>, "id">;

/** Validate a module's authored profiles and key them by their stable id. */
function parseAiProfiles<const T extends Record<string, AiProfileData>>(
  data: T,
): { readonly [K in keyof T]: EnemyAiProfileDef } {
  const parsed = {} as { [K in keyof T]: EnemyAiProfileDef };
  for (const key of Object.keys(data) as (keyof T)[]) {
    parsed[key] = EnemyAiProfileDefSchema.parse({ id: String(key), ...data[key] });
  }
  return parsed;
}

/**
 * The canonical AI profiles, keyed by their stable id. `default` is the
 * schema's fallback, so it is always present and always first.
 */
export const AI_PROFILES = parseAiProfiles({
  default: {
    name: "Line Order",
    description:
      "Balanced line behaviour: advance to musket range, fire, and close only when it tells.",
    flavour: "The drill book covers almost everything, and the serjeant fills in the rest.",
    aggression: 50,
    rangedBias: 60,
    flankBias: 20,
    targetPreference: "nearest",
  },
  aggressive: {
    name: "Cold Steel",
    description: "Press the attack without pause and settle the affair at bayonet range.",
    flavour: "Some men are paid to close, and they are worth the pay.",
    aggression: 90,
    rangedBias: 20,
    flankBias: 40,
    focusFire: true,
    targetPreference: "weakest",
  },
  defensive: {
    name: "Hold the Line",
    description: "Stand on good ground, trade volleys, and make the enemy come to you.",
    flavour: "Let them spend their legs and their powder; the position will do the rest.",
    aggression: 30,
    rangedBias: 75,
    holdGround: true,
    targetPreference: "nearest",
  },
  skirmisher: {
    name: "Skirmish Order",
    description: "Fight in loose order from cover, pick soft targets and fall back when pressed.",
    flavour: "A skirmisher who stays to trade volleys has forgotten what he is for.",
    aggression: 35,
    rangedBias: 80,
    flankBias: 50,
    targetPreference: "weakest",
    withdrawBelow: 0.25,
  },
  skittish: {
    name: "Green and Unsteady",
    description: "Untried troops who fire a few shots and look for the road home.",
    flavour: "Courage is a habit, and they have not had the time to form it.",
    aggression: 30,
    rangedBias: 50,
    withdrawBelow: 0.4,
    targetPreference: "nearest",
  },
  artillery: {
    name: "Gun Line",
    description: "Serve the pieces from a good position; never seek a melee.",
    flavour: "The gun has no opinion about bayonets, only about range.",
    aggression: 10,
    rangedBias: 95,
    holdGround: true,
    targetPreference: "nearest",
  },
  cavalry: {
    name: "Shock Action",
    description: "Ride wide, take the flank and break the line at the gallop.",
    flavour: "The horse is the argument; the sabre only supplies the punctuation.",
    aggression: 95,
    rangedBias: 10,
    flankBias: 80,
    focusFire: true,
    targetPreference: "weakest",
  },
  commander: {
    name: "Command Group",
    description: "Steady the line, hand out orders and keep the standard in sight.",
    flavour: "An officer's first weapon is the sound of his own voice.",
    aggression: 25,
    rangedBias: 40,
    flankBias: 10,
    focusFire: true,
    targetPreference: "weakest",
  },
  guerrilla: {
    name: "Ambush",
    description: "Conceal, wait, and strike a chosen target before melting back into the country.",
    flavour: "The wood is empty until it is not, and then it is empty again.",
    aggression: 60,
    rangedBias: 70,
    flankBias: 60,
    focusFire: true,
    targetPreference: "strongest",
    withdrawBelow: 0.3,
  },
  fanatic: {
    name: "No Quarter",
    description: "Advance into any fire and never break off; the field is taken or not at all.",
    flavour: "They have been told they cannot be beaten, and they have decided to believe it.",
    aggression: 100,
    rangedBias: 30,
    flankBias: 20,
    focusFire: true,
    targetPreference: "strongest",
  },
  beast: {
    name: "Pack Instinct",
    description: "Run down the nearest threat as a pack and pull it down together.",
    flavour: "One dog is a nuisance; six are a verdict.",
    aggression: 85,
    rangedBias: 0,
    flankBias: 70,
    focusFire: true,
    targetPreference: "weakest",
  },
} as const);

/** A known AI profile id. */
export type AiProfileKey = keyof typeof AI_PROFILES;

/** The canonical profile keys in authored order. */
export const AI_PROFILE_KEYS = Object.keys(AI_PROFILES) as AiProfileKey[];

/** The profiles in their canonical order. */
export const AI_PROFILE_LIST: readonly EnemyAiProfileDef[] = AI_PROFILE_KEYS.map(
  (id) => AI_PROFILES[id],
);

/** Runtime guard: `true` when `value` is a canonical AI profile key. */
export function isAiProfileKey(value: unknown): value is AiProfileKey {
  return typeof value === "string" && (AI_PROFILE_KEYS as readonly string[]).includes(value);
}

/** Look up an AI profile by key. Throws on an unknown key. */
export function getAiProfile(id: AiProfileKey): EnemyAiProfileDef {
  const profile = AI_PROFILES[id];
  if (profile === undefined) {
    throw new RangeError(`unknown AI profile: ${String(id)}`);
  }
  return profile;
}

/** Resolve an arbitrary profile id (an authored `EnemyDef.aiProfile`) or `undefined`. */
export function findAiProfile(id: string): EnemyAiProfileDef | undefined {
  return (AI_PROFILES as Record<string, EnemyAiProfileDef | undefined>)[id];
}
