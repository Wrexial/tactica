import { describe, expect, it, vi } from "vitest";

import { createTerrainMap, withTile } from "../../src/engine/terrain";
import {
  ATLAS_PADDING,
  DEFAULT_ATLAS_BUDGET_BYTES,
  SpriteAtlas,
  atlasStats,
  createTerrainAtlas,
  estimateTextureBytes,
  formatBytes,
  memoryReport,
  nextPowerOfTwo,
  normalizeVariant,
  packFrames,
  terrainFrameEntries,
  terrainFrameKey,
  terrainFrameKeys,
  unitFigureKey,
  type AtlasTexture,
} from "../../src/render/atlas";

/* --------------------------------------------------------------------------
 * T105 — Performance pass: texture atlas, lazy loading, memory check.
 *
 * The Pixi rasterisation itself is exercised by the build and the e2e smoke
 * spec. Here we pin the whole Pixi-free surface: the deterministic frame
 * vocabulary, the shelf packer, the lazy LRU frame cache and the byte budget.
 * ------------------------------------------------------------------------ */

/** A fabricated texture handle that records its destruction. */
class FakeTexture implements AtlasTexture {
  destroyed = false;
  readonly destroy = vi.fn(() => {
    this.destroyed = true;
  });

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
}

/** Matches the atlas's authored terrain frame metrics. */
const TERRAIN_W = 128;
const TERRAIN_H = 96;

describe("texture bytes", () => {
  it("charges four bytes per pixel by default", () => {
    expect(estimateTextureBytes(16, 8)).toBe(16 * 8 * 4);
    expect(estimateTextureBytes(16, 8, 2)).toBe(16 * 8 * 2);
  });

  it("rounds fractional sizes up and rejects nonsense", () => {
    expect(estimateTextureBytes(1.2, 2.1)).toBe(2 * 3 * 4);
    expect(estimateTextureBytes(Number.NaN, 10)).toBe(0);
    expect(estimateTextureBytes(-5, 10)).toBe(0);
    expect(estimateTextureBytes(10, 10, Number.POSITIVE_INFINITY)).toBe(10 * 10 * 4);
  });

  it("formats byte counts for the memory report", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KiB");
    expect(formatBytes(1024 * 1024)).toBe("1 MiB");
  });
});

describe("SpriteAtlas", () => {
  it("bakes a frame lazily, once", () => {
    const atlas = new SpriteAtlas<FakeTexture>();
    const bake = vi.fn(() => new FakeTexture(8, 8));
    expect(atlas.has("a")).toBe(false);
    expect(atlas.size).toBe(0);

    const first = atlas.acquire("a", bake);
    const second = atlas.acquire("a", bake);

    expect(bake).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(atlas.size).toBe(1);
    expect(atlas.bytes).toBe(estimateTextureBytes(8, 8));
  });

  it("evicts the least-recently-used frame when over budget", () => {
    const bytes = estimateTextureBytes(10, 10); // 400 B
    const onEvict = vi.fn();
    const atlas = new SpriteAtlas<FakeTexture>({ maxBytes: bytes * 2, onEvict });

    atlas.acquire("a", () => new FakeTexture(10, 10));
    atlas.acquire("b", () => new FakeTexture(10, 10));
    // Touch "a" so "b" is now the oldest.
    atlas.get("a");
    const c = atlas.acquire("c", () => new FakeTexture(10, 10));

    expect(atlas.has("a")).toBe(true);
    expect(atlas.has("b")).toBe(false);
    expect(atlas.has("c")).toBe(true);
    expect(c).toBeDefined();
    expect(atlas.bytes).toBe(bytes * 2);
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict.mock.calls[0][0].key).toBe("b");
  });

  it("destroys evicted, released and cleared textures", () => {
    const atlas = new SpriteAtlas<FakeTexture>({ maxBytes: 0 });
    const first = atlas.acquire("a", () => new FakeTexture(4, 4));
    const second = atlas.acquire("b", () => new FakeTexture(4, 4));

    // A zero budget keeps only the newest frame; "a" was force-evicted.
    expect(first.texture.destroyed).toBe(true);
    expect(second.texture.destroyed).toBe(false);

    expect(atlas.release("b")).toBe(true);
    expect(second.texture.destroyed).toBe(true);
    expect(atlas.release("b")).toBe(false);

    const third = atlas.acquire("c", () => new FakeTexture(4, 4));
    atlas.dispose();
    expect(third.texture.destroyed).toBe(true);
    expect(atlas.size).toBe(0);
    expect(atlas.bytes).toBe(0);
  });

  it("keeps a single oversized frame and reports over budget", () => {
    const atlas = new SpriteAtlas<FakeTexture>({ maxBytes: 100 });
    atlas.acquire("huge", () => new FakeTexture(64, 64));
    const report = memoryReport(atlas);
    expect(report.frames).toBe(1);
    expect(report.level).toBe("over");
    expect(report.bytes).toBeGreaterThan(report.maxBytes);
  });

  it("supports release, clear and key iteration in LRU order", () => {
    const atlas = new SpriteAtlas<FakeTexture>({ maxBytes: DEFAULT_ATLAS_BUDGET_BYTES });
    atlas.acquire("a", () => new FakeTexture(2, 2));
    atlas.acquire("b", () => new FakeTexture(2, 2));
    atlas.get("a");
    expect(atlas.keys()).toEqual(["b", "a"]);
    atlas.clear();
    expect(atlas.keys()).toEqual([]);
    expect(atlas.bytes).toBe(0);
  });
});

describe("memory report", () => {
  it("grades ok, warn and over against the budget", () => {
    const bytes = estimateTextureBytes(100, 100);
    const budget = bytes * 10;

    const ok = new SpriteAtlas<FakeTexture>({ maxBytes: budget });
    ok.acquire("a", () => new FakeTexture(100, 100));
    expect(memoryReport(ok).level).toBe("ok");

    const warn = new SpriteAtlas<FakeTexture>({ maxBytes: bytes });
    warn.acquire("a", () => new FakeTexture(100, 100));
    expect(memoryReport(warn).level).toBe("warn");
    expect(memoryReport(warn).summary).toMatch(/warn/);

    const over = new SpriteAtlas<FakeTexture>({ maxBytes: bytes / 2 });
    over.acquire("a", () => new FakeTexture(100, 100));
    expect(memoryReport(over).level).toBe("over");
  });

  it("snapshots stats", () => {
    const atlas = new SpriteAtlas<FakeTexture>({ maxBytes: 800 });
    atlas.acquire("a", () => new FakeTexture(10, 10));
    const stats = atlasStats(atlas);
    expect(stats.frames).toBe(1);
    expect(stats.maxBytes).toBe(800);
    expect(stats.utilization).toBeCloseTo(400 / 800);
    expect(stats.keys).toEqual(["a"]);
  });
});

describe("frame vocabulary", () => {
  it("normalises variants into 0–3", () => {
    expect(normalizeVariant(0)).toBe(0);
    expect(normalizeVariant(4)).toBe(0);
    expect(normalizeVariant(-1)).toBe(1);
    expect(normalizeVariant(Number.NaN)).toBe(0);
  });

  it("names terrain and unit frames deterministically", () => {
    expect(terrainFrameKey("wood", 1)).toBe("wood#1");
    expect(terrainFrameKey("wood", 5)).toBe("wood#1");
    expect(unitFigureKey({ power: "france", postId: "line-infantry", facing: "north" })).toBe(
      "france|line-infantry|north",
    );
  });
});

describe("map-driven lazy loading", () => {
  function sampleMap() {
    let map = createTerrainMap(3, 2, "field");
    map = withTile(map, { x: 1, y: 0 }, { terrain: "wood", height: 1 });
    map = withTile(map, { x: 2, y: 1 }, { terrain: "wood", height: 0 });
    return map;
  }

  it("lists only the distinct frames a map uses, without baking", () => {
    const keys = terrainFrameKeys(sampleMap());
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.some((key) => key.startsWith("field#"))).toBe(true);
    expect(keys.some((key) => key.startsWith("wood#"))).toBe(true);
    // Six tiles can never need more than six frames (and never the full grid).
    expect(keys.length).toBeLessThanOrEqual(6);
  });

  it("reports decoded entries in deterministic first-seen order", () => {
    const first = terrainFrameEntries(sampleMap());
    const second = terrainFrameEntries(sampleMap());
    expect(second).toEqual(first);
    expect(first[0]).toMatchObject({ key: "field#0", terrain: "field", variant: 0 });
  });

  it("bakes only the frames a map needs, and reuses them", () => {
    const bake = vi.fn(() => new FakeTexture(TERRAIN_W, TERRAIN_H));
    const atlas = createTerrainAtlas(bake, { maxBytes: DEFAULT_ATLAS_BUDGET_BYTES });
    const required = atlas.requiredKeys(sampleMap());
    expect(bake).not.toHaveBeenCalled();

    const loaded = atlas.loadMap(sampleMap());
    expect(loaded.map((frame) => frame.key)).toEqual(required);
    expect(bake).toHaveBeenCalledTimes(required.length);

    // A second load reuses the resident textures.
    atlas.loadMap(sampleMap());
    expect(bake).toHaveBeenCalledTimes(required.length);

    const report = atlas.report();
    expect(report.frames).toBe(required.length);
    expect(report.level).toBe("ok");

    atlas.dispose();
    expect(atlas.textures.size).toBe(0);
  });
});

describe("packFrames", () => {
  const requests = [
    { key: "b", width: 16, height: 32 },
    { key: "a", width: 16, height: 32 },
    { key: "c", width: 32, height: 16 },
  ];

  it("packs deterministically and within the sheet", () => {
    const first = packFrames(requests);
    const second = packFrames(requests);
    expect(second).toEqual(first);
    expect(first.frames.size).toBe(3);
    for (const rect of first.frames.values()) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(first.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(first.height);
    }
  });

  it("never overlaps two frames (padding included)", () => {
    const packing = packFrames(requests);
    const rects = [...packing.frames.values()];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const separated =
          a.x + a.width + packing.padding <= b.x ||
          b.x + b.width + packing.padding <= a.x ||
          a.y + a.height + packing.padding <= b.y ||
          b.y + b.height + packing.padding <= a.y;
        expect(separated).toBe(true);
      }
    }
  });

  it("wraps to a new shelf at maxWidth", () => {
    const packing = packFrames(requests, { maxWidth: 40, padding: 0 });
    expect(packing.width).toBeLessThanOrEqual(40);
    // Three 16-wide frames cannot fit two to a 40px row once the third is 32.
    expect(packing.frames.get("c")?.y).toBeGreaterThan(0);
  });

  it("rounds the sheet up to a power of two on request", () => {
    const packing = packFrames([{ key: "a", width: 20, height: 20 }], { powerOfTwo: true });
    expect(packing.width).toBe(32);
    expect(packing.height).toBe(32);
  });

  it("handles an empty request list and rejects duplicates", () => {
    const empty = packFrames([]);
    expect(empty.width).toBe(0);
    expect(empty.height).toBe(0);
    expect(empty.frames.size).toBe(0);

    expect(() =>
      packFrames([
        { key: "a", width: 1, height: 1 },
        { key: "a", width: 1, height: 1 },
      ]),
    ).toThrow(RangeError);
  });

  it("uses the default padding when none is given", () => {
    expect(packFrames(requests).padding).toBe(ATLAS_PADDING);
  });
});

describe("nextPowerOfTwo", () => {
  it("rounds up and clamps tiny values", () => {
    expect(nextPowerOfTwo(0)).toBe(1);
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(4)).toBe(4);
    expect(nextPowerOfTwo(100)).toBe(128);
  });
});
