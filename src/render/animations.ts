/**
 * Event-driven battle animations (T082).
 *
 * The battle state machine (`src/engine/battle.ts`) communicates every jump the
 * world made through the ordered {@link BattleEvent} stream (T021). This module
 * is the **presentation half** of that contract: it translates those events —
 * and *nothing else* — into plain, deterministic *animation cues* that the
 * Pixi scene (`scene.ts`) plays and the DOM battle log renders.
 *
 * Why event-driven (`agents.md` §7)?
 * - **No diffing ambiguities.** A shove and a march can leave the same
 *   end-state; only the `moved` / `shoved` event knows which to play.
 * - **Correct ordering.** Events arrive in resolution order, so a wind-up flash
 *   always precedes its impact popup.
 * - **Purity.** The module is framework-free and DOM-free, exactly like
 *   `tiles.ts` and `units.ts`: no Pixi, no `window`, no `Math.random`, no
 *   clock. The same events always yield byte-identical cues, so replays and
 *   screenshots stay stable and the whole translation is unit-testable in Node.
 *
 * The four families the task calls for map onto {@link AnimationKind}:
 *
 * | Cue          | Engine source                                            |
 * | ------------ | -------------------------------------------------------- |
 * | `move`       | `moved` (march) and `shoved` (knockback)                 |
 * | `volley`     | `volleyStarted` / `volleyChained`                        |
 * | `artillery`  | `abilityResolved` / `itemUsed` for a Powder ability      |
 * | `popup`      | `damaged`, `healed`, `missed`, condition and resource changes |
 *
 * Vocabulary is Napoleonic (`docs/NAPOLEONIC_MAPPING.md`): the HP bar is
 * strength, **Élan** is morale, **Honour** is the FFTA "JP" resource and a
 * condition is one of the eight reflavoured statuses. Mechanical keys stay
 * FFTA-shaped (`unitId`, `abilityId`, `conditionId`) so formulas and the
 * reference map 1:1.
 *
 * Contract (`agents.md` §2, §7, §9):
 * - **Pure and deterministic** — inputs are only read; no clock or randomness.
 * - **JSON-safe and serialisable** — branded ids, plain coords and finite
 *   integers only, so a cue list can be logged next to a replay.
 * - **No balance constants in logic** — pacing and colour live in named
 *   constants here.
 */

import type { ElementKey } from "../data/schema";
import type { BattleEvent, DamageType } from "../engine/events";
import type { Coord, Facing } from "../engine/grid";
import type { AbilityId, EquipmentId, UnitId } from "../engine/ids";
import { conditionIcon } from "./units";

/* --------------------------------------------------------------------------
 * Cue vocabulary
 * ------------------------------------------------------------------------ */

/** Every animation family the renderer knows how to play. */
export const ANIMATION_KINDS = ["move", "volley", "artillery", "popup"] as const;
export type AnimationKind = (typeof ANIMATION_KINDS)[number];

/**
 * Fields every cue shares. `tick` is the engine's integer Orders Tempo clock,
 * so the scene can stagger cues by *battle time* rather than wall time, and
 * `duration` is the cue's pacing in those same tempo ticks.
 */
export interface AnimationBase {
  readonly kind: AnimationKind;
  /** Orders Tempo tick the triggering event occurred on. */
  readonly tick: number;
  /** How long the cue plays, in tempo ticks (`>= 0`). */
  readonly duration: number;
  /** Short human-readable summary, for the DOM battle log and debugging. */
  readonly label: string;
}

/** A soldier marching or being driven back one or more tiles. */
export interface MoveAnimation extends AnimationBase {
  readonly kind: "move";
  readonly unitId: UnitId;
  /** Display name, resolved from the caller's context when available. */
  readonly unitName?: string;
  readonly from: Coord;
  readonly to: Coord;
  /** Full route, origin first — the scene animates tile by tile. */
  readonly path: readonly Coord[];
  readonly facing: Facing;
  /** A deliberate march or a knockback (FFTA Shove, mapping §12). */
  readonly reason: "march" | "shove";
}

/** One participant firing in a **Volley** (FFTA Combo, mapping §6). */
export interface VolleyAnimation extends AnimationBase {
  readonly kind: "volley";
  readonly unitId: UnitId;
  readonly unitName?: string;
  readonly abilityId: AbilityId;
  /** Resolved centre of the volley's mark. */
  readonly at: Coord;
  readonly targetId?: UnitId;
  /** `start` opens the volley; `chain` is an adjacent ally joining in. */
  readonly role: "start" | "chain";
  /** Honour the initiator committed (`0` for a chainer). */
  readonly honour: number;
}

/** A **Powder** detonation (field gun, grenade, petard, rocket). */
export interface ArtilleryAnimation extends AnimationBase {
  readonly kind: "artillery";
  readonly unitId: UnitId;
  readonly unitName?: string;
  /** The action or kit item that landed the burst. */
  readonly abilityId: AbilityId | EquipmentId;
  /** Tile the burst is centred on. */
  readonly at: Coord;
  readonly targetId?: UnitId;
  /** Elemental flavour when known (mapping §7); purely for colour. */
  readonly element?: ElementKey;
}

/** Tone of a floating combat text popup; selects its default colour. */
export const POPUP_TONES = [
  "damage",
  "heal",
  "miss",
  "condition",
  "elan",
  "honour",
  "drill",
  "defeat",
  "notice",
] as const;
export type PopupTone = (typeof POPUP_TONES)[number];

/** Default colour per popup tone (re-authored for the theatre, mapping §14). */
export const POPUP_COLORS: Readonly<Record<PopupTone, number>> = {
  damage: 0xd94f3d,
  heal: 0x5ebf72,
  miss: 0xb9b3a5,
  condition: 0x8a8175,
  elan: 0x4f9ad4,
  honour: 0xf0c74a,
  drill: 0x9a7ad4,
  defeat: 0x8a1f1f,
  notice: 0xf4f1e8,
};

/**
 * Burst colour per element (mapping §7). The eight FFTA elements are reflavoured
 * as artillery, weather and morale, so each keeps a distinct, readable hue that
 * the Pixi scene can lean on without re-deriving it from the data tables.
 */
export const ELEMENT_COLORS: Readonly<Record<ElementKey, number>> = {
  fire: 0xe0702f,
  ice: 0x6fb7d4,
  lightning: 0xf0c74a,
  earth: 0x9a7a4a,
  water: 0x4f7fd4,
  wind: 0xb9b3a5,
  holy: 0xf4e6b0,
  dark: 0x6a5acd,
};

/** The colour for a Powder burst, defaulting to a neutral Incendiary orange. */
export function artilleryColor(element: ElementKey | undefined): number {
  return element === undefined ? ELEMENT_COLORS.fire : ELEMENT_COLORS[element];
}

/** A floating combat text / condition popup above a soldier. */
export interface PopupAnimation extends AnimationBase {
  readonly kind: "popup";
  readonly unitId: UnitId;
  readonly unitName?: string;
  /** Tile to anchor the popup to, when the caller supplied a position. */
  readonly at?: Coord;
  /** The glyph string shown, e.g. `-12`, `+8`, `BL`, `Out of Action`. */
  readonly text: string;
  readonly tone: PopupTone;
  readonly color: number;
  /** A critical strike; the scene draws it larger. */
  readonly critical: boolean;
  /** This hit reduced the soldier to zero strength. */
  readonly fatal: boolean;
}

/** The complete animation-cue union. Narrow on `kind` to handle each family. */
export type BattleAnimation = MoveAnimation | VolleyAnimation | ArtilleryAnimation | PopupAnimation;

/**
 * Optional lookups the builder uses to anchor popups and label cues. All are
 * reads; the builder never stores the context, so a cue list is self-contained.
 */
export interface AnimationContext {
  /** The tile a soldier currently stands on, when known. */
  readonly unitAt?: (unitId: UnitId) => Coord | undefined;
  /** A soldier's display name, when known. Falls back to the raw id. */
  readonly unitName?: (unitId: UnitId) => string | undefined;
}

/* --------------------------------------------------------------------------
 * Pacing
 * ------------------------------------------------------------------------ */

/** Tempo ticks a single marching step / volley flash / popup occupies. */
export const MOVE_STEP_TICKS = 1;
export const VOLLEY_TICKS = 1;
export const ARTILLERY_TICKS = 2;
export const POPUP_TICKS = 3;

/**
 * Ability-id keywords that read as **Powder** ordnance. Matching is
 * case-insensitive and forgiving so new content needs no render change, exactly
 * like the post role classifier in `units.ts`. The mapping's artillery posts
 * (`artilleryman`, `master-gunner`, `bombardier`, `sapper`) and signature
 * actions (`case-shot`, `grand-barrage`, `petard`) all match.
 *
 * Reference: `docs/NAPOLEONIC_MAPPING.md` §3 (Artilleryman, Sapper, Master
 * Gunner, Bombardier) and §12 (Steel vs. Powder).
 */
export const ARTILLERY_KEYWORDS: readonly string[] = [
  "artiller",
  "cannon",
  "gun",
  "case-shot",
  "shell",
  "howitzer",
  "bombard",
  "grenade",
  "petard",
  "rocket",
  "barrage",
  "ordnance",
  "mortar",
  "shrapnel",
  "canister",
  "siege",
];

/** Whether an ability (or kit item) id reads as Powder artillery. */
export function isArtilleryAbility(id: string): boolean {
  const needle = id.toLowerCase();
  return ARTILLERY_KEYWORDS.some((keyword) => needle.includes(keyword));
}

/** Fire/Cold/Shock/... inferred from an ordnance id, when it names one. */
const ARTILLERY_ELEMENTS: readonly (readonly [string, ElementKey])[] = [
  ["incendiary", "fire"],
  ["fire", "fire"],
  ["flame", "fire"],
  ["cold", "ice"],
  ["frost", "ice"],
  ["shock", "lightning"],
  ["thunder", "lightning"],
  ["siege", "earth"],
  ["deluge", "water"],
  ["smoke", "dark"],
  ["holy", "holy"],
];

/** Best-effort elemental flavour of an ordnance id (colour only). */
export function artilleryElement(id: string): ElementKey | undefined {
  const needle = id.toLowerCase();
  return ARTILLERY_ELEMENTS.find(([keyword]) => needle.includes(keyword))?.[1];
}

/* --------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------ */

/** Resolve a unit's display name from the context, falling back to its id. */
function nameOf(context: AnimationContext, unitId: UnitId): string | undefined {
  return context.unitName?.(unitId);
}

/** Resolve a unit's tile from the context. */
function atOf(context: AnimationContext, unitId: UnitId): Coord | undefined {
  return context.unitAt?.(unitId);
}

/** Copy a coord so a cue never aliases engine state (`agents.md` §2). */
function copyCoord(at: Coord): Coord {
  return { x: at.x, y: at.y };
}

/** `+3` / `-2` resource deltas, with no sign on zero. */
function signed(delta: number): string {
  if (delta === 0) return "0";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/** Build a popup cue from the shared fields, resolving colour and label. */
function popup(
  event: BattleEvent,
  unitId: UnitId,
  context: AnimationContext,
  text: string,
  tone: PopupTone,
  options: {
    readonly color?: number;
    readonly critical?: boolean;
    readonly fatal?: boolean;
  } = {},
): PopupAnimation {
  const name = nameOf(context, unitId);
  const at = atOf(context, unitId);
  return {
    kind: "popup",
    tick: event.tick,
    duration: POPUP_TICKS,
    unitId,
    ...(name === undefined ? {} : { unitName: name }),
    ...(at === undefined ? {} : { at: copyCoord(at) }),
    text,
    tone,
    color: options.color ?? POPUP_COLORS[tone],
    critical: options.critical ?? false,
    fatal: options.fatal ?? false,
    label: `${name ?? unitId}: ${text}`,
  };
}

/* --------------------------------------------------------------------------
 * The builder
 * ------------------------------------------------------------------------ */

/**
 * Translate an ordered engine event stream into an ordered animation-cue list.
 *
 * The mapping is deliberately strict: **only** the kinds below produce a cue,
 * and every field of a cue originates from an event or the read-only context.
 * Kinds the renderer has nothing to animate (lifecycle bookkeeping, Article
 * verdicts, progression awards with no field position, ...) are skipped rather
 * than guessed at.
 *
 * ```ts
 * const cues = animationsForEvents(step(state, command).events, {
 *   unitAt: (id) => findUnit(state, id)?.at,
 *   unitName: (id) => findUnit(state, id)?.name,
 * });
 * ```
 */
export function animationsForEvents(
  events: readonly BattleEvent[],
  context: AnimationContext = {},
): BattleAnimation[] {
  const cues: BattleAnimation[] = [];

  for (const event of events) {
    switch (event.kind) {
      case "moved": {
        const name = nameOf(context, event.unitId);
        cues.push({
          kind: "move",
          tick: event.tick,
          duration: Math.max(1, event.path.length - 1) * MOVE_STEP_TICKS,
          unitId: event.unitId,
          ...(name === undefined ? {} : { unitName: name }),
          from: copyCoord(event.from),
          to: copyCoord(event.to),
          path: event.path.map(copyCoord),
          facing: event.facing,
          reason: "march",
          label: `${name ?? event.unitId} marches ${Math.max(1, event.path.length - 1)} tiles`,
        });
        break;
      }

      case "shoved": {
        const name = nameOf(context, event.unitId);
        cues.push({
          kind: "move",
          tick: event.tick,
          duration: MOVE_STEP_TICKS,
          unitId: event.unitId,
          ...(name === undefined ? {} : { unitName: name }),
          from: copyCoord(event.from),
          to: copyCoord(event.to),
          path: [copyCoord(event.from), copyCoord(event.to)],
          facing: "north",
          reason: "shove",
          label: `${name ?? event.unitId} is driven back`,
        });
        break;
      }

      case "volleyStarted": {
        const name = nameOf(context, event.unitId);
        cues.push({
          kind: "volley",
          tick: event.tick,
          duration: VOLLEY_TICKS,
          unitId: event.unitId,
          ...(name === undefined ? {} : { unitName: name }),
          abilityId: event.abilityId,
          at: copyCoord(event.at),
          ...(event.targetId === undefined ? {} : { targetId: event.targetId }),
          role: "start",
          honour: event.honour,
          label: `${name ?? event.unitId} opens a volley (${event.honour} Honour)`,
        });
        break;
      }

      case "volleyChained": {
        const name = nameOf(context, event.unitId);
        cues.push({
          kind: "volley",
          tick: event.tick,
          duration: VOLLEY_TICKS,
          unitId: event.unitId,
          ...(name === undefined ? {} : { unitName: name }),
          abilityId: event.abilityId,
          at: copyCoord(event.at),
          ...(event.targetId === undefined ? {} : { targetId: event.targetId }),
          role: "chain",
          honour: 0,
          label: `${name ?? event.unitId} chains into the volley`,
        });
        break;
      }

      case "abilityResolved": {
        if (!isArtilleryAbility(event.abilityId)) break;
        const name = nameOf(context, event.unitId);
        const element = artilleryElement(event.abilityId);
        cues.push({
          kind: "artillery",
          tick: event.tick,
          duration: ARTILLERY_TICKS,
          unitId: event.unitId,
          ...(name === undefined ? {} : { unitName: name }),
          abilityId: event.abilityId,
          at: copyCoord(event.at),
          ...(event.targetId === undefined ? {} : { targetId: event.targetId }),
          ...(element === undefined ? {} : { element }),
          label: `${name ?? event.unitId} fires ${event.abilityId}`,
        });
        break;
      }

      case "itemUsed": {
        if (!isArtilleryAbility(event.itemId)) break;
        const name = nameOf(context, event.unitId);
        const element = artilleryElement(event.itemId);
        cues.push({
          kind: "artillery",
          tick: event.tick,
          duration: ARTILLERY_TICKS,
          unitId: event.unitId,
          ...(name === undefined ? {} : { unitName: name }),
          abilityId: event.itemId,
          at: copyCoord(event.at),
          ...(event.targetId === undefined ? {} : { targetId: event.targetId }),
          ...(element === undefined ? {} : { element }),
          label: `${name ?? event.unitId} deploys ${event.itemId}`,
        });
        break;
      }

      case "damaged": {
        const text = event.amount === 0 ? "No Damage" : `-${event.amount}`;
        cues.push(
          popup(event, event.unitId, context, text, "damage", {
            critical: event.critical,
            fatal: event.fatal,
          }),
        );
        break;
      }

      case "healed":
        cues.push(popup(event, event.unitId, context, `+${event.amount}`, "heal"));
        break;

      case "missed":
        cues.push(popup(event, event.unitId, context, "Miss", "miss"));
        break;

      case "outOfAction":
        cues.push(popup(event, event.unitId, context, "Out of Action", "defeat", { fatal: true }));
        break;

      case "revived":
        cues.push(popup(event, event.unitId, context, "Revived", "heal"));
        break;

      case "conditionApplied": {
        const icon = conditionIcon(event.conditionId);
        cues.push(
          popup(event, event.unitId, context, icon.label, "condition", { color: icon.color }),
        );
        break;
      }

      case "conditionRemoved": {
        const icon = conditionIcon(event.conditionId);
        cues.push(
          popup(event, event.unitId, context, `${icon.label} lifted`, "condition", {
            color: icon.color,
          }),
        );
        break;
      }

      case "mpChanged":
        cues.push(popup(event, event.unitId, context, `${signed(event.delta)} Élan`, "elan"));
        break;

      case "honourChanged":
        cues.push(popup(event, event.unitId, context, `${signed(event.delta)} Honour`, "honour"));
        break;

      case "drillGained":
        cues.push(popup(event, event.unitId, context, `+${event.amount} Drill`, "drill"));
        break;

      case "experienceGained":
        cues.push(popup(event, event.unitId, context, `+${event.amount} XP`, "notice"));
        break;

      case "levelUp":
        cues.push(popup(event, event.unitId, context, `Level ${event.level}`, "notice"));
        break;

      case "abilityLearned":
        cues.push(popup(event, event.unitId, context, "Ability Mastered", "notice"));
        break;

      case "postUnlocked":
        cues.push(popup(event, event.unitId, context, "New Post", "notice"));
        break;

      case "articleBroken":
        cues.push(popup(event, event.unitId, context, "Article Broken", "defeat"));
        break;

      case "reprimandIssued":
        cues.push(popup(event, event.unitId, context, "Reprimand", "defeat"));
        break;

      case "courtMartialIssued":
        cues.push(popup(event, event.unitId, context, "Court-Martial", "defeat", { fatal: true }));
        break;

      case "commended":
        cues.push(popup(event, event.unitId, context, `${signed(event.honour)} Honour`, "honour"));
        break;

      // Lifecycle, turn bookkeeping and field-wide rewards have no position to
      // animate; they are intentionally skipped rather than guessed at.
      case "battleStarted":
      case "battleEnded":
      case "unitDeployed":
      case "unitRemoved":
      case "turnStarted":
      case "turnEnded":
      case "chargeStarted":
      case "chargeResolved":
      case "faced":
      case "abilityUsed":
      case "reactionTriggered":
      case "guardSortieCalled":
      case "rewardGranted":
        break;
    }
  }

  return cues;
}

/* --------------------------------------------------------------------------
 * Convenience queries for the scene / HUD
 * ------------------------------------------------------------------------ */

/** All cues of one family, preserving engine order. */
export function animationsOfKind<K extends AnimationKind>(
  animations: readonly BattleAnimation[],
  kind: K,
): Extract<BattleAnimation, { kind: K }>[] {
  return animations.filter(
    (animation): animation is Extract<BattleAnimation, { kind: K }> => animation.kind === kind,
  );
}

/** A stable, JSON-safe snapshot of a cue list, for logs and replay diffing. */
export function serializeAnimations(animations: readonly BattleAnimation[]): string {
  return JSON.stringify(animations);
}

/** The event kinds that can produce a cue; handy documentation and for tests. */
export const ANIMATED_EVENT_KINDS = [
  "moved",
  "shoved",
  "volleyStarted",
  "volleyChained",
  "abilityResolved",
  "itemUsed",
  "damaged",
  "healed",
  "missed",
  "outOfAction",
  "revived",
  "conditionApplied",
  "conditionRemoved",
  "mpChanged",
  "honourChanged",
  "drillGained",
  "experienceGained",
  "levelUp",
  "abilityLearned",
  "postUnlocked",
  "articleBroken",
  "reprimandIssued",
  "courtMartialIssued",
  "commended",
] as const satisfies readonly BattleEvent["kind"][];

/** Type guard used by tests and callers to check a damage type is Powder. */
export function isPowderDamage(damageType: DamageType): boolean {
  return damageType === "powder";
}
