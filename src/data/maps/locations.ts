/**
 * Locations of the Theatre (T074, mapping §10).
 *
 * A **Location** is a named place a detachment action is fought at and the
 * fiction around a region on the Campaign Map (T073). FFTA's world map is built
 * from placeable **area tokens**; in the retheme those tokens establish
 * **regions**, and each region's named places anchor the authored **battle
 * maps** (`./battleMaps.ts`). A location may host several maps — a picket
 * action and a camp assault in the same wood — which is why it carries a
 * `battleMapIds` list rather than a single map.
 *
 * ## Ties to the rest of the campaign
 *
 * - `regionId` is the same stable handle the campaign map (`T073`) and the
 *   contract board (`T070`, `src/data/contracts.ts`) already use
 *   (`sainte-colombe`, `blackwood`, ...). The map tests assert every battle
 *   map's `locationId` and every location's `battleMapIds` resolve, so this
 *   table and `./battleMaps.ts` cannot drift apart.
 * - `isNoMansLand` marks a lawless region (FFTA **Jagd**, mapping §9): no
 *   Provost Marshal, no Articles, no Honour, and losses are permanent
 *   (T065). The highland pass is the first of these.
 * - `chapter` gates a location to a story beat (T077); omitted means it is
 *   open from the start of the campaign.
 *
 * ## Ids vs. names
 *
 * As everywhere in `src/data/`, the **id is a stable mechanical handle**
 * (`sainte-colombe`, `the-highlands`) while the display fields carry the
 * fiction. Ids never contain a period proper noun the engine would have to
 * know about.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.**
 * - **Validated at load.** Every entry is parsed with {@link LocationDefSchema},
 *   so a mistyped terrain or a missing region fails loudly at module load.
 * - **No placeholders.** Every location carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import type { z } from "zod";

import { LocationDefSchema, type LocationDef } from "./schema";

/* --------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/**
 * The canonical location ids in authoring order. Typed as a tuple so the
 * compiler rejects a missing key in {@link LOCATION_DATA}.
 */
export const LOCATION_KEYS = [
  "sainte-colombe",
  "blackwood",
  "the-crossroads",
  "the-coast-road",
  "the-highlands",
] as const;

/** The stable id of every authored location. */
export type LocationKey = (typeof LOCATION_KEYS)[number];

/** The schema's *input* type: defaulted fields may be omitted when authoring. */
type LocationInput = z.input<typeof LocationDefSchema>;

/** A single location as authored, before {@link LocationDefSchema} stamps its id on. */
export type LocationData = Omit<LocationInput, "id">;

/**
 * Unparsed location data, keyed by the stable id. `satisfies` enforces that
 * every {@link LocationKey} is authored.
 */
const LOCATION_DATA = {
  "sainte-colombe": {
    name: "Sainte-Colombe",
    description:
      "A stone bridge over the river at the village of Sainte-Colombe, the only crossing for a day's march.",
    flavour: "Whoever holds the bridge holds the road, and today the road is worth a battalion.",
    regionId: "sainte-colombe",
    terrain: "bridge",
    battleMapIds: ["sainte-colombe-bridge"],
    chapter: 1,
  },
  blackwood: {
    name: "The Blackwood",
    description:
      "Dense forest broken by charcoal clearings and hidden tracks, shelter for irregular bands.",
    flavour: "You cannot shell a forest into submission; someone has to walk it.",
    regionId: "blackwood",
    terrain: "wood",
    battleMapIds: ["blackwood-picket", "guerrilla-camp"],
    chapter: 2,
  },
  "the-crossroads": {
    name: "The Crossroads",
    description:
      "Where three post roads meet, a bare and windswept junction worth more than the fields around it.",
    flavour: "No war is so bitter as the one between two men who both need the same purse.",
    regionId: "crossroads",
    terrain: "road",
    battleMapIds: ["crossroads-skirmish"],
  },
  "the-coast-road": {
    name: "The Coast Road",
    description:
      "A turnpike running behind the dunes, flanked by salt marsh and watched by convoys and raiders alike.",
    flavour: "The road is the region. Hold the road and the rest follows.",
    regionId: "the-coast-road",
    terrain: "road",
    battleMapIds: ["coast-road-ambush"],
  },
  "the-highlands": {
    name: "The Highlands",
    description:
      "A stony pass through bare hills, beyond the reach of any Provost Marshal or standing order.",
    flavour: "The highlands do not belong to any army; that is precisely the problem.",
    regionId: "the-highlands",
    terrain: "hill",
    battleMapIds: ["highland-pass"],
    isNoMansLand: true,
    chapter: 5,
  },
} satisfies Record<LocationKey, LocationData>;

/**
 * Every location, keyed by the stable id and validated at module load. Read
 * this instead of branching on location ids anywhere in the engine.
 */
export const LOCATIONS: Record<LocationKey, LocationDef> = Object.fromEntries(
  Object.entries(LOCATION_DATA).map(([id, def]) => [id, LocationDefSchema.parse({ id, ...def })]),
) as Record<LocationKey, LocationDef>;

/** The locations in their canonical authoring order ({@link LOCATION_KEYS}). */
export const LOCATION_LIST: readonly LocationDef[] = LOCATION_KEYS.map((id) => LOCATIONS[id]);

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical location key. */
export function isLocationKey(value: unknown): value is LocationKey {
  return typeof value === "string" && (LOCATION_KEYS as readonly string[]).includes(value);
}

/** Look up a location by its canonical key. Throws on an unknown key. */
export function getLocation(id: LocationKey): LocationDef {
  const location = LOCATIONS[id];
  if (location === undefined) {
    throw new RangeError(`unknown location: ${String(id)}`);
  }
  return location;
}

/** Every location that establishes `regionId`, in canonical order. */
export function locationsForRegion(regionId: string): readonly LocationDef[] {
  return LOCATION_LIST.filter((location) => location.regionId === regionId);
}

/** The locations the story has unlocked at `chapter` (T077). */
export function locationsForChapter(chapter: number): readonly LocationDef[] {
  if (!Number.isInteger(chapter) || chapter < 0) {
    throw new RangeError(
      `story chapter must be a non-negative integer, received ${String(chapter)}`,
    );
  }
  return LOCATION_LIST.filter(
    (location) => location.chapter === undefined || location.chapter <= chapter,
  );
}
