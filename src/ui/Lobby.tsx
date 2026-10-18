/**
 * Lobby screen (T113) — matchmaking and the online **free-company skirmish**.
 *
 * This is the presentation layer over `src/net/lobby.ts`: it turns the
 * lobby/matchmaking handshake into something a player can drive, and shows the
 * two peers' state hashes agreeing after a match. The engine underneath never
 * sends battle state — only the shared seed and the ordered command log
 * (mapping §10 "link-cable multiplayer → online skirmish", decision D15).
 *
 * ```
 *   HOME_COMPANY ─┐
 *                 ├─► closestOpponent ─► Lobby.join/ready ─► runSkirmish
 *   RIVALS (pool) ┘                                            │
 *                                                              └─► agreed hashes
 * ```
 *
 * ## What this screen owns
 *
 * - **The player's company card** and a **pool** of rival free companies to be
 *   matched against. The companies are authored prototype pages here (until the
 *   campaign save supplies the real roster); the matchmaking itself is the
 *   pure, deterministic `closestOpponent` / `Lobby` from the net layer.
 * - **The ready handshake**: the player marks their company ready; the rival is
 *   ready automatically, mirroring a real opponent's confirmation.
 * - **The skirmish**: pressing start seats both companies in a fresh lobby with
 *   a shared seed, starts the match and plays it headlessly through the lockstep
 *   sessions, then reports the outcome and both peers' final hashes.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation only.** No matchmaking or battle rule is hard-coded here;
 *   every transition goes through `src/net/lobby.ts`.
 * - **Deterministic.** No randomness, no clock. The seed is derived from the
 *   two company ids, so the same pairing always plays the same skirmish.
 * - **Original fiction.** The company names and roster are our own Napoleonic
 *   invention, never FFTA prose.
 *
 * Reference: mapping §1 (Clan → Company), §10 (link-cable multiplayer → online
 * skirmish) and §14/D15 (determinism from day one).
 */

import { useState } from "react";

import type { PowerKey, StatBlock } from "../data/schema";
import type { RosterMember } from "../engine/company";
import { coord } from "../engine/grid";
import { asCompanyId, asPostId, asUnitId } from "../engine/ids";
import { createPostAssignment } from "../engine/progression/posts";
import { createUnit } from "../engine/unit";
import { useTranslation, type Translator } from "../i18n";
import {
  Lobby,
  closestOpponent,
  createLobbyCompany,
  runSkirmish,
  type LobbyCompany,
  type SkirmishResult,
} from "../net/lobby";

/* --------------------------------------------------------------------------
 * Authored prototype companies
 * ------------------------------------------------------------------------ */

/**
 * Battle-worthy line-soldier stats for the prototype skirmish. These are our
 * own balance data (Phase 13 will retune); the net layer only moves them.
 */
const SKIRMISH_STATS: StatBlock = {
  hp: 24,
  mp: 12,
  atk: 14,
  def: 6,
  mag: 4,
  res: 6,
  spd: 29,
  move: 4,
  jump: 2,
};

/** One authored recruit: identity, school and post. */
interface RecruitSpec {
  readonly id: string;
  readonly name: string;
  readonly power: PowerKey;
  readonly postId: string;
}

/** Build a roster member from an authored recruit. */
function makeMember(spec: RecruitSpec, index: number): RosterMember {
  const assignment = createPostAssignment({
    primaryPostId: asPostId(spec.postId),
    power: spec.power,
  });
  const unit = createUnit({
    id: asUnitId(spec.id),
    name: spec.name,
    power: spec.power,
    postId: asPostId(spec.postId),
    level: 1,
    at: coord(0, 0),
    // Stagger Speed by roster index so Orders Tempo ties resolve predictably.
    stats: { ...SKIRMISH_STATS, spd: SKIRMISH_STATS.spd + index },
  });
  return { unit, assignment, recruitedOnDay: 1 };
}

/** Build a lobby match card from an authored company. */
function makeCompany(
  id: string,
  name: string,
  rating: number,
  recruits: readonly RecruitSpec[],
): LobbyCompany {
  return createLobbyCompany({
    id: asCompanyId(id),
    name,
    rating,
    roster: recruits.map(makeMember),
  });
}

/** The player's free company. */
const HOME_COMPANY = makeCompany("company-greycoats", "The Greycoats", 24, [
  { id: "unit-aubry", name: "Sgt. Aubry", power: "france", postId: "fusilier" },
  { id: "unit-bouvet", name: "Cpl. Bouvet", power: "france", postId: "grenadier" },
  { id: "unit-marchand", name: "Pvt. Marchand", power: "france", postId: "surgeon" },
]);

/** Rival free companies waiting in the lobby, at a spread of ratings. */
const RIVALS: readonly LobbyCompany[] = [
  makeCompany("company-red-roses", "The Red Roses", 40, [
    { id: "unit-hale", name: "Lt. Hale", power: "britain", postId: "rifleman" },
    { id: "unit-okafor", name: "Pte. Okafor", power: "britain", postId: "sharpshooter" },
  ]),
  makeCompany("company-black-eagles", "The Black Eagles", 18, [
    { id: "unit-voss", name: "Cpl. Voss", power: "prussia", postId: "line-grenadier" },
    { id: "unit-kral", name: "Pvt. Kral", power: "prussia", postId: "lancer" },
  ]),
  makeCompany("company-white-wolves", "The White Wolves", 60, [
    { id: "unit-volkov", name: "Sgt. Volkov", power: "russia", postId: "sapper" },
    { id: "unit-orlov", name: "Cpl. Orlov", power: "russia", postId: "signaller" },
  ]),
  makeCompany("company-kaisers", "The Kaiser's Own", 32, [
    { id: "unit-sturm", name: "Lt. Sturm", power: "austria", postId: "scout" },
    { id: "unit-falk", name: "Pvt. Falk", power: "austria", postId: "gunner" },
  ]),
];

/* --------------------------------------------------------------------------
 * View helpers
 * ------------------------------------------------------------------------ */

/** The player-facing label for a skirmish outcome. */
function outcomeLabel(result: SkirmishResult, t: Translator): string {
  if (result.outcome === null) return t("lobby.ceasefire");
  switch (result.outcome) {
    case "companyVictory":
      return t("lobby.victory");
    case "companyDefeat":
      return t("lobby.defeat");
    case "draw":
      return t("lobby.draw");
  }
}

/** A compact company card: name, rating and fielded strength. */
function CompanyCard({
  company,
  label,
  testId,
  t,
}: {
  readonly company: LobbyCompany | null;
  readonly label: string;
  readonly testId: string;
  readonly t: Translator;
}) {
  return (
    <article className="lobby-company" data-testid={testId}>
      <p className="lobby-company__label">{label}</p>
      <h3 className="lobby-company__name" data-testid={`${testId}-name`}>
        {company?.name ?? t("common.none")}
      </h3>
      {company !== null && (
        <dl className="lobby-company__meta">
          <div>
            <dt>{t("lobby.rating")}</dt>
            <dd data-testid={`${testId}-rating`}>{company.rating}</dd>
          </div>
          <div>
            <dt>{t("lobby.roster")}</dt>
            <dd data-testid={`${testId}-roster`}>
              {t("lobby.soldiers", { count: company.roster.length })}
            </dd>
          </div>
        </dl>
      )}
    </article>
  );
}

/* --------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------ */

/**
 * The lobby screen: find a rival, confirm readiness, run the 1v1 skirmish and
 * read the after-action report. Everything deterministic lives in
 * `src/net/lobby.ts`; this component only drives it.
 */
export function LobbyScreen() {
  const { t } = useTranslation();
  const [away, setAway] = useState<LobbyCompany | null>(null);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<SkirmishResult | null>(null);

  const findOpponent = (): void => {
    setAway(closestOpponent(HOME_COMPANY, RIVALS));
    setReady(false);
    setResult(null);
  };

  const startSkirmish = (): void => {
    if (away === null) return;
    const seed = `lobby:${HOME_COMPANY.id}:${away.id}`;
    const lobby = new Lobby({ matchId: `${HOME_COMPANY.id}-vs-${away.id}`, seed });
    lobby.join(HOME_COMPANY);
    lobby.join(away);
    lobby.setReady(0);
    lobby.setReady(1);
    setResult(runSkirmish(lobby.start()));
  };

  const reset = (): void => {
    setAway(null);
    setReady(false);
    setResult(null);
  };

  const homeHash = result?.reports[0]?.hash;
  const awayHash = result?.reports[1]?.hash;

  return (
    <section className="lobby-screen" data-testid="lobby-screen" aria-label={t("lobby.title")}>
      <header className="lobby-screen__header">
        <p className="kicker">{t("lobby.kicker")}</p>
        <h2>{t("lobby.title")}</h2>
        <p className="muted">{t("lobby.blurb")}</p>
      </header>

      <div className="lobby-match" data-testid={away === null ? "lobby-idle" : "lobby-matched"}>
        <CompanyCard
          company={HOME_COMPANY}
          label={t("lobby.yourCompany")}
          testId="lobby-home"
          t={t}
        />
        <p className="lobby-vs" aria-hidden="true">
          {t("lobby.vs")}
        </p>
        <CompanyCard company={away} label={t("lobby.opponent")} testId="lobby-away" t={t} />
      </div>

      <div className="lobby-actions">
        {away === null ? (
          <button type="button" className="button" data-testid="lobby-find" onClick={findOpponent}>
            {t("lobby.find")}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={ready ? "button is-active" : "button"}
              data-testid="lobby-ready"
              aria-pressed={ready}
              onClick={() => setReady((current) => !current)}
            >
              {ready ? t("lobby.readyYes") : t("lobby.ready")}
            </button>
            <button
              type="button"
              className="button button--primary"
              data-testid="lobby-start"
              disabled={!ready}
              onClick={startSkirmish}
            >
              {t("lobby.start")}
            </button>
            <button type="button" className="button" data-testid="lobby-rematch" onClick={reset}>
              {t("lobby.rematch")}
            </button>
          </>
        )}
      </div>

      <p className="muted lobby-hint" data-testid="lobby-ready-state">
        {away === null ? t("lobby.noOpponent") : ready ? t("lobby.readyYes") : t("lobby.waiting")}
      </p>

      {result !== null && (
        <section className="lobby-result" data-testid="lobby-result" aria-label={t("lobby.result")}>
          <h3>{t("lobby.result")}</h3>
          <p className="lobby-result__outcome" data-testid="lobby-outcome">
            {outcomeLabel(result, t)}
          </p>
          <dl className="lobby-result__stats">
            <div>
              <dt>{t("lobby.frames")}</dt>
              <dd data-testid="lobby-frames">{result.frames}</dd>
            </div>
            <div>
              <dt>{t("lobby.commands")}</dt>
              <dd data-testid="lobby-commands">{result.commands}</dd>
            </div>
            <div>
              <dt>{t("lobby.hashHome")}</dt>
              <dd data-testid="lobby-hash-home">{homeHash ?? t("common.none")}</dd>
            </div>
            <div>
              <dt>{t("lobby.hashAway")}</dt>
              <dd data-testid="lobby-hash-away">{awayHash ?? t("common.none")}</dd>
            </div>
          </dl>
          <p
            className={result.agreed ? "lobby-agreed is-ok" : "lobby-agreed is-bad"}
            data-testid="lobby-agreed"
          >
            {result.agreed ? t("lobby.agreed") : t("lobby.desync")}
          </p>
        </section>
      )}
    </section>
  );
}
