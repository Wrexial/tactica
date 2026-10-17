/**
 * Condition (status) definitions (T039, mapping §8).
 *
 * FFTA carries a large set of status effects — Poison, Blind, Silence, Sleep,
 * Haste, Slow, Protect, Shell, KO and the rest. The retheme keeps the
 * mechanics and renames every one around the Napoleonic theatre (mapping §8,
 * decisions D6/D8/D9): **Poison → Bleeding**, **Blind → Dazed**,
 * **Silence → Deafened**, **Immobilize → Pinned**, **Protect → Formed**,
 * **Shell → Braced**, and so on. Each is a mundane cause, never literal magic
 * ("magic" = artillery, medicine, signals and morale).
 *
 * ## Ids vs. names
 *
 * As everywhere in `src/data/`, the **id stays FFTA-shaped** (`poison`,
 * `haste`, `protect`) so engine formulas and the reference mirror map 1:1,
 * while the display fields carry the fiction (`Bleeding`, `Double-Quick`,
 * `Formed`). The condition engine (`src/engine/rules/conditions.ts`, T039)
 * additionally derives a Napoleonic alias from each `name` — `bleeding`,
 * `double-quick`, `formed` — so authored content and the older `Hold` order
 * (which spells its stance `braced`) can address a condition by either key.
 *
 * ## What a definition carries
 *
 * Beyond the display strings, a {@link ConditionDef} is the whole mechanical
 * contract for the condition engine (see `ConditionDefSchema` in
 * `src/data/schema.ts`):
 *
 * - **lifecycle** — `duration` (tempo ticks; `0` = until cured), `ticks`,
 *   `removedOnHit`, `cancels`;
 * - **tempo effects** — `tickDamage` / `tickHealing` (per tick) and
 *   `countdown` (Doom's countdown to a knockout);
 * - **action gates** — `blocksMove`, `blocksAct`, `blocksAbilities`;
 * - **combat modifiers** — `statMods`, `hitModifier`, `critModifier`.
 *
 * Every number below is **authored balance data** — inspired by the scraped
 * FFTA status list (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_statuses.md`)
 * but re-authored for our detachment-scale game (`agents.md` §3, §10). No
 * definition is gameplay code; changing a duration never touches the engine.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse.
 * - **Validated at load.** Every entry is parsed with {@link ConditionDefSchema}
 *   so a malformed condition fails loudly rather than skewing a battle.
 * - **No placeholders.** Every condition carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import type { z } from "zod";

import { ConditionDefSchema, type ConditionDef } from "./schema";

/* --------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/**
 * The canonical FFTA-shaped condition keys, in mapping §8 order. Typed as a
 * tuple so the compiler rejects a missing key in {@link CONDITION_DATA} and the
 * engine can iterate conditions in a stable order.
 */
export const CONDITION_KEYS = [
  // Ailments (FFTA / mapping §8)
  "poison",
  "blind",
  "silence",
  "sleep",
  "confuse",
  "berserk",
  "charm",
  "stop",
  "petrify",
  "frog",
  "zombie",
  "doom",
  "ko",
  // Tempo, defense and control
  "haste",
  "slow",
  "regen",
  "protect",
  "shell",
  "reflect",
  "boost",
  "defense",
  "cover",
  "immobilize",
  "disable",
  "addle",
  "astra",
  "autoLife",
  "hibernate",
  "conceal",
  "quicken",
  "expertGuard",
  "advice",
  "control",
  // Stat up / down (FFTA's MPow/WAtk/WDef/MRes pairs)
  "mpowUp",
  "mpowDown",
  "watkUp",
  "watkDown",
  "wdefUp",
  "wdefDown",
  "mresUp",
  "mresDown",
] as const;

/** The FFTA-shaped id of every authored condition (mapping §8). */
export type ConditionKey = (typeof CONDITION_KEYS)[number];

/** The schema's *input* type: defaulted fields may be omitted when authoring. */
type ConditionInput = z.input<typeof ConditionDefSchema>;

/**
 * Unparsed condition data, keyed by the stable FFTA id. `satisfies` enforces
 * that every {@link ConditionKey} is authored; only fields that differ from the
 * schema defaults need to appear.
 */
const CONDITION_DATA = {
  /* ----- Ailments ------------------------------------------------------- */

  poison: {
    name: "Bleeding",
    description:
      "The wound will not close; the soldier loses hit points at the start of every turn.",
    flavour:
      "A surgeon's needle is worth more than a fresh cartridge when the blood will not stop.",
    kind: "ailment",
    ticks: true,
    tickDamage: 12,
    duration: 0,
  },
  blind: {
    name: "Dazed",
    description: "Blown powder and ringing ears ruin the aim: to-hit chance falls sharply.",
    flavour: "The gunsmoke clears and every target seems to have moved.",
    kind: "ailment",
    hitModifier: -30,
    duration: 0,
  },
  silence: {
    name: "Deafened",
    description: "Drums and ringing silence the soldier, barring all action abilities.",
    flavour: "He can see the order given and cannot hear a word of it.",
    kind: "ailment",
    blocksAbilities: true,
    duration: 0,
  },
  sleep: {
    name: "Unconscious",
    description: "Stunned senseless: cannot move or act, and any hit rouses them.",
    flavour: "They will wake with a headache and a story, if they wake at all.",
    kind: "ailment",
    blocksMove: true,
    blocksAct: true,
    removedOnHit: true,
    duration: 0,
  },
  confuse: {
    name: "Panicked",
    description:
      "The soldier fires at anyone — friend, foe or empty air — as the command breaks down.",
    flavour: "In the smoke, every uniform looks like the enemy's.",
    kind: "ailment",
    duration: 0,
  },
  berserk: {
    name: "Frenzied",
    description: "Lost to fury: rushes the nearest enemy and attacks with the bayonet alone.",
    flavour: "Some men are worth more angry, though they seldom live long enough to be told so.",
    kind: "ailment",
    duration: 0,
  },
  charm: {
    name: "Turned",
    description: "Bought, threatened or deceived into firing on their own colours.",
    flavour: "Loyalty is a currency, and some men are perpetually short of it.",
    kind: "ailment",
    duration: 0,
  },
  stop: {
    name: "Stunned",
    description: "Frozen by the concussive blast of a shell; loses movement and every order.",
    flavour: "The world goes white and the ears fill with wool.",
    kind: "ailment",
    blocksMove: true,
    blocksAct: true,
    duration: 20,
  },
  petrify: {
    name: "Broken",
    description: "Catatonic and beyond the reach of any action; counts as a casualty.",
    flavour: "He sits against the wall, eyes open, seeing nothing.",
    kind: "ailment",
    blocksMove: true,
    blocksAct: true,
    duration: 0,
  },
  frog: {
    name: "Disarmed",
    description: "Stripped of kit and dignity: restricted to move, basic attack and wait.",
    flavour: "A prisoner with no weapon is still a man; this one is only a nuisance.",
    kind: "ailment",
    blocksAbilities: true,
    duration: 0,
  },
  zombie: {
    name: "Fevered",
    description: "Inverted medicine: healing harms the patient and harm mends them.",
    flavour: "The ward-fever runs so hot that the surgeon's tonic only feeds it.",
    kind: "ailment",
    duration: 0,
  },
  doom: {
    name: "Mortally Wounded",
    description: "A wound beyond the surgeon's art; the countdown runs to a knockout.",
    flavour: "The stretcher-bearers move a little faster when they see the face.",
    kind: "ailment",
    ticks: true,
    countdown: true,
    duration: 3,
  },
  ko: {
    name: "Out of Action",
    description: "Down and out of the fight until revived; an obstacle on the field.",
    flavour: "A red cross on the field, and a name for the next letter home.",
    kind: "special",
    blocksMove: true,
    blocksAct: true,
    duration: 0,
  },

  /* ----- Tempo, defense and control ------------------------------------- */

  haste: {
    name: "Double-Quick",
    description: "Doubling the quick-march raises Orders Tempo Speed; turns come sooner.",
    flavour:
      "The step is longer, the drum is faster, and the man beside you is struggling to keep up.",
    kind: "buff",
    duration: 12,
    statMods: { spd: 20 },
    cancels: ["slow"],
  },
  slow: {
    name: "Bogged",
    description: "Mud, exhaustion and broken step lower Orders Tempo Speed; turns drag.",
    flavour: "Every pace is bought, and the line is always arriving late.",
    kind: "debuff",
    duration: 12,
    statMods: { spd: -20 },
    cancels: ["haste"],
  },
  regen: {
    name: "Steadied",
    description: "Field dressing and a steady hand restore hit points at the start of every turn.",
    flavour: "A clean bandage and a minute's rest are worth a battery of medicine.",
    kind: "buff",
    ticks: true,
    tickHealing: 12,
    duration: 12,
  },
  protect: {
    name: "Formed",
    description: "Closed ranks and shoulders to the file raise Weapon Def against Steel.",
    flavour: "The square holds because no man can fall without his neighbour holding him up.",
    kind: "buff",
    duration: 12,
    statMods: { def: 20 },
  },
  shell: {
    name: "Braced",
    description: "Dug in with overhead cover raises Magic Resistance against Powder.",
    flavour: "The earthwork eats the shell, and the men behind it eat their dinner.",
    kind: "buff",
    duration: 12,
    statMods: { res: 20 },
  },
  reflect: {
    name: "Deflected",
    description: "Sloped armour and disciplined angles send incoming Powder back at the sender.",
    flavour: "A ricochet is a free shot, if you have the nerve to stand and watch it.",
    kind: "buff",
    duration: 12,
  },
  boost: {
    name: "Rallied",
    description: "The colours are up and the attack surges until the soldier next acts.",
    flavour: "One good shout can carry a line further than a day of drill.",
    kind: "buff",
    duration: 12,
    statMods: { atk: 20 },
  },
  defense: {
    name: "Entrenched",
    description: "Spades and parapets raise both Weapon Def and Magic Resistance.",
    flavour: "An hour with a spade saves a battalion's worth of blood.",
    kind: "buff",
    duration: 12,
    statMods: { def: 15, res: 15 },
  },
  cover: {
    name: "Covering Fire",
    description: "The soldier draws fire meant for a neighbour, absorbing the hit.",
    flavour: "Take the shot meant for another, and the line keeps its shape.",
    kind: "special",
    duration: 12,
  },
  immobilize: {
    name: "Pinned",
    description: "Nailed in place by fire or terrain: cannot move, but may still act.",
    flavour: "Keep your head down and your feet still, and you might live to advance.",
    kind: "ailment",
    blocksMove: true,
    duration: 10,
  },
  disable: {
    name: "Lamed",
    description: "A wound to the arm and kit: can move, but cannot use action abilities.",
    flavour: "He can still march; he cannot still load.",
    kind: "ailment",
    blocksAbilities: true,
    duration: 10,
  },
  addle: {
    name: "Bewildered",
    description: "The mind wanders; bars all action abilities until the soldier steadies.",
    flavour: "Ask him his own name and he will give you the regiment's.",
    kind: "ailment",
    blocksAbilities: true,
    duration: 10,
  },
  astra: {
    name: "Adjutant's Orders",
    description: "A written order confers one-time immunity to the next hostile condition.",
    flavour: "Authority is a shield as long as the paper holds.",
    kind: "buff",
    duration: 0,
  },
  autoLife: {
    name: "Last Rites",
    description: "The chaplain's blessing revives the soldier once when they fall.",
    flavour: "A prayer before the volley is worth more than one after it.",
    kind: "buff",
    duration: 0,
  },
  hibernate: {
    name: "Bivouacked",
    description: "Rested and out of the line: skips orders to recover, and mends each turn.",
    flavour: "Sleep in the baggage train and live to fight another day.",
    kind: "special",
    ticks: true,
    tickHealing: 10,
    blocksMove: true,
    blocksAct: true,
    duration: 0,
  },
  conceal: {
    name: "Camouflaged",
    description: "Hidden in cover: the enemy must find them before they can be engaged.",
    flavour: "A good spot and a still man are worth a company of scouts.",
    kind: "buff",
    duration: 8,
  },
  quicken: {
    name: "Inspired",
    description: "A sudden resolve steals an immediate extra turn from Orders Tempo.",
    flavour: "Now, while the speech still rings in their ears.",
    kind: "special",
    duration: 1,
  },
  expertGuard: {
    name: "Parry",
    description: "A perfect guard: no hit-point or Élan damage lands for the next turn.",
    flavour: "Keep the blade up and let them exhaust themselves.",
    kind: "buff",
    duration: 8,
  },
  advice: {
    name: "Counsel",
    description: "A staff officer's guidance raises the soldier's critical-hit chance.",
    flavour: "One word from the right colonel is worth a week in the saddle.",
    kind: "buff",
    duration: 12,
    critModifier: 20,
  },
  control: {
    name: "Suborned",
    description: "An enemy officer now takes the company's orders until released.",
    flavour: "A captured map is useful; a captured will is better.",
    kind: "special",
    duration: 0,
  },

  /* ----- Stat up / down (FFTA's MPow/WAtk/WDef/MRes pairs) -------------- */

  mpowUp: {
    name: "Powder Up",
    description: "Stronger charges and better ranges raise Magic Power.",
    flavour: "Good powder and a dry touch make the guns do twice the work.",
    kind: "buff",
    duration: 12,
    statMods: { mag: 20 },
    cancels: ["mpowDown"],
  },
  mpowDown: {
    name: "Powder Down",
    description: "Damp cartridges and fouled pieces lower Magic Power.",
    flavour: "Nothing disappoints a gunner like a fizzle.",
    kind: "debuff",
    duration: 12,
    statMods: { mag: -20 },
    cancels: ["mpowUp"],
  },
  watkUp: {
    name: "Steel Up",
    description: "Ground edges and fresh flints raise Weapon Attack.",
    flavour: "A sharpened blade finds the gap in any guard.",
    kind: "buff",
    duration: 12,
    statMods: { atk: 20 },
    cancels: ["watkDown"],
  },
  watkDown: {
    name: "Steel Down",
    description: "Blunted blades and broken locks lower Weapon Attack.",
    flavour: "A dull sabre is a club with a fancy hilt.",
    kind: "debuff",
    duration: 12,
    statMods: { atk: -20 },
    cancels: ["watkUp"],
  },
  wdefUp: {
    name: "Guard Up",
    description: "Plates and padding raise Weapon Def.",
    flavour: "An extra layer of leather turns a fatal cut into a bruise.",
    kind: "buff",
    duration: 12,
    statMods: { def: 20 },
    cancels: ["wdefDown"],
  },
  wdefDown: {
    name: "Guard Down",
    description: "Split straps and cut buckles lower Weapon Def.",
    flavour: "The standard falls and the line is suddenly naked.",
    kind: "debuff",
    duration: 12,
    statMods: { def: -20 },
    cancels: ["wdefUp"],
  },
  mresUp: {
    name: "Faith Up",
    description: "Confidence and cover raise Magic Resistance.",
    flavour: "A man who believes in the colours will stand in the open.",
    kind: "buff",
    duration: 12,
    statMods: { res: 20 },
    cancels: ["mresDown"],
  },
  mresDown: {
    name: "Faith Down",
    description: "Shaken nerve lowers Magic Resistance.",
    flavour: "Doubt is a contagion faster than any fever.",
    kind: "debuff",
    duration: 12,
    statMods: { res: -20 },
    cancels: ["mresUp"],
  },
} satisfies Record<ConditionKey, Omit<ConditionInput, "id">>;

/**
 * Every condition, keyed by the stable FFTA id and validated at module load.
 * Read this instead of branching on condition ids anywhere in the engine.
 */
export const CONDITIONS: Record<ConditionKey, ConditionDef> = Object.fromEntries(
  Object.entries(CONDITION_DATA).map(([id, def]) => [id, ConditionDefSchema.parse({ id, ...def })]),
) as Record<ConditionKey, ConditionDef>;

/**
 * The conditions in their canonical mapping order ({@link CONDITION_KEYS}).
 * Handy for menus, Articles-of-War checks and tests that need a stable order.
 */
export const CONDITION_LIST: readonly ConditionDef[] = CONDITION_KEYS.map((id) => CONDITIONS[id]);

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical FFTA-shaped condition key. */
export function isConditionKey(value: unknown): value is ConditionKey {
  return typeof value === "string" && (CONDITION_KEYS as readonly string[]).includes(value);
}

/** Look up a condition by its canonical key. Throws on an unknown key. */
export function getCondition(id: ConditionKey): ConditionDef {
  const condition = CONDITIONS[id];
  if (condition === undefined) {
    throw new RangeError(`unknown condition: ${String(id)}`);
  }
  return condition;
}
