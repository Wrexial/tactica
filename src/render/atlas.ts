/**
 * Battlefield texture atlas & memory budget (T105 — performance pass).
 *
 * The battlefield draws two things over and over: **terrain surfaces** (twelve
 * types × four deterministic variants) and **soldier figures** (five powers ×
 * role categories × four facings). `scene.ts` currently rebuilds those shapes
 * as Pixi `Graphics` on every repaint. This module is the groundwork for
 * baking each *distinct* shape into a GPU texture **once** and reusing it, so a
 * large board costs one sprite per tile instead of one vector rebuild per tile.
 *
 * Three concerns, kept apart on purpose:
 *
 * 1. **Texture atlas (frame vocabulary + packing).** {@link terrainFrameKey}
 *    and {@link unitFigureKey} name every frame deterministically;
 *    {@link packFrames} lays frames out into one sheet (a shelf packer, pure
 *    integer maths) and returns each frame's {@link AtlasRect}.
 * 2. **Lazy loading.** {@link SpriteAtlas} bakes a frame only when it is first
 *    requested ({@link SpriteAtlas.acquire}) and never touches the others.
 *    {@link TerrainAtlas.loadMap} warms exactly the terrain variants a given
 *    {@link TerrainMap} uses — not the full 48-frame cross-product — and
 *    {@link TerrainAtlas.requiredKeys} reports that set without baking so a
 *    loading screen can size the job.
 * 3. **Memory check.** Every frame records its RGBA8 byte cost
 *    ({@link estimateTextureBytes}); the atlas enforces a byte budget by
 *    evicting the least-recently-used frame and destroying its texture.
 *    {@link memoryReport} turns the live numbers into an `ok` / `warn` / `over`
 *    verdict for logging and tests.
 *
 * ## Why this is Pixi-free
 *
 * Like `tiles.ts` and `units.ts`, this module knows nothing about Pixi or the
 * DOM. It deals in {@link AtlasTexture} handles — `{ width, height, destroy }`,
 * which Pixi's `Texture` satisfies structurally — and in plain frame
 * rectangles. The actual `renderer.generateTexture(...)` call is supplied by
 * `scene.ts` through the `bake` callback of {@link createTerrainAtlas}. That
 * keeps the whole performance surface unit-testable in Node with fabricated
 * textures, and preserves the render layer's split between "what to draw" and
 * "how to draw it" (`agents.md` §2, §7).
 *
 * ## Determinism
 *
 * Every key, every packed rectangle and every byte count is a pure function of
 * its inputs: frames are sorted by a stable comparison, variants come from the
 * seed-free {@link terrainVariant}, and no `Math.random` or clock is read
 * (`agents.md` §2). The same map always produces the same atlas layout.
 */

import { allCoords, type Coord, type Facing } from "../engine/grid";
import { terrainTileAt, type TerrainMap, type TerrainType } from "../engine/terrain";
import type { PowerKey } from "../data/schema";
import { TILE_HEIGHT, TILE_WIDTH, terrainVariant } from "./tiles";

/* --------------------------------------------------------------------------
 * Texture handles & memory maths
 * ------------------------------------------------------------------------ */

/**
 * The minimum a baked frame must expose to live in the atlas: its pixel size
 * and a `destroy` hook. Pixi's `Texture` satisfies this structurally, so this
 * module never has to import Pixi.
 */
export interface AtlasTexture {
  readonly width: number;
  readonly height: number;
  destroy(): void;
}

/** Bytes per pixel of the RGBA8 render targets the atlas bakes into. */
export const ATLAS_BYTES_PER_PIXEL = 4;

/**
 * Default per-atlas budget: 32 MiB. A full 32×32 board is 1024 tiles; even at
 * a generous 128×96 frames that is ~48 MiB if every variant is kept, so the
 * budget is a backstop, not the expected steady state (eviction keeps the
 * working set far below it).
 */
export const DEFAULT_ATLAS_BUDGET_BYTES = 32 * 1024 * 1024;

/** Fraction of the budget at which {@link memoryReport} reports `warn`. */
export const ATLAS_WARN_RATIO = 0.9;

/** Gutter (pixels) left between packed frames so bilinear sampling cannot bleed. */
export const ATLAS_PADDING = 2;

/**
 * RGBA8 byte cost of a `width × height` texture. Rounds up to whole pixels and
 * never returns a negative or `NaN` figure, so a malformed texture reports
 * `0` bytes rather than poisoning the running total.
 */
export function estimateTextureBytes(
  width: number,
  height: number,
  bytesPerPixel: number = ATLAS_BYTES_PER_PIXEL,
): number {
  const w = Number.isFinite(width) ? Math.max(0, Math.ceil(width)) : 0;
  const h = Number.isFinite(height) ? Math.max(0, Math.ceil(height)) : 0;
  const bpp = Number.isFinite(bytesPerPixel) ? Math.max(0, bytesPerPixel) : ATLAS_BYTES_PER_PIXEL;
  return w * h * bpp;
}

/** Human-readable byte count for logs and the memory report. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/* --------------------------------------------------------------------------
 * Lazy, memory-bounded frame cache
 * ------------------------------------------------------------------------ */

/** One baked frame: its key, texture handle and RGBA8 byte cost. */
export interface AtlasFrame<T extends AtlasTexture = AtlasTexture> {
  readonly key: string;
  readonly texture: T;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

/** Construction options for {@link SpriteAtlas}. */
export interface SpriteAtlasOptions<T extends AtlasTexture = AtlasTexture> {
  /** Byte ceiling before LRU eviction starts. Defaults to 32 MiB. */
  readonly maxBytes?: number;
  /** Bytes charged per pixel; override only for non-RGBA targets. */
  readonly bytesPerPixel?: number;
  /**
   * Notification fired for each removed frame (evicted, released, cleared or
   * disposed), after it is destroyed.
   */
  readonly onEvict?: (frame: AtlasFrame<T>) => void;
}

/** Coerce an optional numeric option to a finite non-negative number. */
function nonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * A lazily-populated, memory-bounded cache of baked textures keyed by frame
 * name.
 *
 * Ownership is explicit: the atlas creates textures through the `bake` callback
 * passed to {@link acquire}, so it also **destroys** them on eviction, release,
 * clear and dispose. A frame is therefore never leaked, and a caller that
 * holds an {@link AtlasFrame} beyond an eviction is holding a dead handle —
 * re-`acquire` it.
 *
 * Eviction is least-recently-used: {@link get} and a cache-hit {@link acquire}
 * both move a frame to the back of the queue, so the shapes a map keeps drawing
 * stay resident while one-off frames fall out first.
 */
export class SpriteAtlas<T extends AtlasTexture = AtlasTexture> {
  private readonly entries = new Map<string, AtlasFrame<T>>();
  private readonly bytesPerPixel: number;
  private readonly onEvict: ((frame: AtlasFrame<T>) => void) | undefined;
  private totalBytes = 0;

  /** The byte ceiling this atlas enforces. */
  readonly maxBytes: number;

  constructor(options: SpriteAtlasOptions<T> = {}) {
    this.maxBytes = nonNegative(options.maxBytes, DEFAULT_ATLAS_BUDGET_BYTES);
    this.bytesPerPixel = nonNegative(options.bytesPerPixel, ATLAS_BYTES_PER_PIXEL);
    this.onEvict = options.onEvict;
  }

  /** Number of resident frames. */
  get size(): number {
    return this.entries.size;
  }

  /** Bytes currently charged against the budget. */
  get bytes(): number {
    return this.totalBytes;
  }

  /** Whether `key` is resident (does not affect recency). */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * The resident frame for `key`, touching it (marking it most-recently-used),
   * or `undefined` when it has not been baked or has been evicted.
   */
  get(key: string): AtlasFrame<T> | undefined {
    const frame = this.entries.get(key);
    if (frame === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, frame);
    return frame;
  }

  /**
   * Return the frame for `key`, baking it with `bake` on first use. The frame
   * is charged to the budget as soon as it is stored; if that pushes the atlas
   * over budget the oldest other frames are evicted and destroyed. The frame
   * just baked is always kept (it is the most recent) — if a *single* frame is
   * larger than the whole budget the atlas reports `over` rather than thrash.
   */
  acquire(key: string, bake: () => T): AtlasFrame<T> {
    const existing = this.get(key);
    if (existing !== undefined) return existing;

    const texture = bake();
    const bytes = estimateTextureBytes(texture.width, texture.height, this.bytesPerPixel);
    const frame: AtlasFrame<T> = Object.freeze({
      key,
      texture,
      width: texture.width,
      height: texture.height,
      bytes,
    });
    this.entries.set(key, frame);
    this.totalBytes += bytes;
    this.evictToBudget();
    return frame;
  }

  /**
   * Drop `key` from the atlas, destroying its texture. Returns whether the
   * frame was resident.
   */
  release(key: string): boolean {
    const frame = this.entries.get(key);
    if (frame === undefined) return false;
    this.entries.delete(key);
    this.totalBytes -= frame.bytes;
    if (this.totalBytes < 0) this.totalBytes = 0;
    frame.texture.destroy();
    this.onEvict?.(frame);
    return true;
  }

  /** Evict and destroy every resident frame. */
  clear(): void {
    for (const frame of this.entries.values()) {
      frame.texture.destroy();
      this.onEvict?.(frame);
    }
    this.entries.clear();
    this.totalBytes = 0;
  }

  /** Alias for {@link clear}; the atlas owns and disposes every texture. */
  dispose(): void {
    this.clear();
  }

  /** Resident frame keys, least-recently-used first. */
  keys(): readonly string[] {
    return [...this.entries.keys()];
  }

  /** Evict from the front of the LRU queue until the budget is met. */
  private evictToBudget(): void {
    for (const [key, frame] of this.entries) {
      if (this.totalBytes <= this.maxBytes) break;
      // Never evict the frame just added / the only frame: a single oversized
      // texture is a configuration problem the memory report surfaces.
      if (this.entries.size <= 1) break;
      this.entries.delete(key);
      this.totalBytes -= frame.bytes;
      frame.texture.destroy();
      this.onEvict?.(frame);
    }
  }
}

/* --------------------------------------------------------------------------
 * Memory check / reporting
 * ------------------------------------------------------------------------ */

/** A snapshot of an atlas's memory use. */
export interface AtlasStats {
  readonly frames: number;
  readonly bytes: number;
  readonly maxBytes: number;
  /** `bytes / maxBytes`, clamped to `[0, 1]` for display. */
  readonly utilization: number;
  readonly keys: readonly string[];
}

/** Budget verdict: under, near, or over the ceiling. */
export type MemoryLevel = "ok" | "warn" | "over";

/** {@link AtlasStats} plus the budget verdict and a log line. */
export interface MemoryReport extends AtlasStats {
  readonly level: MemoryLevel;
  readonly summary: string;
}

/** Snapshot an atlas's frame count, byte use and resident keys. */
export function atlasStats<T extends AtlasTexture>(atlas: SpriteAtlas<T>): AtlasStats {
  const utilization = atlas.maxBytes > 0 ? atlas.bytes / atlas.maxBytes : 0;
  return {
    frames: atlas.size,
    bytes: atlas.bytes,
    maxBytes: atlas.maxBytes,
    utilization: Math.min(1, Math.max(0, utilization)),
    keys: atlas.keys(),
  };
}

/**
 * Turn the live atlas numbers into a budget verdict. `over` means a frame
 * could not fit and the atlas is holding more than its budget (a single frame
 * larger than the budget, or a budget set to zero); `warn` means it is at or
 * past {@link ATLAS_WARN_RATIO}; otherwise `ok`.
 */
export function memoryReport<T extends AtlasTexture>(atlas: SpriteAtlas<T>): MemoryReport {
  const stats = atlasStats(atlas);
  const level: MemoryLevel =
    stats.bytes > stats.maxBytes ? "over" : stats.utilization >= ATLAS_WARN_RATIO ? "warn" : "ok";
  const summary =
    `atlas ${level}: ${stats.frames} frame${stats.frames === 1 ? "" : "s"}, ` +
    `${formatBytes(stats.bytes)} / ${formatBytes(stats.maxBytes)} ` +
    `(${Math.round(stats.utilization * 100)}%)`;
  return { ...stats, level, summary };
}

/* --------------------------------------------------------------------------
 * Frame vocabulary
 * ------------------------------------------------------------------------ */

/**
 * Terrain frames are boxed slightly larger than one tile so the decorations
 * (`tileDecorations`) — tree canopies, chimneys, parapets — are not clipped.
 * The tile's top-face centre sits at `(originX, originY)` inside the frame;
 * `scene.ts` positions the sprite by that anchor. Elevation side faces are
 * **not** baked into the frame: they depend on the tile's height and the
 * neighbouring tiles, so `scene.ts` keeps drawing them per tile.
 */
export const TERRAIN_FRAME_WIDTH = TILE_WIDTH + 64; // 128
export const TERRAIN_FRAME_HEIGHT = TILE_HEIGHT + 64; // 96
export const TERRAIN_FRAME_ORIGIN_X = TERRAIN_FRAME_WIDTH / 2; // 64
export const TERRAIN_FRAME_ORIGIN_Y = 40;

/**
 * Unit frames hold the figure, its ground glow, the HP / Élan bars, the Honour
 * pips and the condition icons (see `unitDrawOps`). The soldier's feet sit at
 * `(originX, originY)`; bars and icons extend upward into the top margin.
 * Status values are **not** part of the baked frame — a soldier changes HP
 * every exchange — so callers bake the figure and overdraw the status readout,
 * or key the frame by the presentation they want.
 */
export const UNIT_FRAME_WIDTH = 64;
export const UNIT_FRAME_HEIGHT = 112;
export const UNIT_FRAME_ORIGIN_X = UNIT_FRAME_WIDTH / 2; // 32
export const UNIT_FRAME_ORIGIN_Y = 88;

/** Normalise a variant index the same way `tileDecorations` does (0–3). */
export function normalizeVariant(variant: number): number {
  return Math.abs(Math.trunc(Number.isFinite(variant) ? variant : 0)) % 4;
}

/**
 * Deterministic frame name for one terrain surface + decoration variant.
 * `#` is not a legal character in an id, so the key cannot collide with a unit
 * frame key (which uses `|`).
 */
export function terrainFrameKey(terrain: TerrainType, variant: number): string {
  return `${terrain}#${normalizeVariant(variant)}`;
}

/**
 * Deterministic frame name for one soldier figure. Keyed on the things that
 * change the *shape* — power (uniform), post (role/weapon) and facing — not on
 * HP, Élan or conditions, which change every turn and must stay dynamic.
 */
export function unitFigureKey(figure: {
  readonly power: PowerKey;
  readonly postId: string;
  readonly facing: Facing;
}): string {
  return `${figure.power}|${figure.postId}|${figure.facing}`;
}

/** One distinct terrain frame a map needs, with its decoded parts. */
export interface TerrainFrameEntry {
  readonly key: string;
  readonly terrain: TerrainType;
  readonly variant: number;
  /** A representative tile, handy for diagnostics. */
  readonly at: Coord;
}

/**
 * The distinct terrain frames a map uses, in first-seen (row-major) order.
 * Pure and cheap: it reads the map's terrain and variation but bakes nothing,
 * so a loading screen can size the atlas job before any GPU work happens.
 */
export function terrainFrameEntries(map: TerrainMap): readonly TerrainFrameEntry[] {
  const entries: TerrainFrameEntry[] = [];
  const seen = new Set<string>();
  for (const at of allCoords(map.grid)) {
    const terrain = terrainTileAt(map, at).terrain;
    const variant = normalizeVariant(terrainVariant(at.x, at.y));
    const key = terrainFrameKey(terrain, variant);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ key, terrain, variant, at });
  }
  return entries;
}

/** The distinct frame keys a map uses ({@link terrainFrameEntries}, names only). */
export function terrainFrameKeys(map: TerrainMap): readonly string[] {
  return terrainFrameEntries(map).map((entry) => entry.key);
}

/* --------------------------------------------------------------------------
 * Atlas sheet packing
 * ------------------------------------------------------------------------ */

/** A frame to pack: a name and its pixel footprint. */
export interface AtlasFrameRequest {
  readonly key: string;
  readonly width: number;
  readonly height: number;
}

/** A packed frame's position and size within the sheet. */
export interface AtlasRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A completed sheet layout: its size and each frame's rectangle. */
export interface AtlasPacking {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
  readonly frames: ReadonlyMap<string, AtlasRect>;
}

/** Options for {@link packFrames}. */
export interface PackFramesOptions {
  /** Gutter between frames (default {@link ATLAS_PADDING}). */
  readonly padding?: number;
  /** Wrap to a new shelf once the row would pass this width. */
  readonly maxWidth?: number;
  /** Round the sheet up to power-of-two dimensions (GPU-friendly). */
  readonly powerOfTwo?: boolean;
}

/** The smallest power of two `>= value` (0 and 1 map to 1). */
export function nextPowerOfTwo(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(value));
}

/** Stable ascending comparison for frame keys. */
function compareKeys(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Lay frames out into one sheet with a deterministic **shelf** packer: frames
 * are sorted tallest-first (ties broken by key) and placed left-to-right in a
 * row; when a row is full a new shelf starts below. This is not the tightest
 * possible packing, but it is pure, stable and more than good enough for a
 * handful of hand-sized frames.
 *
 * @throws RangeError when two requests share a key — an authoring bug that
 *   would otherwise silently drop a frame.
 */
export function packFrames(
  requests: readonly AtlasFrameRequest[],
  options: PackFramesOptions = {},
): AtlasPacking {
  const padding = Math.max(0, Math.floor(options.padding ?? ATLAS_PADDING));
  const maxWidth = options.maxWidth !== undefined ? Math.max(1, options.maxWidth) : undefined;
  const frames = new Map<string, AtlasRect>();
  if (requests.length === 0) {
    return { width: 0, height: 0, padding, frames };
  }

  const sorted = [...requests].sort((a, b) => {
    const byHeight = b.height - a.height;
    return byHeight !== 0 ? byHeight : compareKeys(a.key, b.key);
  });

  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  let usedWidth = 0;

  for (const request of sorted) {
    if (frames.has(request.key)) {
      throw new RangeError(`packFrames: duplicate frame key "${request.key}"`);
    }
    const width = Math.max(1, Math.ceil(request.width));
    const height = Math.max(1, Math.ceil(request.height));

    if (x > 0 && maxWidth !== undefined && x + width > maxWidth) {
      y += shelfHeight + padding;
      x = 0;
      shelfHeight = 0;
    }

    frames.set(request.key, { x, y, width, height });
    x += width + padding;
    shelfHeight = Math.max(shelfHeight, height);
    usedWidth = Math.max(usedWidth, x - padding);
  }

  const usedHeight = y + shelfHeight;
  return {
    width: options.powerOfTwo ? nextPowerOfTwo(usedWidth) : usedWidth,
    height: options.powerOfTwo ? nextPowerOfTwo(usedHeight) : usedHeight,
    padding,
    frames,
  };
}

/* --------------------------------------------------------------------------
 * Lazy terrain atlas
 * ------------------------------------------------------------------------ */

/**
 * Rasterises one terrain frame. `scene.ts` supplies this: it builds a Pixi
 * `Graphics` from the frame's draw ops and returns
 * `renderer.generateTexture(graphics)`. The frame metrics are passed through so
 * the drawing is positioned relative to the frame's top-face anchor.
 */
export type TerrainTextureFactory<T extends AtlasTexture> = (
  terrain: TerrainType,
  variant: number,
  frame: {
    readonly width: number;
    readonly height: number;
    readonly originX: number;
    readonly originY: number;
  },
) => T;

/** A lazily-populated atlas of the terrain frames a battlefield needs. */
export interface TerrainAtlas<T extends AtlasTexture = AtlasTexture> {
  /** The underlying cache, for direct frame access and the memory check. */
  readonly textures: SpriteAtlas<T>;
  /** The frame for a terrain surface + variant, baked on first use. */
  frame(terrain: TerrainType, variant: number): AtlasFrame<T>;
  /** The distinct frames a map needs, computed without baking. */
  requiredKeys(map: TerrainMap): readonly string[];
  /** Acquire every frame a map uses; already-baked frames are reused. */
  loadMap(map: TerrainMap): readonly AtlasFrame<T>[];
  /** Current byte use and budget verdict. */
  report(): MemoryReport;
  /** Destroy every resident texture. */
  dispose(): void;
}

/**
 * Build a {@link TerrainAtlas} over a bake callback and a memory budget.
 *
 * ```ts
 * const atlas = createTerrainAtlas((terrain, variant, frame) => {
 *   const g = new Graphics();
 *   drawTerrainFrame(g, terrain, variant, frame);
 *   const texture = renderer.generateTexture(g);
 *   g.destroy();
 *   return texture;
 * });
 * atlas.loadMap(battle.map);        // bakes only the variants in use
 * const sprite = new Sprite(atlas.frame(tile.terrain, variant).texture);
 * ```
 */
export function createTerrainAtlas<T extends AtlasTexture>(
  bake: TerrainTextureFactory<T>,
  options: SpriteAtlasOptions<T> = {},
): TerrainAtlas<T> {
  const textures = new SpriteAtlas<T>(options);
  const metrics = {
    width: TERRAIN_FRAME_WIDTH,
    height: TERRAIN_FRAME_HEIGHT,
    originX: TERRAIN_FRAME_ORIGIN_X,
    originY: TERRAIN_FRAME_ORIGIN_Y,
  } as const;

  const frame = (terrain: TerrainType, variant: number): AtlasFrame<T> => {
    const normalized = normalizeVariant(variant);
    return textures.acquire(terrainFrameKey(terrain, normalized), () =>
      bake(terrain, normalized, metrics),
    );
  };

  return {
    textures,
    frame,
    requiredKeys: (map) => terrainFrameKeys(map),
    loadMap: (map) => terrainFrameEntries(map).map((entry) => frame(entry.terrain, entry.variant)),
    report: () => memoryReport(textures),
    dispose: () => textures.dispose(),
  };
}
