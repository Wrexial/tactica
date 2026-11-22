/**
 * Field Manual (T171) — the in-game quick guide.
 *
 * A player-facing summary of the live build: the field, controls, the turn,
 * fighting, the company and the campaign, plus an honest note about systems
 * that are implemented but not yet wired into live battles. The **full** guide
 * (with the numbers and tips) stays in `docs/HOW_TO_PLAY.md`; this screen is the
 * version that is always one tap away while playing.
 *
 * Presentation only: no engine or campaign state is read or changed, and every
 * string comes from the i18n catalogue.
 */

import { useTranslation, type MessageKey } from "../i18n";

/** One section of the manual. */
interface GuideSection {
  readonly id: string;
  readonly title: MessageKey;
  readonly body: MessageKey;
}

/** The sections, in reading order. */
const SECTIONS: readonly GuideSection[] = [
  { id: "field", title: "guide.field.title", body: "guide.field.body" },
  { id: "controls", title: "guide.controls.title", body: "guide.controls.body" },
  { id: "turn", title: "guide.turn.title", body: "guide.turn.body" },
  { id: "fighting", title: "guide.fighting.title", body: "guide.fighting.body" },
  { id: "company", title: "guide.company.title", body: "guide.company.body" },
  { id: "campaign", title: "guide.campaign.title", body: "guide.campaign.body" },
  { id: "pending", title: "guide.pending.title", body: "guide.pending.body" },
];

/** Props for {@link Guide}. */
export interface GuideProps {
  /** Return to the field. */
  readonly onClose?: () => void;
}

/** The in-game Field Manual. */
export function Guide({ onClose }: GuideProps) {
  const { t } = useTranslation();
  return (
    <section className="guide-screen" data-testid="guide-screen" aria-label={t("guide.title")}>
      <header className="guide-screen__header">
        <div>
          <p className="kicker">{t("guide.kicker")}</p>
          <h2>{t("guide.title")}</h2>
          <p className="muted">{t("guide.blurb")}</p>
        </div>
        {onClose !== undefined && (
          <button type="button" className="button" data-testid="guide-close" onClick={onClose}>
            {t("guide.close")}
          </button>
        )}
      </header>

      <div className="guide-screen__sections">
        {SECTIONS.map((section) => (
          <article
            key={section.id}
            className="guide-section"
            data-testid={`guide-section-${section.id}`}
          >
            <h3>{t(section.title)}</h3>
            <p>{t(section.body)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
