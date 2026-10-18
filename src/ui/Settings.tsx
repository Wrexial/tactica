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
import { useTranslation, type MessageKey, type TranslationVars } from "../i18n";
import { applyColourBlindPalette } from "./a11y";
import {
  COLOUR_BLIND_MODES,
  COLOUR_BLIND_PALETTES,
  DEFAULT_KEYBINDS,
  DEFAULT_SETTINGS,
  KEYBIND_ACTIONS,
  KEYBIND_LABEL_KEYS,
  MODIFIER_KEYS,
  TEXT_SPEED_LABEL_KEYS,
  TEXT_SPEED_NOTE_KEYS,
  TEXT_SPEEDS,
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

/** A status line kept as a key so the active locale resolves it at render. */
type StatusMessage = { readonly key: MessageKey; readonly vars?: TranslationVars } | null;

/**
 * The camp settings screen: audio, reading, HUD, colour and keybind
 * preferences, read from and written to the {@link SaveStore}.
 */
export function Settings({ store: storeProp, initial, onChange }: SettingsProps) {
  const { t } = useTranslation();
  const store = useMemo(() => storeProp ?? createDefaultSettingsStore(), [storeProp]);
  const [settings, setSettings] = useState<SettingsValue>(() => initial ?? DEFAULT_SETTINGS);
  // Saving stays gated until the stored record has been read, so opening the
  // screen never overwrites a player's preferences with the stock defaults.
  const [hydrated, setHydrated] = useState(initial !== undefined);
  const [status, setStatus] = useState<StatusMessage>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [capturing, setCapturing] = useState<(typeof KEYBIND_ACTIONS)[number] | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Set once the player has changed anything, so a late IndexedDB read can
  // never clobber a live edit with the stale stored record.
  const dirtyRef = useRef(false);

  // Read the persisted record once on mount.
  useEffect(() => {
    if (hydrated) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadSettings(store);
        if (cancelled) return;
        setSettings((current) => (dirtyRef.current ? current : loaded));
        setStatus(null);
        setHydrated(true);
      } catch (error) {
        if (cancelled) return;
        setStatus({ key: "settings.readError", vars: { error: describe(error) } });
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
        if (!cancelled) setStatus({ key: "settings.writeError", vars: { error: describe(error) } });
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
    applyColourBlindPalette(settings.colourBlind, root);
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
      dirtyRef.current = true;
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
    dirtyRef.current = true;
    setSettings((current) => {
      const next = { ...current, ...patch };
      onChangeRef.current?.(next);
      return next;
    });
  }, []);

  const resetAll = useCallback((): void => {
    dirtyRef.current = true;
    setSettings({ ...DEFAULT_SETTINGS, keybinds: { ...DEFAULT_KEYBINDS } });
    setStatus({ key: "settings.defaultsRestored" });
  }, []);

  const resetKeybinds = useCallback((): void => {
    dirtyRef.current = true;
    setSettings((current) => ({ ...current, keybinds: { ...DEFAULT_KEYBINDS } }));
    setStatus({ key: "settings.keybindsRestored" });
  }, []);

  const palette = COLOUR_BLIND_PALETTES[settings.colourBlind];

  return (
    <section className="settings-screen" data-testid="settings-screen" aria-label={t("settings.label")}>
      <header className="settings-screen__header">
        <div>
          <p className="kicker">{t("settings.header.kicker")}</p>
          <h2>{t("settings.header.title")}</h2>
          <p className="muted">{t("settings.header.blurb")}</p>
        </div>
        <dl className="settings-screen__summary" data-testid="settings-summary">
          <div>
            <dt>{t("settings.volume")}</dt>
            <dd data-testid="settings-summary-volume">{settings.volume}%</dd>
          </div>
          <div>
            <dt>{t("settings.textSpeed")}</dt>
            <dd data-testid="settings-summary-text-speed">{t(TEXT_SPEED_LABEL_KEYS[settings.textSpeed])}</dd>
          </div>
          <div>
            <dt>{t("settings.damageNumbers")}</dt>
            <dd data-testid="settings-summary-damage-numbers">
              {settings.damageNumbers ? t("settings.shown") : t("settings.hidden")}
            </dd>
          </div>
          <div>
            <dt>{t("settings.colourBlind")}</dt>
            <dd data-testid="settings-summary-colour-blind">{t(palette.nameKey)}</dd>
          </div>
          <div>
            <dt>{t("settings.format")}</dt>
            <dd data-testid="settings-summary-version">v{settings.version}</dd>
          </div>
          <div>
            <dt>{t("settings.filed")}</dt>
            <dd data-testid="settings-summary-saved">
              {savedAt === null ? t("common.none") : new Date(savedAt).toLocaleTimeString()}
            </dd>
          </div>
        </dl>
      </header>

      <div className="settings-screen__body">
        <section className="settings-panel" aria-label={t("settings.audio")}>
          <h3>{t("settings.audio")}</h3>
          <label className="settings-field" htmlFor="settings-volume">
            <span>{t("settings.masterVolume")}</span>
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
              {t("settings.mute")}
            </button>
            <button
              type="button"
              className="button button--ghost"
              data-testid="settings-volume-full"
              onClick={() => update({ volume: 100 })}
            >
              {t("settings.full")}
            </button>
          </div>
          <p className="muted">{t("settings.audioNote")}</p>
        </section>

        <section className="settings-panel" aria-label={t("settings.textSpeedLabel")}>
          <h3>{t("settings.textSpeed")}</h3>
          <label className="settings-field" htmlFor="settings-text-speed">
            <span>{t("settings.dispatchPacing")}</span>
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
                {t(TEXT_SPEED_LABEL_KEYS[speed])}
              </option>
            ))}
          </select>
          <p className="muted" data-testid="settings-text-speed-note">
            {t(TEXT_SPEED_NOTE_KEYS[settings.textSpeed])}
          </p>
        </section>

        <section className="settings-panel" aria-label={t("settings.fieldHud")}>
          <h3>{t("settings.fieldHud")}</h3>
          <label className="settings-toggle" htmlFor="settings-damage-numbers">
            <input
              id="settings-damage-numbers"
              data-testid="settings-damage-numbers"
              type="checkbox"
              checked={settings.damageNumbers}
              onChange={(event) => update({ damageNumbers: event.target.checked })}
            />
            <span>{t("settings.showDamageNumbers")}</span>
          </label>
          <p className="muted">{t("settings.damageNumbersNote")}</p>
        </section>

        <section className="settings-panel" aria-label={t("settings.colourBlindMode")}>
          <h3>{t("settings.colourBlindMode")}</h3>
          <label className="settings-field" htmlFor="settings-colour-blind">
            <span>{t("settings.palette")}</span>
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
                {t(COLOUR_BLIND_PALETTES[mode].nameKey)}
              </option>
            ))}
          </select>
          <div
            className="settings-palette"
            data-testid="settings-palette"
            data-mode={settings.colourBlind}
            aria-label={t("settings.paletteAria", { palette: t(palette.nameKey) })}
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
            {t(palette.noteKey)}
          </p>
        </section>

        <section className="settings-panel settings-panel--wide" aria-label={t("settings.keybinds")}>
          <h3>{t("settings.keybinds")}</h3>
          <p className="muted">{t("settings.keybindsNote")}</p>
          <table className="settings-table" data-testid="settings-keybinds">
            <thead>
              <tr>
                <th scope="col">{t("common.action")}</th>
                <th scope="col">{t("common.key")}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {KEYBIND_ACTIONS.map((action) => (
                <tr key={action} data-testid={`settings-keybind-${action}`}>
                  <th scope="row">{t(KEYBIND_LABEL_KEYS[action])}</th>
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
                      {capturing === action ? t("settings.pressAKey") : t("settings.rebind")}
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
            {t("settings.resetKeybinds")}
          </button>
        </section>

        <section className="settings-panel" aria-label={t("settings.restoreLabel")}>
          <h3>{t("settings.restoreDefaults")}</h3>
          <p className="muted">{t("settings.restoreDefaultsNote")}</p>
          <button type="button" className="button" data-testid="settings-reset" onClick={resetAll}>
            {t("settings.resetAll")}
          </button>
          <p
            className="settings-status"
            data-testid="settings-status"
            role="status"
            aria-live="polite"
          >
            {status !== null
              ? t(status.key, status.vars)
              : savedAt === null
                ? t("settings.ready")
                : t("settings.filedStatus")}
          </p>
        </section>
      </div>
    </section>
  );
}
