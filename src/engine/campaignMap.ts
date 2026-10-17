/**
 * Campaign Map + Campaign Markers (T073) — the **Theatre** the company marches
 * across between contracts (mapping §1, §10).
 *
 * In FFTA the world map starts empty except for the starting location and is
 * *grown by the player*: winning missions awards **area tokens** (different
 * terrains and settlements), which are placed into open slots on the map of the
 * player's choice. The placement is the point — depending on where a token goes,
 * a location yields different items when the clan travels there and runs a
 * **treasure hunt** (see `docs/wiki/pages/Final_Fantasy_Tactics_Advance.md` and
 * `docs/wiki/pages/Ivalice_(Tactics_Advance).md`). That loop is the mechanical
 * contract this module preserves under the retheme:
 *
 * | FFTA                      | Tactica (mapping §1, §10)                     |
 * | ------------------------- | --------------------------------------------- |
 * | World map / The Theatre   | **Campaign Map** (`CampaignMapState`)         |
 * | Area token                | **Campaign Marker** (`CampaignMarker`)        |
 * | Map slot                  | an empty cell of the map `Grid`               |
 * | Location / area           | a placed marker's **region** (`RegionId`)     |
 * | Treasure Hunting          | {@link huntTreasure} (rewards by placement)   |
 *
 * ## The model
 *
 * ```
 *   CampaignMapState
 *   ├─ grid          ── fixed theatre rectangle (slots start empty)
 *   ├─ placements[]  ── MarkerPlacement { slot, marker }
 *   └─ huntedSlots[] ── coord keys already treasure-hunted
 *
 *   CampaignMarker
 *   ├─ id, name
 *   ├─ terrain       ── surface the token lays down (field, wood, bridge, ...)
 *   ├─ regionId      ── the region it establishes (Company.theatre.regionId)
 *   └─ treasure[]    ── TreasureRule { itemId, count, nearTerrain }
 * ```
 *
 * A {@link TreasureRule} names a `nearTerrain`; the rule fires only when a
 * *cardinally adjacent* placed marker has that terrain. A `null` `nearTerrain`
 * is always available. The same marker therefore yields different spoils in
 * different slots — that is how **placement rewards** work. Treasure hunting a
 * location is allowed once, so a hunt is a finite, deterministic discovery.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Engine purity & determinism** — framework-free, DOM-free TypeScript with
 *   no `Math.random` and no `Date`. Travel time is Manhattan distance on the
 *   integer grid (FFTA advanced one campaign day per step), so the same map,
 *   company and order of placements always produce the same result.
 * - **State in, state out** — every transition returns a **new**
 *   {@link CampaignMapState}; inputs are never mutated. Structural sharing is
 *   fine (`agents.md` §7).
 * - **Trust boundary** — {@link createCampaignMap}, {@link createCampaignMarker}
 *   and {@link parseCampaignMap} validate every field, so a corrupt save or a
 *   bad fixture fails loudly instead of poisoning the campaign.
 * - **Data-driven** — markers are plain authored values (T074 authors the real
 *   content); this module only defines the shape and the rules.
 *
 * Reference: mapping §1 (Ivalice/world map → The Theatre / Campaign Map, area
 * token → Campaign Marker), §5 (Crowns), §10 (World map + area tokens →
 * Campaign Map + Markers, "place tiles, shape the theatre, treasure hunts") and
 * `docs/wiki/pages/World_map.md`. This is original fiction inspired by the
 * Napoleonic Wars, not a port of FFTA's map data.
 */

import { advanceDay, travelTo, type Company } from "./company";
import {
  coordEquals,
  coordKey,
  createGrid,
  inBounds,
  manhattanDistance,
  neighboursInGrid,
  parseCoordKey,
  type Coord,
  type Grid,
} from "./grid";
import { assertId, type MapTokenId, type RegionId } from "./ids";
import { isTerrainType, type TerrainType } from "./terrain";

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/**
 * Largest side of a campaign map. Keeps a save bounded and the UI renderable;
 * FFTA's map is a fixed grid too, not an endless plane.
 */
export const CAMPAIGN_MAP_MAX_DIMENSION = 32;

/** Side of the blank theatre map the editor starts from. */
export const CAMPAIGN_MAP_DEFAULT_DIMENSION = 5;

/**
 * Campaign days spent reaching the map when the company has no charted region
 * to march from (a fresh company joining the theatre, mapping §10). Travel
 * between two charted regions instead costs their Manhattan distance.
 */
export const TRAVEL_DAYS_FALLBACK = 1;

/** Default spoils from a treasure rule that does not author a `count`. */
export const TREASURE_RULE_DEFAULT_COUNT = 1;

/* --------------------------------------------------------------------------
 * Treasure rules — how placement changes the loot (FFTA treasure hunting)
 * ------------------------------------------------------------------------ */

/**
 * One authored treasure rule for a {@link CampaignMarker}. When the marker is
 * placed, the rule fires if a cardinally adjacent marker has `nearTerrain` (a
 * `null` terrain always fires). The spoils are `itemId × count × matches`.
 */
export interface TreasureRule {
  /** Equipment id found by the hunt (`EquipmentKey`), plain and data-stable. */
  readonly itemId: string;
  /** Base copies found per matching neighbour (or once for a `null` rule). */
  readonly count: number;
  /**
   * Terrain an adjacent placed marker must have for this rule to fire, or
   * `null` for "always found at this location". This is the field that makes
   * **rewards depend on placement**.
   */
  readonly nearTerrain: TerrainType | null;
}

/** Authoring input for {@link createTreasureRule}. */
export interface TreasureRuleInit {
  readonly itemId: string;
  readonly count?: number;
  readonly nearTerrain?: TerrainType | null;
}

/**
 * Validate and normalise a treasure rule.
 *
 * @throws RangeError when `itemId` is malformed, `count` is not a positive
 *   integer, or `nearTerrain` is not a known terrain (or `null`).
 */
export function createTreasureRule(init: TreasureRuleInit): TreasureRule {
  assertId(init.itemId, "treasureRule.itemId");
  const count = init.count ?? TREASURE_RULE_DEFAULT_COUNT;
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(
      `treasureRule.count must be a positive integer, received ${String(count)}`,
    );
  }
  const nearTerrain = init.nearTerrain ?? null;
  if (nearTerrain !== null && !isTerrainType(nearTerrain)) {
    throw new RangeError(`treasureRule.nearTerrain is not a terrain: ${String(nearTerrain)}`);
  }
  return { itemId: init.itemId, count, nearTerrain };
}

/* --------------------------------------------------------------------------
 * Campaign markers — FFTA "area tokens"
 * ------------------------------------------------------------------------ */

/**
 * A placeable **Campaign Marker** (FFTA area token). It carries the surface it
 * lays down, the **region** it establishes and the treasure rules that decide
 * what a hunt finds once it is on the map.
 */
export interface CampaignMarker {
  /** Stable marker id, unique across the map. */
  readonly id: MapTokenId;
  /** Player-facing Napoleonic name (mapping §14, D6). */
  readonly name: string;
  /** The campaign surface this token lays down (field, wood, bridge, ...). */
  readonly terrain: TerrainType;
  /** The region the marker establishes on the company's theatre state. */
  readonly regionId: RegionId;
  /** What a treasure hunt here may find, gated by adjacent terrain. */
  readonly treasure: readonly TreasureRule[];
}

/** Authoring input for {@link createCampaignMarker}. */
export interface CampaignMarkerInit {
  readonly id: MapTokenId;
  readonly name: string;
  readonly terrain: TerrainType;
  readonly regionId: RegionId;
  readonly treasure?: readonly TreasureRuleInit[];
}

/**
 * Validate and normalise a campaign marker, so a bad fixture or save fails at
 * the boundary rather than midway through a placement.
 *
 * @throws RangeError when the id/name/region is malformed or the terrain is
 *   unknown, or when a treasure rule is invalid.
 */
export function createCampaignMarker(init: CampaignMarkerInit): CampaignMarker {
  assertId(init.id, "marker.id");
  if (typeof init.name !== "string" || init.name.trim().length === 0) {
    throw new RangeError("marker.name must be a non-empty string");
  }
  if (!isTerrainType(init.terrain)) {
    throw new RangeError(`marker.terrain is not a terrain: ${String(init.terrain)}`);
  }
  assertId(init.regionId, "marker.regionId");
  const treasure = (init.treasure ?? []).map((rule) => createTreasureRule(rule));
  return {
    id: init.id,
    name: init.name,
    terrain: init.terrain,
    regionId: init.regionId,
    treasure,
  };
}

/* --------------------------------------------------------------------------
 * Map state
 * ------------------------------------------------------------------------ */

/** A marker occupying one slot of the campaign map. */
export interface MarkerPlacement {
  /** The map cell the marker was placed into. */
  readonly slot: Coord;
  /** The placed marker (its `regionId` is the campaign region established). */
  readonly marker: CampaignMarker;
}

/** The **Campaign Map**: a fixed grid of slots plus the markers placed in it. */
export interface CampaignMapState {
  /** The theatre rectangle; slots start empty and are filled by markers. */
  readonly grid: Grid;
  /** Placed markers in placement order (deterministic). */
  readonly placements: readonly MarkerPlacement[];
  /** Coord keys already treasure-hunted, in first-hunted order. */
  readonly huntedSlots: readonly string[];
}

/** Authoring input for {@link createCampaignMap}. */
export interface CampaignMapInit {
  readonly width: number;
  readonly height: number;
  readonly placements?: readonly { readonly slot: Coord; readonly marker: CampaignMarkerInit }[];
  readonly huntedSlots?: readonly string[];
}

/** Why a marker cannot be placed in a slot (empty ⇒ it can). */
export type PlacementBlocker = "out-of-bounds" | "slot-occupied" | "marker-already-placed";

/** Thrown when an untrusted value is not a well-formed campaign map. */
export class CampaignMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignMapError";
  }
}

/* --------------------------------------------------------------------------
 * Validation internals
 * ------------------------------------------------------------------------ */

/**
 * Normalise a hunt record: every key must be a real slot on `grid`, and
 * duplicates collapse to the first occurrence (like `TheatreState`).
 */
function normalizeHuntedSlots(grid: Grid, keys: readonly string[]): readonly string[] {
  const hunted: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index] as string;
    const at = typeof key === "string" ? parseCoordKey(key) : undefined;
    if (at === undefined || !inBounds(grid, at)) {
      throw new RangeError(`campaignMap.huntedSlots[${index}] is not a map slot: ${String(key)}`);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    hunted.push(key);
  }
  return hunted;
}

/**
 * Build and validate a {@link CampaignMapState}. The map starts as an empty
 * grid; the authored placements usually contain just the company's starting
 * location, and later **Campaign Markers** fill the rest.
 *
 * @throws RangeError on a malformed dimension, an out-of-bounds/duplicate
 *   placement, a duplicate marker id or a bad marker/hunt record.
 */
export function createCampaignMap(init: CampaignMapInit): CampaignMapState {
  const grid = createGrid(init.width, init.height);
  if (grid.width > CAMPAIGN_MAP_MAX_DIMENSION || grid.height > CAMPAIGN_MAP_MAX_DIMENSION) {
    throw new RangeError(
      `campaignMap dimensions may not exceed ${CAMPAIGN_MAP_MAX_DIMENSION}, received ${grid.width}×${grid.height}`,
    );
  }

  const placements: MarkerPlacement[] = [];
  const placedSlots = new Set<string>();
  const placedMarkers = new Set<string>();
  for (let index = 0; index < (init.placements?.length ?? 0); index++) {
    const entry = init.placements?.[index] as {
      readonly slot: Coord;
      readonly marker: CampaignMarkerInit;
    };
    if (!inBounds(grid, entry.slot)) {
      throw new RangeError(
        `campaignMap.placements[${index}].slot { x: ${entry.slot.x}, y: ${entry.slot.y} } is outside the map`,
      );
    }
    const key = coordKey(entry.slot);
    if (placedSlots.has(key)) {
      throw new RangeError(`campaignMap.placements[${index}] duplicates slot ${key}`);
    }
    const marker = createCampaignMarker(entry.marker);
    if (placedMarkers.has(marker.id)) {
      throw new RangeError(`campaignMap.placements[${index}] duplicates marker ${marker.id}`);
    }
    placedSlots.add(key);
    placedMarkers.add(marker.id);
    placements.push({ slot: { x: entry.slot.x, y: entry.slot.y }, marker });
  }

  return {
    grid,
    placements,
    huntedSlots: normalizeHuntedSlots(grid, init.huntedSlots ?? []),
  };
}

/** `true` when `value` round-trips through {@link parseCampaignMap}. */
export function isCampaignMap(value: unknown): value is CampaignMapState {
  try {
    parseCampaignMap(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate an untrusted value (a save, a fixture) and return it as a fresh
 * {@link CampaignMapState}. This is the trust boundary; it throws
 * {@link CampaignMapError} when the shape is wrong.
 */
export function parseCampaignMap(value: unknown, label = "campaign map"): CampaignMapState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CampaignMapError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const grid = record.grid as { width?: unknown; height?: unknown } | undefined;
  const placements = Array.isArray(record.placements) ? record.placements : [];
  try {
    return createCampaignMap({
      width: grid?.width as number,
      height: grid?.height as number,
      placements: placements.map((entry) => {
        const placed = entry as { slot: Coord; marker: CampaignMarkerInit };
        return { slot: placed.slot, marker: placed.marker };
      }),
      huntedSlots: (record.huntedSlots as readonly string[] | undefined) ?? [],
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CampaignMapError(`${label} is not a well-formed campaign map: ${reason}`);
  }
}

/* --------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------ */

/** The marker placed at `at`, or `undefined` while the slot is empty. */
export function markerAt(map: CampaignMapState, at: Coord): CampaignMarker | undefined {
  return placementAt(map, at)?.marker;
}

/** The full placement at `at`, or `undefined` while the slot is empty. */
export function placementAt(map: CampaignMapState, at: Coord): MarkerPlacement | undefined {
  const key = coordKey(at);
  return map.placements.find((placement) => coordKey(placement.slot) === key);
}

/** The placement holding `markerId`, or `undefined` when it is still unplaced. */
export function placementForMarker(
  map: CampaignMapState,
  markerId: MapTokenId,
): MarkerPlacement | undefined {
  return map.placements.find((placement) => placement.marker.id === markerId);
}

/** The placement that established `regionId`, or `undefined` when unplaced. */
export function placementForRegion(
  map: CampaignMapState,
  regionId: RegionId,
): MarkerPlacement | undefined {
  return map.placements.find((placement) => placement.marker.regionId === regionId);
}

/** `true` while the slot at `at` holds no marker. */
export function isSlotEmpty(map: CampaignMapState, at: Coord): boolean {
  return placementAt(map, at) === undefined;
}

/** How many markers have been placed (the map "grows" by one per placement). */
export function placementCount(map: CampaignMapState): number {
  return map.placements.length;
}

/** `true` when a treasure hunt has already run at `at`. */
export function isHunted(map: CampaignMapState, at: Coord): boolean {
  return map.huntedSlots.includes(coordKey(at));
}

/** The terrains of the markers cardinally adjacent to `at`, in facing order. */
export function neighbourTerrains(map: CampaignMapState, at: Coord): readonly TerrainType[] {
  const terrains: TerrainType[] = [];
  for (const next of neighboursInGrid(map.grid, at)) {
    const placement = placementAt(map, next);
    if (placement !== undefined) terrains.push(placement.marker.terrain);
  }
  return terrains;
}

/* --------------------------------------------------------------------------
 * Placement — growing the map
 * ------------------------------------------------------------------------ */

/**
 * Every reason `marker` cannot be placed at `at`, in a stable order. An empty
 * array means {@link placeMarker} will succeed.
 *
 * | Blocker                 | Rule                                       |
 * | ----------------------- | ------------------------------------------ |
 * | `out-of-bounds`         | the slot is outside the map grid           |
 * | `slot-occupied`         | the slot already holds a marker            |
 * | `marker-already-placed` | that token has already been spent          |
 */
export function placementBlockers(
  map: CampaignMapState,
  marker: CampaignMarker,
  at: Coord,
): readonly PlacementBlocker[] {
  const blockers: PlacementBlocker[] = [];
  if (!inBounds(map.grid, at)) {
    blockers.push("out-of-bounds");
  } else if (!isSlotEmpty(map, at)) {
    blockers.push("slot-occupied");
  }
  if (placementForMarker(map, marker.id) !== undefined) {
    blockers.push("marker-already-placed");
  }
  return blockers;
}

/** `true` when {@link placeMarker} would accept `marker` at `at`. */
export function canPlaceMarker(
  map: CampaignMapState,
  marker: CampaignMarker,
  at: Coord,
): boolean {
  return placementBlockers(map, marker, at).length === 0;
}

/**
 * Place `marker` into the empty slot at `at`, returning a new map. This is the
 * "map grows" transition: the starting location is authored into
 * {@link createCampaignMap}, and every later campaign reward adds one marker.
 *
 * @throws RangeError when any {@link PlacementBlocker} applies or the marker is
 *   malformed.
 */
export function placeMarker(
  map: CampaignMapState,
  marker: CampaignMarker,
  at: Coord,
): CampaignMapState {
  const blockers = placementBlockers(map, marker, at);
  if (blockers.length > 0) {
    throw new RangeError(`cannot place marker ${marker.id}: ${blockers.join(", ")}`);
  }
  const normalized = createCampaignMarker(marker);
  return {
    ...map,
    placements: [...map.placements, { slot: { x: at.x, y: at.y }, marker: normalized }],
  };
}

/* --------------------------------------------------------------------------
 * Travel — marching the company between regions (mapping §10)
 * ------------------------------------------------------------------------ */

/** Campaign days to march between two slots, FFTA-style (one day per step). */
export function travelDays(map: CampaignMapState, from: Coord, to: Coord): number {
  if (!inBounds(map.grid, from)) {
    throw new RangeError(`from { x: ${from.x}, y: ${from.y} } is outside the campaign map`);
  }
  if (!inBounds(map.grid, to)) {
    throw new RangeError(`to { x: ${to.x}, y: ${to.y} } is outside the campaign map`);
  }
  return manhattanDistance(from, to);
}

/** A computed march between two regions on the campaign map. */
export interface TravelPlan {
  /** The region the march starts from, or `null` when off the map. */
  readonly fromRegionId: RegionId | null;
  /** The region the march ends at. */
  readonly toRegionId: RegionId;
  /** The starting slot, or `null` when the company is not on the map. */
  readonly from: Coord | null;
  /** The destination slot. */
  readonly to: Coord;
  /** Campaign days the march costs. */
  readonly days: number;
}

/**
 * Plan a march to `toRegionId`. The destination must be a placed marker; the
 * company's current region (which may be `null` or not yet on this map) sets
 * the distance. A rank company marches in {@link TRAVEL_DAYS_FALLBACK} day.
 *
 * @throws RangeError when the destination region is not placed on the map.
 */
export function travelPlan(
  map: CampaignMapState,
  fromRegionId: RegionId | null,
  toRegionId: RegionId,
): TravelPlan {
  const destination = placementForRegion(map, toRegionId);
  if (destination === undefined) {
    throw new RangeError(`region ${toRegionId} is not on the campaign map`);
  }
  const origin = fromRegionId === null ? undefined : placementForRegion(map, fromRegionId);
  const days =
    origin === undefined
      ? TRAVEL_DAYS_FALLBACK
      : coordEquals(origin.slot, destination.slot)
        ? 0
        : travelDays(map, origin.slot, destination.slot);

  return {
    fromRegionId: origin?.marker.regionId ?? null,
    toRegionId,
    from: origin?.slot ?? null,
    to: destination.slot,
    days,
  };
}

/**
 * March a company to a charted region on the campaign map: compute the plan,
 * move the company (`travelTo`, T068) and advance the campaign clock by the
 * days spent (`advanceDay`, T068) — FFTA advanced one day per map step
 * (`docs/wiki/pages/Ivalice_(Tactics_Advance).md`).
 *
 * ```ts
 * const { company } = travelCompany(company, map, asRegionId("blackwood"));
 * ```
 *
 * @throws RangeError when the destination is not on the map.
 */
export function travelCompany(
  company: Company,
  map: CampaignMapState,
  toRegionId: RegionId,
): { readonly company: Company; readonly plan: TravelPlan } {
  const plan = travelPlan(map, company.theatre.regionId, toRegionId);
  const arrived = travelTo(company, toRegionId);
  return { company: plan.days > 0 ? advanceDay(arrived, plan.days) : arrived, plan };
}

/* --------------------------------------------------------------------------
 * Treasure hunting — rewards that depend on placement (mapping §10)
 * ------------------------------------------------------------------------ */

/** One item a treasure hunt turns up at a location. */
export interface TreasureFind {
  /** The slot that was hunted. */
  readonly slot: Coord;
  /** The equipment id discovered. */
  readonly itemId: string;
  /** Copies discovered (`count × matching neighbours`). */
  readonly count: number;
  /** The terrain that made the rule fire, or `null` for an always-found rule. */
  readonly nearTerrain: TerrainType | null;
}

/**
 * Scan the location at `at` for treasure without consuming the hunt. Every
 * {@link TreasureRule} on the placed marker is evaluated against its
 * cardinally adjacent terrains: a `null` rule always fires, a terrain rule
 * fires once per adjacent marker of that terrain. The result is deterministic
 * and placement-dependent.
 *
 * Returns an empty array when no marker is placed.
 */
export function findTreasure(map: CampaignMapState, at: Coord): readonly TreasureFind[] {
  const placement = placementAt(map, at);
  if (placement === undefined) return [];

  const neighbours = neighbourTerrains(map, at);
  const finds: TreasureFind[] = [];
  for (const rule of placement.marker.treasure) {
    if (rule.nearTerrain === null) {
      finds.push({ slot: at, itemId: rule.itemId, count: rule.count, nearTerrain: null });
      continue;
    }
    const matches = neighbours.filter((terrain) => terrain === rule.nearTerrain).length;
    if (matches > 0) {
      finds.push({
        slot: at,
        itemId: rule.itemId,
        count: rule.count * matches,
        nearTerrain: rule.nearTerrain,
      });
    }
  }
  return finds;
}

/** The result of committing a treasure hunt: the finds and the updated map. */
export interface TreasureHuntResult {
  readonly map: CampaignMapState;
  readonly finds: readonly TreasureFind[];
}

/**
 * Run a treasure hunt at `at` (FFTA: travel to a location and "scan the area").
 * The spoils are {@link findTreasure}'s, and the slot is recorded as hunted so
 * a location can only be searched once. A location with no rules still consumes
 * its hunt.
 *
 * @throws RangeError when the slot is empty or has already been hunted.
 */
export function huntTreasure(map: CampaignMapState, at: Coord): TreasureHuntResult {
  if (placementAt(map, at) === undefined) {
    throw new RangeError(`cannot treasure hunt empty slot { x: ${at.x}, y: ${at.y} }`);
  }
  if (isHunted(map, at)) {
    throw new RangeError(`slot { x: ${at.x}, y: ${at.y} } has already been hunted`);
  }
  const finds = findTreasure(map, at);
  return {
    map: { ...map, huntedSlots: [...map.huntedSlots, coordKey(at)] },
    finds,
  };
}
