/**
 * Music (T108) — the presentation layer's **procedural** score.
 *
 * Royalty-free and original by construction (`agents.md` §3): there are **no
 * audio files**, no ripped tracks and no third-party samples. Every piece is a
 * small, authored *score* of notes — instruments are synthesis recipes, and the
 * melodies are original to *Lines of Glory*. That keeps the whole soundtrack
 * ours to ship, remix and relicense, which is the task's "original/licensed
 * music" bar.
 *
 * ## What this module is (and is not)
 *
 * Like `src/audio/sfx.ts` and `src/render/animations.ts`, this is a
 * **presentation** module: it touches the browser, but it never reads or writes
 * engine state and never ships anything into `src/engine`. Nothing here is
 * driven by the deterministic simulation — a scene picks a track, the same way
 * a battle event picks a sound cue in `sfxForEvent`:
 *
 * ```
 *   scene change ──► trackForScene(scene) ──► MusicName ──► MusicPlayer.play(name)
 *   loud stinger ──► player.duck() / unduck()  (ride music under SFX)
 *   camp volume  ──► setMusicMasterVolume(v)  (src/ui/Settings.tsx)
 * ```
 *
 * ## Volume mixing
 *
 * Music and SFX are separate buses under one master fader (`agents.md` §7).
 * {@link musicGain} resolves a track's own trim against the master level, the
 * music-bus level, mute and a **duck** factor, so a cannon volley can ride the
 * score down and let it swell back. That maths is pure and testable, and the
 * {@link MusicPlayer} reapplies it live via the backend seam.
 *
 * ## Why procedural (and not a licensed soundtrack)?
 *
 * - **No licence risk / no downloads.** A score is a table of notes, so the
 *   soundtrack stays tiny and 100% original.
 * - **Testable in Node.** The instrument table and the track table are pure
 *   data; the browser-only {@link AudioContext} work is isolated behind the
 *   {@link MusicBackend} seam. `createMusicPlayer({ backend })` lets Vitest
 *   assert *which* track and *what* gain would play, with a fake backend, in a
 *   plain Node environment.
 * - **Degrades gracefully.** On a server, in jsdom, or before the user has
 *   gestured (autoplay policy), the backend reports `supported: false` and
 *   {@link MusicPlayer.play} is an honest no-op instead of throwing.
 *
 * Napoleonically the tracks map onto the campaign's places and beats (mapping
 * §14): the camp and the officers' mess, the muster roll, the field of battle,
 * the colours advanced and the retreat, and the lawless quiet of No-Man's Land.
 * Mechanical keys stay FFTA-shaped; only the sound is period.
 *
 * Contract (`agents.md` §2, §7, §9):
 * - **Original data.** Every instrument and phrase is authored design data, not
 *   a sample or a quotation; comments say what inspired each track.
 * - **No engine reach-in.** Reads no engine state and mutates nothing.
 * - **No balance constants inline.** Tempos, gains, notes and envelopes live in
 *   the tables below.
 */

/* --------------------------------------------------------------------------
 * Vocabulary
 * ------------------------------------------------------------------------ */

/**
 * Every piece the score can play, grouped by {@link MUSIC_CATEGORIES} so a
 * mixer (T108) can ride whole moods — e.g. duck the `result` stings under the
 * officers' mess.
 */
export const MUSIC_NAMES = ["camp", "muster", "battle", "victory", "defeat", "noMansLand"] as const;
export type MusicName = (typeof MUSIC_NAMES)[number];

/** The mixer families, mirroring the places a track belongs to. */
export const MUSIC_CATEGORIES = ["camp", "march", "field", "result"] as const;
export type MusicCategory = (typeof MUSIC_CATEGORIES)[number];

/** Human-readable family names for a future audio settings panel. */
export const MUSIC_CATEGORY_LABELS: Readonly<Record<MusicCategory, string>> = {
  camp: "Camp & officers' mess",
  march: "March & muster",
  field: "Field of battle",
  result: "After the action",
};

/** The scenes the campaign can ask a track for, in rough play order. */
export const MUSIC_SCENES = [
  "title",
  "camp",
  "officersMess",
  "muster",
  "battle",
  "victory",
  "defeat",
  "noMansLand",
] as const;
export type MusicScene = (typeof MUSIC_SCENES)[number];

/** Human-readable scene names, for a debug panel or the settings screen. */
export const MUSIC_SCENE_LABELS: Readonly<Record<MusicScene, string>> = {
  title: "Title & dispatch",
  camp: "Camp",
  officersMess: "Officers' mess",
  muster: "Muster",
  battle: "Battle",
  victory: "Victory",
  defeat: "Defeat",
  noMansLand: "No-Man's Land",
};

/* --------------------------------------------------------------------------
 * Instrument model (pure data)
 * ------------------------------------------------------------------------ */

/** A percussive noise transient mixed under a tone; used by the drum. */
export interface NoiseLayer {
  readonly gain: number;
  readonly duration: number;
  readonly filter: BiquadFilterType;
  readonly cutoff: number;
  readonly q?: number;
}

/** One synthesis voice: how an {@link MusicInstrument} makes its sound. */
export interface InstrumentDef {
  readonly wave: OscillatorType;
  /** Attack time in seconds. */
  readonly attack: number;
  /** Release time in seconds. */
  readonly release: number;
  /** Per-instrument trim, multiplied by the note's velocity. */
  readonly gain: number;
  /** Octave transposition in semitones (e.g. `-12` for a bass). */
  readonly transpose?: number;
  /** Detune in cents, for a slightly bowed or reedy colour. */
  readonly detune?: number;
  readonly filter?: BiquadFilterType;
  readonly cutoff?: number;
  readonly q?: number;
  /** Vibrato (fife, strings): rate in hertz and depth in cents. */
  readonly vibratoHz?: number;
  readonly vibratoCents?: number;
  /** Optional noise transient mixed under the tone (drums). */
  readonly noise?: NoiseLayer;
}

/** The five voices of the field band, plus a camp bell. */
export const MUSIC_INSTRUMENTS = ["fife", "drum", "horn", "strings", "bass", "bell"] as const;
export type MusicInstrument = (typeof MUSIC_INSTRUMENTS)[number];

/**
 * The authored instrument table. Every entry is original synthesis data —
 * inspired by a Napoleonic field band (fife, drum, hunting horn, strings, bass,
 * a camp bell), never sampled.
 */
export const MUSIC_INSTRUMENT_DEFS: Readonly<Record<MusicInstrument, InstrumentDef>> = {
  fife: {
    wave: "triangle",
    attack: 0.008,
    release: 0.06,
    gain: 0.5,
    vibratoHz: 5.5,
    vibratoCents: 7,
  },
  drum: {
    wave: "sine",
    attack: 0.002,
    release: 0.12,
    gain: 0.9,
    transpose: -12,
    noise: { gain: 0.5, duration: 0.08, filter: "bandpass", cutoff: 1800, q: 0.8 },
  },
  horn: {
    wave: "sawtooth",
    attack: 0.02,
    release: 0.18,
    gain: 0.4,
    filter: "lowpass",
    cutoff: 1400,
    q: 0.7,
  },
  strings: {
    wave: "sawtooth",
    attack: 0.16,
    release: 0.32,
    gain: 0.32,
    filter: "lowpass",
    cutoff: 1100,
    q: 0.5,
  },
  bass: { wave: "triangle", attack: 0.01, release: 0.12, gain: 0.7 },
  bell: { wave: "sine", attack: 0.004, release: 0.9, gain: 0.4, detune: 6 },
};

/* --------------------------------------------------------------------------
 * Note & track model (pure data)
 * ------------------------------------------------------------------------ */

/** One sounded note, positioned in beats from the start of the loop. */
export interface MusicNote {
  readonly instrument: MusicInstrument;
  /** MIDI note number (60 = middle C, 69 = A4). */
  readonly pitch: number;
  /** Beat offset from the loop start (`>= 0`). */
  readonly at: number;
  /** Duration in beats (`> 0`). */
  readonly beats: number;
  /** Velocity, `0..1`; defaults to `1`. */
  readonly gain?: number;
}

/** One complete, self-contained piece of music. */
export interface MusicTrack {
  readonly name: MusicName;
  readonly category: MusicCategory;
  /** Napoleonic title shown in a music player or debug panel. */
  readonly title: string;
  /** One-line description of the mood and where it belongs. */
  readonly description: string;
  /** Beats per minute. */
  readonly tempo: number;
  /** Beats per bar. */
  readonly meter: number;
  /** Length of one pass, in beats. */
  readonly loopBeats: number;
  /** Whether the track repeats; result stings play once. */
  readonly loop: boolean;
  /** Bus trim, applied before the master and bus faders. */
  readonly gain: number;
  readonly notes: readonly MusicNote[];
}

/** Shortest stable attack, to avoid clicks on a hard start. */
export const MUSIC_DEFAULT_ATTACK = 0.008;
/** Default release so a note never cuts off abruptly. */
export const MUSIC_DEFAULT_RELEASE = 0.08;

/** Convert a MIDI note number to hertz (A4 = MIDI 69 = 440 Hz). */
export function midiToFrequency(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

/** Seconds in one pass of a track, excluding any release tail. */
export function trackSeconds(track: MusicTrack): number {
  return (track.loopBeats * 60) / track.tempo;
}

/* --------------------------------------------------------------------------
 * Authoring helpers
 *
 * The score below is written as note tables, but these helpers keep the data
 * readable: a monophonic `line`, a fixed-grid `grid` (for drums and pulses), and
 * a `chord`. They are pure and run once, at module load.
 * ------------------------------------------------------------------------ */

/** One note, with a default velocity. */
function n(
  instrument: MusicInstrument,
  pitch: number,
  at: number,
  beats: number,
  gain = 0.8,
): MusicNote {
  return { instrument, pitch, at, beats, gain };
}

/**
 * Lay a monophonic line from `[pitch, beats]` pairs, starting at `start`. A
 * pitch of `0` is a rest (no note is emitted, but the cursor still advances).
 */
function line(
  instrument: MusicInstrument,
  gain: number,
  start: number,
  pairs: readonly (readonly [pitch: number, beats: number])[],
): MusicNote[] {
  let at = start;
  const out: MusicNote[] = [];
  for (const [pitch, beats] of pairs) {
    if (pitch > 0) out.push(n(instrument, pitch, at, beats, gain));
    at += beats;
  }
  return out;
}

/**
 * Place hits on a fixed grid: each token lasts `step` beats, and a token of `0`
 * is a rest. Useful for a drum pattern or a pumping bass.
 */
function grid(
  instrument: MusicInstrument,
  gain: number,
  start: number,
  step: number,
  tokens: readonly number[],
): MusicNote[] {
  const out: MusicNote[] = [];
  tokens.forEach((pitch, index) => {
    if (pitch > 0) out.push(n(instrument, pitch, start + index * step, step, gain));
  });
  return out;
}

/** Sound several pitches together, for a string pad or a chordal stab. */
function chord(
  instrument: MusicInstrument,
  gain: number,
  pitches: readonly number[],
  at: number,
  beats: number,
): MusicNote[] {
  return pitches.map((pitch) => n(instrument, pitch, at, beats, gain));
}

/* --------------------------------------------------------------------------
 * The score
 * ------------------------------------------------------------------------ */

/**
 * The authored music table. Every entry is an original composition — inspired
 * by the marches and airs of a Napoleonic field band, never quoted.
 */
export const MUSIC_LIBRARY: Readonly<Record<MusicName, MusicTrack>> = {
  /* ----- Camp: a warm air for the bivouac and the officers' mess --------- */
  camp: {
    name: "camp",
    category: "camp",
    title: "Camp at Dawn",
    description: "A slow horn air over a string pad; the company stirring before the march.",
    tempo: 92,
    meter: 4,
    loopBeats: 16,
    loop: true,
    gain: 0.8,
    notes: [
      // D minor → B♭ → F → C, one bar each.
      ...chord("strings", 0.5, [50, 53, 57], 0, 4),
      ...chord("strings", 0.5, [46, 50, 53], 4, 4),
      ...chord("strings", 0.5, [41, 45, 48], 8, 4),
      ...chord("strings", 0.5, [48, 52, 55], 12, 4),
      ...line("bass", 0.55, 0, [
        [38, 4],
        [34, 4],
        [41, 4],
        [36, 4],
      ]),
      ...line("horn", 0.6, 0, [
        [74, 2],
        [77, 2],
        [81, 2],
        [77, 2],
        [79, 4],
        [76, 2],
        [74, 2],
      ]),
    ],
  },

  /* ----- Muster: a fife-and-drum march as the ranks form ----------------- */
  muster: {
    name: "muster",
    category: "march",
    title: "The Muster Roll",
    description: "A fife tune over a steady marching drum; the company falling in.",
    tempo: 112,
    meter: 4,
    loopBeats: 16,
    loop: true,
    gain: 0.85,
    notes: [
      ...line("fife", 0.6, 0, [
        [69, 1],
        [69, 1],
        [74, 2],
        [71, 1],
        [71, 1],
        [76, 2],
        [78, 2],
        [74, 1],
        [76, 1],
        [74, 4],
      ]),
      // Accented on the downbeat, answering tap on the third beat.
      ...grid("drum", 0.7, 0, 1, [50, 0, 45, 0, 50, 0, 45, 0, 50, 0, 45, 0, 50, 45, 50, 45]),
      ...line("bass", 0.6, 0, [
        [38, 2],
        [38, 2],
        [43, 2],
        [43, 2],
        [41, 2],
        [41, 2],
        [38, 2],
        [38, 2],
      ]),
    ],
  },

  /* ----- Battle: a driving field march (mapping §6, §12) ---------------- */
  battle: {
    name: "battle",
    category: "field",
    title: "Lines of Glory",
    description: "A driving fife and drum over a pumping bass; the field action.",
    tempo: 138,
    meter: 4,
    loopBeats: 16,
    loop: true,
    gain: 0.9,
    notes: [
      ...line("fife", 0.62, 0, [
        [74, 1],
        [76, 1],
        [78, 1],
        [79, 1],
        [81, 1],
        [79, 1],
        [78, 2],
        [76, 1],
        [78, 1],
        [79, 1],
        [78, 1],
        [76, 2],
        [74, 2],
      ]),
      // D → A → Bm → G.
      ...chord("strings", 0.35, [50, 54, 57], 0, 4),
      ...chord("strings", 0.35, [45, 52, 57], 4, 4),
      ...chord("strings", 0.35, [47, 54, 59], 8, 4),
      ...chord("strings", 0.35, [43, 50, 55], 12, 4),
      // Root–root–octave–root pump, one bar per chord.
      ...grid("bass", 0.6, 0, 1, [38, 38, 50, 38, 45, 45, 57, 45, 47, 47, 59, 47, 43, 43, 55, 43]),
      ...grid("drum", 0.75, 0, 1, [50, 0, 45, 0, 50, 0, 45, 0, 50, 0, 45, 0, 50, 45, 50, 45]),
    ],
  },

  /* ----- Victory: a short fanfare, played once (mapping §9) ------------- */
  victory: {
    name: "victory",
    category: "result",
    title: "Colours Advanced",
    description: "A rising fanfare and a drum flourish; the field is carried.",
    tempo: 120,
    meter: 4,
    loopBeats: 8,
    loop: false,
    gain: 0.9,
    notes: [
      // D major triad climbing to the octave.
      ...line("fife", 0.68, 0, [
        [74, 0.5],
        [78, 0.5],
        [81, 0.5],
        [86, 1.5],
        [81, 0.5],
        [86, 2.5],
        [79, 1],
        [81, 1],
      ]),
      ...grid("drum", 0.8, 0, 0.5, [45, 50, 45, 50, 45, 50, 45, 50, 50, 0, 50, 0, 50, 0, 50, 0]),
      ...line("bass", 0.6, 0, [
        [38, 2],
        [45, 2],
        [43, 1],
        [45, 1],
        [38, 2],
      ]),
    ],
  },

  /* ----- Defeat: a sombre retreat, played once -------------------------- */
  defeat: {
    name: "defeat",
    category: "result",
    title: "The Retreat",
    description: "A descending minor horn over a D-minor drone; the colours fall back.",
    tempo: 66,
    meter: 4,
    loopBeats: 8,
    loop: false,
    gain: 0.8,
    notes: [
      ...chord("strings", 0.3, [50, 53, 57], 0, 8),
      ...line("bass", 0.5, 0, [
        [38, 4],
        [34, 4],
      ]),
      ...line("horn", 0.55, 0, [
        [74, 2],
        [72, 1],
        [70, 1],
        [69, 2],
        [65, 2],
      ]),
    ],
  },

  /* ----- No-Man's Land: sparse and eerie (mapping §9, the lawless Jagd) --- */
  noMansLand: {
    name: "noMansLand",
    category: "field",
    title: "No-Man's Land",
    description: "A held minor drone, distant bell tolls and a broken horn call. No provost here.",
    tempo: 84,
    meter: 4,
    loopBeats: 16,
    loop: true,
    gain: 0.7,
    notes: [
      ...chord("strings", 0.28, [50, 53, 57], 0, 16),
      ...grid("bell", 0.4, 0, 4, [50, 57, 50, 45]),
      ...line("bass", 0.5, 0, [
        [38, 8],
        [34, 8],
      ]),
      ...line("horn", 0.45, 0, [
        [74, 2],
        [0, 2],
        [72, 2],
        [0, 2],
        [69, 2],
        [0, 2],
        [65, 2],
        [0, 2],
      ]),
    ],
  },
};

/** Titles for a music player menu, keyed by track. */
export const MUSIC_TRACK_LABELS: Readonly<Record<MusicName, string>> = {
  camp: MUSIC_LIBRARY.camp.title,
  muster: MUSIC_LIBRARY.muster.title,
  battle: MUSIC_LIBRARY.battle.title,
  victory: MUSIC_LIBRARY.victory.title,
  defeat: MUSIC_LIBRARY.defeat.title,
  noMansLand: MUSIC_LIBRARY.noMansLand.title,
};

/* --------------------------------------------------------------------------
 * Gains & mixing
 * ------------------------------------------------------------------------ */

/** Default music-bus level, matching the camp settings' stock volume. */
export const DEFAULT_MUSIC_VOLUME = 70;
/** Default master level, matching the camp settings' stock volume. */
export const DEFAULT_MASTER_VOLUME = 70;
/** How far a loud stinger ducks the score (`0.35` = to 35%). */
export const DEFAULT_DUCK = 0.35;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Clamp an arbitrary value to a whole fader level in `[0, 100]`. */
export function clampMusicVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Options for {@link musicGain}: the bus fader, mute and ducking. */
export interface MusicMixOptions {
  /** Music-bus level, `0..100`; defaults to `100`. */
  readonly bus?: number;
  /** When `true`, the score is silent. */
  readonly muted?: boolean;
  /** Ducking factor, `0..1`; `1` leaves the score untouched. */
  readonly duck?: number;
}

/**
 * Combine a track's own trim with the master level, the music-bus level, mute
 * and any ducking — exactly as the backend will apply it. Exposed so tests (and
 * a future mixer) can reason about effective loudness without a browser.
 *
 * `master` and `bus` are 0–100 fader levels; the result is a linear gain.
 */
export function musicGain(
  trackGain: number,
  master: number,
  options: MusicMixOptions = {},
): number {
  if (options.muted) return 0;
  const masterLevel = clampMusicVolume(master) / 100;
  const busLevel = clampMusicVolume(options.bus ?? 100) / 100;
  const duck = clamp01(options.duck ?? 1);
  return clamp01(trackGain) * masterLevel * busLevel * duck;
}

/* --------------------------------------------------------------------------
 * Backend seam (the only browser-facing part)
 * ------------------------------------------------------------------------ */

/**
 * The minimal audio sink the player talks to. `supported` is `false` on a
 * server or in jsdom, so the player can no-op cleanly instead of throwing.
 */
export interface MusicBackend {
  readonly supported: boolean;
  /** Start a track, ramping in from silence over `fadeMs`. */
  play(track: MusicTrack, gain: number, fadeMs: number): void;
  /** Change the current track's gain without restarting it. */
  setGain(gain: number, fadeMs: number): void;
  /** Stop the current track, optionally fading out. */
  stop(fadeMs: number): void;
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

/** Look-ahead window, in seconds, for the loop scheduler. */
export const MUSIC_LOOKAHEAD_SECONDS = 0.35;
/** How often the scheduler wakes up, in milliseconds. */
export const MUSIC_SCHEDULER_INTERVAL_MS = 40;

/** Deterministic noise sample, so even the drum's grit is reproducible. */
function noiseSample(seed: number): () => number {
  // Numeric Recipes' 32-bit LCG (a classic, dependency-free choice).
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

/**
 * The real Web Audio backend. It lazily creates one {@link AudioContext} on the
 * first track (so importing this module is safe on a server), keeps a look-ahead
 * scheduler looping the score, and synthesises every voice from oscillators and
 * a reusable noise buffer.
 */
export function createWebAudioMusicBackend(): MusicBackend {
  const Ctor = resolveAudioContext();
  let context: AudioContext | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let output: GainNode | null = null;
  let current: MusicTrack | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let startTime = 0;
  let loopsScheduled = 0;
  let disposed = false;

  const ensureContext = (): AudioContext | null => {
    if (context !== null) return context;
    if (Ctor === undefined || disposed) return null;
    context = new Ctor();
    return context;
  };

  const ensureNoise = (ctx: AudioContext): AudioBuffer => {
    if (noiseBuffer !== null) return noiseBuffer;
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    const next = noiseSample(0x2545f491);
    for (let i = 0; i < length; i += 1) channel[i] = next();
    noiseBuffer = buffer;
    return buffer;
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  /** Schedule one note's voices at an absolute context time. */
  const voice = (ctx: AudioContext, note: MusicNote, when: number): void => {
    if (output === null || current === null) return;
    const def = MUSIC_INSTRUMENT_DEFS[note.instrument];
    const secondsPerBeat = 60 / current.tempo;
    const duration = Math.max(0.05, note.beats * secondsPerBeat);
    const peak = clamp01((note.gain ?? 1) * def.gain);
    const frequency = midiToFrequency(note.pitch + (def.transpose ?? 0));

    const oscillator = ctx.createOscillator();
    oscillator.type = def.wave;
    oscillator.frequency.setValueAtTime(frequency, when);
    if (def.detune !== undefined) oscillator.detune.setValueAtTime(def.detune, when);

    let node: AudioNode = oscillator;
    if (def.filter !== undefined) {
      const filter = ctx.createBiquadFilter();
      filter.type = def.filter;
      filter.frequency.setValueAtTime(Math.max(1, def.cutoff ?? 1200), when);
      filter.Q.setValueAtTime(def.q ?? 1, when);
      oscillator.connect(filter);
      node = filter;
    }

    const envelope = ctx.createGain();
    const attack = Math.min(def.attack, duration * 0.5);
    const release = Math.min(def.release, Math.max(0.02, duration - attack));
    const releaseAt = when + Math.max(attack, duration - release);
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(peak, when + attack);
    envelope.gain.setValueAtTime(peak, releaseAt);
    envelope.gain.linearRampToValueAtTime(0, when + duration);
    node.connect(envelope).connect(output);

    oscillator.start(when);
    oscillator.stop(when + duration + 0.05);

    if (def.vibratoHz !== undefined && def.vibratoCents !== undefined) {
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(def.vibratoHz, when);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(def.vibratoCents, when);
      lfo.connect(depth).connect(oscillator.detune);
      lfo.start(when);
      lfo.stop(when + duration + 0.05);
    }

    if (def.noise !== undefined) {
      const source = ctx.createBufferSource();
      source.buffer = ensureNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = def.noise.filter;
      filter.frequency.setValueAtTime(Math.max(1, def.noise.cutoff), when);
      if (def.noise.q !== undefined) filter.Q.setValueAtTime(def.noise.q, when);
      const transient = ctx.createGain();
      const end = when + Math.min(def.noise.duration, duration);
      transient.gain.setValueAtTime(clamp01(def.noise.gain), when);
      transient.gain.exponentialRampToValueAtTime(0.0001, end);
      source.connect(filter).connect(transient).connect(output);
      source.start(when);
      source.stop(end + 0.02);
    }
  };

  /** Fill the look-ahead window with whole loop passes. */
  const pump = (): void => {
    const ctx = context;
    if (ctx === null || output === null || current === null) return;
    const secondsPerBeat = 60 / current.tempo;
    const loopSeconds = current.loopBeats * secondsPerBeat;
    const horizon = ctx.currentTime + MUSIC_LOOKAHEAD_SECONDS;

    while (startTime + loopsScheduled * loopSeconds < horizon) {
      const base = startTime + loopsScheduled * loopSeconds;
      for (const note of current.notes) voice(ctx, note, base + note.at * secondsPerBeat);
      loopsScheduled += 1;
      if (!current.loop) {
        clearTimer();
        break;
      }
    }
  };

  const rampGain = (ctx: AudioContext, target: number, fadeMs: number): void => {
    if (output === null) return;
    const now = ctx.currentTime;
    const seconds = Math.max(0, fadeMs) / 1000;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(output.gain.value, now);
    if (seconds > 0) output.gain.linearRampToValueAtTime(target, now + seconds);
    else output.gain.setValueAtTime(target, now);
  };

  return {
    supported: Ctor !== undefined,
    play(track, gain, fadeMs) {
      const ctx = ensureContext();
      if (ctx === null) return;
      clearTimer();
      // Retire the previous pass; already-scheduled voices fade with it.
      const previous = output;
      if (previous !== null) {
        const now = ctx.currentTime;
        previous.gain.cancelScheduledValues(now);
        previous.gain.setValueAtTime(previous.gain.value, now);
        previous.gain.linearRampToValueAtTime(0, now + Math.max(0, fadeMs) / 1000);
        const doomed = previous;
        setTimeout(() => doomed.disconnect(), Math.max(0, fadeMs) + 50);
      }

      const next = ctx.createGain();
      const seconds = Math.max(0, fadeMs) / 1000;
      const now = ctx.currentTime;
      next.gain.setValueAtTime(seconds > 0 ? 0 : clamp01(gain), now);
      if (seconds > 0) next.gain.linearRampToValueAtTime(clamp01(gain), now + seconds);
      next.connect(ctx.destination);

      output = next;
      current = track;
      startTime = now + 0.06;
      loopsScheduled = 0;
      pump();
      if (track.loop) timer = setInterval(pump, MUSIC_SCHEDULER_INTERVAL_MS);
    },
    setGain(gain, fadeMs) {
      const ctx = context;
      if (ctx === null) return;
      rampGain(ctx, clamp01(gain), fadeMs);
    },
    stop(fadeMs) {
      const ctx = context;
      clearTimer();
      if (ctx !== null && output !== null) {
        rampGain(ctx, 0, fadeMs);
        const doomed = output;
        setTimeout(() => doomed.disconnect(), Math.max(0, fadeMs) + 50);
      }
      output = null;
      current = null;
      loopsScheduled = 0;
    },
    async resume() {
      const ctx = ensureContext();
      if (ctx !== null && ctx.state === "suspended") await ctx.resume();
    },
    dispose() {
      disposed = true;
      clearTimer();
      const ctx = context;
      context = null;
      output = null;
      current = null;
      noiseBuffer = null;
      if (ctx !== null) void ctx.close();
    },
  };
}

/* --------------------------------------------------------------------------
 * Player
 * ------------------------------------------------------------------------ */

/** Construction options; every field is optional so `createMusicPlayer()` works. */
export interface MusicPlayerOptions {
  /** Inject a fake sink in tests, or a custom one in the app. */
  readonly backend?: MusicBackend;
  /** Initial music-bus level, 0–100. */
  readonly volume?: number;
  /** Initial master level, 0–100. */
  readonly masterVolume?: number;
  readonly muted?: boolean;
}

/** Options for a single {@link MusicPlayer.play}. */
export interface MusicPlayOptions {
  /** Restart the track even if it is already playing. */
  readonly restart?: boolean;
  /** Fade-in time in milliseconds; defaults to {@link MUSIC_DEFAULT_FADE_MS}. */
  readonly fadeMs?: number;
}

/** Default crossfade when switching tracks. */
export const MUSIC_DEFAULT_FADE_MS = 600;

/**
 * A thin, stateful façade over a {@link MusicBackend}. It owns the music-bus and
 * master faders, mute and ducking, resolves a {@link MusicName} against
 * {@link MUSIC_LIBRARY}, and reapplies the mix whenever a fader moves — so a
 * settings slider rides the score live.
 */
export interface MusicPlayer {
  readonly supported: boolean;
  /** The track currently playing, or `null` when stopped. */
  readonly track: MusicName | null;
  readonly volume: number;
  readonly masterVolume: number;
  readonly muted: boolean;
  readonly ducked: boolean;
  /** Play a track; returns `false` only when audio is unsupported. */
  play(name: MusicName, options?: MusicPlayOptions): boolean;
  /** Play the track for a scene; `null` scenes stop the score. */
  playScene(scene: MusicScene, options?: MusicPlayOptions): boolean;
  stop(fadeMs?: number): void;
  setVolume(volume: number): void;
  setMasterVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Ride the score down under a loud stinger. */
  duck(factor?: number, fadeMs?: number): void;
  /** Restore the score after {@link duck}. */
  unduck(fadeMs?: number): void;
  /** Resume audio after the first user gesture (browser autoplay policy). */
  unlock(): Promise<void>;
  dispose(): void;
}

/** Build a player. Omit `backend` to use the real Web Audio backend. */
export function createMusicPlayer(options: MusicPlayerOptions = {}): MusicPlayer {
  const backend = options.backend ?? createWebAudioMusicBackend();
  let volume = clampMusicVolume(options.volume ?? DEFAULT_MUSIC_VOLUME);
  let masterVolume = clampMusicVolume(options.masterVolume ?? DEFAULT_MASTER_VOLUME);
  let muted = options.muted ?? false;
  let duckFactor = 1;
  let current: MusicName | null = null;

  const effectiveGain = (track: MusicTrack): number =>
    musicGain(track.gain, masterVolume, { bus: volume, muted, duck: duckFactor });

  const applyGain = (fadeMs: number): void => {
    if (current === null) return;
    backend.setGain(effectiveGain(MUSIC_LIBRARY[current]), fadeMs);
  };

  const mixChanged = (): void => {
    applyGain(150);
  };

  return {
    get supported() {
      return backend.supported;
    },
    get track() {
      return current;
    },
    get volume() {
      return volume;
    },
    get masterVolume() {
      return masterVolume;
    },
    get muted() {
      return muted;
    },
    get ducked() {
      return duckFactor < 1;
    },
    play(name, playOptions = {}) {
      if (!backend.supported) return false;
      if (current === name && playOptions.restart !== true) return true;
      const track = MUSIC_LIBRARY[name];
      current = name;
      backend.play(
        track,
        effectiveGain(track),
        Math.max(0, playOptions.fadeMs ?? MUSIC_DEFAULT_FADE_MS),
      );
      return true;
    },
    playScene(scene, playOptions) {
      const name = trackForScene(scene);
      if (name === null) {
        this.stop();
        return false;
      }
      return this.play(name, playOptions);
    },
    stop(fadeMs = 0) {
      current = null;
      backend.stop(Math.max(0, fadeMs));
    },
    setVolume(next) {
      volume = clampMusicVolume(next);
      mixChanged();
    },
    setMasterVolume(next) {
      masterVolume = clampMusicVolume(next);
      mixChanged();
    },
    setMuted(next) {
      muted = next;
      mixChanged();
    },
    duck(factor = DEFAULT_DUCK, fadeMs = 250) {
      duckFactor = clamp01(factor);
      applyGain(fadeMs);
    },
    unduck(fadeMs = 400) {
      duckFactor = 1;
      applyGain(fadeMs);
    },
    async unlock() {
      await backend.resume?.();
    },
    dispose() {
      current = null;
      backend.dispose();
    },
  };
}

/* --------------------------------------------------------------------------
 * Scene bridge
 * ------------------------------------------------------------------------ */

/**
 * The track a scene should play, or `null` for silence. Pure and deterministic,
 * so every visit to a place sounds the same.
 *
 * - **Camp / officers' mess / title** — the warm camp air (mapping §14).
 * - **Muster** — the fife-and-drum march.
 * - **Battle** — the field march.
 * - **Victory / defeat** — the one-shot result stings.
 * - **No-Man's Land** — the lawless quiet of a Jagd (mapping §9).
 */
export function trackForScene(scene: MusicScene): MusicName | null {
  switch (scene) {
    case "title":
    case "camp":
    case "officersMess":
      return "camp";
    case "muster":
      return "muster";
    case "battle":
      return "battle";
    case "victory":
      return "victory";
    case "defeat":
      return "defeat";
    case "noMansLand":
      return "noMansLand";
    default:
      return null;
  }
}

/* --------------------------------------------------------------------------
 * Lazy app-wide singleton
 * ------------------------------------------------------------------------ */

let shared: MusicPlayer | undefined;

/**
 * The process-wide player, created on first use. The context itself is still
 * lazy (only the *backend object* is made here), so calling this early — before
 * a user gesture — is safe.
 */
export function getMusic(): MusicPlayer {
  shared ??= createMusicPlayer();
  return shared;
}

/** Apply the camp's master volume to the shared player (`src/ui/Settings.tsx`). */
export function setMusicMasterVolume(volume: number): void {
  getMusic().setMasterVolume(volume);
}

/** Set the music-bus level on the shared player (a separate fader from SFX). */
export function setMusicVolume(volume: number): void {
  getMusic().setVolume(volume);
}

/** Mute or unmute the shared player (the camp's "silent camp" toggle). */
export function setMusicMuted(muted: boolean): void {
  getMusic().setMuted(muted);
}

/** Play the shared player's track for a scene; unknown scenes stop it. */
export function playMusicScene(scene: MusicScene, options?: MusicPlayOptions): boolean {
  return getMusic().playScene(scene, options);
}

/** Duck the shared score under a loud stinger (e.g. a cannon volley). */
export function duckMusic(factor?: number, fadeMs?: number): void {
  getMusic().duck(factor, fadeMs);
}

/** Restore the shared score after a stinger has passed. */
export function unduckMusic(fadeMs?: number): void {
  getMusic().unduck(fadeMs);
}
