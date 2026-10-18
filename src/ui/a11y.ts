/**
 * Accessibility (T109) — the presentation layer's accessibility toolkit:
 * keyboard navigation, screen-reader labels, reduced-motion and a
 * colour-blind-safe palette.
 *
 * Like `src/audio/sfx.ts` and `src/render/animations.ts`, this is an **edge**
 * module: it may touch the DOM, but it never reads or writes engine state and
 * never ships anything into `src/engine` (`agents.md` §2, §7). Every capability
 * is factored into a pure core that runs in Node, plus thin DOM glue guarded by
 * `typeof document`/`typeof window`:
 *
 * | Concern             | Pure core                              | DOM glue                        |
 * | ------------------- | -------------------------------------- | ------------------------------- |
 * | Keyboard navigation | {@link nextRovingIndex}, {@link rovingTabIndex} | `app/input.ts` focus layer |
 * | Screen-reader labels| {@link describeUnit}, {@link describeEvent}, {@link describeEvents} | {@link announce}, {@link ensureLiveRegion} |
 * | Reduced motion      | {@link motionModeFor}, {@link scaleMotionDuration} | {@link applyMotionPreference}, {@link observeMotionPreference} |
 * | Colour-blind palette| {@link paletteFor}, {@link paletteVariables}, {@link contrastRatio} | {@link applyColourBlindPalette} |
 *
 * ## Locked theme (mapping §14)
 *
 * The vocabulary is Napoleonic and original: a soldier's hit points are its
 * **strength**, FFTA "MP" is **Élan** (and morale), FFTA "JP" is **Honour**, a
 * status is a **condition**, and the field is a square-isometric grid. The
 * colour-blind palettes keep the *mechanical* friend/foe distinction intact —
 * they only re-author the hues as our own, luminance-separated balance data.
 *
 * Contract:
 * - **Original data.** Palettes, labels and tuning live in the tables below,
 *   not inline in logic.
 * - **No engine reach-in.** Types are imported for labelling; no state is read
 *   or mutated.
 * - **Node-safe.** Importing the module never throws on a server; DOM work is
 *   inside functions that guard the environment.
 */

import type { BattleEvent } from "../engine/events";
import { type Facing } from "../engine/grid";
import type { ConditionId, PostId, UnitId } from "../engine/ids";
import type { Unit, UnitSide } from "../engine/unit";
import { t, type MessageKey } from "../i18n";
import type { SaveStore } from "../persist";
import { createDefaultSettingsStore, loadSettings, type ColourBlindMode } from "./settingsModel";

/* ==========================================================================
 * Reduced motion
 * ======================================================================== */

/** The two motion modes the presentation layer understands. */
export const MOTION_MODES = ["full", "reduced"] as const;
export type MotionMode = (typeof MOTION_MODES)[number];

/** The user preference the app listens to (`prefers-reduced-motion`). */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Root data attribute carrying {@link MotionMode} (CSS hooks on it). */
export const MOTION_DATA_ATTRIBUTE = "data-motion";

/** Shorter alias for the same mode, kept for the stylesheet's convenience. */
export const REDUCED_MOTION_DATA_ATTRIBUTE = "data-reduced-motion";

/** Whether `matchMedia` says the visitor asked for fewer animations. */
export function prefersReducedMotion(
  matches: (query: string) => boolean = matchMediaMatches,
): boolean {
  try {
    return matches(REDUCED_MOTION_QUERY);
  } catch {
    return false;
  }
}

/** The default `matchMedia` probe; `false` when the browser lacks it. */
function matchMediaMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

/** Map a boolean preference to its {@link MotionMode}. */
export function motionModeFor(reduced: boolean): MotionMode {
  return reduced ? "reduced" : "full";
}

/**
 * Scale a base animation duration (ms) for the motion preference. Reduced
 * motion collapses pacing to instant; a non-positive or non-finite base is
 * always `0` so callers never schedule a negative timer.
 */
export function scaleMotionDuration(baseMs: number, reduced: boolean): number {
  if (!Number.isFinite(baseMs) || baseMs <= 0) return 0;
  return reduced ? 0 : baseMs;
}

/** Resolve the document root used for data attributes and CSS variables. */
function resolveRoot(root?: HTMLElement | null): HTMLElement | null {
  if (root !== undefined) return root;
  if (typeof document === "undefined") return null;
  return document.documentElement;
}

/**
 * Mirror the motion preference onto `root` as data attributes, so CSS can opt
 * out of transitions (`styles.css`) and tests can read the resolved mode.
 * Returns the applied {@link MotionMode}.
 */
export function applyMotionPreference(reduced: boolean, root?: HTMLElement | null): MotionMode {
  const mode = motionModeFor(reduced);
  const target = resolveRoot(root);
  if (target !== null) {
    target.setAttribute(MOTION_DATA_ATTRIBUTE, mode);
    target.setAttribute(REDUCED_MOTION_DATA_ATTRIBUTE, mode);
  }
  return mode;
}

/**
 * Observe the OS motion preference, invoking `onChange` immediately with the
 * current value and again on every change. Returns an unsubscribe function
 * (a no-op where `matchMedia` is unavailable), so callers can dispose cleanly.
 */
export function observeMotionPreference(
  onChange: (reduced: boolean) => void,
  query: string = REDUCED_MOTION_QUERY,
): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const media = window.matchMedia(query);
  const listener = (): void => onChange(media.matches);
  onChange(media.matches);
  media.addEventListener?.("change", listener);
  return () => media.removeEventListener?.("change", listener);
}

/* ==========================================================================
 * Colour-blind-safe palette
 * ======================================================================== */

/** The semantic colour roles the field and HUD share. */
export const A11Y_COLOUR_ROLES = [
  "company",
  "enemy",
  "neutral",
  "selected",
  "danger",
  "warning",
  "success",
  "focus",
] as const;
export type A11yColourRole = (typeof A11Y_COLOUR_ROLES)[number];

/** Prefix for the CSS custom properties the palette writes on the root. */
export const A11Y_CSS_PREFIX = "--a11y-";

/** A full set of role colours plus a human name for the settings preview. */
export interface A11yPalette {
  readonly name: string;
  readonly note: string;
  readonly colours: Readonly<Record<A11yColourRole, string>>;
}

/**
 * The authored palettes, one per {@link ColourBlindMode}. Every mode keeps the
 * **free company** dark and the **hostile** side light, so the two read apart by
 * luminance even when their hues are confusable — the point of a colour-blind
 * palette. The hues themselves are original balance data for the theatre.
 */
export const A11Y_PALETTES: Readonly<Record<ColourBlindMode, A11yPalette>> = {
  off: {
    name: "Issue palette",
    note: "The full army colours — friend, foe and neutral read at a glance.",
    colours: {
      company: "#22304a",
      enemy: "#d9a441",
      neutral: "#6b7280",
      selected: "#2aa8c4",
      danger: "#c0392b",
      warning: "#d9a441",
      success: "#3f8f5a",
      focus: "#f0c74a",
    },
  },
  protanopia: {
    name: "Martian (red-weak)",
    note: "Deep blue against pale gold: red and green are never asked to differ.",
    colours: {
      company: "#1b3a5c",
      enemy: "#d9b95c",
      neutral: "#7a8496",
      selected: "#4fb3d9",
      danger: "#a8721a",
      warning: "#e0c264",
      success: "#2a7f7f",
      focus: "#ffd25a",
    },
  },
  deuteranopia: {
    name: "Grass (green-weak)",
    note: "Navy against orange, with a violet selection, keeps friend and foe apart.",
    colours: {
      company: "#1d2c45",
      enemy: "#e0a03c",
      neutral: "#7a8496",
      selected: "#7a5fd0",
      danger: "#b04a8a",
      warning: "#e0c264",
      success: "#2a8f8f",
      focus: "#ffd25a",
    },
  },
  tritanopia: {
    name: "Violet (blue-weak)",
    note: "Warm earth against bright wheat — a warm-to-cool ramp instead of blue.",
    colours: {
      company: "#3a2f2a",
      enemy: "#d9c15c",
      neutral: "#808080",
      selected: "#2f8f5f",
      danger: "#c0392b",
      warning: "#d9a441",
      success: "#2f8f5f",
      focus: "#ffe08a",
    },
  },
};

/** WCAG minimum contrast ratio for non-text UI parts (graphical objects). */
export const WCAG_NON_TEXT_CONTRAST = 3;

/** The palette for `mode`, falling back to the issue palette for unknown keys. */
export function paletteFor(mode: ColourBlindMode): A11yPalette {
  return A11Y_PALETTES[mode] ?? A11Y_PALETTES.off;
}

/** The role colours as CSS custom-property assignments (`--a11y-company`, …). */
export function paletteVariables(mode: ColourBlindMode): Record<string, string> {
  const palette = paletteFor(mode);
  const variables: Record<string, string> = {};
  for (const role of A11Y_COLOUR_ROLES) {
    variables[`${A11Y_CSS_PREFIX}${role}`] = palette.colours[role];
  }
  return variables;
}

/**
 * Apply a palette to `root` (default: `<html>`): set the `data-colour-blind`
 * attribute the CSS hooks on, and write the role colours as CSS variables for
 * the HUD and overlays.
 */
export function applyColourBlindPalette(
  mode: ColourBlindMode,
  root?: HTMLElement | null,
): A11yPalette {
  const palette = paletteFor(mode);
  const target = resolveRoot(root);
  if (target !== null) {
    target.setAttribute("data-colour-blind", mode);
    for (const [name, value] of Object.entries(paletteVariables(mode))) {
      target.style.setProperty(name, value);
    }
  }
  return palette;
}

/* ---- Contrast maths (pure, used by tests and a future theme checker) ---- */

/** Parse `#rgb` / `#rrggbb` into `[r, g, b]` in `[0, 255]`, or `null`. */
function parseHex(hex: string): readonly [number, number, number] | null {
  const value = hex.trim().replace(/^#/, "");
  if (value.length === 3) {
    const expanded = value
      .split("")
      .map((digit) => digit + digit)
      .join("");
    return parseHex(`#${expanded}`);
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/** One sRGB channel (0–255) to its linear-light value. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a hex colour; `0` when it cannot be parsed. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (rgb === null) return 0;
  const [r, g, b] = rgb;
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** WCAG contrast ratio between two hex colours (`>= 1`, or `1` on bad input). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ==========================================================================
 * Keyboard navigation (pure roving-tabindex helpers)
 * ======================================================================== */

/** How arrow keys map onto a widget: one axis or both. */
export const ROVING_ORIENTATIONS = ["horizontal", "vertical", "both"] as const;
export type RovingOrientation = (typeof ROVING_ORIENTATIONS)[number];

/** Tuning for {@link nextRovingIndex}. */
export interface RovingOptions {
  /** Which arrows move; defaults to `"both"` (a grid or list). */
  readonly orientation?: RovingOrientation;
  /** Wrap past the ends; defaults to `true`. */
  readonly wrap?: boolean;
}

/**
 * The next focused index for a roving-tabindex widget (listbox, tablist,
 * radio-group, grid). `Home`/`End` jump to the ends; arrows step one item, and
 * are filtered by {@link RovingOptions.orientation}. Pure and DOM-free so the
 * keyboard model is unit-tested in Node; `app/input.ts` applies the result to
 * real focus.
 *
 * Returns `-1` for an empty widget and `current` for an unhandled key.
 */
export function nextRovingIndex(
  count: number,
  current: number,
  key: string,
  options: RovingOptions = {},
): number {
  if (count <= 0) return -1;
  const orientation = options.orientation ?? "both";
  const wrap = options.wrap ?? true;
  const last = count - 1;
  const index = current < 0 || current >= count ? 0 : current;

  if (key === "Home") return 0;
  if (key === "End") return last;

  const horizontal = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  const vertical = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
  const delta =
    orientation === "horizontal"
      ? horizontal
      : orientation === "vertical"
        ? vertical
        : horizontal !== 0
          ? horizontal
          : vertical;
  if (delta === 0) return current;

  const next = index + delta;
  if (wrap) return (next + count) % count;
  return Math.max(0, Math.min(last, next));
}

/** The `tabindex` a roving-tabindex item should carry (`0` active, else `-1`). */
export function rovingTabIndex(index: number, activeIndex: number): 0 | -1 {
  return index === activeIndex ? 0 : -1;
}

/* ==========================================================================
 * Screen-reader labels
 * ======================================================================== */

/** The DOM id of the shared live region, used by tests and the app. */
export const LIVE_REGION_ID = "a11y-live-region";

/** How urgently an announcement interrupts (ARIA `aria-live`). */
export type AnnouncementPoliteness = "polite" | "assertive";

/** Catalog keys for the three field sides. */
export const SIDE_LABEL_KEYS: Readonly<Record<UnitSide, MessageKey>> = {
  company: "a11y.side.company",
  enemy: "a11y.side.enemy",
  neutral: "a11y.side.neutral",
};

/** Catalog keys for the spoken cardinal directions. */
export const FACING_LABEL_KEYS: Readonly<Record<Facing, MessageKey>> = {
  north: "a11y.facing.north",
  east: "a11y.facing.east",
  south: "a11y.facing.south",
  west: "a11y.facing.west",
};

/** Resolvers that let the caller keep the display layer in charge of names. */
export interface LabelResolvers {
  /** A unit's display name; falls back to the raw id. */
  readonly unitName?: (unitId: UnitId) => string | undefined;
  /** A post's player-facing name. */
  readonly postName?: (postId: PostId) => string | undefined;
  /** A condition's player-facing name. */
  readonly conditionName?: (conditionId: ConditionId) => string | undefined;
}

/** A unit's name, or its id when the caller offers no resolver. */
function nameFor(unitId: UnitId, resolvers: LabelResolvers): string {
  return resolvers.unitName?.(unitId) ?? unitId;
}

/**
 * A complete, spoken description of a soldier for a screen reader: side, level,
 * post, strength, Élan, Honour, facing, tile and active conditions. Pure.
 */
export function describeUnit(unit: Unit, resolvers: LabelResolvers = {}): string {
  const parts: string[] = [
    unit.name,
    t(SIDE_LABEL_KEYS[unit.side]),
    t("a11y.unit.level", { level: unit.level }),
  ];
  const post = resolvers.postName?.(unit.postId);
  if (post !== undefined) parts.push(post);
  parts.push(t("a11y.unit.strength", { hp: unit.hp, maxHp: unit.stats.hp }));
  parts.push(t("a11y.unit.elan", { mp: unit.mp, maxMp: unit.stats.mp }));
  parts.push(t("a11y.unit.honour", { honour: unit.judgePoints }));
  parts.push(t("a11y.unit.facing", { facing: t(FACING_LABEL_KEYS[unit.facing]) }));
  parts.push(t("a11y.unit.tile", { x: unit.at.x, y: unit.at.y }));
  const conditions = unit.conditions.map(
    (condition) => resolvers.conditionName?.(condition.conditionId) ?? condition.conditionId,
  );
  if (conditions.length > 0) {
    parts.push(t("a11y.unit.conditions", { conditions: conditions.join(", ") }));
  }
  return parts.join(", ");
}

/** `+3` / `-2` / `0` for a signed resource delta. */
function signed(delta: number): string {
  if (delta === 0) return "0";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/**
 * One spoken sentence for a battle event, or `null` when the event is
 * bookkeeping a screen reader need not hear (turn ticks, charge timers, …).
 * Pure, so the wording is testable and a replay reads the same every run.
 */
export function describeEvent(event: BattleEvent, resolvers: LabelResolvers = {}): string | null {
  const name = "unitId" in event ? nameFor(event.unitId, resolvers) : "";
  switch (event.kind) {
    case "moved":
      return t("a11y.event.moved", { name, x: event.to.x, y: event.to.y });
    case "shoved":
      return t("a11y.event.shoved", { name });
    case "faced":
      return t("a11y.event.faced", { name, facing: t(FACING_LABEL_KEYS[event.to]) });
    case "volleyStarted":
      return t("a11y.event.volleyStarted", { name, honour: event.honour });
    case "volleyChained":
      return t("a11y.event.volleyChained", { name });
    case "guardSortieCalled":
      return t("a11y.event.guardSortie", { name });
    case "damaged":
      return event.fatal
        ? t("a11y.event.damagedFatal", { name, amount: event.amount })
        : t("a11y.event.damaged", { name, amount: event.amount });
    case "healed":
      return t("a11y.event.healed", { name, amount: event.amount });
    case "missed":
      return t("a11y.event.missed", { name });
    case "outOfAction":
      return t("a11y.event.outOfAction", { name });
    case "revived":
      return t("a11y.event.revived", { name });
    case "mpChanged":
      return t("a11y.event.elanChanged", { name, delta: signed(event.delta) });
    case "honourChanged":
      return t("a11y.event.honourChanged", { name, delta: signed(event.delta) });
    case "conditionApplied":
      return t("a11y.event.conditionApplied", {
        name,
        condition: resolvers.conditionName?.(event.conditionId) ?? event.conditionId,
      });
    case "conditionRemoved":
      return t("a11y.event.conditionRemoved", {
        name,
        condition: resolvers.conditionName?.(event.conditionId) ?? event.conditionId,
      });
    case "drillGained":
      return t("a11y.event.drillGained", { name, amount: event.amount });
    case "abilityLearned":
      return t("a11y.event.abilityLearned", { name });
    case "experienceGained":
      return t("a11y.event.experienceGained", { name, amount: event.amount });
    case "levelUp":
      return t("a11y.event.levelUp", { name, level: event.level });
    case "postUnlocked":
      return t("a11y.event.postUnlocked", { name });
    case "articleBroken":
      return t("a11y.event.articleBroken", { name });
    case "reprimandIssued":
      return t("a11y.event.reprimand", { name });
    case "courtMartialIssued":
      return t("a11y.event.courtMartial", { name });
    case "commended":
      return t("a11y.event.commended", { name, honour: event.honour });
    case "battleEnded":
      return t("a11y.event.battleEnded", { outcome: event.outcome });
    case "rewardGranted":
      return t("a11y.event.rewardGranted", { crowns: event.crowns });
    default:
      return null;
  }
}

/** Join the spoken sentences for an event stream, skipping bookkeeping. */
export function describeEvents(
  events: readonly BattleEvent[],
  resolvers: LabelResolvers = {},
): string {
  const spoken = events
    .map((event) => describeEvent(event, resolvers))
    .filter((line): line is string => line !== null);
  return spoken.join(". ");
}

/* ---- Live region announcements ---- */

/** Options for {@link announce}. */
export interface AnnounceOptions {
  /** `"polite"` waits for a pause; `"assertive"` interrupts. Defaults polite. */
  readonly politeness?: AnnouncementPoliteness;
}

/**
 * Create (once) and return the shared off-screen live region. A screen reader
 * watches it for text changes. Idempotent and safe to call from a mount effect.
 */
export function ensureLiveRegion(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let region = document.getElementById(LIVE_REGION_ID);
  if (region === null) {
    region = document.createElement("div");
    region.id = LIVE_REGION_ID;
    region.className = "sr-only";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.appendChild(region);
  }
  return region;
}

/**
 * Announce a message to screen readers through the shared live region. Returns
 * `false` where there is no DOM (server / Node), so callers can ignore the
 * result. Re-announcing identical text is handled by clearing first.
 */
export function announce(message: string, options: AnnounceOptions = {}): boolean {
  if (typeof document === "undefined") return false;
  const region = ensureLiveRegion();
  if (region === null) return false;
  const politeness = options.politeness ?? "polite";
  region.setAttribute("aria-live", politeness);
  region.setAttribute("role", politeness === "assertive" ? "alert" : "status");
  region.textContent = "";
  region.textContent = message;
  return true;
}

/* ==========================================================================
 * App-wide installation
 * ======================================================================== */

/** Options for {@link installAccessibility}. */
export interface AccessibilityOptions {
  /** The root to annotate; defaults to `<html>`. */
  readonly root?: HTMLElement;
  /** The settings store to read the colour-blind preference from. */
  readonly store?: SaveStore;
}

/**
 * Wire the app's accessibility basics in one call:
 *
 * - mirror `prefers-reduced-motion` onto the root (and keep listening),
 * - read the persisted colour-blind preference and apply its palette,
 * - create the shared live region.
 *
 * Returns a disposer that removes the motion listener and cancels any in-flight
 * settings read. The caller (the app shell) owns the DOM root, so a clean
 * remount never leaves duplicate attributes behind.
 */
export function installAccessibility(options: AccessibilityOptions = {}): () => void {
  const stopMotion = observeMotionPreference((reduced) =>
    applyMotionPreference(reduced, options.root),
  );
  ensureLiveRegion();

  let cancelled = false;
  const store = options.store ?? createDefaultSettingsStore();
  void loadSettings(store)
    .then((settings) => {
      if (!cancelled) applyColourBlindPalette(settings.colourBlind, options.root);
    })
    .catch(() => undefined);

  return () => {
    cancelled = true;
    stopMotion();
  };
}
