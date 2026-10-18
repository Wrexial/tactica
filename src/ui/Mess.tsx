/**
 * Officers' Mess (T071) — the **mission board** where the company takes
 * contracts (mapping §1, §10).
 *
 * In FFTA the **pub** posts missions with an entry **fee**, a set of
 * **requirements** (an item, a job level, a unit count) and a **reward** (Gil,
 * AP, XP, an item, a clan title). The retheme keeps that contract exactly and
 * renames the board the **Officers' Mess**, the currency **Crowns**, AP
 * **Drill**, XP **Experience** and clan titles **Regimental Honours**
 * (mapping §1, §5, §10). The authored contracts themselves live in
 * `src/data/contracts.ts` (T070); this module only *presents* them.
 *
 * ```
 *   CONTRACT_LIST (data) ──┐
 *                          ├─► evaluateRequirement(company, req) ─► met / unmet
 *   Company.roster (T068) ─┘
 * ```
 *
 * ## What this screen owns
 *
 * - The **board**: every authored contract, filtered by **kind** (Battle,
 *   Skirmish, Detachment, Pacification), each showing its **fee**, its
 *   **requirements** with live progress against the roster, and a **reward
 *   preview**.
 * - The **gating**: a contract may only be taken when the company is at the
 *   right story chapter, meets every requirement and can afford the fee. When
 *   taken, the fee is paid from the war chest via the pure {@link spendCrowns}
 *   update (T068) — the screen never mutates company state in place.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation over data.** No contract names, fees, requirements or
 *   rewards are hard-coded here; they come from `src/data/`.
 * - **Pure & deterministic.** No randomness, no clock, no I/O. The same company
 *   and chapter always render the same board.
 * - **Thin over the engine.** Every company change goes through the pure
 *   `engine/company` helpers; the UI holds the latest immutable value only.
 *
 * Reference: mapping §10 (pub → Officers' Mess, fee + item/post/unit gates) and
 * `docs/wiki/pages/Final_Fantasy_Tactics_Advance_missions.md` (mission board).
 */

import { useMemo, useState } from "react";

import { CONTRACT_LIST } from "../data/contracts";
import { getEquipment, isEquipmentKey } from "../data/equipment";
import { getPost, isPostKey } from "../data/posts";
import {
  CONTRACT_KINDS,
  EQUIP_SLOTS,
  type ContractDef,
  type ContractKind,
  type ContractRequirement,
} from "../data/schema";

import { createDemoCompany } from "../app/campaignController";
import { spendCrowns, type Company } from "../engine/company";
import { useTranslation, type MessageKey, type Translator } from "../i18n";

/* --------------------------------------------------------------------------
 * View-model helpers
 * ------------------------------------------------------------------------ */

/**
 * One requirement evaluated against the company: what it asks for (`label`),
 * what the company has (`have`), how much is needed (`required`) and whether
 * the gate is passed (`met`). A plain value so the render is a pure mapping.
 */
export interface RequirementStatus {
  readonly requirement: ContractRequirement;
  readonly label: string;
  readonly have: number;
  readonly required: number;
  readonly met: boolean;
}

/** Player-facing name for a requirement's item id (falls back to the raw id). */
function itemLabel(itemId: string): string {
  return isEquipmentKey(itemId) ? getEquipment(itemId).name : itemId;
}

/** Player-facing name for a requirement's post id (falls back to the raw id). */
function postLabel(postId: string): string {
  return isPostKey(postId) ? getPost(postId).name : postId;
}

/** How many copies of `itemId` the roster currently carries, in any slot. */
function countEquipment(company: Company, itemId: string): number {
  let total = 0;
  for (const member of company.roster) {
    for (const slot of EQUIP_SLOTS) {
      if (member.unit.equipment[slot] === itemId) total += 1;
    }
  }
  return total;
}

/** How many soldiers hold `postId` as their **primary** post. */
function countPost(company: Company, postId: string): number {
  return company.roster.filter((member) => member.assignment.primaryPostId === postId).length;
}

/**
 * Evaluate one contract requirement against the company. Requirements are
 * **data only** (`src/data/contracts.ts`); this is the check the mess applies:
 *
 * | `kind`   | counted from                              |
 * | -------- | ----------------------------------------- |
 * | `item`   | equipment copies across the roster        |
 * | `post`   | soldiers whose primary post matches        |
 * | `unit`   | the whole roster                          |
 * | `honour` | the company's Regimental Honours          |
 */
function evaluateRequirement(
  company: Company,
  requirement: ContractRequirement,
  t: Translator,
): RequirementStatus {
  const required = requirement.count;
  switch (requirement.kind) {
    case "item": {
      const itemId = requirement.id ?? "";
      const have = countEquipment(company, itemId);
      return { requirement, label: itemLabel(itemId), have, required, met: have >= required };
    }
    case "post": {
      const postId = requirement.id ?? "";
      const have = countPost(company, postId);
      return { requirement, label: postLabel(postId), have, required, met: have >= required };
    }
    case "unit": {
      const have = company.roster.length;
      return { requirement, label: t("mess.soldiers"), have, required, met: have >= required };
    }
    case "honour": {
      const have = company.honours;
      return {
        requirement,
        label: t("mess.regimentalHonours"),
        have,
        required,
        met: have >= required,
      };
    }
  }
}

/** Every requirement of a contract evaluated against the company, in order. */
function requirementStatuses(
  company: Company,
  contract: ContractDef,
  t: Translator,
): readonly RequirementStatus[] {
  return contract.requires.map((requirement) => evaluateRequirement(company, requirement, t));
}

/** `true` when every requirement of `contract` is satisfied by `company`. */
function meetsContractRequirements(
  company: Company,
  contract: ContractDef,
  t: Translator,
): boolean {
  return requirementStatuses(company, contract, t).every((status) => status.met);
}

/* --------------------------------------------------------------------------
 * Display labels
 * ------------------------------------------------------------------------ */

const KIND_LABEL_KEYS: Readonly<Record<ContractKind, MessageKey>> = {
  battle: "mess.kind.battle",
  skirmish: "mess.kind.skirmish",
  detachment: "mess.kind.detachment",
  pacification: "mess.kind.pacification",
};

/** A Crowns amount (`250 Crowns`) for the fee and reward lines. */
function crownsLabel(amount: number, t: Translator): string {
  return t("common.crownsAmount", { count: amount });
}

/* --------------------------------------------------------------------------
 * Demo company
 * ------------------------------------------------------------------------ */

// The deterministic demonstration company now lives with the campaign
// controller (T121), which owns the working save the Mess presents. The Mess
// falls back to the same authored roster when it is rendered standalone.

/* --------------------------------------------------------------------------
 * Props
 * ------------------------------------------------------------------------ */

/** Props for {@link Mess}. */
export interface MessProps {
  /** The company taking contracts. Defaults to the deterministic demo company. */
  readonly company?: Company;
  /**
   * The story chapter in progress (T077); it gates contracts that carry a
   * `chapter`. Defaults to the last authored chapter so the demo board shows
   * every contract.
   */
  readonly chapter?: number;
  /** Called after a contract is accepted (its fee paid and it marked posted). */
  readonly onAccept?: (contract: ContractDef) => void;
}

/* --------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------ */

/**
 * The Officers' Mess mission board. Reads the authored contracts (T070) and
 * the company (T068), evaluates each contract's fee / requirements / reward,
 * and lets the player take a contract whose gates are open.
 */
export function Mess({ company: companyProp, chapter = 5, onAccept }: MessProps) {
  const { t } = useTranslation();
  const [localCompany, setLocalCompany] = useState<Company>(
    () => companyProp ?? createDemoCompany(),
  );
  const company = companyProp ?? localCompany;
  const [filter, setFilter] = useState<ContractKind | "all">("all");
  const [posted, setPosted] = useState<ReadonlySet<string>>(() => new Set<string>());

  const visible = useMemo(
    () => CONTRACT_LIST.filter((contract) => filter === "all" || contract.kind === filter),
    [filter],
  );

  /** Accept a contract: delegate the fee to the campaign, or pay it locally. */
  const accept = (contract: ContractDef): void => {
    if (posted.has(contract.id)) return;
    if (!meetsContractRequirements(company, contract, t)) return;
    if (company.crowns < contract.fee) return;
    // When a working campaign owns the company (T121), it alone pays the fee
    // and opens the field; the Mess is then a rendering of that save.
    if (companyProp === undefined) {
      setLocalCompany((current) => spendCrowns(current, contract.fee));
    }
    setPosted((current) => {
      const next = new Set(current);
      next.add(contract.id);
      return next;
    });
    onAccept?.(contract);
  };

  return (
    <section className="mess-screen" data-testid="mess-screen" aria-label={t("mess.title")}>
      <header className="mess-screen__header">
        <div className="mess-screen__identity">
          <p className="kicker">{t("mess.kicker")}</p>
          <h2>{t("mess.title")}</h2>
          <p className="muted">{t("mess.blurb")}</p>
        </div>
        <dl className="mess-screen__company" data-testid="mess-company">
          <div>
            <dt>{t("common.company")}</dt>
            <dd data-testid="mess-company-name">{company.name}</dd>
          </div>
          <div>
            <dt>{t("common.crowns")}</dt>
            <dd data-testid="mess-company-crowns">{company.crowns}</dd>
          </div>
          <div>
            <dt>{t("common.honours")}</dt>
            <dd data-testid="mess-company-honours">{company.honours}</dd>
          </div>
          <div>
            <dt>{t("common.roster")}</dt>
            <dd data-testid="mess-company-roster">
              {t("common.soldiers", { count: company.roster.length })}
            </dd>
          </div>
        </dl>
      </header>

      <nav className="mess-filter" aria-label={t("mess.contractKind")}>
        <button
          type="button"
          className={filter === "all" ? "mess-filter__button is-active" : "mess-filter__button"}
          data-testid="mess-filter-all"
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          {t("mess.all")}
        </button>
        {CONTRACT_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={filter === kind ? "mess-filter__button is-active" : "mess-filter__button"}
            data-testid={`mess-filter-${kind}`}
            aria-pressed={filter === kind}
            onClick={() => setFilter(kind)}
          >
            {t(KIND_LABEL_KEYS[kind])}
          </button>
        ))}
      </nav>

      <ul className="contract-board">
        {visible.map((contract) => {
          const statuses = requirementStatuses(company, contract, t);
          const requirementsMet = statuses.every((status) => status.met);
          const chapterOpen = contract.chapter === undefined || contract.chapter <= chapter;
          const affordable = company.crowns >= contract.fee;
          const isPosted = posted.has(contract.id);
          const canAccept = chapterOpen && requirementsMet && affordable && !isPosted;
          const blocked = !chapterOpen || !requirementsMet || !affordable;

          return (
            <li
              key={contract.id}
              className={blocked ? "contract contract--blocked" : "contract"}
              data-testid={`contract-${contract.id}`}
            >
              <div className="contract__head">
                <div className="contract__title">
                  <span className="contract__name">{contract.name}</span>
                  <span
                    className={`contract-kind contract-kind--${contract.kind}`}
                    data-testid={`contract-${contract.id}-kind`}
                  >
                    {t(KIND_LABEL_KEYS[contract.kind])}
                  </span>
                  {!chapterOpen && (
                    <span
                      className="contract-badge"
                      data-testid={`contract-${contract.id}-chapter`}
                    >
                      {t("mess.chapterBadge", { chapter: contract.chapter ?? 0 })}
                    </span>
                  )}
                </div>
                <div className="contract__fee" data-testid={`contract-${contract.id}-fee`}>
                  {crownsLabel(contract.fee, t)}
                </div>
              </div>

              <p className="contract__desc">{contract.description}</p>
              <p className="contract__flavour">{contract.flavour}</p>

              <dl className="contract__meta">
                <div>
                  <dt>{t("common.region")}</dt>
                  <dd data-testid={`contract-${contract.id}-region`}>
                    {contract.regionId ?? t("common.none")}
                  </dd>
                </div>
                {contract.duration !== undefined && (
                  <div>
                    <dt>{t("mess.detachment")}</dt>
                    <dd data-testid={`contract-${contract.id}-duration`}>
                      {t("common.days", { count: contract.duration })}
                    </dd>
                  </div>
                )}
              </dl>

              <section className="contract__requirements" aria-label={t("mess.requirements")}>
                <h4>{t("mess.requirements")}</h4>
                {statuses.length === 0 ? (
                  <p className="muted">{t("mess.noRequirements")}</p>
                ) : (
                  <ul className="requirement-list">
                    {statuses.map((status, index) => (
                      <li
                        key={`${status.requirement.kind}-${status.requirement.id ?? index}`}
                        className={
                          status.met
                            ? "requirement requirement--met"
                            : "requirement requirement--unmet"
                        }
                        data-testid={`contract-${contract.id}-req-${index}`}
                        data-met={status.met}
                      >
                        <span className="requirement__label">{status.label}</span>
                        <span className="requirement__value">
                          {status.have} / {status.required}
                        </span>
                        <span
                          className="requirement__status"
                          data-testid={`contract-${contract.id}-req-${index}-status`}
                        >
                          {status.met ? t("common.met") : t("common.unmet")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="contract__reward" aria-label={t("mess.reward")}>
                <h4>{t("mess.reward")}</h4>
                <ul className="reward-list" data-testid={`contract-${contract.id}-reward`}>
                  <li data-testid={`contract-${contract.id}-reward-crowns`}>
                    {crownsLabel(contract.reward.crowns, t)}
                  </li>
                  {contract.reward.ap > 0 && (
                    <li data-testid={`contract-${contract.id}-reward-drill`}>
                      {t("common.drillAmount", { count: contract.reward.ap })}
                    </li>
                  )}
                  {contract.reward.experience > 0 && (
                    <li data-testid={`contract-${contract.id}-reward-experience`}>
                      {t("mess.experienceAmount", { count: contract.reward.experience })}
                    </li>
                  )}
                  {contract.reward.honours > 0 && (
                    <li data-testid={`contract-${contract.id}-reward-honours`}>
                      {t("common.honoursAmount", { count: contract.reward.honours })}
                    </li>
                  )}
                  {contract.reward.itemIds.map((itemId) => (
                    <li
                      key={itemId}
                      className="reward-list__item"
                      data-testid={`contract-${contract.id}-reward-item-${itemId}`}
                    >
                      {t("mess.kitReward", { item: itemLabel(itemId) })}
                    </li>
                  ))}
                </ul>
              </section>

              <div className="contract__actions">
                {!affordable && requirementsMet && chapterOpen && !isPosted && (
                  <p className="contract__blocker" data-testid={`contract-${contract.id}-blocker`}>
                    {t("mess.insufficientCrowns", { fee: crownsLabel(contract.fee, t) })}
                  </p>
                )}
                <button
                  type="button"
                  className="button"
                  data-testid={`contract-${contract.id}-accept`}
                  disabled={!canAccept}
                  onClick={() => accept(contract)}
                >
                  {isPosted
                    ? t("common.posted")
                    : t("mess.takeContract", { fee: crownsLabel(contract.fee, t) })}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
