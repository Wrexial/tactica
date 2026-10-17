/**
 * Unit presentation (T081) — placeholder soldiers, facing and status readouts.
 *
 * This module is deliberately **Pixi-free and DOM-free**, exactly like
 * `tiles.ts` (T080): it turns an engine {@link Unit} into plain, deterministic
 * *draw operations* — a stylised board-game soldier, a direction marker, the
 * HP / Élan bars and the condition / Honour indicators. `scene.ts` translates
 * those ops into Pixi calls. Keeping the geometry as data means the whole unit
 * rendering can be unit-tested in Node without a WebGL context, and the render
 * layer keeps its split between "what to draw" (here) and "how to draw it"
 * (`scene.ts`).
 *
 * Art direction is **minimalist board-game first** (mapping §14, decision D12):
 * a soldier is a small figure built from a handful of shapes, not a sprite
 * sheet. The silhouette still reads at a glance because it is keyed on the two
 * things the player needs on the field:
 *
 * - **Power (military school).** Each of the five powers wears a distinct
 *   uniform colour — France blue, Britain red, Prussia dark blue, Russia
 *   green, Austria white (mapping §2). The id stays the FFTA-shaped power key.
 * - **Post (role).** The role category changes the weapon / kit marker and the
 *   accent colour — line infantry carry a musket, skirmishers a long rifle,
 *   cavalry a raised sabre, artillery a linstock, medics a red cross, command a
 *   sash, engineers tools (mapping §3).
 *
 * Status is drawn above the figure: an **Élan** bar (morale, decision D4), an
 * **HP** bar, an **Honour** pip row (10 pips, mapping §5) and a row of
 * **condition** icons coloured by condition kind (mapping §8). Facing is shown
 * by a ground chevron pointing toward the unit's front — very Napoleonic
 * flank/rear play (mapping §12).
 *
 * Contracts (`agents.md` §2, §7, §9; `src/render`):
 * - **Pure and deterministic.** No `Math.random`, no clock, no DOM. The same
 *   unit always yields byte-identical ops, so replays and screenshots are
 *   stable.
 * - **Read-only.** The module never mutates a unit; it only reads engine state.
 * - **No balance constants.** Every tunable presentation number is a named
 *   constant here, never inline in logic.
 */

import type { Facing } from "../engine/grid";
import { HONOUR_MAX, type ActiveCondition, type Unit, type UnitSide } from "../engine/unit";
import { CONDITIONS, isConditionKey } from "../data/conditions";
import type { ConditionKind, PowerKey } from "../data/schema";
import { shadeColor, type ScreenPoint } from "./tiles";

/* --------------------------------------------------------------------------
 * Draw operations
 * ------------------------------------------------------------------------ */

/**
 * A Pixi-free drawing primitive for one unit detail, positioned relative to a
 * tile's **top-face centre** in unzoomed world pixels (the figure's feet rest
 * at the origin, and status reads upward in negative `y`). `scene.ts` turns
 * these into Pixi calls; tests inspect them directly in Node.
 */
export type UnitDrawOp =
  | {
      readonly kind: "circle";
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly color: number;
      readonly alpha: number;
    }
  | {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly color: number;
      readonly alpha: number;
    }
  | {
      readonly kind: "poly";
      readonly points: readonly number[];
      readonly color: number;
      readonly alpha: number;
    }
  | {
      readonly kind: "line";
      readonly points: readonly number[];
      readonly width: number;
      readonly color: number;
      readonly alpha: number;
    };

function circle(x: number, y: number, radius: number, color: number, alpha = 1): UnitDrawOp {
  return { kind: "circle", x, y, radius, color, alpha };
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
  alpha = 1,
): UnitDrawOp {
  return { kind: "rect", x, y, width, height, color, alpha };
}

function poly(points: readonly number[], color: number, alpha = 1): UnitDrawOp {
  return { kind: "poly", points, color, alpha };
}

function line(points: readonly number[], width: number, color: number, alpha = 1): UnitDrawOp {
  return { kind: "line", points, width, color, alpha };
}

/* --------------------------------------------------------------------------
 * Power uniforms (mapping §2)
 * ------------------------------------------------------------------------ */

/**
 * A power's uniform palette. Colours are **authored** for readability at a
 * glance on the isometric field, not historical exactness (D12): each power
 * still reads in its conventional coat colour, while `trim`, `accent`, `skin`
 * and `metal` stay consistent so the figures look like one army's kit.
 */
export interface PowerUniform {
  /** Main coat colour. */
  readonly coat: number;
  /** Darker coat used for legs, hat and shading. */
  readonly coatDark: number;
  /** Facings (collar, cuffs, hem) — usually white or a contrast colour. */
  readonly trim: number;
  /** Small role/honour accent (plumes, sashes). */
  readonly accent: number;
  /** Face and hands. */
  readonly skin: number;
  /** Musket barrels, sabres, buckles. */
  readonly metal: number;
}

/**
 * The five great-power uniforms (mapping §2). France is the balanced blue,
 * Britain the red line, Prussia the dark blue of the old regiments, Russia the
 * green, Austria the white-coat army.
 */
export const POWER_UNIFORMS: Readonly<Record<PowerKey, PowerUniform>> = {
  france: {
    coat: 0x2f5fa8,
    coatDark: 0x21447a,
    trim: 0xe8e2d0,
    accent: 0xd4b34a,
    skin: 0xd8a77e,
    metal: 0x9aa4ad,
  },
  britain: {
    coat: 0xa63b2f,
    coatDark: 0x7a2a21,
    trim: 0xe8e2d0,
    accent: 0xd4b34a,
    skin: 0xd8a77e,
    metal: 0x9aa4ad,
  },
  prussia: {
    coat: 0x333a4d,
    coatDark: 0x232838,
    trim: 0xd8d2c0,
    accent: 0xc9a227,
    skin: 0xd8a77e,
    metal: 0x9aa4ad,
  },
  russia: {
    coat: 0x3f6b46,
    coatDark: 0x2c4c33,
    trim: 0xe8e2d0,
    accent: 0xc9a227,
    skin: 0xd8a77e,
    metal: 0x9aa4ad,
  },
  austria: {
    coat: 0xd9d3c0,
    coatDark: 0xa9a390,
    trim: 0x2f5fa8,
    accent: 0xc9a227,
    skin: 0xd8a77e,
    metal: 0x9aa4ad,
  },
};

/** Neutral kit used if an unknown power ever reaches the renderer. */
const FALLBACK_UNIFORM: PowerUniform = {
  coat: 0x6f7a8a,
  coatDark: 0x4b545f,
  trim: 0xd8d2c0,
  accent: 0xc9a227,
  skin: 0xd8a77e,
  metal: 0x9aa4ad,
};

/** The uniform palette for a power, falling back to neutral kit. */
export function powerUniform(power: PowerKey): PowerUniform {
  return POWER_UNIFORMS[power] ?? FALLBACK_UNIFORM;
}

/* --------------------------------------------------------------------------
 * Roles / posts (mapping §3)
 * ------------------------------------------------------------------------ */

/**
 * The presentation family of a post. The engine keeps the FFTA-shaped post id;
 * the renderer only needs a coarse silhouette so one glance tells a rifleman
 * from a gunner. A post maps to exactly one category via keyword matching, so
 * new posts need no render change as long as their id reads sensibly.
 */
export const ROLE_CATEGORIES = [
  "line",
  "skirmisher",
  "cavalry",
  "artillery",
  "medical",
  "command",
  "engineer",
  "irregular",
] as const;

export type RoleCategory = (typeof ROLE_CATEGORIES)[number];

/** Role accent colour, independent of power, for plumes and markers. */
export const ROLE_COLORS: Readonly<Record<RoleCategory, number>> = {
  line: 0x9aa4ad,
  skirmisher: 0x4fae6a,
  cavalry: 0xd4b34a,
  artillery: 0xc4632f,
  medical: 0xd23b3b,
  command: 0xe8e2d0,
  engineer: 0x7a9bbf,
  irregular: 0x8a8175,
};

/**
 * Classify a post id into its role family. Matching is keyword-based and
 * case-insensitive so it is forgiving of ids the data layer may add later
 * (`voltigeur`, `rifleman`, `line-grenadier`, ...). Unrecognised ids fall back
 * to line infantry, the commonest silhouette.
 */
export function roleCategory(postId: string): RoleCategory {
  const id = postId.toLowerCase();
  const has = (...needles: string[]): boolean => needles.some((needle) => id.includes(needle));

  if (has("irregular", "militia", "guerrilla", "partisan", "deserter")) return "irregular";
  if (has("surgeon", "chaplain", "medical", "medic")) return "medical";
  if (has("officer", "adjutant", "colour", "standard", "command", "intelligence", "signal"))
    return "command";
  if (has("hussar", "cuirass", "lancer", "dragoon", "cavalry")) return "cavalry";
  if (has("artiller", "bombard", "gunner", "gun", "rocket")) return "artillery";
  if (has("engineer", "sapper", "pioneer", "forager")) return "engineer";
  if (has("rifle", "marksman", "sharpshooter", "sniper", "scout", "skirmish", "light", "voltigeur"))
    return "skirmisher";
  return "line";
}

/* --------------------------------------------------------------------------
 * Facing (mapping §12)
 * ------------------------------------------------------------------------ */

/**
 * Screen-space unit vector for each grid facing, normalised to `~1`.
 *
 * The engine is axis-based (`north = -y`, `east = +x`, ...), but the isometric
 * projection maps the axes to the diamond's diagonals (`iso.ts`): north is
 * up-right, east down-right, south down-left and west up-left. The marker and
 * weapon lean use these vectors.
 */
export function facingScreen(facing: Facing): ScreenPoint {
  switch (facing) {
    case "north":
      return { x: 0.7, y: -0.7 };
    case "east":
      return { x: 0.7, y: 0.7 };
    case "south":
      return { x: -0.7, y: 0.7 };
    case "west":
      return { x: -0.7, y: -0.7 };
  }
}

/* --------------------------------------------------------------------------
 * Side colours
 * ------------------------------------------------------------------------ */

/**
 * Ground-glow colour by battlefield side. Company is the friendly blue, enemy
 * the hostile red and neutrals (the Provost Marshal) bone grey (mapping §9).
 */
export const SIDE_COLORS: Readonly<Record<UnitSide, number>> = {
  company: 0x5aa9ff,
  enemy: 0xd23b3b,
  neutral: 0xb9b3a5,
};

/* --------------------------------------------------------------------------
 * The soldier figure
 * ------------------------------------------------------------------------ */

/** Wood/leather colour shared by musket stocks and tools. */
const WOOD = 0x5b3f27;

/** Options for {@link soldierFigure}. */
export interface SoldierFigureOptions {
  readonly power: PowerKey;
  readonly postId: string;
  readonly facing: Facing;
}

/**
 * A placeholder soldier as a bag of draw ops (feet at the origin) plus the
 * anchor where a status readout should sit. The role category, facing and
 * uniform are echoed back so callers (and animations, T082) do not have to
 * recompute them.
 */
export interface SoldierFigure {
  readonly role: RoleCategory;
  readonly facing: Facing;
  readonly uniform: PowerUniform;
  readonly ops: readonly UnitDrawOp[];
  /** Where an external callout should attach, above the soldier's head. */
  readonly statusAnchor: ScreenPoint;
}

/** Shadow and ground glow beneath every figure. */
function groundOps(side: UnitSide): UnitDrawOp[] {
  return [circle(0, 3, 13, SIDE_COLORS[side], 0.22), circle(0, 3, 10, 0x101418, 0.35)];
}

/** Coat, legs, arms and webbing; an irregular skips the regulation straps. */
function bodyOps(uniform: PowerUniform, role: RoleCategory): UnitDrawOp[] {
  const irregular = role === "irregular";
  const ops: UnitDrawOp[] = [
    line([-2, -2, -4, -12], 4, uniform.coatDark, 1),
    line([2, -2, 4, -12], 4, uniform.coatDark, 1),
    poly([-8, -11, 8, -11, 7, -27, -7, -27], uniform.coat, 1),
    poly([3, -11, 8, -11, 7, -27, 2, -27], shadeColor(uniform.coat, 0.84), 1),
    line([-8, -11, 8, -11], 2, uniform.trim, 1),
    line([-7, -15, 7, -15], 3, uniform.trim, 0.9),
    line([-7, -25, -11, -16], 4, uniform.coat, 1),
    line([7, -25, 11, -16], 4, uniform.coat, 1),
  ];
  if (!irregular) {
    ops.push(
      line([-6, -26, 6, -14], 2, uniform.metal, 0.85),
      line([6, -26, -6, -14], 2, uniform.metal, 0.85),
      circle(-7, -25, 2.5, uniform.trim, 1),
      circle(7, -25, 2.5, uniform.trim, 1),
    );
  }
  return ops;
}

/** Head and headgear, with a role-coloured plume (soft cap for irregulars). */
function headOps(uniform: PowerUniform, role: RoleCategory, roleColor: number): UnitDrawOp[] {
  const ops: UnitDrawOp[] = [circle(0, -31, 5, uniform.skin, 1)];
  if (role === "irregular") {
    ops.push(circle(0, -36, 5, uniform.coatDark, 1));
    return ops;
  }
  ops.push(
    poly([-6, -34, 6, -34, 5, -44, -5, -44], uniform.coatDark, 1),
    line([-6, -34, 6, -34], 2, uniform.trim, 0.9),
    line([0, -44, 2, -50], 2, roleColor, 0.95),
  );
  return ops;
}

/** The role's signature kit: weapon, tools, sash or medical cross. */
function weaponOps(uniform: PowerUniform, role: RoleCategory, roleColor: number): UnitDrawOp[] {
  switch (role) {
    case "cavalry":
      return [
        line([9, -22, 16, -40], 3, uniform.metal, 1),
        line([13, -34, 19, -34], 2, roleColor, 0.9),
      ];
    case "artillery":
      return [
        line([-11, -28, 11, -28], 3, WOOD, 1),
        line([-11, -28, -14, -22], 2, WOOD, 1),
        circle(12, -28, 2.5, uniform.metal, 1),
      ];
    case "engineer":
      return [
        line([-11, -18, -14, -7], 3, WOOD, 1),
        rect(-17, -8, 6, 4, uniform.metal, 1),
        rect(8, -18, 5, 5, uniform.metal, 0.9),
      ];
    case "medical":
      return [
        line([0, -24, 0, -17], 3, roleColor, 1),
        line([-3.5, -20.5, 3.5, -20.5], 3, roleColor, 1),
      ];
    case "command":
      return [line([-8, -26, 8, -13], 3, roleColor, 0.85)];
    case "skirmisher":
      return [
        line([-12, -28, 13, -6], 3, uniform.metal, 1),
        line([-12, -28, -14, -31], 3, WOOD, 1),
        line([11, -8, 15, -3], 2, uniform.metal, 1),
      ];
    case "line":
    case "irregular":
      return [
        line([-11, -28, 12, -7], 3, uniform.metal, 1),
        line([-11, -28, -14, -31], 3, WOOD, 1),
        line([10, -9, 13, -4], 2, uniform.metal, 1),
      ];
  }
}

/** A ground chevron pointing toward the unit's front. */
function facingOps(facing: Facing, color: number): UnitDrawOp[] {
  const direction = facingScreen(facing);
  const perpendicularX = -direction.y;
  const perpendicularY = direction.x;
  const tipX = direction.x * 20;
  const tipY = direction.y * 20 + 2;
  const baseX = -direction.x * 6;
  const baseY = -direction.y * 6 + 2;
  const spread = 6;
  return [
    poly(
      [
        tipX,
        tipY,
        baseX + perpendicularX * spread,
        baseY + perpendicularY * spread,
        baseX - perpendicularX * spread,
        baseY - perpendicularY * spread,
      ],
      color,
      0.85,
    ),
  ];
}

/**
 * Build one placeholder soldier. The returned ops are relative to the tile's
 * top-face centre; `scene.ts` offsets them per unit. Side colour is **not**
 * included here (the figure is side-agnostic); {@link unitDrawOps} prepends it.
 */
export function soldierFigure(options: SoldierFigureOptions): SoldierFigure {
  const uniform = powerUniform(options.power);
  const role = roleCategory(options.postId);
  const roleColor = ROLE_COLORS[role];
  return {
    role,
    facing: options.facing,
    uniform,
    ops: [
      ...bodyOps(uniform, role),
      ...weaponOps(uniform, role, roleColor),
      ...headOps(uniform, role, roleColor),
      ...facingOps(options.facing, roleColor),
    ],
    statusAnchor: { x: 0, y: -52 },
  };
}

/* --------------------------------------------------------------------------
 * Status bars (HP / Élan)
 * ------------------------------------------------------------------------ */

/** Geometry for the hit-point bar, relative to the figure's feet. */
export const HP_BAR = { x: -18, y: -63, width: 36, height: 4 } as const;
/** Geometry for the Élan (morale) bar, relative to the figure's feet. */
export const ELAN_BAR = { x: -18, y: -57, width: 36, height: 3 } as const;

/** Backdrop behind both bars. */
export const BAR_BACKDROP = 0x161b24;
/** Hit-point bar colours at healthy / wounded / critical levels. */
export const HP_COLOR_HIGH = 0x4fae5a;
export const HP_COLOR_MID = 0xd4b34a;
export const HP_COLOR_LOW = 0xc4432f;
/** Élan colours: steady blue when fed, alarming red when close to breaking. */
export const ELAN_COLOR_HIGH = 0x4f9ad4;
export const ELAN_COLOR_LOW = 0xc4432f;

/** A status bar value with its geometry and resolved fill colour. */
export interface StatusBar {
  readonly value: number;
  readonly max: number;
  /** `value / max`, clamped to `[0, 1]`; `0` when `max <= 0`. */
  readonly ratio: number;
  readonly color: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Clamp a number into `[0, 1]`, treating non-finite input as `0`. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Resolve the hit-point bar's colour from its ratio. */
export function hpColor(ratio: number): number {
  if (ratio > 0.5) return HP_COLOR_HIGH;
  if (ratio > 0.25) return HP_COLOR_MID;
  return HP_COLOR_LOW;
}

/** Resolve the Élan bar's colour from its ratio. */
export function elanColor(ratio: number): number {
  return ratio > 0.3 ? ELAN_COLOR_HIGH : ELAN_COLOR_LOW;
}

/** The unit's hit-point bar. */
export function hpBar(unit: Unit): StatusBar {
  const ratio = clamp01(unit.hp / unit.stats.hp);
  return { value: unit.hp, max: unit.stats.hp, ratio, color: hpColor(ratio), ...HP_BAR };
}

/** The unit's Élan (morale) bar. */
export function elanBar(unit: Unit): StatusBar {
  const ratio = clamp01(unit.mp / unit.stats.mp);
  return { value: unit.mp, max: unit.stats.mp, ratio, color: elanColor(ratio), ...ELAN_BAR };
}

/* --------------------------------------------------------------------------
 * Honour (mapping §5)
 * ------------------------------------------------------------------------ */

/** Geometry of the Honour pip row; one pip per Honour point (max 10). */
export const HONOUR_ROW = { x: -18, y: -68, pip: 3, gap: 1 } as const;
/** A filled Honour pip. */
export const HONOUR_PIP_ON = 0xf0c74a;
/** An empty Honour pip slot. */
export const HONOUR_PIP_OFF = 0x3a4150;

/**
 * Clamp a unit's Honour into the `[0, HONOUR_MAX]` pip range. The engine
 * already caps Honour; this keeps the renderer total for malformed saves.
 */
export function honourPips(judgePoints: number): number {
  if (!Number.isFinite(judgePoints)) return 0;
  return Math.max(0, Math.min(HONOUR_MAX, Math.round(judgePoints)));
}

/* --------------------------------------------------------------------------
 * Condition icons (mapping §8)
 * ------------------------------------------------------------------------ */

/** Icon colour by condition kind: red ailment, amber debuff, green buff, violet special. */
export const CONDITION_KIND_COLORS: Readonly<Record<ConditionKind, number>> = {
  ailment: 0xb8433b,
  debuff: 0xc07a2a,
  buff: 0x3f8f5a,
  special: 0x6a5acd,
};

/** Icon colour for a condition id the data layer does not recognise. */
export const CONDITION_ICON_FALLBACK = 0x8a8175;

/** Geometry of the condition icon row, above the Honour pips. */
export const CONDITION_ROW = { x: -18, y: -74, size: 6, gap: 2 } as const;

/** One condition readout: a short label and the colour/glyph to draw. */
export interface ConditionIcon {
  readonly id: string;
  /** Two-character abbreviation of the Napoleonic name, e.g. `BL` / `DQ`. */
  readonly label: string;
  /** Condition kind, or `"unknown"` for an id outside the authored table. */
  readonly kind: ConditionKind | "unknown";
  readonly color: number;
}

/** Short words that carry no meaning in an icon label. */
const ABBREVIATION_STOP_WORDS = new Set(["of", "the", "a", "an", "and", "to", "in", "on", "for"]);

/** Uppercase abbreviation from a display name's initials (max two). */
export function abbreviate(label: string): string {
  const words = label
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 1 && !ABBREVIATION_STOP_WORDS.has(word.toLowerCase()));
  if (words.length === 0) return "?";
  const first = words[0];
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return words
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Resolve one condition id to its icon. Known FFTA-shaped ids look up the
 * authored Napoleonic name and kind; anything else degrades gracefully to a
 * neutral icon so an unexpected save never crashes the field.
 */
export function conditionIcon(conditionId: string): ConditionIcon {
  if (isConditionKey(conditionId)) {
    const condition = CONDITIONS[conditionId];
    return {
      id: conditionId,
      label: abbreviate(condition.name),
      kind: condition.kind,
      color: CONDITION_KIND_COLORS[condition.kind],
    };
  }
  return {
    id: conditionId,
    label: abbreviate(conditionId),
    kind: "unknown",
    color: CONDITION_ICON_FALLBACK,
  };
}

/** Resolve every active condition, preserving the engine's order. */
export function conditionIcons(conditions: readonly ActiveCondition[]): readonly ConditionIcon[] {
  return conditions.map((condition) => conditionIcon(condition.conditionId));
}

/* --------------------------------------------------------------------------
 * Composition
 * ------------------------------------------------------------------------ */

/** Everything needed to draw one unit's figure and status. */
export interface UnitPresentation {
  readonly figure: SoldierFigure;
  readonly hp: StatusBar;
  readonly elan: StatusBar;
  /** Clamped Honour pip count (`0..HONOUR_MAX`). */
  readonly honour: number;
  readonly conditions: readonly ConditionIcon[];
}

/** Build the full presentation model for a unit. */
export function unitPresentation(unit: Unit): UnitPresentation {
  return {
    figure: soldierFigure({ power: unit.power, postId: unit.postId, facing: unit.facing }),
    hp: hpBar(unit),
    elan: elanBar(unit),
    honour: honourPips(unit.judgePoints),
    conditions: conditionIcons(unit.conditions),
  };
}

/** Two stacked rectangles: the bar backdrop and its proportional fill. */
function barOps(bar: StatusBar): UnitDrawOp[] {
  return [
    rect(bar.x, bar.y, bar.width, bar.height, BAR_BACKDROP, 0.6),
    rect(bar.x, bar.y, bar.width * bar.ratio, bar.height, bar.color, 1),
  ];
}

/** One pip per available Honour point, filled up to `filled`. */
function honourOps(filled: number): UnitDrawOp[] {
  const ops: UnitDrawOp[] = [];
  for (let index = 0; index < HONOUR_MAX; index++) {
    const x = HONOUR_ROW.x + index * (HONOUR_ROW.pip + HONOUR_ROW.gap);
    const on = index < filled;
    ops.push(
      rect(
        x,
        HONOUR_ROW.y,
        HONOUR_ROW.pip,
        HONOUR_ROW.pip,
        on ? HONOUR_PIP_ON : HONOUR_PIP_OFF,
        on ? 1 : 0.5,
      ),
    );
  }
  return ops;
}

/** A small coloured tile per condition with a kind-specific glyph. */
function conditionOps(icons: readonly ConditionIcon[]): UnitDrawOp[] {
  const ops: UnitDrawOp[] = [];
  icons.forEach((icon, index) => {
    const x = CONDITION_ROW.x + index * (CONDITION_ROW.size + CONDITION_ROW.gap);
    const y = CONDITION_ROW.y;
    const centerX = x + CONDITION_ROW.size / 2;
    const centerY = y + CONDITION_ROW.size / 2;
    const radius = CONDITION_ROW.size / 4;
    ops.push(rect(x, y, CONDITION_ROW.size, CONDITION_ROW.size, icon.color, 0.9));

    const glyph = 0xffffff;
    if (icon.kind === "ailment") {
      ops.push(
        line(
          [centerX - radius, centerY - radius, centerX + radius, centerY + radius],
          1.2,
          glyph,
          0.9,
        ),
        line(
          [centerX - radius, centerY + radius, centerX + radius, centerY - radius],
          1.2,
          glyph,
          0.9,
        ),
      );
    } else if (icon.kind === "buff") {
      ops.push(
        poly(
          [
            centerX,
            centerY - radius,
            centerX + radius,
            centerY + radius,
            centerX - radius,
            centerY + radius,
          ],
          glyph,
          0.9,
        ),
      );
    } else if (icon.kind === "debuff") {
      ops.push(
        poly(
          [
            centerX,
            centerY + radius,
            centerX + radius,
            centerY - radius,
            centerX - radius,
            centerY - radius,
          ],
          glyph,
          0.9,
        ),
      );
    } else {
      ops.push(
        poly(
          [
            centerX,
            centerY - radius,
            centerX + radius,
            centerY,
            centerX,
            centerY + radius,
            centerX - radius,
            centerY,
          ],
          glyph,
          0.9,
        ),
      );
    }
  });
  return ops;
}

/**
 * Every draw op for one unit, relative to its tile's top-face centre:
 * the side ground-glow, the soldier, then the HP / Élan bars, Honour pips and
 * condition icons stacked above the head. This is the single entry point
 * `scene.ts` uses to paint a unit.
 */
export function unitDrawOps(unit: Unit): readonly UnitDrawOp[] {
  const presentation = unitPresentation(unit);
  return [
    ...groundOps(unit.side),
    ...presentation.figure.ops,
    ...barOps(presentation.hp),
    ...barOps(presentation.elan),
    ...honourOps(presentation.honour),
    ...conditionOps(presentation.conditions),
  ];
}
