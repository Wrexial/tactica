/**
 * Post-change screen (T052) — the barracks UI for swapping a soldier's
 * **primary post**, **attached post** / action skillset, and for reading the
 * **Drill** progress that unlocks the rest of the role tree.
 *
 * This is a thin React view over the pure progression helpers in
 * `engine/progression/posts.ts` (T051) and the authored roster in
 * `src/data/posts/` (T046/T047). It owns **no** game rules: every gate it
 * draws — power restriction, "master N abilities from post X" prerequisites,
 * which skillsets may be attached — comes from the data layer's
 * `canTakePost` / `meetsPostRequirements` / `availableSkillsets`. The screen
 * only renders that state and hands a caller (eventually the roster) a new
 * {@link PostAssignment}.
 *
 * Mapping notes (mapping §3/§5/§6, decisions D3/D4):
 * - **Post** is FFTA's *job*. Stats come from the **primary** post; the
 *   attached post only contributes a second *action skillset* (T051).
 * - **Drill** is FFTA's AP: earned in battle and spent mastering the abilities
 *   bound to equipped kit. A post whose prerequisite abilities are not yet
 *   mastered is shown **locked**, with per-requirement progress, and its
 *   "Set primary" control is disabled.
 * - The attached skillset is restricted to posts the soldier has **mastered**
 *   (`availableSkillsets`), mirroring FFTA's secondary-job command.
 *
 * Contract (`agents.md` §2, §7, §9):
 * - **Presentation only.** The component reads data/engine values and never
 *   mutates engine state; it emits a new assignment through its callback.
 * - **Deterministic.** No randomness, no clock, no I/O. The same soldier and
 *   mastery always render the same screen.
 * - **Data-driven.** No post names, costs or requirements are hard-coded here;
 *   they come from `src/data/`.
 *
 * Reference: `docs/wiki/pages/Final_Fantasy_Tactics_Advance_jobs.md` (job
 * growth + "secondary command") and `docs/wiki/pages/Ability_Points.md` (AP).
 */

import { useMemo, useState } from "react";

import {
  getPost,
  isPostKey,
  meetsPostRequirements,
  POST_LIST,
  postsForPower,
  type MasteredByPost,
  type PostKey,
} from "../data/posts";
import type { PowerKey, PostDef } from "../data/schema";
import { asPostId, asSkillsetId, type SkillsetId } from "../engine/ids";
import {
  assignActionSkillset,
  attachedPostOf,
  availableSkillsets,
  createPostAssignment,
  derivePostStats,
  primaryPostOf,
  type PostAssignment,
} from "../engine/progression/posts";
import { useTranslation, type MessageKey, type Translator } from "../i18n";

/* --------------------------------------------------------------------------
 * View-model types
 * ------------------------------------------------------------------------ */

/**
 * One ability's **Drill** (AP) progress toward mastery. The data layer does not
 * yet author abilities with an owning post (that lands with the ability
 * collection, T089), so the barracks is fed this small, explicit shape.
 */
export interface DrillProgress {
  /** Stable ability id (FFTA-shaped, mapping §1). */
  readonly abilityId: string;
  /** Player-facing action name. */
  readonly abilityName: string;
  /** The post whose mastery this Drill counts toward. */
  readonly postId: PostKey;
  /** Drill accumulated so far. */
  readonly drill: number;
  /** Drill required to master the ability. */
  readonly required: number;
  /** `true` once `drill >= required`; mastery is permanent (T048). */
  readonly mastered: boolean;
}

/**
 * The soldier shown in the barracks: identity, current assignment, the
 * abilities mastered per post (the unlock currency) and the Drill progress
 * list. Kept as a plain, serialisable value so a roster save can round-trip it.
 */
export interface PostScreenSoldier {
  readonly name: string;
  readonly power: PowerKey;
  readonly level: number;
  readonly assignment: PostAssignment;
  readonly mastered: MasteredByPost;
  readonly drill: readonly DrillProgress[];
}

/** Props for {@link PostScreen}. */
export interface PostScreenProps {
  /** The soldier to manage. Defaults to a deterministic demo recruit. */
  readonly soldier?: PostScreenSoldier;
  /** Called with the new, immutable assignment after a legal post change. */
  readonly onAssignmentChange?: (assignment: PostAssignment) => void;
}

/* --------------------------------------------------------------------------
 * Display helpers (presentation only)
 * ------------------------------------------------------------------------ */

const POWER_LABEL_KEYS: Readonly<Record<PowerKey, MessageKey>> = {
  france: "power.france",
  britain: "power.britain",
  prussia: "power.prussia",
  russia: "power.russia",
  austria: "power.austria",
};

const STAT_COLUMNS = ["hp", "mp", "atk", "def", "mag", "res", "spd", "move", "jump"] as const;
type StatColumn = (typeof STAT_COLUMNS)[number];

const STAT_LABEL_KEYS: Readonly<Record<StatColumn, MessageKey>> = {
  hp: "stat.hp",
  mp: "stat.mp",
  atk: "stat.atk",
  def: "stat.def",
  mag: "stat.mag",
  res: "stat.res",
  spd: "stat.spd",
  move: "stat.move",
  jump: "stat.jump",
};

/** Resolve a post id from authored data, or `null` when it is unknown. */
function findPost(postId: string): PostDef | null {
  return isPostKey(postId) ? getPost(postId) : null;
}

/** A post's display name for a requirement line (falls back to the raw id). */
function postLabel(postId: string): string {
  return findPost(postId)?.name ?? postId;
}

/**
 * A human-readable summary of a post's unlock requirements, with progress:
 * `Requires 2 from Fusilier (1/2)`. Returns `null` for a starting post.
 */
function requirementSummary(
  post: PostDef,
  mastered: MasteredByPost,
  t: Translator,
): string | null {
  if (post.requires.length === 0) return null;
  return post.requires
    .map((requirement) => {
      const have = mastered[requirement.postId]?.length ?? 0;
      const shown = Math.min(have, requirement.abilities);
      return t("posts.requirement", {
        abilities: requirement.abilities,
        post: postLabel(requirement.postId),
        have: shown,
        required: requirement.abilities,
      });
    })
    .join(" · ");
}

/** A skillset's display label, derived from its owning post (`Fusilier Kit`). */
function skillsetLabel(skillsetId: SkillsetId, t: Translator): string {
  const owner = POST_LIST.find((post) => post.skillsetIds.includes(skillsetId));
  return owner === undefined ? String(skillsetId) : t("posts.kitSuffix", { post: owner.name });
}

/** Clamp a Drill value into `[0, required]` for the progress bar. */
function clampDrill(value: number, required: number): number {
  if (required <= 0) return 0;
  return Math.min(Math.max(value, 0), required);
}

/* --------------------------------------------------------------------------
 * Demo soldier
 * ------------------------------------------------------------------------ */

/**
 * A deterministic barracks recruit for the app shell, standing in until the
 * roster/save layer (T100) can supply a real one. Sgt. Aubry is a France
 * fusilier (mapping §2/§3) who has mastered two fusilier abilities — enough to
 * unlock **Grenadier** and **Marksman** — and one marksman ability, so the
 * screen always demonstrates an unlocked post, a locked post and in-progress
 * Drill.
 */
const DEMO_MASTERED: MasteredByPost = {
  fusilier: ["volley-fire", "bayonet-charge"],
  marksman: ["range-the-ground"],
};

const DEMO_DRILL: readonly DrillProgress[] = [
  {
    abilityId: "volley-fire",
    abilityName: "Volley Fire",
    postId: "fusilier",
    drill: 100,
    required: 100,
    mastered: true,
  },
  {
    abilityId: "bayonet-charge",
    abilityName: "Bayonet Charge",
    postId: "fusilier",
    drill: 100,
    required: 100,
    mastered: true,
  },
  {
    abilityId: "range-the-ground",
    abilityName: "Range the Ground",
    postId: "marksman",
    drill: 70,
    required: 70,
    mastered: true,
  },
  {
    abilityId: "aim-vitals",
    abilityName: "Aim Vitals",
    postId: "marksman",
    drill: 40,
    required: 150,
    mastered: false,
  },
];

const DEMO_SOLDIER: PostScreenSoldier = {
  name: "Sgt. Aubry",
  power: "france",
  level: 4,
  assignment: createPostAssignment({
    primaryPostId: asPostId("fusilier"),
    attachedPostId: asPostId("marksman"),
    actionSkillsetId: asSkillsetId("marksman-kit"),
    power: "france",
  }),
  mastered: DEMO_MASTERED,
  drill: DEMO_DRILL,
};

/* --------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------ */

/**
 * The post-change screen. Lists every post available to the soldier's power,
 * gates each by its unlock requirements, and lets a legal choice become the
 * new primary post or attached action skillset.
 */
export function PostScreen({ soldier = DEMO_SOLDIER, onAssignmentChange }: PostScreenProps) {
  const { t } = useTranslation();
  const [assignment, setAssignment] = useState<PostAssignment>(soldier.assignment);

  const primary = primaryPostOf(assignment);
  const attached = attachedPostOf(assignment);

  const powerPosts = useMemo(() => postsForPower(soldier.power), [soldier.power]);
  const skillsets = useMemo(
    () => availableSkillsets(assignment, soldier.mastered),
    [assignment, soldier.mastered],
  );
  const stats = useMemo(
    () => derivePostStats({ level: soldier.level, assignment }),
    [soldier.level, assignment],
  );

  /** Apply a legal assignment and notify the caller. */
  const commit = (next: PostAssignment): void => {
    setAssignment(next);
    onAssignmentChange?.(next);
  };

  /**
   * Change the **primary** post. Stats follow the primary post only; the action
   * skillset resets to the new post's own kit and the attached post clears
   * (T051). The caller must gate on {@link meetsPostRequirements} first — the
   * button is disabled for locked posts.
   */
  const choosePrimary = (post: PostDef): void => {
    commit(
      createPostAssignment({
        primaryPostId: asPostId(post.id),
        power: soldier.power,
        slots: assignment.slots,
      }),
    );
  };

  /** Attach a mastered post's actions skillset (or return to the primary's). */
  const chooseSkillset = (skillsetId: SkillsetId): void => {
    commit(assignActionSkillset(assignment, skillsetId, soldier.mastered));
  };

  return (
    <section className="post-screen" data-testid="post-screen" aria-label={t("posts.label")}>
      <header className="post-screen__header">
        <div className="post-screen__identity">
          <p className="kicker">{t("posts.kicker")}</p>
          <h2>{soldier.name}</h2>
          <p className="muted">
            {t("posts.levelLine", {
              power: t(POWER_LABEL_KEYS[soldier.power]),
              level: soldier.level,
            })}
          </p>
        </div>
        <dl className="post-screen__current">
          <div>
            <dt>{t("posts.primary")}</dt>
            <dd data-testid="post-current-primary">{primary.name}</dd>
          </div>
          <div>
            <dt>{t("posts.attached")}</dt>
            <dd data-testid="post-current-attached">{attached?.name ?? t("common.none")}</dd>
          </div>
        </dl>
      </header>

      <div className="post-screen__body">
        <section className="post-screen__tree" aria-label={t("posts.roleTree")}>
          <h3>
            {t("posts.roleTreeHeading", { power: t(POWER_LABEL_KEYS[soldier.power]) })}
          </h3>
          <ul className="post-list">
            {powerPosts.map((post) => {
              const unlocked = meetsPostRequirements(post, soldier.mastered);
              const isPrimary = post.id === assignment.primaryPostId;
              const summary = requirementSummary(post, soldier.mastered, t);
              return (
                <li
                  key={post.id}
                  className={unlocked ? "post-row" : "post-row post-row--locked"}
                  data-testid={`post-${post.id}`}
                >
                  <div className="post-row__main">
                    <div className="post-row__title">
                      <span className="post-row__name">{post.name}</span>
                      <span
                        className={unlocked ? "post-badge" : "post-badge post-badge--locked"}
                        data-testid={`post-${post.id}-status`}
                      >
                        {unlocked
                          ? isPrimary
                            ? t("posts.currentBadge")
                            : t("posts.unlockedBadge")
                          : t("posts.lockedBadge")}
                      </span>
                    </div>
                    <p className="post-row__desc">{post.description}</p>
                    {summary !== null && (
                      <p className="post-row__req" data-testid={`post-${post.id}-requirement`}>
                        {summary}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="button"
                    data-testid={`post-${post.id}-set-primary`}
                    disabled={!unlocked || isPrimary}
                    onClick={() => choosePrimary(post)}
                  >
                    {isPrimary ? t("posts.primaryButton") : t("posts.setPrimary")}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="post-screen__side">
          <section aria-label={t("posts.skillsetLabel")}>
            <h3>{t("posts.actionSkillset")}</h3>
            <p className="muted">{t("posts.skillsetNote")}</p>
            <label className="post-skillset">
              <span>{t("posts.attachedCommand")}</span>
              <select
                data-testid="action-skillset"
                value={assignment.actionSkillsetId ?? ""}
                onChange={(event) => chooseSkillset(asSkillsetId(event.target.value))}
              >
                {skillsets.map((skillsetId) => (
                  <option key={skillsetId} value={skillsetId}>
                    {skillsetLabel(skillsetId, t)}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section aria-label={t("posts.drillProgressLabel")}>
            <h3>{t("posts.drillProgress")}</h3>
            <p className="muted">{t("posts.drillNote")}</p>
            <ul className="drill-list">
              {soldier.drill.map((entry) => (
                <li
                  key={entry.abilityId}
                  className="drill-row"
                  data-testid={`drill-${entry.abilityId}`}
                >
                  <div className="drill-row__head">
                    <span className="drill-row__name">{entry.abilityName}</span>
                    <span
                      className="drill-row__value"
                      data-testid={`drill-${entry.abilityId}-progress`}
                    >
                      {entry.drill} / {entry.required}
                    </span>
                  </div>
                  <progress
                    max={entry.required}
                    value={clampDrill(entry.drill, entry.required)}
                    aria-label={`${entry.abilityName} ${t("common.drill")}`}
                  />
                  <span
                    className="drill-row__status"
                    data-testid={`drill-${entry.abilityId}-status`}
                  >
                    {entry.mastered ? t("common.mastered") : t("common.inTraining")}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label={t("posts.statsLabel")}>
            <h3>{t("posts.statsHeading", { post: primary.name })}</h3>
            <dl className="post-stats" data-testid="post-stats">
              {STAT_COLUMNS.map((key) => (
                <div key={key}>
                  <dt>{t(STAT_LABEL_KEYS[key])}</dt>
                  <dd data-testid={`post-stat-${key}`}>{stats[key]}</dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>
    </section>
  );
}
