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
import { getPost, isPostKey, type PostKey } from "../data/posts";
import {
  CONTRACT_KINDS,
  EQUIP_SLOTS,
  type ContractDef,
  type ContractKind,
  type ContractRequirement,
  type EquipSlot,
  type PowerKey,
} from "../data/schema";

import { createCompany, spendCrowns, type Company } from "../engine/company";
import { coord } from "../engine/grid";
import {
  asCompanyId,
  asEquipmentId,
  asPostId,
  asRegionId,
  asUnitId,
  type EquipmentId,
} from "../engine/ids";
import { createPostAssignment, derivePostStats } from "../engine/progression/posts";
import { createUnit } from "../engine/unit";

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
      return { requirement, label: "Soldiers", have, required, met: have >= required };
    }
    case "honour": {
      const have = company.honours;
      return {
        requirement,
        label: "Regimental Honours",
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
): readonly RequirementStatus[] {
  return contract.requires.map((requirement) => evaluateRequirement(company, requirement));
}

/** `true` when every requirement of `contract` is satisfied by `company`. */
function meetsContractRequirements(company: Company, contract: ContractDef): boolean {
  return requirementStatuses(company, contract).every((status) => status.met);
}

/* --------------------------------------------------------------------------
 * Display labels
 * ------------------------------------------------------------------------ */

const KIND_LABELS: Readonly<Record<ContractKind, string>> = {
  battle: "Battle",
  skirmish: "Skirmish",
  detachment: "Detachment",
  pacification: "Pacification",
};

/** A Crowns amount (`250 Crowns`) for the fee and reward lines. */
function crownsLabel(amount: number): string {
  return `${amount} ${amount === 1 ? "Crown" : "Crowns"}`;
}

/* --------------------------------------------------------------------------
 * Demo company
 * ------------------------------------------------------------------------ */

/** One authored soldier for the deterministic demo company. */
interface DemoRecruit {
  readonly id: string;
  readonly name: string;
  readonly power: PowerKey;
  readonly postId: PostKey;
  readonly level: number;
  readonly equipment: Partial<Record<EquipSlot, string>>;
}

/** Build a roster member (unit + assignment) through the authored factories. */
function makeDemoMember(spec: DemoRecruit) {
  const assignment = createPostAssignment({
    primaryPostId: asPostId(spec.postId),
    power: spec.power,
  });
  const equipment = Object.fromEntries(
    Object.entries(spec.equipment).map(([slot, id]) => [slot, asEquipmentId(id)]),
  ) as Partial<Record<EquipSlot, EquipmentId>>;
  const unit = createUnit({
    id: asUnitId(spec.id),
    name: spec.name,
    power: spec.power,
    postId: asPostId(spec.postId),
    level: spec.level,
    at: coord(0, 0),
    stats: derivePostStats({ level: spec.level, assignment }),
    equipment,
  });
  return { unit, assignment };
}

/**
 * The deterministic company the mess opens with, standing in for the campaign
 * roster until the save layer (T100/T101) supplies a real one. It is authored
 * so the board demonstrates every requirement kind in both states: five
 * soldiers (so unit gates pass), a Forager / Scout / Chasseur / Grenadier (so
 * some post gates pass), no Sapper's Tools or Artilleryman (so a `storm` /
 * `redoubt` gate fails) and one Powder Flask (so the Highland item gate fails).
 */
const DEMO_COMPANY: Company = createCompany({
  id: asCompanyId("company-greycoats"),
  name: "The Greycoats",
  crowns: 900,
  honours: 3,
  theatre: { day: 12, regionId: asRegionId("sainte-colombe") },
  roster: [
    makeDemoMember({
      id: "unit-aubry",
      name: "Sgt. Aubry",
      power: "france",
      postId: "fusilier",
      level: 4,
      equipment: { weapon: "baker-rifle", armour: "line-uniform" },
    }),
    makeDemoMember({
      id: "unit-bouvet",
      name: "Cpl. Bouvet",
      power: "france",
      postId: "grenadier",
      level: 4,
      equipment: { weapon: "grenadier-broadsword", head: "bearskin" },
    }),
    makeDemoMember({
      id: "unit-okafor",
      name: "Pte. Okafor",
      power: "britain",
      postId: "forager",
      level: 3,
      equipment: { weapon: "charleville-musket", accessory: "water-canteen" },
    }),
    makeDemoMember({
      id: "unit-voss",
      name: "Lt. Voss",
      power: "austria",
      postId: "scout",
      level: 3,
      equipment: { weapon: "light-carbine", accessory: "spyglass" },
    }),
    makeDemoMember({
      id: "unit-duret",
      name: "Cpl. Duret",
      power: "france",
      postId: "chasseur",
      level: 3,
      equipment: { weapon: "light-carbine", accessory: "powder-flask" },
    }),
  ],
});

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
  const [company, setCompany] = useState<Company>(companyProp ?? DEMO_COMPANY);
  const [filter, setFilter] = useState<ContractKind | "all">("all");
  const [posted, setPosted] = useState<ReadonlySet<string>>(() => new Set<string>());

  const visible = useMemo(
    () => CONTRACT_LIST.filter((contract) => filter === "all" || contract.kind === filter),
    [filter],
  );

  /** Accept a contract: pay its fee from the war chest and mark it posted. */
  const accept = (contract: ContractDef): void => {
    if (posted.has(contract.id)) return;
    if (!meetsContractRequirements(company, contract)) return;
    if (company.crowns < contract.fee) return;
    setCompany((current) => spendCrowns(current, contract.fee));
    setPosted((current) => {
      const next = new Set(current);
      next.add(contract.id);
      return next;
    });
    onAccept?.(contract);
  };

  return (
    <section className="mess-screen" data-testid="mess-screen" aria-label="Officers' Mess">
      <header className="mess-screen__header">
        <div className="mess-screen__identity">
          <p className="kicker">Garrison Town · Officers' Mess</p>
          <h2>Mission Board</h2>
          <p className="muted">
            Contracts of the free company, posted by the officers of the garrison.
          </p>
        </div>
        <dl className="mess-screen__company" data-testid="mess-company">
          <div>
            <dt>Company</dt>
            <dd data-testid="mess-company-name">{company.name}</dd>
          </div>
          <div>
            <dt>Crowns</dt>
            <dd data-testid="mess-company-crowns">{company.crowns}</dd>
          </div>
          <div>
            <dt>Honours</dt>
            <dd data-testid="mess-company-honours">{company.honours}</dd>
          </div>
          <div>
            <dt>Roster</dt>
            <dd data-testid="mess-company-roster">{company.roster.length} soldiers</dd>
          </div>
        </dl>
      </header>

      <nav className="mess-filter" aria-label="Contract kind">
        <button
          type="button"
          className={filter === "all" ? "mess-filter__button is-active" : "mess-filter__button"}
          data-testid="mess-filter-all"
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All
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
            {KIND_LABELS[kind]}
          </button>
        ))}
      </nav>

      <ul className="contract-board">
        {visible.map((contract) => {
          const statuses = requirementStatuses(company, contract);
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
                    {KIND_LABELS[contract.kind]}
                  </span>
                  {!chapterOpen && (
                    <span
                      className="contract-badge"
                      data-testid={`contract-${contract.id}-chapter`}
                    >
                      Chapter {contract.chapter}
                    </span>
                  )}
                </div>
                <div className="contract__fee" data-testid={`contract-${contract.id}-fee`}>
                  {crownsLabel(contract.fee)}
                </div>
              </div>

              <p className="contract__desc">{contract.description}</p>
              <p className="contract__flavour">{contract.flavour}</p>

              <dl className="contract__meta">
                <div>
                  <dt>Region</dt>
                  <dd data-testid={`contract-${contract.id}-region`}>{contract.regionId ?? "—"}</dd>
                </div>
                {contract.duration !== undefined && (
                  <div>
                    <dt>Detachment</dt>
                    <dd data-testid={`contract-${contract.id}-duration`}>
                      {contract.duration} days
                    </dd>
                  </div>
                )}
              </dl>

              <section className="contract__requirements" aria-label="Requirements">
                <h4>Requirements</h4>
                {statuses.length === 0 ? (
                  <p className="muted">None — any company may take this contract.</p>
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
                          {status.met ? "Met" : "Unmet"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="contract__reward" aria-label="Reward">
                <h4>Reward on success</h4>
                <ul className="reward-list" data-testid={`contract-${contract.id}-reward`}>
                  <li data-testid={`contract-${contract.id}-reward-crowns`}>
                    {crownsLabel(contract.reward.crowns)}
                  </li>
                  {contract.reward.ap > 0 && (
                    <li data-testid={`contract-${contract.id}-reward-drill`}>
                      {contract.reward.ap} Drill
                    </li>
                  )}
                  {contract.reward.experience > 0 && (
                    <li data-testid={`contract-${contract.id}-reward-experience`}>
                      {contract.reward.experience} Experience
                    </li>
                  )}
                  {contract.reward.honours > 0 && (
                    <li data-testid={`contract-${contract.id}-reward-honours`}>
                      {contract.reward.honours}{" "}
                      {contract.reward.honours === 1 ? "Honour" : "Honours"}
                    </li>
                  )}
                  {contract.reward.itemIds.map((itemId) => (
                    <li
                      key={itemId}
                      className="reward-list__item"
                      data-testid={`contract-${contract.id}-reward-item-${itemId}`}
                    >
                      {itemLabel(itemId)} (kit)
                    </li>
                  ))}
                </ul>
              </section>

              <div className="contract__actions">
                {!affordable && requirementsMet && chapterOpen && !isPosted && (
                  <p className="contract__blocker" data-testid={`contract-${contract.id}-blocker`}>
                    Insufficient Crowns — the fee is {crownsLabel(contract.fee)}.
                  </p>
                )}
                <button
                  type="button"
                  className="button"
                  data-testid={`contract-${contract.id}-accept`}
                  disabled={!canAccept}
                  onClick={() => accept(contract)}
                >
                  {isPosted ? "Posted" : `Take contract · ${crownsLabel(contract.fee)}`}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
