/**
 * Officers' Mess contracts (T070, mapping §10).
 *
 * In FFTA the **pub** posts missions on a board: each one has an entry **fee**,
 * a set of **requirements** (an item, a job level, a unit count, ...) and a
 * **reward** (Gil, AP, XP, an item, a clan title). The retheme keeps that
 * contract exactly and renames the board the **Officers' Mess**, the currency
 * **Crowns**, AP **Drill**, XP **Experience** and clan titles **Regimental
 * Honours** (mapping §1, §5, §10). A mission kind maps 1:1:
 *
 * | FFTA mission   | `kind` in this module | Tactica fiction                                          |
 * | -------------- | --------------------- | -------------------------------------------------------- |
 * | Regular        | `battle`              | A story/campaign set piece                               |
 * | Encounter      | `skirmish`            | A rival free company met on the road                     |
 * | Dispatch       | `detachment`          | Soldiers sent away for N days (`duration`)               |
 * | Area           | `pacification`        | Clear a region and hold it (`regionId`)                  |
 *
 * The engine (`src/engine/company.ts` and the still-to-land mess/dispatch code)
 * consumes these definitions; this module only **declares** them. The fee is
 * paid in Crowns, so every contract's reward is authored to turn a profit on
 * success — the risk is the battle, not the arithmetic.
 *
 * ## Requirements
 *
 * A {@link ContractRequirement} mirrors the FFTA pub gate and names its class
 * with `kind`:
 *
 * | `kind`   | `id` names...                    | `count` means...            |
 * | -------- | -------------------------------- | --------------------------- |
 * | `item`   | an equipment id (`baker-rifle`)  | how many are needed         |
 * | `post`   | a post id (`scout`, `surgeon`)   | how many of that trade      |
 * | `unit`   | — (any soldier)                  | how many soldiers to commit |
 * | `honour` | — (company Honour / JP)          | Honour the company must hold |
 *
 * Requirements are **data only**; the check against the roster lives in the
 * officers' mess UI (T071) and the campaign tests (T079). Because the ids are
 * the same stable handles used everywhere else in `src/data/`, this module can
 * be validated against the post and equipment registries in tests.
 *
 * ## Region and story gates
 *
 * `regionId`, when present, ties a contract to a campaign-map region
 * (`RegionId`, owned by the map in T073). The region ids here are stable,
 * evocative handles; the map defines the actual tiles. `chapter`, when present,
 * gates a contract to a story beat (T077); a contract with no `chapter` is
 * always postable. `duration` is authored only for `detachment` contracts.
 *
 * ## Authored numbers
 *
 * Every fee and reward below is **re-authored balance data**, inspired by the
 * FFTA mission/fee tables but tuned for detachment-scale play
 * (`agents.md` §3, §10). No balance constant lives in engine code.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse. Ids stay plain strings, branded at the engine
 *   boundary (T012).
 * - **Validated at load.** Every entry is parsed with {@link ContractDefSchema},
 *   so a mistyped kind, requirement or negative reward fails loudly at module
 *   load rather than skewing the campaign.
 * - **No placeholders.** Every contract carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import type { z } from "zod";

import {
  ContractDefSchema,
  type ContractDef,
  type ContractKind,
  type ContractRequirement,
} from "./schema";

/* --------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/**
 * The canonical contract ids in authoring order — battles, skirmishes,
 * detachments, then pacifications. Typed as a tuple so the compiler rejects a
 * missing key in {@link CONTRACT_DATA} and the Officers' Mess can iterate a
 * stable order.
 */
export const CONTRACT_KEYS = [
  // Battles — story / campaign set pieces (FFTA "regular" missions)
  "break-the-bridge",
  "storm-the-farmhouse",
  "hold-the-redoubt",
  // Skirmishes — rival free companies (FFTA "encounter" missions)
  "crossed-sabres",
  "the-rival-foragers",
  "pistols-at-dawn",
  // Detachments — soldiers sent away for N days (FFTA "dispatch" missions)
  "forage-the-valley",
  "escort-the-pay-chest",
  "reconnoitre-the-ridge",
  // Pacifications — clear and hold a region (FFTA "area" missions)
  "pacify-the-coast-road",
  "clear-the-forest-bands",
  "break-the-guerrilla-camp",
] as const;

/** The stable, FFTA-shaped id of every authored contract. */
export type ContractKey = (typeof CONTRACT_KEYS)[number];

/** The schema's *input* type: defaulted fields may be omitted when authoring. */
type ContractInput = z.input<typeof ContractDefSchema>;

/** A single contract as authored, before {@link ContractDefSchema} stamps its id on. */
export type ContractData = Omit<ContractInput, "id">;

/**
 * Unparsed contract data, keyed by the stable id. `satisfies` enforces that
 * every {@link ContractKey} is authored; only fields that differ from the
 * schema defaults need to appear.
 */
const CONTRACT_DATA = {
  /* ----- Battles: story / campaign set pieces ---------------------------- */

  "break-the-bridge": {
    name: "Break the Bridge",
    description:
      "March on Sainte-Colombe and drop the stone bridge before the enemy column crosses; four soldiers and a day's powder.",
    flavour: "Whoever holds the bridge holds the road, and today the road is worth a battalion.",
    kind: "battle",
    fee: 250,
    requires: [{ kind: "unit", count: 4 }],
    reward: { crowns: 1200, ap: 60, experience: 45, honours: 2, itemIds: ["baker-rifle"] },
    regionId: "sainte-colombe",
    chapter: 1,
  },
  "storm-the-farmhouse": {
    name: "Storm the Farmhouse",
    description:
      "Sappers blow the gate and a Grenadier party clears the farmhouse held by the enemy rearguard.",
    flavour: "The farm looks quiet from the road. Farms held by desperate men always do.",
    kind: "battle",
    fee: 300,
    requires: [
      { kind: "item", id: "sappers-tools" },
      { kind: "post", id: "grenadier" },
      { kind: "unit", count: 5 },
    ],
    reward: { crowns: 1500, ap: 70, experience: 55, honours: 2, itemIds: ["congreve-rocket"] },
    regionId: "blackwood",
    chapter: 3,
  },
  "hold-the-redoubt": {
    name: "Hold the Redoubt",
    description:
      "Man the earthwork with a gun crew and hold it through the afternoon's counter-attack.",
    flavour: "A redoubt is nothing but a promise. The battery is what keeps it.",
    kind: "battle",
    fee: 220,
    requires: [
      { kind: "post", id: "artilleryman" },
      { kind: "unit", count: 4 },
    ],
    reward: { crowns: 1000, ap: 55, experience: 40, honours: 2, itemIds: ["six-pounder"] },
    regionId: "sainte-colombe",
    chapter: 4,
  },

  /* ----- Skirmishes: rival free companies --------------------------------- */

  "crossed-sabres": {
    name: "Crossed Sabres",
    description:
      "A rival company holds the crossroads and will not yield it; clear them before dusk.",
    flavour: "No war is so bitter as the one between two men who both need the same purse.",
    kind: "skirmish",
    fee: 120,
    requires: [{ kind: "unit", count: 3 }],
    reward: { crowns: 550, ap: 30, experience: 25, honours: 1, itemIds: ["cavalry-sabre"] },
    regionId: "crossroads",
  },
  "the-rival-foragers": {
    name: "The Rival Foragers",
    description:
      "Another company is stripping the same valley; see them off before the stores are gone.",
    flavour: "They call it living off the land. The land calls it something else.",
    kind: "skirmish",
    fee: 80,
    requires: [{ kind: "post", id: "forager" }],
    reward: { crowns: 350, ap: 25, experience: 20, itemIds: ["water-canteen"] },
  },
  "pistols-at-dawn": {
    name: "Pistols at Dawn",
    description:
      "A matter of honour between two companies is settled in the old way: a brace of pistols and a witness.",
    flavour: "The code is absurd, and every officer in the theatre will swear by it.",
    kind: "skirmish",
    fee: 150,
    requires: [
      { kind: "post", id: "sabreur" },
      { kind: "unit", count: 2 },
    ],
    reward: { crowns: 600, ap: 35, experience: 30, honours: 1, itemIds: ["horse-pistol"] },
  },

  /* ----- Detachments: send soldiers away for N days ---------------------- */

  "forage-the-valley": {
    name: "Forage the Valley",
    description:
      "Send a foraging party down the valley for four days to bring in hay, cattle and grain.",
    flavour: "An army marches on its stomach, and a company on whatever it can carry.",
    kind: "detachment",
    fee: 60,
    duration: 4,
    requires: [
      { kind: "post", id: "forager" },
      { kind: "unit", count: 2 },
    ],
    reward: { crowns: 300, ap: 40, experience: 25, itemIds: ["water-canteen"] },
  },
  "escort-the-pay-chest": {
    name: "Escort the Pay Chest",
    description:
      "Ride with the pay chest to the forward depot; six days on the road and a good deal of watching the hedgerows.",
    flavour: "Gold does not march, but it never travels alone.",
    kind: "detachment",
    fee: 120,
    duration: 6,
    requires: [
      { kind: "post", id: "chasseur" },
      { kind: "unit", count: 3 },
    ],
    reward: { crowns: 700, ap: 50, experience: 35, honours: 1, itemIds: ["spyglass"] },
  },
  "reconnoitre-the-ridge": {
    name: "Reconnoitre the Ridge",
    description:
      "A Scout party maps the ridge and its approaches for three days and returns with a sketch.",
    flavour: "A ridge seen from the wrong side has lost more battles than any bad general.",
    kind: "detachment",
    fee: 50,
    duration: 3,
    requires: [{ kind: "post", id: "scout" }],
    reward: { crowns: 250, ap: 45, experience: 30, honours: 1, itemIds: ["spyglass"] },
  },

  /* ----- Pacifications: clear and hold a region -------------------------- */

  "pacify-the-coast-road": {
    name: "Pacify the Coast Road",
    description:
      "Clear the coast road of raiders and deserters so the convoys can move again.",
    flavour: "The road is the region. Hold the road and the rest follows.",
    kind: "pacification",
    fee: 300,
    requires: [{ kind: "unit", count: 5 }],
    reward: { crowns: 1600, ap: 80, experience: 55, honours: 3, itemIds: ["congreve-rocket"] },
    regionId: "the-coast-road",
  },
  "clear-the-forest-bands": {
    name: "Clear the Forest Bands",
    description:
      "A Partisan leads the company against the irregular bands sheltering in the Blackwood.",
    flavour: "You cannot shell a forest into submission; someone has to walk it.",
    kind: "pacification",
    fee: 250,
    requires: [
      { kind: "post", id: "partisan" },
      { kind: "unit", count: 4 },
    ],
    reward: { crowns: 1300, ap: 75, experience: 50, honours: 2, itemIds: ["forester-bow"] },
    regionId: "blackwood",
  },
  "break-the-guerrilla-camp": {
    name: "Break the Guerrilla Camp",
    description:
      "Storm the guerrilla camp in the highlands with powder, rifles and a company willing to climb.",
    flavour: "The highlands do not belong to any army; that is precisely the problem.",
    kind: "pacification",
    fee: 400,
    requires: [
      { kind: "item", id: "powder-flask", count: 3 },
      { kind: "post", id: "chasseur" },
      { kind: "unit", count: 6 },
      { kind: "honour", count: 3 },
    ],
    reward: { crowns: 1800, ap: 100, experience: 70, honours: 3, itemIds: ["baker-rifle"] },
    regionId: "the-highlands",
    chapter: 5,
  },
} satisfies Record<ContractKey, ContractData>;

/**
 * Every contract, keyed by the stable id and validated at module load. Read
 * this instead of branching on contract ids anywhere in the engine; the
 * Officers' Mess (T071) and the campaign tests (T079) both consume the parsed
 * {@link ContractDef}.
 */
export const CONTRACTS: Record<ContractKey, ContractDef> = Object.fromEntries(
  Object.entries(CONTRACT_DATA).map(([id, def]) => [id, ContractDefSchema.parse({ id, ...def })]),
) as Record<ContractKey, ContractDef>;

/**
 * The contracts in their canonical authoring order ({@link CONTRACT_KEYS}).
 * Handy for the mission board and tests that need a stable iteration order.
 */
export const CONTRACT_LIST: readonly ContractDef[] = CONTRACT_KEYS.map((id) => CONTRACTS[id]);

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical contract key. */
export function isContractKey(value: unknown): value is ContractKey {
  return typeof value === "string" && (CONTRACT_KEYS as readonly string[]).includes(value);
}

/** Look up a contract by its canonical key. Throws on an unknown key. */
export function getContract(id: ContractKey): ContractDef {
  const contract = CONTRACTS[id];
  if (contract === undefined) {
    throw new RangeError(`unknown contract: ${String(id)}`);
  }
  return contract;
}

/** Every contract of a given kind (`battle`, `skirmish`, `detachment`, `pacification`). */
export function contractsOfKind(kind: ContractKind): readonly ContractDef[] {
  return CONTRACT_LIST.filter((contract) => contract.kind === kind);
}

/** Every contract posted for a region (`pacifications`, mostly), in canonical order. */
export function contractsForRegion(regionId: string): readonly ContractDef[] {
  return CONTRACT_LIST.filter((contract) => contract.regionId === regionId);
}

/**
 * The contracts a story at `chapter` has unlocked: those gated at or below the
 * party's progress, plus the ungated contracts that belong to no story beat.
 * Mirrors `guardSortiesForChapter` so the story spine (T077) reads the same.
 */
export function contractsForChapter(chapter: number): readonly ContractDef[] {
  if (!Number.isInteger(chapter) || chapter < 0) {
    throw new RangeError(
      `story chapter must be a non-negative integer, received ${String(chapter)}`,
    );
  }
  return CONTRACT_LIST.filter(
    (contract) => contract.chapter === undefined || contract.chapter <= chapter,
  );
}

/**
 * The requirements of a contract, in authored order. A tiny convenience so
 * menus and tests do not reach through the definition for the common field.
 */
export function requirementsOf(id: ContractKey): readonly ContractRequirement[] {
  return getContract(id).requires;
}
