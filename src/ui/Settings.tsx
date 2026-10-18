/**
 * Settings (T103) — the camp preferences screen, persisted through the
 * versioned {@link SaveStore} laid down by T100.
 *
 * This module owns presentation only; the settings shape, defaults, defensive
 * reader and `SaveStore` round-trip live in the framework-free
 * `src/ui/settingsModel.ts` so they can be shared without tripping React
 * Refresh.
 * The screen surfaces five families of preference, matching the task's
 * definition of done:
 *
 * - **Volume** — a master 0–100 level, ready for the audio layer (T107/T108).
 * - **Text speed** — slow / normal / fast / instant, for message pacing.
 * - **Damage numbers** — whether the field HUD floats casualty figures.
 * - **Colour-blind mode** — off / protanopia / deuteranopia / tritanopia, with
 *   an on-screen palette preview so the choice is visible before T109 wires the
 *   battle palette to it.
 * - **Keybinds** — one keyboard binding per action, rebound by pressing a key.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Edge layer.** This module is React/DOM; it imports the persistence layer
 *   and the settings model but nothing from `src/engine`.
 * - **Engine stays pure.** Settings never touch the deterministic simulation.
 * - **Data, not branches.** Speeds, colour modes and keybind actions are data
 *   arrays so a new option is a list entry, not a new code path.
 *
 * The fiction is original: preferences for a Napoleonic free company, not a
 * port of FFTA's options menu (mapping §3, §14 D6).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SaveStore } from "../persist";
import {
  COLOUR_BLIND_MODES,
  COLOUR_BLIND_PALETTES,
  DEFAULT_KEYBINDS,
  DEFAULT_SETTINGS,
  KEYBIND_ACTIONS,
  KEYBIND_LABELS,
  MODIFIER_KEYS,
  TEXT_SPEEDS,
  TEXT_SPEED_NOTES,
  createDefaultSettingsStore,
  formatKey,
  loadSettings,
  saveSettings,
  type ColourBlindMode,
  type Settings as SettingsValue,
  type TextSpeed,
} from "./settingsModel";

/** Props for {@link Settings}. */
export interface SettingsProps {
  /** The persistence backend. Defaults to IndexedDB with a memory fallback. */
  readonly store?: SaveStore;
  /** Settings to open with, skipping the initial read (used in unit tests). */
  readonly initial?: SettingsValue;
  /** Called after every change with the resulting settings. */
  readonly onChange?: (settings: SettingsValue) => void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The camp settings screen: audio, reading, HUD, colour and keybind
 * preferences, read from and written to the {@link SaveStore}.
 */
export function Settings({ store: storeProp, initial, onChange }: SettingsProps) {
  const store = useMemo(() => storeProp ?? createDefaultSettingsStore(), [storeProp]);
  const [settings, setSettings] = useState<SettingsValue>(() => initial ?? DEFAULT_SETTINGS);
  // Saving stays gated until the stored record has been read, so opening the
  // screen never overwrites a player's preferences with the stock defaults.
  const [hydrated, setHydrated] = useState(initial !== undefined);
  const [status, setStatus] = useState<string>("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [capturing, setCapturing] = useState<(typeof KEYBIND_ACTIONS)[number] | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Read the persisted record once on mount.
  useEffect(() => {
    if (hydrated) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadSettings(store);
        if (cancelled) return;
        setSettings(loaded);
        setStatus("");
        setHydrated(true);
      } catch (error) {
        if (cancelled) return;
        setStatus(`Could not read saved settings: ${describe(error)}`);
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, store]);

  // Write the record back whenever it changes (and once after hydration).
  useEffect(() => {
    if (!hydrated) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const envelope = await saveSettings(store, settings);
        if (!cancelled) setSavedAt(envelope.savedAt);
      } catch (error) {
        if (!cancelled) setStatus(`Could not save settings: ${describe(error)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, settings, store]);

  // Mirror the preferences onto the document root for the presentation layer.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.colourBlind = settings.colourBlind;
    root.dataset.damageNumbers = settings.damageNumbers ? "on" : "off";
    root.dataset.textSpeed = settings.textSpeed;
    root.dataset.volume = String(settings.volume);
  }, [settings]);

  // Capture the next keypress while a binding is being rebound. The listener
  // runs in the capture phase and stops propagation so the global input
  // controller never sees the key as a command.
  useEffect(() => {
    if (capturing === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturing(null);
        return;
      }
      if (MODIFIER_KEYS.has(event.key)) return;
      const action = capturing;
      setSettings((current) => ({
        ...current,
        keybinds: { ...current.keybinds, [action]: event.key },
      }));
      setCapturing(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing]);

  const update = useCallback((patch: Partial<SettingsValue>): void => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      onChangeRef.current?.(next);
      return next;
    });
  }, []);

  const resetAll = useCallback((): void => {
    setSettings({ ...DEFAULT_SETTINGS, keybinds: { ...DEFAULT_KEYBINDS } });
    setStatus("Settings restored to issue defaults.");
  }, []);

  const resetKeybinds = useCallback((): void => {
    setSettings((current) => ({ ...current, keybinds: { ...DEFAULT_KEYBINDS } }));
    setStatus("Keybinds restored to issue defaults.");
  }, []);

  const palette = COLOUR_BLIND_PALETTES[settings.colourBlind];

  return (
    <section className="settings-screen" data-testid="settings-screen" aria-label="Settings">
      <header className="settings-screen__header">
        <div>
          <p className="kicker">Camp Keep · Settings</p>
          <h2>Preferences &amp; Keybinds</h2>
          <p className="muted">
            Set the volume, the pace of dispatches and how the field reads — then bind the keys the
            company answers to. Preferences are filed with the campaign record.
          </p>
        </div>
        <dl className="settings-screen__summary" data-testid="settings-summary">
          <div>
            <dt>Volume</dt>
            <dd data-testid="settings-summary-volume">{settings.volume}%</dd>
          </div>
          <div>
            <dt>Text speed</dt>
            <dd data-testid="settings-summary-text-speed">{settings.textSpeed}</dd>
          </div>
          <div>
            <dt>Damage numbers</dt>
            <dd data-testid="settings-summary-damage-numbers">
              {settings.damageNumbers ? "Shown" : "Hidden"}
            </dd>
          </div>
          <div>
            <dt>Colour-blind</dt>
            <dd data-testid="settings-summary-colour-blind">{palette.name}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd data-testid="settings-summary-version">v{settings.version}</dd>
          </div>
          <div>
            <dt>Filed</dt>
            <dd data-testid="settings-summary-saved">
              {savedAt === null ? "—" : new Date(savedAt).toLocaleTimeString()}
            </dd>
          </div>
        </dl>
      </header>

      <div className="settings-screen__body">
        <section className="settings-panel" aria-label="Audio">
          <h3>Audio</h3>
          <label className="settings-field" htmlFor="settings-volume">
            <span>Master volume</span>
            <output data-testid="settings-volume-value">{settings.volume}%</output>
          </label>
          <input
            id="settings-volume"
            className="settings-range"
            data-testid="settings-volume"
            type="range"
            min={0}
            max={100}
            step={5}
            value={settings.volume}
            aria-valuetext={`${settings.volume}%`}
            onChange={(event) => update({ volume: Number(event.target.value) })}
          />
          <div className="settings-inline">
            <button
              type="button"
              className="button button--ghost"
              data-testid="settings-mute"
              onClick={() => update({ volume: 0 })}
            >
              Mute
            </button>
            <button
              type="button"
              className="button button--ghost"
              data-testid="settings-volume-full"
              onClick={() => update({ volume: 100 })}
            >
              Full
            </button>
          </div>
          <p className="muted">The audio layer honours this once its files are in (T107).</p>
        </section>

        <section className="settings-panel" aria-label="Text speed">
          <h3>Text speed</h3>
          <label className="settings-field" htmlFor="settings-text-speed">
            <span>Dispatch pacing</span>
          </label>
          <select
            id="settings-text-speed"
            className="settings-select"
            data-testid="settings-text-speed"
            value={settings.textSpeed}
            onChange={(event) => update({ textSpeed: event.target.value as TextSpeed })}
          >
            {TEXT_SPEEDS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}
              </option>
            ))}
          </select>
          <p className="muted" data-testid="settings-text-speed-note">
            {TEXT_SPEED_NOTES[settings.textSpeed]}
          </p>
        </section>

        <section className="settings-panel" aria-label="Field HUD">
          <h3>Field HUD</h3>
          <label className="settings-toggle" htmlFor="settings-damage-numbers">
            <input
              id="settings-damage-numbers"
              data-testid="settings-damage-numbers"
              type="checkbox"
              checked={settings.damageNumbers}
              onChange={(event) => update({ damageNumbers: event.target.checked })}
            />
            <span>Show damage numbers</span>
          </label>
          <p className="muted">
            Casualty figures float over the field after each volley. Turn them off for a cleaner
            board.
          </p>
        </section>

        <section className="settings-panel" aria-label="Colour-blind mode">
          <h3>Colour-blind mode</h3>
          <label className="settings-field" htmlFor="settings-colour-blind">
            <span>Palette</span>
          </label>
          <select
            id="settings-colour-blind"
            className="settings-select"
            data-testid="settings-colour-blind"
            value={settings.colourBlind}
            onChange={(event) => update({ colourBlind: event.target.value as ColourBlindMode })}
          >
            {COLOUR_BLIND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {COLOUR_BLIND_PALETTES[mode].name}
              </option>
            ))}
          </select>
          <div
            className="settings-palette"
            data-testid="settings-palette"
            data-mode={settings.colourBlind}
            aria-label={`${palette.name} swatches`}
          >
            {palette.colours.map((colour) => (
              <span
                key={colour}
                className="settings-palette__swatch"
                style={{ background: colour }}
                data-testid="settings-palette-swatch"
              />
            ))}
          </div>
          <p className="muted" data-testid="settings-colour-blind-note">
            {palette.note}
          </p>
        </section>

        <section className="settings-panel settings-panel--wide" aria-label="Keybinds">
          <h3>Keybinds</h3>
          <p className="muted">
            Order the company answers to. Choose <em>Rebind</em>, then press a key; Escape cancels.
          </p>
          <table className="settings-table" data-testid="settings-keybinds">
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Key</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {KEYBIND_ACTIONS.map((action) => (
                <tr key={action} data-testid={`settings-keybind-${action}`}>
                  <th scope="row">{KEYBIND_LABELS[action]}</th>
                  <td data-testid={`settings-keybind-${action}-key`}>
                    <kbd>{formatKey(settings.keybinds[action])}</kbd>
                  </td>
                  <td className="settings-table__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      data-testid={`settings-rebind-${action}`}
                      data-capturing={capturing === action}
                      aria-pressed={capturing === action}
                      onClick={() => setCapturing(action)}
                    >
                      {capturing === action ? "Press a key…" : "Rebind"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="button button--ghost"
            data-testid="settings-reset-keybinds"
            onClick={resetKeybinds}
          >
            Reset keybinds
          </button>
        </section>

        <section className="settings-panel" aria-label="Restore defaults">
          <h3>Restore defaults</h3>
          <p className="muted">Return every preference and binding to the issue settings.</p>
          <button type="button" className="button" data-testid="settings-reset" onClick={resetAll}>
            Reset all settings
          </button>
          <p
            className="settings-status"
            data-testid="settings-status"
            role="status"
            aria-live="polite"
          >
            {status.length > 0 ? status : savedAt === null ? "Ready." : "Preferences filed."}
          </p>
        </section>
      </div>
    </section>
  );
}
