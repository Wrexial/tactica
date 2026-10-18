/**
 * Sound effects (T107) — the presentation layer's **procedural** SFX bank.
 *
 * Royalty-free by construction (`agents.md` §3): there are **no audio files**,
 * no ripped assets and no third-party samples. Every cue is a small, authored
 * *recipe* of oscillators and filtered noise that the Web Audio API synthesises
 * at play time. The recipes are original to *Lines of Glory*, so the whole bank
 * is ours to ship, remix and relicense — the task's "royalty-free SFX" bar.
 *
 * ## What this module is (and is not)
 *
 * Like `src/render/animations.ts`, this is a **presentation** module: it may
 * touch the browser, but it never reads or writes engine state, and it never
 * ships anything into `src/engine`. The engine's only channel to the outside is
 * the ordered {@link BattleEvent} stream, so {@link sfxForEvent} is the bridge:
 *
 * ```
 *   engine events ──► sfxForEvent(event) ──► SfxName ──► SfxPlayer.play(name)
 *   UI intents    ──► play("ui-confirm")  ──► SfxPlayer.play(name)
 * ```
 *
 * Volume is *not* owned here. The camp settings screen (`src/ui/Settings.tsx`,
 * T103) persists a 0–100 master volume; the caller feeds it to
 * {@link SfxPlayer.setVolume} (or the {@link setSfxVolume} convenience). The
 * player only turns that master level into a per-cue linear gain.
 *
 * ## Why procedural (and not a sprite sheet of samples)?
 *
 * - **No licence risk / no downloads.** A recipe is a few numbers, so the bank
 *   stays tiny and 100% original.
 * - **Testable in Node.** The recipe table is pure data; the browser-only
 *   {@link AudioContext} work is isolated behind the {@link SfxBackend} seam.
 *   `createSfxPlayer({ backend })` lets Vitest assert *which* cue and *what*
 *   gain would play, with a fake backend, in a plain Node environment.
 * - **Degrades gracefully.** On a server, in jsdom, or before the user has
 *   gestured (autoplay policy), the backend reports `supported: false` and
 *   {@link SfxPlayer.play} is an honest no-op instead of throwing.
 *
 * Napoleonically, the four families the task names map onto
 * {@link SfxCategory}: `ui` (menus and orders), `volley` (massed musket fire,
 * the FFTA combo, mapping §6), `gun` (Powder ordnance, mapping §12) and `card`
 * (Articles of War / the Provost Marshal's Reprimand and Court-Martial, §9).
 * `combat` rounds out the field hits, misses and medicines. Mechanical keys
 * stay FFTA-shaped; only the sound design is period.
 *
 * Contract (`agents.md` §2, §7, §9):
 * - **Original data.** Every recipe is authored balance/design data, not a
 *   sample; comments say what inspired each family.
 * - **No engine reach-in.** Reads at most a {@link BattleEvent}; imports no
 *   engine state and mutates nothing.
 * - **No balance constants inline.** Durations, frequencies and gains live in
 *   the {@link SFX_LIBRARY} table (or named constants below).
 */

import type { BattleEvent } from "../engine/events";
import { isArtilleryAbility } from "../render/animations";

/* --------------------------------------------------------------------------
 * Vocabulary
 * ------------------------------------------------------------------------ */

/**
 * Every sound the field can make. Grouped by {@link SFX_CATEGORIES} so a mixer
 * (T108) can ride whole families — e.g. duck `gun` under `ui`.
 */
export const SFX_NAMES = [
  // Menus, orders and confirmation (UI).
  "ui-move",
  "ui-select",
  "ui-confirm",
  "ui-cancel",
  "ui-open",
  "ui-close",
  "ui-error",
  "ui-page",
  // Massed musket fire (FFTA Combo, mapping §6).
  "volley-start",
  "volley-chain",
  // Powder ordnance (mapping §12).
  "gun-musket",
  "gun-cannon",
  "gun-rocket",
  // Field hits, medicines and discipline.
  "combat-clash",
  "combat-hit",
  "combat-miss",
  "combat-defeat",
  "combat-heal",
  // Articles of War, the Provost Marshal and national Guard Sorties (§9).
  "card-article",
  "card-reprimand",
  "card-court-martial",
  "card-commend",
  "card-sortie",
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/** The mixer families. `ui` should usually sit above the battlefield bus. */
export const SFX_CATEGORIES = ["ui", "volley", "gun", "combat", "card"] as const;
export type SfxCategory = (typeof SFX_CATEGORIES)[number];

/** Human-readable family names for a future audio settings panel (T108). */
export const SFX_CATEGORY_LABELS: Readonly<Record<SfxCategory, string>> = {
  ui: "Orders & menus",
  volley: "Volleys",
  gun: "Guns & ordnance",
  combat: "Field combat",
  card: "Articles & cards",
};

/* --------------------------------------------------------------------------
 * Recipe model (pure data)
 * ------------------------------------------------------------------------ */

/** A pitched element of a cue: one oscillator with a gain envelope. */
export interface ToneNode {
  readonly kind: "tone";
  readonly wave: OscillatorType;
  /** Seconds from the cue's start. */
  readonly at: number;
  /** Total sounding length, in seconds (`> 0`). */
  readonly duration: number;
  /** Starting frequency, in hertz. */
  readonly from: number;
  /** Optional glide target, in hertz; omit for a steady pitch. */
  readonly to?: number;
  /** Peak linear gain, `0..1`. */
  readonly gain: number;
  /** Attack time in seconds; defaults to {@link DEFAULT_ATTACK}. */
  readonly attack?: number;
  /** Release time in seconds; defaults to {@link DEFAULT_RELEASE}. */
  readonly release?: number;
}

/** A filtered white-noise element, for cracks, thumps, whooshes and wind. */
export interface NoiseNode {
  readonly kind: "noise";
  readonly at: number;
  readonly duration: number;
  readonly gain: number;
  readonly filter: BiquadFilterType;
  /** Filter corner/resonant frequency, in hertz. */
  readonly cutoff: number;
  /** Biquad Q; defaults to the backend's neutral value. */
  readonly q?: number;
}

export type SfxNode = ToneNode | NoiseNode;

/** One complete, self-contained sound. */
export interface SfxRecipe {
  readonly name: SfxName;
  readonly category: SfxCategory;
  /** Cue-level trim, applied before the master volume. */
  readonly gain: number;
  /** Layered elements, all scheduled relative to the cue's start. */
  readonly nodes: readonly SfxNode[];
}

/** Shortest stable attack, to avoid clicks on a hard start. */
export const DEFAULT_ATTACK = 0.004;
/** Default release so a cue never cuts off abruptly. */
export const DEFAULT_RELEASE = 0.05;

/* --------------------------------------------------------------------------
 * The bank
 * ------------------------------------------------------------------------ */

/**
 * The authored SFX table. Every entry is original synthesis data — inspired by
 * Napoleonic field sounds (a musket's crack, a gun's boom, a provost's drum),
 * never sampled. Gains are conservative so stacked volleys don't clip; the
 * caller's master volume trims the whole bank.
 */
export const SFX_LIBRARY: Readonly<Record<SfxName, SfxRecipe>> = {
  /* ----- Orders & menus: short, dry, unobtrusive ------------------------- */
  "ui-move": {
    name: "ui-move",
    category: "ui",
    gain: 0.5,
    nodes: [
      { kind: "tone", wave: "triangle", at: 0, duration: 0.05, from: 520, to: 640, gain: 0.18 },
    ],
  },
  "ui-select": {
    name: "ui-select",
    category: "ui",
    gain: 0.5,
    nodes: [
      { kind: "noise", at: 0, duration: 0.03, gain: 0.12, filter: "highpass", cutoff: 2600 },
      { kind: "tone", wave: "square", at: 0, duration: 0.04, from: 880, gain: 0.08 },
    ],
  },
  "ui-confirm": {
    name: "ui-confirm",
    category: "ui",
    gain: 0.6,
    nodes: [
      { kind: "tone", wave: "triangle", at: 0, duration: 0.07, from: 523, gain: 0.22 },
      { kind: "tone", wave: "triangle", at: 0.055, duration: 0.1, from: 784, gain: 0.2 },
    ],
  },
  "ui-cancel": {
    name: "ui-cancel",
    category: "ui",
    gain: 0.6,
    nodes: [
      { kind: "tone", wave: "triangle", at: 0, duration: 0.07, from: 466, gain: 0.2 },
      { kind: "tone", wave: "triangle", at: 0.05, duration: 0.1, from: 311, gain: 0.18 },
    ],
  },
  "ui-open": {
    name: "ui-open",
    category: "ui",
    gain: 0.55,
    nodes: [{ kind: "tone", wave: "sine", at: 0, duration: 0.12, from: 330, to: 660, gain: 0.2 }],
  },
  "ui-close": {
    name: "ui-close",
    category: "ui",
    gain: 0.55,
    nodes: [{ kind: "tone", wave: "sine", at: 0, duration: 0.12, from: 660, to: 294, gain: 0.2 }],
  },
  "ui-error": {
    name: "ui-error",
    category: "ui",
    gain: 0.6,
    nodes: [
      { kind: "tone", wave: "square", at: 0, duration: 0.16, from: 185, to: 150, gain: 0.18 },
      { kind: "tone", wave: "square", at: 0.05, duration: 0.12, from: 175, gain: 0.14 },
    ],
  },
  "ui-page": {
    name: "ui-page",
    category: "ui",
    gain: 0.5,
    nodes: [
      {
        kind: "noise",
        at: 0,
        duration: 0.06,
        gain: 0.14,
        filter: "bandpass",
        cutoff: 1800,
        q: 0.8,
      },
      { kind: "tone", wave: "triangle", at: 0, duration: 0.05, from: 720, to: 900, gain: 0.08 },
    ],
  },

  /* ----- Volleys: massed musket fire (FFTA Combo, mapping §6) ------------ */
  "volley-start": {
    name: "volley-start",
    category: "volley",
    gain: 0.9,
    nodes: [
      { kind: "noise", at: 0, duration: 0.08, gain: 0.5, filter: "bandpass", cutoff: 1700, q: 0.7 },
      {
        kind: "noise",
        at: 0.035,
        duration: 0.08,
        gain: 0.45,
        filter: "bandpass",
        cutoff: 2100,
        q: 0.8,
      },
      {
        kind: "noise",
        at: 0.07,
        duration: 0.09,
        gain: 0.4,
        filter: "bandpass",
        cutoff: 1500,
        q: 0.7,
      },
      { kind: "tone", wave: "sine", at: 0, duration: 0.16, from: 150, to: 70, gain: 0.3 },
      { kind: "tone", wave: "sine", at: 0.04, duration: 0.14, from: 120, to: 60, gain: 0.22 },
    ],
  },
  "volley-chain": {
    name: "volley-chain",
    category: "volley",
    gain: 0.8,
    nodes: [
      {
        kind: "noise",
        at: 0,
        duration: 0.07,
        gain: 0.42,
        filter: "bandpass",
        cutoff: 1900,
        q: 0.8,
      },
      { kind: "tone", wave: "sine", at: 0, duration: 0.11, from: 140, to: 70, gain: 0.22 },
    ],
  },

  /* ----- Guns & ordnance (mapping §12, D9) ------------------------------- */
  "gun-musket": {
    name: "gun-musket",
    category: "gun",
    gain: 0.85,
    nodes: [
      {
        kind: "noise",
        at: 0,
        duration: 0.07,
        gain: 0.45,
        filter: "bandpass",
        cutoff: 2000,
        q: 0.9,
      },
      { kind: "tone", wave: "sine", at: 0, duration: 0.1, from: 170, to: 80, gain: 0.2 },
    ],
  },
  "gun-cannon": {
    name: "gun-cannon",
    category: "gun",
    gain: 1,
    nodes: [
      { kind: "tone", wave: "sine", at: 0, duration: 0.5, from: 170, to: 42, gain: 0.55 },
      { kind: "noise", at: 0, duration: 0.42, gain: 0.4, filter: "lowpass", cutoff: 900 },
      { kind: "noise", at: 0, duration: 0.1, gain: 0.35, filter: "highpass", cutoff: 2400 },
      { kind: "tone", wave: "triangle", at: 0.02, duration: 0.3, from: 90, to: 50, gain: 0.25 },
    ],
  },
  "gun-rocket": {
    name: "gun-rocket",
    category: "gun",
    gain: 0.85,
    nodes: [
      { kind: "noise", at: 0, duration: 0.35, gain: 0.3, filter: "bandpass", cutoff: 1200, q: 0.5 },
      { kind: "tone", wave: "sawtooth", at: 0, duration: 0.35, from: 260, to: 900, gain: 0.12 },
      { kind: "tone", wave: "sine", at: 0.3, duration: 0.25, from: 120, to: 45, gain: 0.35 },
    ],
  },

  /* ----- Field combat ---------------------------------------------------- */
  "combat-clash": {
    name: "combat-clash",
    category: "combat",
    gain: 0.8,
    nodes: [
      { kind: "noise", at: 0, duration: 0.05, gain: 0.28, filter: "bandpass", cutoff: 3400, q: 2 },
      { kind: "tone", wave: "square", at: 0, duration: 0.09, from: 1500, to: 900, gain: 0.14 },
      {
        kind: "tone",
        wave: "triangle",
        at: 0.005,
        duration: 0.08,
        from: 2200,
        to: 1400,
        gain: 0.12,
      },
    ],
  },
  "combat-hit": {
    name: "combat-hit",
    category: "combat",
    gain: 0.85,
    nodes: [
      { kind: "tone", wave: "sine", at: 0, duration: 0.13, from: 220, to: 80, gain: 0.4 },
      { kind: "noise", at: 0, duration: 0.1, gain: 0.25, filter: "lowpass", cutoff: 700 },
    ],
  },
  "combat-miss": {
    name: "combat-miss",
    category: "combat",
    gain: 0.7,
    nodes: [
      { kind: "noise", at: 0, duration: 0.18, gain: 0.24, filter: "bandpass", cutoff: 900, q: 0.6 },
      { kind: "tone", wave: "sine", at: 0, duration: 0.16, from: 700, to: 1300, gain: 0.06 },
    ],
  },
  "combat-defeat": {
    name: "combat-defeat",
    category: "combat",
    gain: 0.95,
    nodes: [
      { kind: "tone", wave: "sine", at: 0, duration: 0.36, from: 150, to: 48, gain: 0.5 },
      { kind: "noise", at: 0, duration: 0.3, gain: 0.24, filter: "lowpass", cutoff: 600 },
      { kind: "tone", wave: "triangle", at: 0.02, duration: 0.28, from: 110, to: 55, gain: 0.2 },
    ],
  },
  "combat-heal": {
    name: "combat-heal",
    category: "combat",
    gain: 0.7,
    nodes: [
      { kind: "tone", wave: "sine", at: 0, duration: 0.12, from: 587, gain: 0.16 },
      { kind: "tone", wave: "sine", at: 0.07, duration: 0.13, from: 784, gain: 0.15 },
      { kind: "tone", wave: "sine", at: 0.14, duration: 0.16, from: 1175, gain: 0.13 },
    ],
  },

  /* ----- Articles of War, the Provost & Guard Sorties (§9) --------------- */
  "card-article": {
    name: "card-article",
    category: "card",
    gain: 0.8,
    nodes: [
      { kind: "noise", at: 0, duration: 0.05, gain: 0.3, filter: "bandpass", cutoff: 2200, q: 1 },
      { kind: "tone", wave: "triangle", at: 0, duration: 0.09, from: 320, to: 240, gain: 0.18 },
    ],
  },
  "card-reprimand": {
    name: "card-reprimand",
    category: "card",
    gain: 0.9,
    nodes: [
      // A warning drum: two descending taps with a sour edge.
      { kind: "tone", wave: "square", at: 0, duration: 0.12, from: 660, to: 494, gain: 0.2 },
      { kind: "tone", wave: "square", at: 0.12, duration: 0.18, from: 494, to: 392, gain: 0.2 },
      { kind: "tone", wave: "sawtooth", at: 0.12, duration: 0.16, from: 233, gain: 0.1 },
    ],
  },
  "card-court-martial": {
    name: "card-court-martial",
    category: "card",
    gain: 1,
    nodes: [
      // The drum stops: a harsh, low brass-and-drum hit.
      { kind: "tone", wave: "sawtooth", at: 0, duration: 0.5, from: 130, to: 88, gain: 0.3 },
      { kind: "tone", wave: "square", at: 0, duration: 0.4, from: 98, to: 66, gain: 0.22 },
      { kind: "noise", at: 0, duration: 0.3, gain: 0.3, filter: "lowpass", cutoff: 500 },
      { kind: "tone", wave: "sine", at: 0.04, duration: 0.4, from: 180, to: 45, gain: 0.3 },
    ],
  },
  "card-commend": {
    name: "card-commend",
    category: "card",
    gain: 0.85,
    nodes: [
      // A short, bright field fanfare (original, not a national anthem).
      { kind: "tone", wave: "triangle", at: 0, duration: 0.12, from: 587, gain: 0.2 },
      { kind: "tone", wave: "triangle", at: 0.1, duration: 0.12, from: 740, gain: 0.2 },
      { kind: "tone", wave: "triangle", at: 0.2, duration: 0.24, from: 880, gain: 0.22 },
      { kind: "tone", wave: "sine", at: 0.2, duration: 0.24, from: 1175, gain: 0.12 },
    ],
  },
  "card-sortie": {
    name: "card-sortie",
    category: "card",
    gain: 1,
    nodes: [
      // A national Guard Sortie: a rising swell with a martial low end.
      { kind: "tone", wave: "sawtooth", at: 0, duration: 0.7, from: 98, to: 196, gain: 0.2 },
      { kind: "tone", wave: "triangle", at: 0.05, duration: 0.6, from: 392, to: 784, gain: 0.18 },
      { kind: "tone", wave: "triangle", at: 0.2, duration: 0.5, from: 587, to: 1175, gain: 0.16 },
      {
        kind: "noise",
        at: 0.4,
        duration: 0.35,
        gain: 0.22,
        filter: "bandpass",
        cutoff: 1800,
        q: 0.7,
      },
    ],
  },
};

/* --------------------------------------------------------------------------
 * Gains & clamping
 * ------------------------------------------------------------------------ */

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Clamp an arbitrary value to a whole master volume in `[0, 100]`. */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Combine a cue's own trim with the master volume and mute, exactly as the
 * backend will apply it. Exposed so tests (and a future mixer, T108) can reason
 * about effective loudness without a browser.
 */
export function sfxGain(recipeGain: number, volume: number, muted = false): number {
  if (muted) return 0;
  return clamp01(recipeGain) * (clampVolume(volume) / 100);
}

/* --------------------------------------------------------------------------
 * Backend seam (the only browser-facing part)
 * ------------------------------------------------------------------------ */

/**
 * The minimal audio sink the player talks to. `supported` is `false` on a
 * server or in jsdom, so the player can no-op cleanly instead of throwing.
 */
export interface SfxBackend {
  readonly supported: boolean;
  /** Schedule one recipe at an already-resolved linear gain. */
  play(recipe: SfxRecipe, gain: number): void;
  /** Resume a context suspended by the browser's autoplay policy. */
  resume?(): Promise<void>;
  /** Release the audio context, if one was created. */
  dispose(): void;
}

type AudioContextCtor = new () => AudioContext;

/** The `AudioContext` constructor, with the Safari-prefixed fallback. */
function resolveAudioContext(): AudioContextCtor | undefined {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

/** Deterministic noise sample, so even the grit is reproducible. */
function noiseSample(seed: number): () => number {
  // Numeric Recipes' 32-bit LCG (a classic, dependency-free choice).
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

/**
 * The real Web Audio backend: lazily creates one {@link AudioContext} on the
 * first cue (so importing this module is safe on a server) and synthesises
 * every recipe from oscillators and a reusable noise buffer.
 */
export function createWebAudioBackend(): SfxBackend {
  const Ctor = resolveAudioContext();
  let context: AudioContext | null = null;
  let noiseBuffer: AudioBuffer | null = null;

  const ensureContext = (): AudioContext | null => {
    if (context !== null) return context;
    if (Ctor === undefined) return null;
    context = new Ctor();
    return context;
  };

  const ensureNoise = (ctx: AudioContext): AudioBuffer => {
    if (noiseBuffer !== null) return noiseBuffer;
    const length = Math.max(1, Math.floor(ctx.sampleRate * 1.5));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    const next = noiseSample(0x9e3779b9);
    for (let i = 0; i < length; i += 1) channel[i] = next();
    noiseBuffer = buffer;
    return buffer;
  };

  const scheduleTone = (
    ctx: AudioContext,
    destination: AudioNode,
    node: ToneNode,
    now: number,
  ): void => {
    const start = now + Math.max(0, node.at);
    const duration = Math.max(0.01, node.duration);
    const peak = clamp01(node.gain);
    const attack = Math.min(node.attack ?? DEFAULT_ATTACK, duration * 0.5);
    const release = Math.min(node.release ?? DEFAULT_RELEASE, duration - attack);

    const oscillator = ctx.createOscillator();
    oscillator.type = node.wave;
    oscillator.frequency.setValueAtTime(Math.max(1, node.from), start);
    if (node.to !== undefined && node.to !== node.from) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, node.to), start + duration);
    }

    const envelope = ctx.createGain();
    const sustainEnd = start + duration - Math.max(0, release);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(peak, start + attack);
    if (sustainEnd > start + attack) envelope.gain.setValueAtTime(peak, sustainEnd);
    envelope.gain.linearRampToValueAtTime(0, start + duration);

    oscillator.connect(envelope).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  };

  const scheduleNoise = (
    ctx: AudioContext,
    destination: AudioNode,
    node: NoiseNode,
    now: number,
    buffer: AudioBuffer,
  ): void => {
    const start = now + Math.max(0, node.at);
    const duration = Math.max(0.01, node.duration);
    const peak = clamp01(node.gain);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = node.filter;
    filter.frequency.setValueAtTime(Math.max(1, node.cutoff), start);
    if (node.q !== undefined) filter.Q.setValueAtTime(node.q, start);

    const envelope = ctx.createGain();
    const attack = Math.min(DEFAULT_ATTACK, duration * 0.5);
    const release = Math.min(DEFAULT_RELEASE, duration - attack);
    const sustainEnd = start + duration - release;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(peak, start + attack);
    if (sustainEnd > start + attack) envelope.gain.setValueAtTime(peak, sustainEnd);
    envelope.gain.linearRampToValueAtTime(0, start + duration);

    source.connect(filter).connect(envelope).connect(destination);
    source.start(start);
    source.stop(start + duration + 0.02);
  };

  return {
    supported: Ctor !== undefined,
    play(recipe, gain) {
      const ctx = ensureContext();
      if (ctx === null || gain <= 0) return;
      const master = ctx.createGain();
      master.gain.value = clamp01(gain);
      master.connect(ctx.destination);
      const buffer = ensureNoise(ctx);
      for (const node of recipe.nodes) {
        if (node.kind === "tone") scheduleTone(ctx, master, node, ctx.currentTime);
        else scheduleNoise(ctx, master, node, ctx.currentTime, buffer);
      }
    },
    async resume() {
      const ctx = ensureContext();
      if (ctx !== null && ctx.state === "suspended") await ctx.resume();
    },
    dispose() {
      const ctx = context;
      context = null;
      noiseBuffer = null;
      if (ctx !== null) void ctx.close();
    },
  };
}

/* --------------------------------------------------------------------------
 * Player
 * ------------------------------------------------------------------------ */

/** Construction options; every field is optional so `createSfxPlayer()` works. */
export interface SfxPlayerOptions {
  /** Inject a fake sink in tests, or a custom one in the app. */
  readonly backend?: SfxBackend;
  /** Initial master volume, 0–100 (the settings default is 70). */
  readonly volume?: number;
  readonly muted?: boolean;
}

/**
 * A thin, stateful façade over a {@link SfxBackend}. It owns the master volume
 * and mute flag, resolves a {@link SfxName} against {@link SFX_LIBRARY}, and
 * returns whether a cue actually sounded — handy for tests and for silently
 * skipping work when muted.
 */
export interface SfxPlayer {
  readonly supported: boolean;
  readonly volume: number;
  readonly muted: boolean;
  /** Play a cue; returns `false` when unsupported, muted or off. */
  play(name: SfxName): boolean;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Resume audio after the first user gesture (browser autoplay policy). */
  unlock(): Promise<void>;
  dispose(): void;
}

/** Build a player. Omit `backend` to use the real Web Audio backend. */
export function createSfxPlayer(options: SfxPlayerOptions = {}): SfxPlayer {
  const backend = options.backend ?? createWebAudioBackend();
  let volume = clampVolume(options.volume ?? 100);
  let muted = options.muted ?? false;

  return {
    get supported() {
      return backend.supported;
    },
    get volume() {
      return volume;
    },
    get muted() {
      return muted;
    },
    play(name) {
      const recipe = SFX_LIBRARY[name];
      const gain = sfxGain(recipe.gain, volume, muted);
      if (!backend.supported || gain <= 0) return false;
      backend.play(recipe, gain);
      return true;
    },
    setVolume(next) {
      volume = clampVolume(next);
    },
    setMuted(next) {
      muted = next;
    },
    async unlock() {
      await backend.resume?.();
    },
    dispose() {
      backend.dispose();
    },
  };
}

/* --------------------------------------------------------------------------
 * Lazy app-wide singleton
 * ------------------------------------------------------------------------ */

let shared: SfxPlayer | undefined;

/**
 * The process-wide player, created on first use. The context itself is still
 * lazy (only the *backend object* is made here), so calling this early — before
 * a user gesture — is safe.
 */
export function getSfx(): SfxPlayer {
  shared ??= createSfxPlayer();
  return shared;
}

/** Apply the camp's master volume to the shared player (`src/ui/Settings.tsx`). */
export function setSfxVolume(volume: number): void {
  getSfx().setVolume(volume);
}

/** Mute or unmute the shared player (e.g. a future "silent camp" toggle). */
export function setSfxMuted(muted: boolean): void {
  getSfx().setMuted(muted);
}

/* --------------------------------------------------------------------------
 * Event bridge
 * ------------------------------------------------------------------------ */

/**
 * The cue an engine event should play, or `null` when the event is bookkeeping
 * or already covered by another cue.
 *
 * Volleys, Powder ordnance and the Provost's cards are the task's focus:
 * - **Volleys** — `volleyStarted` opens the massed fire; each
 *   `volleyChained` ally adds a single crack (mapping §6).
 * - **Guns** — an artillery ability or item (classified with the same
 *   {@link isArtilleryAbility} predicate the renderer uses) booms; a Powder
 *   hit lands as a musket ball (mapping §12).
 * - **Cards** — a Reprimand, Court-Martial, broken Article or Commendation
 *   from the Articles of War (mapping §9).
 *
 * Presentation stays free to ignore this and design its own timing; the mapping
 * is pure and deterministic, so a replay sounds identical every run.
 */
export function sfxForEvent(event: BattleEvent): SfxName | null {
  switch (event.kind) {
    case "volleyStarted":
      return "volley-start";
    case "volleyChained":
      return "volley-chain";
    case "abilityResolved":
      return isArtilleryAbility(event.abilityId) ? "gun-cannon" : null;
    case "itemUsed":
      return isArtilleryAbility(event.itemId) ? "gun-cannon" : null;
    case "damaged":
      if (event.fatal) return "combat-defeat";
      if (event.damageType === "powder") return "gun-musket";
      if (event.damageType === "steel") return "combat-clash";
      return "combat-hit";
    case "missed":
      return "combat-miss";
    case "outOfAction":
      return "combat-defeat";
    case "healed":
    case "revived":
      return "combat-heal";
    case "articleBroken":
      return "card-article";
    case "reprimandIssued":
      return "card-reprimand";
    case "courtMartialIssued":
      return "card-court-martial";
    case "commended":
      return "card-commend";
    case "guardSortieCalled":
      return "card-sortie";
    default:
      return null;
  }
}
