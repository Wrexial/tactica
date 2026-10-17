/**
 * Battle maps (T074, mapping §10/§12).
 *
 * A **Battle Map** is the board a detachment action is fought on: a rectangle
 * of terrain and elevation, the starting tiles for each side, and the action's
 * win condition. It hangs off a **Location** (`./locations.ts`) and, where one
 * posts it, an Officers' Mess **Contract** (`src/data/contracts.ts`, T070).
 *
 * FFTA's maps are hand-authored boards with an imposed mission goal — defeat
 * all, survive N turns, hold a spot (see `docs/wiki/pages/Mission.md`). The
 * retheme keeps that shape at **detachment scale** (mapping §0): break a bridge,
 * clear a picket line, endure an ambush on the coast road, hold a highland pass
 * where no Provost rides.
 *
 * ## Reading a map
 *
 * Each map's `layout` is one string per row, north→south, with each character a
 * terrain surface (the legend lives in `./schema.ts`, `MAP_TERRAIN_CHARS`):
 *
 * ```
 *   . field     = road      % wood      # village
 *   ~ river     , marsh     ^ hill      O redoubt
 *   W wall      x rubble    B bridge    R rooftop
 * ```
 *
 * `elevation`, when present, is an optional second layer of the same shape
 * using the codes `0`–`9` and `a`–`f` (`0`–`15`, matching the engine's
 * elevation). Omit it for a flat board. `deployment` lists the tiles each side
 * may start on and `objective` is the action's win condition; both are bounds
 * checked against the grid by {@link BattleMapDefSchema}.
 *
 * The schemas themselves live in `./schema.ts`; this module is the authored
 * table. `./layout.ts` expands a map into engine-shaped tiles. Ids are stable
 * mechanical handles; the display fields carry the fiction.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** `battleMapToTerrainMap` returns a
 *   structurally-compatible `TerrainMap` without the data layer importing the
 *   engine.
 * - **Validated at load.** Every map is parsed with {@link BattleMapDefSchema},
 *   so a ragged row, an unknown terrain code or an out-of-bounds deployment
 *   tile fails loudly at module load.
 * - **No placeholders.** Every map carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import type { z } from "zod";

import duelAtDawnJson from "./duel-at-dawn.json";
import farmhouseAssaultJson from "./farmhouse-assault.json";
import greenValleyForageJson from "./green-valley-forage.json";
import millfordCrossingJson from "./millford-crossing.json";
import orchardSkirmishJson from "./orchard-skirmish.json";
import payChestEscortJson from "./pay-chest-escort.json";
import redoubtStandJson from "./redoubt-stand.json";
import ridgeReconnaissanceJson from "./ridge-reconnaissance.json";
import { BattleMapDefSchema, type BattleMapDef, type BattleMapObjective } from "./schema";

/* --------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/**
 * The canonical battle-map ids in authoring order. Typed as a tuple so the
 * compiler rejects a missing key in {@link BATTLE_MAP_DATA}.
 */
export const BATTLE_MAP_KEYS = [
  "sainte-colombe-bridge",
  "blackwood-picket",
  "guerrilla-camp",
  "crossroads-skirmish",
  "coast-road-ambush",
  "highland-pass",
  "farmhouse-assault",
  "redoubt-stand",
  "orchard-skirmish",
  "duel-at-dawn",
  "green-valley-forage",
  "pay-chest-escort",
  "ridge-reconnaissance",
  "millford-crossing",
] as const;

/** The stable id of every authored battle map. */
export type BattleMapKey = (typeof BATTLE_MAP_KEYS)[number];

/** The schema's *input* type: defaulted fields may be omitted when authoring. */
type BattleMapInput = z.input<typeof BattleMapDefSchema>;

/** A single map as authored, before {@link BattleMapDefSchema} stamps its id on. */
export type BattleMapData = Omit<BattleMapInput, "id">;

/**
 * The board ids authored as standalone JSON files in this directory (T092).
 * JSON keeps a large grid easier to diff and hand-edit than a TypeScript
 * literal; the schema validates it exactly as it does the TS entries, so the
 * two authoring styles are interchangeable.
 */
export const JSON_BATTLE_MAP_KEYS = [
  "farmhouse-assault",
  "redoubt-stand",
  "orchard-skirmish",
  "duel-at-dawn",
  "green-valley-forage",
  "pay-chest-escort",
  "ridge-reconnaissance",
  "millford-crossing",
] as const;

/** The stable id of a JSON-authored battle map. */
export type JsonBattleMapKey = (typeof JSON_BATTLE_MAP_KEYS)[number];

/**
 * Validate a JSON-authored board and pin its `id` to the canonical key. The
 * file name is the handle; a mismatch fails loudly at module load rather than
 * silently registering the map under the wrong id.
 */
function parseJsonBattleMap(id: JsonBattleMapKey, raw: unknown): BattleMapDef {
  const parsed = BattleMapDefSchema.parse(raw);
  if (parsed.id !== id) {
    throw new Error(
      `battle map ${id} is authored in JSON with id "${parsed.id}"; the file name and id must match`,
    );
  }
  return parsed;
}

/**
 * The JSON-authored boards, parsed at module load. A {@link BattleMapDef} is
 * assignable to {@link BattleMapData} (its fields are the schema's output, and
 * a required field satisfies an optional one), so the table can merge both
 * authoring styles without a cast.
 */
const JSON_BATTLE_MAP_DATA: Record<JsonBattleMapKey, BattleMapData> = {
  "farmhouse-assault": parseJsonBattleMap("farmhouse-assault", farmhouseAssaultJson),
  "redoubt-stand": parseJsonBattleMap("redoubt-stand", redoubtStandJson),
  "orchard-skirmish": parseJsonBattleMap("orchard-skirmish", orchardSkirmishJson),
  "duel-at-dawn": parseJsonBattleMap("duel-at-dawn", duelAtDawnJson),
  "green-valley-forage": parseJsonBattleMap("green-valley-forage", greenValleyForageJson),
  "pay-chest-escort": parseJsonBattleMap("pay-chest-escort", payChestEscortJson),
  "ridge-reconnaissance": parseJsonBattleMap("ridge-reconnaissance", ridgeReconnaissanceJson),
  "millford-crossing": parseJsonBattleMap("millford-crossing", millfordCrossingJson),
};

/**
 * Unparsed map data, keyed by the stable id. `satisfies` enforces that every
 * {@link BattleMapKey} is authored.
 */
const BATTLE_MAP_DATA = {
  /* ----- Sainte-Colombe: the stone bridge -------------------------------- */

  "sainte-colombe-bridge": {
    name: "The Bridge at Sainte-Colombe",
    description:
      "A twelve-by-nine field split by a river crossed only at the central stone bridge. Take and hold the span before the enemy column arrives.",
    flavour: "One arch of stone decides whether an army marches or drowns.",
    locationId: "sainte-colombe",
    width: 12,
    height: 9,
    layout: [
      "....%%......",
      "....%%......",
      "....%%......",
      ".....~......",
      ".....B......",
      ".....~......",
      ".........##.",
      ".........##.",
      "............",
    ],
    elevation: [
      "000000000000",
      "000000000000",
      "000000000000",
      "000000000000",
      "000000000000",
      "000000000000",
      "000000001000",
      "000000002000",
      "000000000000",
    ],
    deployment: [
      {
        side: "company",
        tiles: [
          { x: 1, y: 3 },
          { x: 1, y: 4 },
          { x: 1, y: 5 },
          { x: 2, y: 4 },
        ],
      },
      {
        side: "enemy",
        tiles: [
          { x: 10, y: 3 },
          { x: 10, y: 4 },
          { x: 10, y: 5 },
          { x: 9, y: 4 },
        ],
      },
    ],
    objective: { kind: "capture", at: { x: 5, y: 4 } },
    recommendedLevel: 1,
    contractId: "break-the-bridge",
  },

  /* ----- The Blackwood: a picket line in the trees ----------------------- */

  "blackwood-picket": {
    name: "The Blackwood Picket",
    description:
      "A ten-by-eight thicket of close woods and boggy rides. Break the picket line screening the charcoal burners.",
    flavour: "The trees hide a hundred men until they are ten paces off.",
    locationId: "blackwood",
    width: 10,
    height: 8,
    layout: [
      "....%%%%%%",
      "..%.%%%%%%",
      "....%%%%%%",
      ",,,,..%%%%",
      ",,,,..%%%%",
      "....%%%%%%",
      "..%.%%%%%%",
      "....%%%%%%",
    ],
    deployment: [
      {
        side: "company",
        tiles: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      },
      {
        side: "enemy",
        tiles: [
          { x: 8, y: 7 },
          { x: 9, y: 7 },
          { x: 9, y: 6 },
        ],
      },
    ],
    objective: { kind: "rout", defeated: 3 },
    recommendedLevel: 2,
    contractId: "clear-the-forest-bands",
  },

  /* ----- The Blackwood: the guerrilla camp ------------------------------- */

  "guerrilla-camp": {
    name: "The Guerrilla Camp",
    description:
      "A ten-by-eight clearing ringed by felled timber and earthworks. Storm the camp and leave none to rally.",
    flavour: "A camp is only safe when no one is left to avenge it.",
    locationId: "blackwood",
    width: 10,
    height: 8,
    layout: [
      "%%%.......",
      "%%...xx...",
      "%....OO...",
      ".....OO...",
      "..........",
      "...xx.....",
      "..xx......",
      "%%........",
    ],
    deployment: [
      {
        side: "company",
        tiles: [
          { x: 0, y: 4 },
          { x: 1, y: 4 },
          { x: 0, y: 5 },
        ],
      },
      {
        side: "enemy",
        tiles: [
          { x: 5, y: 2 },
          { x: 6, y: 2 },
          { x: 5, y: 3 },
          { x: 6, y: 3 },
        ],
      },
    ],
    objective: { kind: "annihilation" },
    recommendedLevel: 3,
    contractId: "break-the-guerrilla-camp",
  },

  /* ----- The Crossroads: a rival company's stand ------------------------- */

  "crossroads-skirmish": {
    name: "The Crossroads Stand",
    description:
      "An eleven-by-nine junction of post roads. Hold the centre against a rival free company until the stores are clear.",
    flavour: "Two companies, one road, and no gentleman among the officers.",
    locationId: "the-crossroads",
    width: 11,
    height: 9,
    layout: [
      "....===....",
      "....===....",
      "....===....",
      "===========",
      "....===....",
      "....===....",
      "....===....",
      "...........",
      "...........",
    ],
    deployment: [
      {
        side: "company",
        tiles: [
          { x: 0, y: 3 },
          { x: 1, y: 3 },
          { x: 2, y: 3 },
        ],
      },
      {
        side: "enemy",
        tiles: [
          { x: 8, y: 3 },
          { x: 9, y: 3 },
          { x: 10, y: 3 },
        ],
      },
    ],
    objective: { kind: "survive", turns: 6 },
    recommendedLevel: 2,
    contractId: "crossed-sabres",
  },

  /* ----- The Coast Road: an ambush in the marsh -------------------------- */

  "coast-road-ambush": {
    name: "The Coast Road Ambush",
    description:
      "A twelve-by-eight turnpike between dune wood and salt marsh. Break the raiders before they can slip back to the shore.",
    flavour: "The dunes swallow a running man; the marsh swallows everyone.",
    locationId: "the-coast-road",
    width: 12,
    height: 8,
    layout: [
      "....%%%%....",
      "....%%%%....",
      "............",
      "============",
      "............",
      ",,,,........",
      ",,,,........",
      "............",
    ],
    deployment: [
      {
        side: "company",
        tiles: [
          { x: 0, y: 4 },
          { x: 1, y: 4 },
          { x: 2, y: 4 },
        ],
      },
      {
        side: "enemy",
        tiles: [
          { x: 9, y: 4 },
          { x: 10, y: 4 },
          { x: 11, y: 4 },
        ],
      },
    ],
    objective: { kind: "rout", defeated: 4 },
    recommendedLevel: 3,
    contractId: "pacify-the-coast-road",
  },

  /* ----- The Highlands: No-Man's Land ------------------------------------ */

  "highland-pass": {
    name: "The Highland Pass",
    description:
      "A ten-by-ten pass walled by high ground. Hold the track for four turns; no Provost rides this far, so a downed soldier is a lost one.",
    flavour: "Beyond the last picket there is no law but the weather and the enemy.",
    locationId: "the-highlands",
    width: 10,
    height: 10,
    layout: [
      "^^^^^^^^^^",
      "^^^^..^^^^",
      "^^^....^^^",
      "^^......^^",
      "xx......xx",
      "xx......xx",
      "^^......^^",
      "^^^....^^^",
      "^^^^..^^^^",
      "^^^^^^^^^^",
    ],
    elevation: [
      "2111111112",
      "1111001111",
      "1110000111",
      "1100000011",
      "1100000011",
      "1100000011",
      "1100000011",
      "1110000111",
      "1111001111",
      "2111111112",
    ],
    deployment: [
      {
        side: "company",
        tiles: [
          { x: 4, y: 7 },
          { x: 5, y: 7 },
          { x: 4, y: 6 },
        ],
      },
      {
        side: "enemy",
        tiles: [
          { x: 4, y: 2 },
          { x: 5, y: 2 },
          { x: 4, y: 3 },
        ],
      },
    ],
    objective: { kind: "defend", at: { x: 4, y: 4 }, turns: 4 },
    recommendedLevel: 4,
  },

  /* ----- JSON-authored boards (T092) ------------------------------------- */
  // The grids large enough to be painful in TS live in sibling `*.json` files
  // and are merged in here after validation; see {@link JSON_BATTLE_MAP_KEYS}.
  ...JSON_BATTLE_MAP_DATA,
} satisfies Record<BattleMapKey, BattleMapData>;

/**
 * Every battle map, keyed by the stable id and validated at module load. Read
 * this instead of branching on map ids anywhere in the engine; deployment and
 * the campaign layer consume the parsed {@link BattleMapDef}.
 */
export const BATTLE_MAPS: Record<BattleMapKey, BattleMapDef> = Object.fromEntries(
  Object.entries(BATTLE_MAP_DATA).map(([id, def]) => [
    id,
    // The canonical key wins over any `id` inside the raw map, so a JSON file
    // can be validated and registered without trusting its own handle.
    BattleMapDefSchema.parse({ ...def, id }),
  ]),
) as Record<BattleMapKey, BattleMapDef>;

/** The maps in their canonical authoring order ({@link BATTLE_MAP_KEYS}). */
export const BATTLE_MAP_LIST: readonly BattleMapDef[] = BATTLE_MAP_KEYS.map(
  (id) => BATTLE_MAPS[id],
);

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical battle-map key. */
export function isBattleMapKey(value: unknown): value is BattleMapKey {
  return typeof value === "string" && (BATTLE_MAP_KEYS as readonly string[]).includes(value);
}

/** Look up a battle map by its canonical key. Throws on an unknown key. */
export function getBattleMap(id: BattleMapKey): BattleMapDef {
  const map = BATTLE_MAPS[id];
  if (map === undefined) {
    throw new RangeError(`unknown battle map: ${String(id)}`);
  }
  return map;
}

/** Every battle map fought at `locationId`, in canonical order. */
export function battleMapsForLocation(locationId: string): readonly BattleMapDef[] {
  return BATTLE_MAP_LIST.filter((map) => map.locationId === locationId);
}

/** The maps authored for `contractId`, in canonical order. */
export function battleMapsForContract(contractId: string): readonly BattleMapDef[] {
  return BATTLE_MAP_LIST.filter((map) => map.contractId === contractId);
}

/** A map's win/lose objective (a convenience for the scenario/deployment code). */
export function battleMapObjective(id: BattleMapKey): BattleMapObjective {
  return getBattleMap(id).objective;
}
