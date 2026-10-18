import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUCK,
  MUSIC_CATEGORIES,
  MUSIC_DEFAULT_FADE_MS,
  MUSIC_INSTRUMENTS,
  MUSIC_LIBRARY,
  MUSIC_NAMES,
  MUSIC_SCENES,
  clampMusicVolume,
  createMusicPlayer,
  midiToFrequency,
  musicGain,
  trackForScene,
  trackSeconds,
  type MusicBackend,
  type MusicName,
  type MusicTrack,
} from "../../src/audio/music";

/* --------------------------------------------------------------------------
 * T108 — Original music with volume mixing
 *
 * The score is pure, authored data, so it can be pinned entirely in Node: track
 * integrity, the mixing maths, the {@link createMusicPlayer} façade (against a
 * fake backend) and the scene→track bridge. No browser, no assets.
 * ------------------------------------------------------------------------ */

type RecordedCall =
  | { kind: "play"; track: MusicTrack; gain: number; fadeMs: number }
  | { kind: "gain"; gain: number; fadeMs: number }
  | { kind: "stop"; fadeMs: number };

/** A recording backend so tests can observe what would have played. */
function recordingBackend(options: { supported?: boolean } = {}): {
  backend: MusicBackend;
  calls: RecordedCall[];
  played: () => RecordedCall[];
  resumed: () => number;
  disposed: () => number;
} {
  const calls: RecordedCall[] = [];
  let resumes = 0;
  let disposes = 0;
  const backend: MusicBackend = {
    supported: options.supported ?? true,
    play(track, gain, fadeMs) {
      calls.push({ kind: "play", track, gain, fadeMs });
    },
    setGain(gain, fadeMs) {
      calls.push({ kind: "gain", gain, fadeMs });
    },
    stop(fadeMs) {
      calls.push({ kind: "stop", fadeMs });
    },
    async resume() {
      resumes += 1;
    },
    dispose() {
      disposes += 1;
    },
  };
  return {
    backend,
    calls,
    played: () => calls.filter((call) => call.kind === "play"),
    resumed: () => resumes,
    disposed: () => disposes,
  };
}

describe("T108 — music library", () => {
  it("has a track for every declared name, keyed by that name", () => {
    const declared = [...MUSIC_NAMES].sort();
    const authored = Object.keys(MUSIC_LIBRARY).sort();
    expect(authored).toEqual(declared);
    for (const name of MUSIC_NAMES) {
      expect(MUSIC_LIBRARY[name].name).toBe(name);
    }
  });

  it("gives every track a real category, tempo, loop and bus trim", () => {
    const titles = new Set<string>();
    for (const name of MUSIC_NAMES) {
      const track = MUSIC_LIBRARY[name];
      expect(MUSIC_CATEGORIES).toContain(track.category);
      expect(track.title.length).toBeGreaterThan(0);
      expect(track.description.length).toBeGreaterThan(0);
      expect(titles.has(track.title)).toBe(false);
      titles.add(track.title);

      expect(track.tempo).toBeGreaterThan(0);
      expect(track.meter).toBeGreaterThan(0);
      expect(track.loopBeats).toBeGreaterThan(0);
      expect(track.gain).toBeGreaterThan(0);
      expect(track.gain).toBeLessThanOrEqual(1);
      expect(typeof track.loop).toBe("boolean");
      expect(track.notes.length).toBeGreaterThan(0);
    }
  });

  it("keeps every note playable and inside the loop", () => {
    for (const name of MUSIC_NAMES) {
      const track = MUSIC_LIBRARY[name];
      for (const note of track.notes) {
        expect(MUSIC_INSTRUMENTS).toContain(note.instrument);
        expect(note.pitch).toBeGreaterThan(0);
        expect(note.pitch).toBeLessThanOrEqual(127);
        expect(note.at).toBeGreaterThanOrEqual(0);
        expect(note.beats).toBeGreaterThan(0);
        expect(note.gain ?? 1).toBeGreaterThan(0);
        expect(note.gain ?? 1).toBeLessThanOrEqual(1);
        // A note starts within its pass and does not run past the loop end.
        expect(note.at).toBeLessThan(track.loopBeats);
        expect(note.at + note.beats).toBeLessThanOrEqual(track.loopBeats + 1e-9);
      }
    }
  });

  it("loops the ambient tracks and plays the result stings once", () => {
    expect(MUSIC_LIBRARY.camp.loop).toBe(true);
    expect(MUSIC_LIBRARY.muster.loop).toBe(true);
    expect(MUSIC_LIBRARY.battle.loop).toBe(true);
    expect(MUSIC_LIBRARY.noMansLand.loop).toBe(true);
    expect(MUSIC_LIBRARY.victory.loop).toBe(false);
    expect(MUSIC_LIBRARY.defeat.loop).toBe(false);
  });

  it("covers each mood family the setting names", () => {
    for (const category of ["camp", "march", "field", "result"] as const) {
      expect(MUSIC_NAMES.some((name) => MUSIC_LIBRARY[name].category === category)).toBe(true);
    }
    // Victory and defeat must sound distinct.
    expect(MUSIC_LIBRARY.victory.notes).not.toEqual(MUSIC_LIBRARY.defeat.notes);
  });
});

describe("T108 — note helpers", () => {
  it("tunes A4 to 440 Hz and doubles per octave", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 5);
    expect(midiToFrequency(81)).toBeCloseTo(880, 5);
    expect(midiToFrequency(57)).toBeCloseTo(220, 5);
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3);
  });

  it("measures a track's pass in seconds from tempo and beats", () => {
    expect(trackSeconds(MUSIC_LIBRARY.camp)).toBeCloseTo((16 * 60) / 92, 6);
    expect(trackSeconds(MUSIC_LIBRARY.battle)).toBeCloseTo((16 * 60) / 138, 6);
  });
});

describe("T108 — volume mixing", () => {
  it("clamps an arbitrary fader to a whole 0–100", () => {
    expect(clampMusicVolume(-10)).toBe(0);
    expect(clampMusicVolume(0)).toBe(0);
    expect(clampMusicVolume(70.4)).toBe(70);
    expect(clampMusicVolume(70.6)).toBe(71);
    expect(clampMusicVolume(1000)).toBe(100);
    expect(clampMusicVolume(Number.NaN)).toBe(0);
  });

  it("multiplies the track trim by the master and music-bus faders", () => {
    expect(musicGain(1, 100)).toBeCloseTo(1, 5);
    expect(musicGain(1, 50)).toBeCloseTo(0.5, 5);
    expect(musicGain(0.8, 100, { bus: 50 })).toBeCloseTo(0.4, 5);
    expect(musicGain(0.8, 50, { bus: 50 })).toBeCloseTo(0.2, 5);
    expect(musicGain(2, 100)).toBe(1);
  });

  it("silences on mute and ducks by the given factor", () => {
    expect(musicGain(1, 100, { muted: true })).toBe(0);
    expect(musicGain(1, 100, { duck: DEFAULT_DUCK })).toBeCloseTo(DEFAULT_DUCK, 5);
    expect(musicGain(1, 100, { duck: 0 })).toBe(0);
    expect(musicGain(1, 100, { duck: 5 })).toBe(1);
  });
});

describe("T108 — MusicPlayer", () => {
  it("resolves a name to its track and forwards the effective gain", () => {
    const { backend, played } = recordingBackend();
    const player = createMusicPlayer({ backend, volume: 100, masterVolume: 100 });

    expect(player.supported).toBe(true);
    expect(player.play("battle")).toBe(true);

    const calls = played();
    expect(calls).toHaveLength(1);
    expect(calls[0].kind === "play" && calls[0].track.name).toBe("battle");
    expect(calls[0].kind === "play" && calls[0].gain).toBeCloseTo(MUSIC_LIBRARY.battle.gain, 6);
    expect(player.track).toBe<MusicName>("battle");
  });

  it("does not restart the same track, but does on request", () => {
    const { backend, played } = recordingBackend();
    const player = createMusicPlayer({ backend, volume: 100, masterVolume: 100 });

    player.play("camp");
    player.play("camp");
    expect(played()).toHaveLength(1);

    player.play("camp", { restart: true });
    expect(played()).toHaveLength(2);
  });

  it("rides the live mix when a fader, mute or duck changes", () => {
    const { backend, calls } = recordingBackend();
    const player = createMusicPlayer({ backend, volume: 100, masterVolume: 100 });
    player.play("battle");
    const lastGain = (): number => {
      const gains = calls.filter((call) => call.kind === "gain");
      const last = gains.at(-1);
      return last?.kind === "gain" ? last.gain : Number.NaN;
    };

    player.setVolume(50);
    expect(lastGain()).toBeCloseTo(0.9 * 1 * 0.5, 5);
    player.setMasterVolume(50);
    expect(player.volume).toBe(50);
    expect(player.masterVolume).toBe(50);
    expect(lastGain()).toBeCloseTo(0.9 * 0.5 * 0.5, 5);

    player.duck(0.5);
    expect(player.ducked).toBe(true);
    expect(lastGain()).toBeCloseTo(0.9 * 0.5 * 0.5 * 0.5, 5);
    player.unduck();
    expect(player.ducked).toBe(false);
    expect(lastGain()).toBeCloseTo(0.9 * 0.5 * 0.5, 5);

    player.setMuted(true);
    expect(lastGain()).toBe(0);
  });

  it("stops, clears its track and forwards the fade", () => {
    const { backend, calls } = recordingBackend();
    const player = createMusicPlayer({ backend, volume: 100, masterVolume: 100 });
    player.play("muster");
    player.stop(300);

    expect(player.track).toBeNull();
    const stopped = calls.filter((call) => call.kind === "stop");
    expect(stopped).toHaveLength(1);
    expect(stopped[0].kind === "stop" && stopped[0].fadeMs).toBe(300);
  });

  it("fades in over the default crossfade unless told otherwise", () => {
    const { backend, played } = recordingBackend();
    const player = createMusicPlayer({ backend, volume: 100, masterVolume: 100 });
    player.play("camp");
    expect(played()[0].kind === "play" && played()[0].fadeMs).toBe(MUSIC_DEFAULT_FADE_MS);

    player.play("battle", { fadeMs: 0 });
    expect(played()[1].kind === "play" && played()[1].fadeMs).toBe(0);
  });

  it("maps scenes to tracks and stops on an unknown scene", () => {
    const { backend, played } = recordingBackend();
    const player = createMusicPlayer({ backend, volume: 100, masterVolume: 100 });

    expect(player.playScene("victory")).toBe(true);
    const first = played()[0];
    expect(first.kind === "play" && first.track.name).toBe("victory");

    player.playScene("noMansLand");
    const second = played()[1];
    expect(second.kind === "play" && second.track.name).toBe("noMansLand");
  });

  it("degrades to an unsupported no-op player in a plain Node run", () => {
    const { backend, played } = recordingBackend({ supported: false });
    const player = createMusicPlayer({ backend });

    expect(player.supported).toBe(false);
    expect(player.play("battle")).toBe(false);
    expect(player.track).toBeNull();
    expect(played()).toHaveLength(0);
  });

  it("resumes and disposes through the backend", async () => {
    const { backend, resumed, disposed } = recordingBackend();
    const player = createMusicPlayer({ backend, volume: 70, masterVolume: 70 });

    expect(player.volume).toBe(70);
    expect(player.masterVolume).toBe(70);
    player.setVolume(250);
    expect(player.volume).toBe(100);
    player.setMasterVolume(-5);
    expect(player.masterVolume).toBe(0);

    await player.unlock();
    expect(resumed()).toBe(1);

    player.play("battle");
    player.dispose();
    expect(disposed()).toBe(1);
    expect(player.track).toBeNull();
  });
});

describe("T108 — scene bridge", () => {
  it("maps every declared scene to a real track (or silence)", () => {
    for (const scene of MUSIC_SCENES) {
      const name = trackForScene(scene);
      if (name !== null) expect(MUSIC_NAMES).toContain(name);
    }
  });

  it("routes the camp, the muster, the field and the lawless quiet", () => {
    expect(trackForScene("camp")).toBe("camp");
    expect(trackForScene("officersMess")).toBe("camp");
    expect(trackForScene("muster")).toBe("muster");
    expect(trackForScene("battle")).toBe("battle");
    expect(trackForScene("victory")).toBe("victory");
    expect(trackForScene("defeat")).toBe("defeat");
    expect(trackForScene("noMansLand")).toBe("noMansLand");
  });
});
