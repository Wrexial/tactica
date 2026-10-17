import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Rng } from "../../src/engine/rng";
import type { RngState } from "../../src/engine/rng";

/* --------------------------------------------------------------------------
 * T011 — Seeded PRNG
 *
 * Two guarantees matter to the rest of the engine:
 *   1. Determinism — the same seed + the same call sequence yields the same
 *      values, so battles can be replayed from a seed and a command log.
 *   2. Serialisability — the whole stream can be round-tripped through JSON,
 *      so a save can resume mid-battle.
 * The golden vectors below are a regression lock: if the algorithm ever
 * drifts, existing saves/replays would desync, and these tests say so loudly.
 * ------------------------------------------------------------------------ */

describe("Rng — determinism", () => {
  it("reproduces an identical stream for the same seed", () => {
    const a = new Rng("waterloo-1815");
    const b = new Rng("waterloo-1815");
    const first = Array.from({ length: 500 }, () => a.next());
    const second = Array.from({ length: 500 }, () => b.next());
    expect(second).toEqual(first);
  });

  it("produces different streams for different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 8 }, () => a.nextUint32());
    const seqB = Array.from({ length: 8 }, () => b.nextUint32());
    expect(seqA).not.toEqual(seqB);
  });

  it("treats numeric and string seeds as distinct", () => {
    expect(new Rng(42).nextUint32()).not.toBe(new Rng("42").nextUint32());
  });

  it("matches the locked golden integer sequence", () => {
    // Changing these values is a breaking save/replay change — do not update
    // them casually (mapping decision D15: determinism from day one).
    const rng = new Rng(12345);
    expect(Array.from({ length: 8 }, () => rng.nextUint32())).toEqual([
      1482015622, 3374989862, 153595890, 1512108221, 1742383576, 4098584337, 1603298152, 2788089741,
    ]);
  });

  it("matches the locked golden float sequence", () => {
    const rng = new Rng("waterloo-1815");
    expect(Array.from({ length: 5 }, () => rng.next())).toEqual([
      0.15082236751914024, 0.6408857807982713, 0.3470892780460417, 0.1479009275790304,
      0.4882091626059264,
    ]);
  });
});

describe("Rng — value ranges", () => {
  it("emits uint32 values as integers in [0, 2**32)", () => {
    const rng = new Rng("uint32");
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 32);
    }
  });

  it("emits floats in [0, 1)", () => {
    const rng = new Rng("float");
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("keeps nextInt inside [0, maxExclusive) and covers every outcome", () => {
    const rng = new Rng("d6");
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      const roll = rng.nextInt(6);
      expect(Number.isInteger(roll)).toBe(true);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(6);
      seen.add(roll);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps intBetween inclusive on both ends", () => {
    const rng = new Rng(2024);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const value = rng.intBetween(1, 20);
      expect(Number.isInteger(value)).toBe(true);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    expect(min).toBe(1);
    expect(max).toBe(20);
  });

  it("does not mutate bounded draws disproportionately", () => {
    const rng = new Rng("fairness");
    const counts = new Array<number>(6).fill(0);
    const draws = 6000;
    for (let i = 0; i < draws; i++) {
      counts[rng.nextInt(6)]! += 1;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(draws / 6 - 200);
      expect(count).toBeLessThan(draws / 6 + 200);
    }
  });

  it("matches the locked intBetween sequence", () => {
    const rng = new Rng(2024);
    expect(Array.from({ length: 10 }, () => rng.intBetween(1, 20))).toEqual([
      8, 15, 14, 9, 9, 20, 7, 7, 11, 9,
    ]);
  });
});

describe("Rng — chance, pick and shuffle", () => {
  it("makes chance(0) always false and chance(1) always true", () => {
    const zero = new Rng("zero");
    const one = new Rng("one");
    for (let i = 0; i < 100; i++) {
      expect(zero.chance(0)).toBe(false);
      expect(one.chance(1)).toBe(true);
    }
  });

  it("approximates the requested probability", () => {
    const rng = new Rng("probability");
    let hits = 0;
    const trials = 20_000;
    for (let i = 0; i < trials; i++) {
      if (rng.chance(0.25)) hits += 1;
    }
    expect(hits / trials).toBeGreaterThan(0.23);
    expect(hits / trials).toBeLessThan(0.27);
  });

  it("picks only from the supplied list and rejects empty lists", () => {
    const rng = new Rng("pick");
    const items = ["voltigeur", "grenadier", "chasseur"] as const;
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(rng.pick(items));
    }
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it("shuffles deterministically without mutating the input", () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = new Rng("shuffle").shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out).toEqual(new Rng("shuffle").shuffle(input));
    expect(out).toEqual([7, 2, 3, 8, 1, 4, 6, 5]);
  });

  it("shuffles an empty list to an empty list", () => {
    expect(new Rng("empty").shuffle([])).toEqual([]);
  });
});

describe("Rng — serialisable state", () => {
  const drain = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.next());

  it("exposes only JSON-safe uint32 state words", () => {
    const rng = new Rng(7);
    const state = rng.getState();
    expect(state).toEqual({
      a: 2278909941,
      b: 2317486128,
      c: 1560007450,
      d: 1359789279,
      calls: 0,
    });
    for (const word of [state.a, state.b, state.c, state.d]) {
      expect(Number.isInteger(word)).toBe(true);
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThan(2 ** 32);
    }
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("resumes the exact stream after a JSON round-trip", () => {
    const rng = new Rng("save-me");
    drain(rng, 37);
    const snapshot = JSON.parse(JSON.stringify(rng.getState())) as RngState;

    const restored = Rng.fromState(snapshot);
    expect(restored.calls).toBe(rng.calls);
    expect(drain(restored, 50)).toEqual(drain(rng, 50));
  });

  it("rewinds to an earlier snapshot", () => {
    const rng = new Rng("rewind");
    const before = rng.getState();
    const first = drain(rng, 10);
    rng.setState(before);
    expect(rng.calls).toBe(before.calls);
    expect(drain(rng, 10)).toEqual(first);
  });

  it("increments the call counter once per draw", () => {
    const rng = new Rng("count");
    expect(rng.calls).toBe(0);
    rng.next();
    rng.nextUint32();
    rng.nextInt(6);
    rng.chance(0.5);
    expect(rng.calls).toBe(4);
    expect(rng.getState().calls).toBe(4);
  });

  it("clones into an independent stream without advancing the parent", () => {
    const parent = new Rng("fork");
    const child = parent.clone();
    const parentStream = drain(parent, 20);
    expect(parent.calls).toBe(20);

    // The clone started from the parent's pre-draw state, so it matches.
    expect(drain(child, 20)).toEqual(parentStream);
    expect(child.calls).toBe(20);

    // Advancing the clone must not disturb the parent's continuation.
    const reference = new Rng("fork");
    drain(reference, 20);
    child.next();
    child.next();
    expect(parent.next()).toBe(reference.next());
    expect(parent.next()).toBe(reference.next());
  });
});

describe("Rng — argument validation", () => {
  it("rejects invalid bounds", () => {
    const rng = new Rng("validate");
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(-3)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(RangeError);
    expect(() => rng.nextInt(2 ** 32 + 1)).toThrow(RangeError);
    expect(() => rng.intBetween(4, 3)).toThrow(RangeError);
    expect(() => rng.intBetween(0.5, 3)).toThrow(RangeError);
  });

  it("rejects probabilities outside [0, 1]", () => {
    const rng = new Rng("validate");
    expect(() => rng.chance(-0.01)).toThrow(RangeError);
    expect(() => rng.chance(1.01)).toThrow(RangeError);
    expect(() => rng.chance(Number.NaN)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Engine purity guard: `agents.md` §2 forbids unseeded randomness, and the
 * ESLint config bans `Math.random` in `src/engine`. This sweep is the belt to
 * that rule's braces — comments are stripped so documentation may still name
 * the forbidden API.
 * ------------------------------------------------------------------------ */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n\r]*/g, "");
}

/** Recursively collect every `.ts` file under `dir`. */
function collectTypeScript(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScript(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("engine purity", () => {
  it("never calls Math.random anywhere in src/engine", () => {
    const engineDir = fileURLToPath(new URL("../../src/engine", import.meta.url));
    const sources = collectTypeScript(engineDir);
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, `${file} must not call Math.random`).not.toMatch(/Math\s*\.\s*random/);
    }
  });
});
