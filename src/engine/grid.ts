/**
 * Coordinates, the square grid and 4-directional (cardinal) facing — T013.
 *
 * The engine grid is deliberately **square**, not isometric: geometry must
 * stay render-agnostic. The "isometric" look is a presentation concern applied
 * at the edge by `src/render/iso.ts` (locked decision D10), which maps `+x`
 * down-right and `+y` down-left on screen. Because projection never leaks into
 * the engine, movement, line of sight, AI and saves all share one `Coord`.
 *
 * Contract:
 * - A {@link Coord} is a plain, JSON-serialisable `{ x, y }` object. The origin
 *   `(0, 0)` is the "north-west" corner; `x` grows east and `y` grows south.
 * - A {@link Grid} is a `width × height` rectangle of tiles. Tile `(x, y)` is
 *   in bounds when `0 ≤ x < width` and `0 ≤ y < height`; coordinates are always
 *   integers.
 * - A unit faces one of four cardinal directions (mapping §14, D10 — "keep
 *   FFTA's 4-directional facing; no hex rewrite"). Facing is axis-based, not
 *   screen-based: `north = -y`, `east = +x`, `south = +y`, `west = -x`. That
 *   keeps flank/rear maths (T037) independent of the camera.
 * - Nothing here mutates its inputs, touches the DOM or draws randomness:
 *   every function returns a fresh value. Terrain and elevation (T014) layer on
 *   top of this geometry; this module only answers "where is a tile, what is
 *   next to it, and which way is a unit looking".
 */

/* --------------------------------------------------------------------------
 * Coordinates
 * ------------------------------------------------------------------------ */

/** A tile position on the square grid. Plain, immutable and JSON-safe. */
export interface Coord {
  readonly x: number;
  readonly y: number;
}

/** Build a coordinate. Values are not validated here; grids validate bounds. */
export function coord(x: number, y: number): Coord {
  return { x, y };
}

/** Structural equality for two tiles — useful in pathfinding and target sets. */
export function coordEquals(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * A stable string key for a coordinate, for `Map`/`Set` membership without
 * object identity. The inverse is {@link parseCoordKey}.
 */
export function coordKey(at: Coord): string {
  return `${at.x},${at.y}`;
}

/** Parse a key produced by {@link coordKey}; `undefined` when malformed. */
export function parseCoordKey(key: string): Coord | undefined {
  const match = /^(-?\d+),(-?\d+)$/.exec(key);
  if (!match) return undefined;
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** Translate one coordinate by another (offset vectors, knockback, shove). */
export function addCoords(a: Coord, b: Coord): Coord {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Component-wise difference `a − b`, as a reusable offset vector. */
export function subtractCoords(a: Coord, b: Coord): Coord {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Manhattan ("taxicab") distance: the number of cardinal steps between tiles. */
export function manhattanDistance(a: Coord, b: Coord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Chebyshev distance: `max(|dx|, |dy|)`, counting diagonal steps as one. */
export function chebyshevDistance(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/* --------------------------------------------------------------------------
 * Cardinal facing (mapping §14, D10)
 * ------------------------------------------------------------------------ */

/**
 * The four directions a unit can face. Ordered clockwise starting from north,
 * so {@link rotateFacing} can move through the list arithmetically.
 */
export const FACINGS = ["north", "east", "south", "west"] as const;

/** A cardinal direction a unit looks toward. See {@link FACINGS}. */
export type Facing = (typeof FACINGS)[number];

/**
 * Grid-space offset for each facing. `north` is up the grid (`-y`) and `east`
 * is `+x`; on screen (isometric) these appear as the diamond's diagonals.
 */
export const FACING_OFFSETS: Readonly<Record<Facing, Coord>> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

/** Position of each facing in {@link FACINGS}, for rotation without `indexOf`. */
const FACING_INDEX: Readonly<Record<Facing, number>> = {
  north: 0,
  east: 1,
  south: 2,
  west: 3,
};

/** The diametrically opposite facing (front ↔ back for flank style maths). */
const OPPOSITE_FACING: Readonly<Record<Facing, Facing>> = {
  north: "south",
  east: "west",
  south: "north",
  west: "east",
};

/** Runtime guard for untrusted facing values (saves, AI, network). */
export function isFacing(value: unknown): value is Facing {
  return typeof value === "string" && (FACINGS as readonly string[]).includes(value);
}

/** The facing 180° away — used for rear/flank checks (T037). */
export function oppositeFacing(facing: Facing): Facing {
  return OPPOSITE_FACING[facing];
}

/**
 * Rotate a facing clockwise by `steps` quarter-turns. Negative values rotate
 * anticlockwise; the result always wraps, so `rotateFacing(f, 4) === f`.
 */
export function rotateFacing(facing: Facing, steps = 1): Facing {
  const start = FACING_INDEX[facing];
  const next = (((start + steps) % FACINGS.length) + FACINGS.length) % FACINGS.length;
  return FACINGS[next];
}

/** The tile one step in `facing` from `at`. The result may be out of bounds. */
export function neighbour(at: Coord, facing: Facing): Coord {
  return addCoords(at, FACING_OFFSETS[facing]);
}

/**
 * The four orthogonally adjacent tiles, in {@link FACINGS} order
 * (north, east, south, west). Out-of-bounds tiles are included; use
 * {@link neighboursInGrid} when only legal tiles matter.
 */
export function neighbours(at: Coord): Coord[] {
  return FACINGS.map((facing) => neighbour(at, facing));
}

/** The adjacent tiles that lie inside `grid`, preserving facing order. */
export function neighboursInGrid(grid: Grid, at: Coord): Coord[] {
  return neighbours(at).filter((next) => inBounds(grid, next));
}

/** Whether two tiles share an edge (diagonals do not count — no hex, no diagonals). */
export function isAdjacent(a: Coord, b: Coord): boolean {
  return manhattanDistance(a, b) === 1;
}

/**
 * The facing from `from` to an orthogonally adjacent `to`, or `undefined` when
 * they are the same tile, diagonal, or further apart. This is the primitive
 * the "face target" action (T026) and flank detection (T037) build on.
 */
export function facingTo(from: Coord, to: Coord): Facing | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) return "east";
  if (dx === -1 && dy === 0) return "west";
  if (dx === 0 && dy === 1) return "south";
  if (dx === 0 && dy === -1) return "north";
  return undefined;
}

/* --------------------------------------------------------------------------
 * The grid
 * ------------------------------------------------------------------------ */

/** Rectangular tile field, `width` tiles west→east and `height` north→south. */
export interface Grid {
  readonly width: number;
  readonly height: number;
}

/** Create a grid, validating that both dimensions are positive integers. */
export function createGrid(width: number, height: number): Grid {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`width must be a positive integer, received ${String(width)}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new RangeError(`height must be a positive integer, received ${String(height)}`);
  }
  return { width, height };
}

/** Total number of tiles in the grid. */
export function tileCount(grid: Grid): number {
  return grid.width * grid.height;
}

/**
 * Whether `at` names a tile of `grid`. Coordinates must be integers: a
 * fractional position is never a tile, even if it falls inside the rectangle.
 */
export function inBounds(grid: Grid, at: Coord): boolean {
  return (
    Number.isInteger(at.x) &&
    Number.isInteger(at.y) &&
    at.x >= 0 &&
    at.y >= 0 &&
    at.x < grid.width &&
    at.y < grid.height
  );
}

/** Assert {@link inBounds}, throwing a `RangeError` naming the offending coord. */
export function assertInBounds(grid: Grid, at: Coord, label = "coord"): void {
  if (!inBounds(grid, at)) {
    throw new RangeError(
      `${label} { x: ${at.x}, y: ${at.y} } is outside the ${grid.width}×${grid.height} grid`,
    );
  }
}

/**
 * Flatten a coordinate to a row-major index (`y * width + x`). The inverse is
 * {@link indexToCoord}. Handy for storing per-tile data in a flat array.
 */
export function coordToIndex(grid: Grid, at: Coord): number {
  assertInBounds(grid, at, "coord");
  return at.y * grid.width + at.x;
}

/** Expand a row-major index back into a coordinate. Bounds-checked. */
export function indexToCoord(grid: Grid, index: number): Coord {
  const count = tileCount(grid);
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`index must be an integer within [0, ${count}), received ${String(index)}`);
  }
  return { x: index % grid.width, y: Math.floor(index / grid.width) };
}

/**
 * Iterate every tile in row-major order (north→south, then west→east). The
 * order is fixed so any consumer that accumulates over the grid is
 * deterministic.
 */
export function* iterateCoords(grid: Grid): Generator<Coord, void, void> {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      yield { x, y };
    }
  }
}

/** Every tile of the grid as a new array in row-major order. */
export function allCoords(grid: Grid): Coord[] {
  return [...iterateCoords(grid)];
}
