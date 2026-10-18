/**
 * Settings model & persistence helpers (T103).
 *
 * Kept apart from the `Settings.tsx` component so the React module exports only
 * components (the `react-refresh` rule) while the rest of the app can still
 * share the settings shape, defaults and the `SaveStore` round-trip:
 *
 * ```
 *   loadSettings(store)  ──►  Settings          (empty slot → issue defaults)
 *   saveSettings(store, settings)  ──►  SaveEnvelope<Settings>
 *   normalizeSettings(payload)     ──►  Settings  (defensive, never throws)
 * ```
 *
 * The model is the edge layer's own; it never reaches into the deterministic
 * engine, and every field is JSON-safe so it rides the same versioned
 * {@link SaveStore} as the campaign (`agents.md` §2, §3, §7).
 */

import {
  createIndexedDbSaveStore,
  createMemorySaveStore,
  isIndexedDbAvailable,
  type SaveEnvelope,
  type SaveStore,
} from "../persist";
import { t, type MessageKey } from "../i18n";

/* --------------------------------------------------------------------------
 * Model
 * ------------------------------------------------------------------------ */

/** Reserved save slot for the settings record (separate from campaign slots). */
export const SETTINGS_SLOT = "settings";

/** Version of the persisted settings shape. Bump when fields change. */
export const SETTINGS_VERSION = 1;

/** The selectable message pacing values, in display order. */
export const TEXT_SPEEDS = ["slow", "normal", "fast", "instant"] as const;
export type TextSpeed = (typeof TEXT_SPEEDS)[number];

/** The supported colour-vision modes. */
export const COLOUR_BLIND_MODES = ["off", "protanopia", "deuteranopia", "tritanopia"] as const;
export type ColourBlindMode = (typeof COLOUR_BLIND_MODES)[number];

/** The rebindable keyboard actions, in display order. */
export const KEYBIND_ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "cancel",
  "orders",
  "menu",
] as const;
export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];

/** One keyboard binding per action, keyed by the event's `KeyboardEvent.key`. */
export type Keybinds = Readonly<Record<KeybindAction, string>>;

/** The complete, serializable settings value. */
export interface Settings {
  /** Shape version, so a future migration can tell records apart (T104). */
  readonly version: number;
  /** Master volume, 0–100. */
  readonly volume: number;
  /** Message pacing. */
  readonly textSpeed: TextSpeed;
  /** Whether casualty figures float over the field. */
  readonly damageNumbers: boolean;
  /** Colour-vision palette. */
  readonly colourBlind: ColourBlindMode;
  /** Keyboard bindings. */
  readonly keybinds: Keybinds;
}

/** The stock keyboard bindings, matching the controls diagram in `input.ts`. */
export const DEFAULT_KEYBINDS: Keybinds = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  confirm: "Enter",
  cancel: "Escape",
  orders: "O",
  menu: "M",
};

/** The stock settings a fresh company begins with. */
export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  volume: 70,
  textSpeed: "normal",
  damageNumbers: true,
  colourBlind: "off",
  keybinds: DEFAULT_KEYBINDS,
};

/** Catalog keys for each rebindable action. */
export const KEYBIND_LABEL_KEYS: Readonly<Record<KeybindAction, MessageKey>> = {
  up: "settings.keybind.up",
  down: "settings.keybind.down",
  left: "settings.keybind.left",
  right: "settings.keybind.right",
  confirm: "settings.keybind.confirm",
  cancel: "settings.keybind.cancel",
  orders: "settings.keybind.orders",
  menu: "settings.keybind.menu",
};

/** Catalog keys for the blurb shown beside each text speed. */
export const TEXT_SPEED_NOTE_KEYS: Readonly<Record<TextSpeed, MessageKey>> = {
  slow: "settings.speedNote.slow",
  normal: "settings.speedNote.normal",
  fast: "settings.speedNote.fast",
  instant: "settings.speedNote.instant",
};

/** Catalog keys for each text speed's display label. */
export const TEXT_SPEED_LABEL_KEYS: Readonly<Record<TextSpeed, MessageKey>> = {
  slow: "settings.speed.slow",
  normal: "settings.speed.normal",
  fast: "settings.speed.fast",
  instant: "settings.speed.instant",
};

/** A colour-blind palette preview. */
export interface ColourBlindPalette {
  /** Catalog key for the palette's display name. */
  readonly nameKey: MessageKey;
  /** Catalog key for the palette's explanatory note. */
  readonly noteKey: MessageKey;
  readonly colours: readonly string[];
}

/** Preview swatches for each mode; presentation only until T109 uses them. */
export const COLOUR_BLIND_PALETTES: Readonly<Record<ColourBlindMode, ColourBlindPalette>> = {
  off: {
    nameKey: "settings.palette.off.name",
    noteKey: "settings.palette.off.note",
    colours: ["#22304a", "#b8891f", "#8a2f24", "#1d4d24"],
  },
  protanopia: {
    nameKey: "settings.palette.protanopia.name",
    noteKey: "settings.palette.protanopia.note",
    colours: ["#1b3a5c", "#d9b95c", "#7a4a12", "#20303f"],
  },
  deuteranopia: {
    nameKey: "settings.palette.deuteranopia.name",
    noteKey: "settings.palette.deuteranopia.note",
    colours: ["#1b3a5c", "#e0c264", "#1f6f8b", "#4a2f1a"],
  },
  tritanopia: {
    nameKey: "settings.palette.tritanopia.name",
    noteKey: "settings.palette.tritanopia.note",
    colours: ["#243d2c", "#c98a2b", "#6a2f4a", "#3a3a3a"],
  },
};

/* --------------------------------------------------------------------------
 * Validation & persistence
 * ------------------------------------------------------------------------ */

function isTextSpeed(value: unknown): value is TextSpeed {
  return typeof value === "string" && (TEXT_SPEEDS as readonly string[]).includes(value);
}

function isColourBlindMode(value: unknown): value is ColourBlindMode {
  return typeof value === "string" && (COLOUR_BLIND_MODES as readonly string[]).includes(value);
}

/** Clamp an unknown volume to a whole number in `[0, 100]`, or the default. */
function normalizeVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SETTINGS.volume;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Keep only non-empty string bindings; anything else falls back to default. */
function normalizeKeybinds(value: unknown): Keybinds {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const keybinds = {} as Record<KeybindAction, string>;
  for (const action of KEYBIND_ACTIONS) {
    const candidate = record[action];
    keybinds[action] =
      typeof candidate === "string" && candidate.length > 0 ? candidate : DEFAULT_KEYBINDS[action];
  }
  return keybinds;
}

/**
 * Coerce an arbitrary persisted payload into a valid {@link Settings}. Missing
 * or malformed fields fall back to their stock values, so an older or corrupt
 * record degrades gracefully instead of throwing.
 */
export function normalizeSettings(value: unknown): Settings {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    version: SETTINGS_VERSION,
    volume: normalizeVolume(record.volume),
    textSpeed: isTextSpeed(record.textSpeed) ? record.textSpeed : DEFAULT_SETTINGS.textSpeed,
    damageNumbers:
      typeof record.damageNumbers === "boolean"
        ? record.damageNumbers
        : DEFAULT_SETTINGS.damageNumbers,
    colourBlind: isColourBlindMode(record.colourBlind)
      ? record.colourBlind
      : DEFAULT_SETTINGS.colourBlind,
    keybinds: normalizeKeybinds(record.keybinds),
  };
}

/** Read the settings record, or the stock defaults when the slot is empty. */
export async function loadSettings(store: SaveStore): Promise<Settings> {
  const envelope = await store.load<unknown>(SETTINGS_SLOT);
  return envelope === null ? DEFAULT_SETTINGS : normalizeSettings(envelope.data);
}

/** Write the settings record into its reserved slot. */
export async function saveSettings(
  store: SaveStore,
  settings: Settings,
): Promise<SaveEnvelope<Settings>> {
  return store.save(SETTINGS_SLOT, settings, { label: t("settings.label") });
}

/** A human-readable label for a bound key. */
export function formatKey(key: string): string {
  if (key === " ") return t("settings.key.space");
  if (key === "ArrowUp") return t("settings.key.arrowUp");
  if (key === "ArrowDown") return t("settings.key.arrowDown");
  if (key === "ArrowLeft") return t("settings.key.arrowLeft");
  if (key === "ArrowRight") return t("settings.key.arrowRight");
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Keys that only modify another key and so cannot be bound on their own. */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "Tab",
]);

/** Pick the browser backend when available, else the in-memory test double. */
export function createDefaultSettingsStore(): SaveStore {
  if (isIndexedDbAvailable()) {
    try {
      return createIndexedDbSaveStore();
    } catch {
      // Fall through to the memory backend below.
    }
  }
  return createMemorySaveStore();
}
