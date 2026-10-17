/**
 * Seeded pseudo-random number generator (PRNG) — the *only* source of
 * randomness the engine is allowed to use (see `agents.md` §2 determinism).
 *
 * Algorithm: **sfc32** (Chris Doty-Humphrey's "Small Fast Counting" generator),
 * a 128-bit-state generator combined with **cyrb128** seed expansion. sfc32 is
 * small, fast, integer-only (no floating-point drift), and its whole state is
 * four 32-bit words, which makes {@link RngState} trivially serialisable for
 * saves and replays.
 *
 * Reference: the public-domain descriptions of sfc32 and cyrb128 by
 * Chris Doty-Humphrey / Bryce Kerley. Re-authored here, not copied verbatim.
 *
 * Contract:
 * - Given the same seed and the same ordered sequence of calls, an `Rng`
 *   produces byte-identical values on every platform (Node and browser).
 * - {@link Rng.getState} / {@link Rng.setState} round-trip the stream through
 *   JSON, so a battle can be paused and resumed exactly.
 * - Never call `Math.random` in `src/engine`; ESLint rejects it and
 *   `tests/unit/rng.test.ts` sweeps the engine sources as a second guard.
 */

/** A seed is a number (e.g. a campaign seed) or a human-readable string. */
export type Seed = number | string;

/**
 * Plain, JSON-serialisable snapshot of a generator's internal state.
 *
 * `a`–`d` are the four 32-bit words of the sfc32 state; `calls` counts how many
 * values have been drawn, which is handy when debugging replays. All fields are
 * unsigned 32-bit integers.
 */
export interface RngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly calls: number;
}

/** 2^32 — one past the largest 32-bit unsigned integer. */
const UINT32 = 0x1_0000_0000;

/**
 * Expand a seed into four well-mixed 32-bit words (cyrb128).
 *
 * Numbers and strings are tagged (`n:` / `s:`) before hashing so they cannot
 * collide. The salt also means seed `0` does not yield a zero state for sfc32.
 */
function seedWords(seed: Seed): [number, number, number, number] {
  const str = typeof seed === "number" ? `n:${seed}` : `s:${seed}`;
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** Throws a `RangeError` unless `value` is a positive safe integer. */
function assertPositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, received ${value}`);
  }
}

/**
 * Deterministic, serialisable pseudo-random number generator.
 *
 * ```ts
 * const rng = new Rng("waterloo-1815");
 * rng.next();        // float in [0, 1)
 * rng.nextInt(6);    // integer in [0, 6) — one die pip
 * rng.chance(0.3);   // true ~30% of the time
 * ```
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private count: number;

  constructor(seed: Seed) {
    const [a, b, c, d] = seedWords(seed);
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.count = 0;
    // cyrb128 output is already mixed; guard the pathological all-zero state.
    if ((this.a | this.b | this.c | this.d) === 0) {
      this.d = 0x9e3779b9;
    }
  }

  /** Rebuild a generator from a state produced by {@link getState}. */
  static fromState(state: RngState): Rng {
    const rng = new Rng(0);
    rng.setState(state);
    return rng;
  }

  /** Number of values drawn from this generator so far. */
  get calls(): number {
    return this.count;
  }

  /** Draw the next raw unsigned 32-bit integer in `[0, 2^32)`. */
  nextUint32(): number {
    // sfc32 core. All arithmetic stays in signed 32-bit ints; `>>> 0` reads the
    // bit pattern as unsigned. Keep this byte-for-byte stable — replays and
    // saves depend on it.
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (((this.c << 21) | (this.c >>> 11)) + t) | 0;
    this.count += 1;
    return t >>> 0;
  }

  /** Draw the next float in `[0, 1)` with 32 bits of precision. */
  next(): number {
    return this.nextUint32() / UINT32;
  }

  /**
   * Draw an integer in `[0, maxExclusive)` using rejection sampling so every
   * outcome is equally likely (no modulo bias).
   */
  nextInt(maxExclusive: number): number {
    assertPositiveInt(maxExclusive, "maxExclusive");
    if (maxExclusive > UINT32) {
      throw new RangeError(`maxExclusive must be at most 2**32, received ${maxExclusive}`);
    }
    // Largest multiple of maxExclusive that fits in 32 bits.
    const limit = UINT32 - (UINT32 % maxExclusive);
    let draw = this.nextUint32();
    while (draw >= limit) {
      draw = this.nextUint32();
    }
    return draw % maxExclusive;
  }

  /** Draw an integer in `[minInclusive, maxInclusive]` (both ends included). */
  intBetween(minInclusive: number, maxInclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new RangeError("bounds must be integers");
    }
    if (maxInclusive < minInclusive) {
      throw new RangeError(`maxInclusive (${maxInclusive}) < minInclusive (${minInclusive})`);
    }
    return minInclusive + this.nextInt(maxInclusive - minInclusive + 1);
  }

  /**
   * Returns `true` with the given `probability` in `[0, 1]`.
   * `chance(0)` is always false and `chance(1)` is always true.
   */
  chance(probability: number): boolean {
    if (!(probability >= 0 && probability <= 1)) {
      throw new RangeError(`probability must be within [0, 1], received ${probability}`);
    }
    return this.next() < probability;
  }

  /** Pick one element uniformly at random. Throws on an empty list. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError("cannot pick from an empty list");
    }
    return items[this.nextInt(items.length)] as T;
  }

  /** Return a new, uniformly shuffled copy of `items` (input is untouched). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /** Snapshot the full generator state as a plain JSON-safe object. */
  getState(): RngState {
    return {
      a: this.a >>> 0,
      b: this.b >>> 0,
      c: this.c >>> 0,
      d: this.d >>> 0,
      calls: this.count,
    };
  }

  /** Restore a state produced by {@link getState}. */
  setState(state: RngState): void {
    this.a = state.a | 0;
    this.b = state.b | 0;
    this.c = state.c | 0;
    this.d = state.d | 0;
    this.count = state.calls;
  }

  /**
   * Fork an independent generator that starts from this one's current state.
   * The parent's stream is not advanced, so this is useful for per-subsystem
   * streams (turn order, loot, AI) that must not disturb one another.
   */
  clone(): Rng {
    return Rng.fromState(this.getState());
  }
}
