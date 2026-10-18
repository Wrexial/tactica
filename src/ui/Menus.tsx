/**
 * Menu suite (T084) — the out-of-battle **orders hub** that ties every camp
 * screen together (mapping §10): the main menu, the **company** roll, the
 * **post** (barracks) screen, the **equipment** and **abilities** ledgers, the
 * **depot**, the officers' **mess** and the **campaign map**.
 *
 * FFTA's between-battles loop is a ring of menus: a clan roster, a job screen
 * per unit, an ability list, a shop, a pub and the world map. This module is
 * that ring for Tactica. It is deliberately a *presentation* router:
 *
 * - It owns only the **screen state** (which camp menu is open) and the
 *   **selected soldier**, plus the local, immutable soldier records the demo
 *   company is built from.
 * - Every rule it draws (post unlocks, kit legality, drill progress, economy,
 *   contracts, map placement) lives in `src/data/` and `src/engine/`; the suite
 *   never hard-codes a balance number.
 * - It re-uses the already-authored screens — {@link PostScreen} (T052),
 *   {@link Depot} (T075), {@link Mess} (T071) and {@link CampaignMap} (T073) —
 *   and fills the gaps FFTA fills with a roster, an equip screen and an
 *   ability list.
 *
 * ## Menus
 *
 * | Screen          | FFTA equivalent       | Backing data                              |
 * | --------------- | --------------------- | ----------------------------------------- |
 * | `main`          | castle / camp hub     | —                                         |
 * | `company`       | clan roster           | `engine/company` + `src/data/posts`       |
 * | `post`          | job change            | {@link PostScreen}, `engine/progression`  |
 * | `equipment`     | equip                 | `src/data/equipment`, `engine/unit`       |
 * | `abilities`     | ability list          | `LearnedAbility`, kit `teaches`           |
 * | `depot`         | shop                  | {@link Depot}                             |
 * | `mess`          | pub                   | {@link Mess}                              |
 * | `campaign-map`  | world map             | {@link CampaignMap}                       |
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Presentation only, at the edge.** All campaign/battle simulation stays in
 *   the pure engine; equipment changes go through the immutable `withEquipment`
 *   helper and post changes through `PostScreen`'s callback. Nothing here reads
 *   the clock or `Math.random`.
 * - **Data-driven.** Names, stats, kit and drill costs come from `src/data/`;
 *   no item or post name is hard-coded in the render path.
 * - **Prototype scaffolding.** The demo company, its roster and its drill
 *   ledger stand in until the save/roster layer (T100/T101) supplies real ones.
 *   Ability *display* names are looked up from the kit that teaches them; the
 *   full ability collection is T089.
 *
 * Reference: mapping §10 (camp menu ring) and
 * `docs/wiki/pages/Final_Fantasy_Tactics_Advance_jobs.md` (job / ability / equip
 * screens).
 */

import { useMemo, useState } from "react";

import {
  equipmentForSlot,
  getEquipment,
  isEquipmentKey,
  statsOf,
  type EquipmentKey,
} from "../data/equipment";
import { getPost, isPostKey, type MasteredByPost, type PostKey } from "../data/posts";
import {
  EQUIP_SLOTS,
  type EquipmentDef,
  type EquipSlot,
  type PostDef,
  type PowerKey,
  type StatBlock,
} from "../data/schema";
import { createCompany, type Company } from "../engine/company";
import { coord } from "../engine/grid";
import {
  asCompanyId,
  asEquipmentId,
  asPostId,
  asRegionId,
  asSkillsetId,
  asUnitId,
  type EquipmentId,
  type UnitId,
} from "../engine/ids";
import {
  ABILITY_SLOT_KEYS,
  attachedPostOf,
  canEquipItem,
  createPostAssignment,
  derivePostStats,
  primaryPostOf,
  type AbilitySlot,
  type PostAssignment,
} from "../engine/progression/posts";
import { createUnit, withEquipment, type Unit } from "../engine/unit";
import { useTranslation, type MessageKey, type Translator } from "../i18n";

import { CampaignMap } from "./CampaignMap";
import { Depot } from "./Depot";
import { Mess } from "./Mess";
import { PostScreen, type DrillProgress, type PostScreenSoldier } from "./PostScreen";

/* --------------------------------------------------------------------------
 * Screen model
 * ------------------------------------------------------------------------ */

/** Every camp menu in the suite, in sidebar order. */
const MENU_SCREENS = [
  "main",
  "company",
  "post",
  "equipment",
  "abilities",
  "depot",
  "mess",
  "campaign-map",
] as const;
export type MenuScreen = (typeof MENU_SCREENS)[number];

/** One sidebar entry: the screen it opens and the catalog keys it carries. */
interface MenuEntry {
  readonly screen: MenuScreen;
  readonly labelKey: MessageKey;
  readonly kickerKey: MessageKey;
  readonly blurbKey: MessageKey;
}

/** The suite's navigation, shared by the sidebar and the main-menu tiles. */
const MENU_ENTRIES: readonly MenuEntry[] = [
  {
    screen: "main",
    labelKey: "menu.orders.label",
    kickerKey: "menu.orders.kicker",
    blurbKey: "menu.orders.blurb",
  },
  {
    screen: "company",
    labelKey: "menu.company.label",
    kickerKey: "menu.company.kicker",
    blurbKey: "menu.company.blurb",
  },
  {
    screen: "post",
    labelKey: "menu.barracks.label",
    kickerKey: "menu.barracks.kicker",
    blurbKey: "menu.barracks.blurb",
  },
  {
    screen: "equipment",
    labelKey: "menu.kit.label",
    kickerKey: "menu.kit.kicker",
    blurbKey: "menu.kit.blurb",
  },
  {
    screen: "abilities",
    labelKey: "menu.drill.label",
    kickerKey: "menu.drill.kicker",
    blurbKey: "menu.drill.blurb",
  },
  {
    screen: "depot",
    labelKey: "menu.depot.label",
    kickerKey: "menu.depot.kicker",
    blurbKey: "menu.depot.blurb",
  },
  {
    screen: "mess",
    labelKey: "menu.mess.label",
    kickerKey: "menu.mess.kicker",
    blurbKey: "menu.mess.blurb",
  },
  {
    screen: "campaign-map",
    labelKey: "menu.map.label",
    kickerKey: "menu.map.kicker",
    blurbKey: "menu.map.blurb",
  },
];

/** `true` for a member of {@link MENU_SCREENS} (used to guard callbacks). */
function isMenuScreen(value: unknown): value is MenuScreen {
  return typeof value === "string" && (MENU_SCREENS as readonly string[]).includes(value);
}

/* --------------------------------------------------------------------------
 * Display labels (presentation only)
 * ------------------------------------------------------------------------ */

const POWER_LABEL_KEYS: Readonly<Record<PowerKey, MessageKey>> = {
  france: "power.france",
  britain: "power.britain",
  prussia: "power.prussia",
  russia: "power.russia",
  austria: "power.austria",
};

const SLOT_LABEL_KEYS: Readonly<Record<EquipSlot, MessageKey>> = {
  weapon: "slot.weapon",
  offhand: "slot.offhand",
  armour: "slot.armour",
  head: "slot.head",
  accessory: "slot.accessory",
};

const ABILITY_SLOT_LABEL_KEYS: Readonly<Record<AbilitySlot, MessageKey>> = {
  reaction: "slot.reaction",
  trait: "slot.trait",
  volley: "slot.volley",
};

/** The nine stat columns a menu shows, in roster order. */
const STAT_COLUMNS: readonly (keyof StatBlock)[] = [
  "hp",
  "mp",
  "atk",
  "def",
  "mag",
  "res",
  "spd",
  "move",
  "jump",
];

const STAT_LABEL_KEYS: Readonly<Record<keyof StatBlock, MessageKey>> = {
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

/**
 * Napoleonic display names for the abilities authored in `src/data/equipment`
 * (`teaches`). This stands in until the ability collection lands (T089); the
 * fallback title-cases the stable id so an unlabelled ability is never blank.
 */
const ABILITY_LABELS: Readonly<Record<string, string>> = {
  riposte: "Riposte",
  "crushing-blow": "Crushing Blow",
  "couched-charge": "Couched Charge",
  "volley-fire": "Volley Fire",
  "bayonet-charge": "Bayonet Charge",
  "snap-shot": "Snap Shot",
  "aim-vitals": "Aim Vitals",
  "quiet-loosing": "Quiet Loosing",
  "canister-shot": "Canister Shot",
  "case-shot": "Case Shot",
  "signal-flare": "Signal Flare",
  "call-hounds": "Call Hounds",
  "charge-the-sap": "Charge the Sap",
  parry: "Parry",
  "dismounting-shot": "Dismounting Shot",
  "range-the-ground": "Range the Ground",
  "well-timed-order": "Well-Timed Order",
};

/** Player-facing name for an ability id (labelled, else title-cased id). */
function abilityLabel(abilityId: string): string {
  return (
    ABILITY_LABELS[abilityId] ??
    abilityId
      .split(/[-_]/)
      .map((word) => (word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(" ")
  );
}

/** Player-facing name for a post id (falls back to the raw id). */
function postLabel(postId: string): string {
  return isPostKey(postId) ? getPost(postId).name : postId;
}

/** Player-facing name for an equipment id (falls back to the raw id). */
function itemLabel(itemId: string): string {
  return isEquipmentKey(itemId) ? getEquipment(itemId).name : itemId;
}

/** A Crowns amount (`250 Crowns`). */
function crownsLabel(amount: number, t: Translator): string {
  return t("common.crownsAmount", { count: amount });
}

/* --------------------------------------------------------------------------
 * Demo company data (prototype scaffolding until T100/T101)
 * ------------------------------------------------------------------------ */

/** One ability's authored Drill progress; names are derived from the id. */
interface DrillSpec {
  readonly abilityId: string;
  readonly postId: PostKey;
  readonly drill: number;
  readonly required: number;
}

/** Authoring input for one demo soldier. */
interface SoldierSpec {
  readonly id: string;
  readonly name: string;
  readonly power: PowerKey;
  readonly postId: PostKey;
  readonly level: number;
  readonly equipment: Partial<Record<EquipSlot, string>>;
  readonly drill: readonly DrillSpec[];
  readonly attachedPostId?: PostKey;
  readonly actionSkillsetId?: string;
}

/** A demo soldier plus the camp-only Drill ledger the menus read. */
export interface MenuSoldier {
  readonly unit: Unit;
  readonly assignment: PostAssignment;
  readonly mastered: MasteredByPost;
  readonly drill: readonly DrillProgress[];
  readonly recruitedOnDay: number;
}

/** Every post the soldier has mastered at least one ability from. */
function masteredFromDrill(drill: readonly DrillProgress[]): MasteredByPost {
  const mastered: Record<string, string[]> = {};
  for (const entry of drill) {
    if (!entry.mastered) continue;
    (mastered[entry.postId] ??= []).push(entry.abilityId);
  }
  return mastered;
}

/** Build one demo soldier from its spec, authoring through engine factories. */
function makeSoldier(spec: SoldierSpec): MenuSoldier {
  const assignment = createPostAssignment({
    primaryPostId: asPostId(spec.postId),
    power: spec.power,
    ...(spec.attachedPostId !== undefined ? { attachedPostId: asPostId(spec.attachedPostId) } : {}),
    ...(spec.actionSkillsetId !== undefined
      ? { actionSkillsetId: asSkillsetId(spec.actionSkillsetId) }
      : {}),
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

  const drill: readonly DrillProgress[] = spec.drill.map((entry) => ({
    abilityId: entry.abilityId,
    abilityName: abilityLabel(entry.abilityId),
    postId: entry.postId,
    drill: entry.drill,
    required: entry.required,
    mastered: entry.drill >= entry.required,
  }));

  return {
    unit,
    assignment,
    mastered: masteredFromDrill(drill),
    drill,
    recruitedOnDay: 1,
  };
}

/**
 * The deterministic demo company the suite opens with. Five soldiers across the
 * great-power schools demonstrate an unlocked post, a locked post, in-progress
 * Drill, a full kit loadout and a shouldered one.
 */
const DEMO_SOLDIERS: readonly MenuSoldier[] = [
  makeSoldier({
    id: "unit-aubry",
    name: "Sgt. Aubry",
    power: "france",
    postId: "fusilier",
    level: 4,
    equipment: {
      weapon: "charleville-musket",
      armour: "line-uniform",
      head: "shako",
      accessory: "pocket-watch",
    },
    attachedPostId: "marksman",
    actionSkillsetId: "marksman-kit",
    drill: [
      { abilityId: "volley-fire", postId: "fusilier", drill: 100, required: 100 },
      { abilityId: "bayonet-charge", postId: "fusilier", drill: 100, required: 100 },
      { abilityId: "range-the-ground", postId: "marksman", drill: 70, required: 70 },
      { abilityId: "aim-vitals", postId: "marksman", drill: 40, required: 150 },
    ],
  }),
  makeSoldier({
    id: "unit-bouvet",
    name: "Cpl. Bouvet",
    power: "france",
    postId: "grenadier",
    level: 4,
    equipment: {
      weapon: "grenadier-broadsword",
      offhand: "pavise-shield",
      armour: "cuirass",
      head: "bearskin",
      accessory: "water-canteen",
    },
    drill: [
      { abilityId: "bayonet-charge", postId: "fusilier", drill: 100, required: 100 },
      { abilityId: "crushing-blow", postId: "grenadier", drill: 60, required: 120 },
    ],
  }),
  makeSoldier({
    id: "unit-okafor",
    name: "Pte. Okafor",
    power: "britain",
    postId: "forager",
    level: 3,
    equipment: {
      weapon: "forester-bow",
      armour: "campaign-shirt",
      head: "forage-cap",
      accessory: "water-canteen",
    },
    drill: [{ abilityId: "quiet-loosing", postId: "forager", drill: 40, required: 60 }],
  }),
  makeSoldier({
    id: "unit-voss",
    name: "Lt. Voss",
    power: "austria",
    postId: "scout",
    level: 3,
    equipment: {
      weapon: "light-carbine",
      armour: "campaign-shirt",
      head: "forage-cap",
      accessory: "spyglass",
    },
    drill: [{ abilityId: "snap-shot", postId: "scout", drill: 90, required: 90 }],
  }),
  makeSoldier({
    id: "unit-duret",
    name: "Cpl. Duret",
    power: "france",
    postId: "chasseur",
    level: 3,
    equipment: {
      weapon: "baker-rifle",
      armour: "campaign-shirt",
      head: "forage-cap",
      accessory: "powder-flask",
    },
    drill: [{ abilityId: "aim-vitals", postId: "chasseur", drill: 150, required: 150 }],
  }),
];

/** The company whose colours the suite flies. */
const DEMO_COMPANY: Company = createCompany({
  id: asCompanyId("company-greycoats"),
  name: "The Greycoats",
  crowns: 1400,
  honours: 3,
  theatre: { day: 12, regionId: asRegionId("sainte-colombe") },
});

/* --------------------------------------------------------------------------
 * Kit helpers (presentation over `src/data/equipment`)
 * ------------------------------------------------------------------------ */

/** Resolve a unit's primary post definition, failing loudly on a bad id. */
function unitPost(unit: Unit): PostDef {
  if (!isPostKey(unit.postId)) {
    throw new RangeError(`unit ${unit.id} holds an unknown post: ${String(unit.postId)}`);
  }
  return getPost(unit.postId);
}

/** Whether a soldier on `assignment` may fill `slot` with `item`. */
function canEquip(unit: Unit, item: EquipmentDef): boolean {
  // The post's kit list is the baseline; `canEquipItem` owns the rule (T051).
  return canEquipItem(unitPost(unit), item, unit.power);
}

/** Every item a soldier may put in `slot`, in canonical authoring order. */
function kitFor(unit: Unit, slot: EquipSlot): readonly EquipmentDef[] {
  return equipmentForSlot(slot).filter((item) => canEquip(unit, item));
}

/** The stat block a soldier fields with its current kit, for menu previews. */
function statsWithKit(soldier: MenuSoldier): StatBlock {
  const mods = [];
  for (const slot of EQUIP_SLOTS) {
    const itemId = soldier.unit.equipment[slot];
    if (itemId === null || !isEquipmentKey(itemId)) continue;
    mods.push(statsOf(itemId));
  }
  return derivePostStats({
    level: soldier.unit.level,
    assignment: soldier.assignment,
    equipment: mods,
  });
}

/** A short stat-modifier summary for one item (`+8 Steel, +2 Speed`). */
function itemModsSummary(item: EquipmentDef, t: Translator): string {
  const entries: string[] = [];
  for (const key of STAT_COLUMNS) {
    const value = item.stats[key];
    if (value === 0) continue;
    entries.push(`${value > 0 ? "+" : ""}${value} ${t(STAT_LABEL_KEYS[key])}`);
  }
  return entries.length === 0 ? t("common.noStatModifier") : entries.join(", ");
}

/* --------------------------------------------------------------------------
 * Props
 * ------------------------------------------------------------------------ */

/** Props for {@link Menus}. */
export interface MenusProps {
  /** The company whose colours are flown. Defaults to the demo company. */
  readonly company?: Company;
  /** The soldiers on the roll. Defaults to the deterministic demo roster. */
  readonly soldiers?: readonly MenuSoldier[];
  /** The camp menu to open first. Defaults to `"main"`. */
  readonly initialScreen?: MenuScreen;
  /** Called when the player leaves the camp for the battlefield. */
  readonly onClose?: () => void;
}

/* --------------------------------------------------------------------------
 * Presentational sub-views
 * ------------------------------------------------------------------------ */

/** The persistent camp sidebar, shared by every screen in the suite. */
function MenuSidebar({
  screen,
  onNavigate,
  onClose,
}: {
  readonly screen: MenuScreen;
  readonly onNavigate: (screen: MenuScreen) => void;
  readonly onClose?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <nav className="menu-sidebar" aria-label={t("menu.sidebarLabel")}>
      <ul>
        {MENU_ENTRIES.map((entry) => (
          <li key={entry.screen}>
            <button
              type="button"
              className={screen === entry.screen ? "menu-nav is-active" : "menu-nav"}
              data-testid={`menu-nav-${entry.screen}`}
              aria-current={screen === entry.screen ? "page" : undefined}
              onClick={() => onNavigate(entry.screen)}
            >
              <span className="menu-nav__kicker">{t(entry.kickerKey)}</span>
              <span className="menu-nav__label">{t(entry.labelKey)}</span>
            </button>
          </li>
        ))}
      </ul>
      {onClose !== undefined && (
        <button
          type="button"
          className="menu-nav menu-nav--field"
          data-testid="menu-nav-field"
          onClick={onClose}
        >
          <span className="menu-nav__kicker">{t("menu.returnKicker")}</span>
          <span className="menu-nav__label">{t("menu.returnToField")}</span>
        </button>
      )}
    </nav>
  );
}

/** The camp hub: tiles for every menu plus the company's war chest. */
function MainMenu({
  company,
  soldierCount,
  onNavigate,
}: {
  readonly company: Company;
  readonly soldierCount: number;
  readonly onNavigate: (screen: MenuScreen) => void;
}) {
  const tiles = MENU_ENTRIES.filter((entry) => entry.screen !== "main");
  const { t } = useTranslation();
  return (
    <section className="menu-main" data-testid="menu-main" aria-label={t("screen.campOrders")}>
      <header className="menu-panel__header">
        <p className="kicker">{t("menu.kicker")}</p>
        <h2>{company.name}</h2>
        <p className="muted">{t("menu.blurb")}</p>
      </header>

      <dl className="menu-summary" data-testid="menu-summary">
        <div>
          <dt>{t("common.crowns")}</dt>
          <dd data-testid="menu-summary-crowns">{crownsLabel(company.crowns, t)}</dd>
        </div>
        <div>
          <dt>{t("common.honours")}</dt>
          <dd data-testid="menu-summary-honours">{company.honours}</dd>
        </div>
        <div>
          <dt>{t("common.roster")}</dt>
          <dd data-testid="menu-summary-roster">{t("common.soldiers", { count: soldierCount })}</dd>
        </div>
        <div>
          <dt>{t("common.day")}</dt>
          <dd data-testid="menu-summary-day">{company.theatre.day}</dd>
        </div>
      </dl>

      <ul className="menu-grid">
        {tiles.map((entry) => (
          <li key={entry.screen}>
            <button
              type="button"
              className="menu-tile"
              data-testid={`menu-tile-${entry.screen}`}
              onClick={() => onNavigate(entry.screen)}
            >
              <span className="menu-tile__kicker">{t(entry.kickerKey)}</span>
              <span className="menu-tile__label">{t(entry.labelKey)}</span>
              <span className="menu-tile__blurb">{t(entry.blurbKey)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The company roll: the roster and the selected soldier's service record. */
function CompanyMenu({
  company,
  soldiers,
  selectedUnitId,
  onSelect,
}: {
  readonly company: Company;
  readonly soldiers: readonly MenuSoldier[];
  readonly selectedUnitId: UnitId | null;
  readonly onSelect: (unitId: UnitId) => void;
}) {
  const { t } = useTranslation();
  const selected = soldiers.find((soldier) => soldier.unit.id === selectedUnitId) ?? soldiers[0];
  const stats = selected === undefined ? null : statsWithKit(selected);

  return (
    <section className="menu-company" data-testid="company-screen" aria-label={t("menu.company.label")}>
      <header className="menu-panel__header">
        <p className="kicker">{t("menu.companyRoll")}</p>
        <h2>{company.name}</h2>
        <p className="muted">
          {t("menu.companySummary", {
            soldiers: soldiers.length,
            crowns: crownsLabel(company.crowns, t),
            honours: company.honours,
          })}
        </p>
      </header>

      <div className="company-layout">
        <ul className="company-roster" data-testid="company-roster">
          {soldiers.map((soldier) => {
            const isActive = soldier.unit.id === selectedUnitId;
            return (
              <li key={soldier.unit.id}>
                <button
                  type="button"
                  className={isActive ? "company-row is-active" : "company-row"}
                  data-testid={`company-soldier-${soldier.unit.id}`}
                  aria-pressed={isActive}
                  onClick={() => onSelect(soldier.unit.id)}
                >
                  <span className="company-row__name">{soldier.unit.name}</span>
                  <span className="company-row__meta">
                    {t("menu.soldierMeta", {
                      power: t(POWER_LABEL_KEYS[soldier.unit.power]),
                      post: postLabel(soldier.unit.postId),
                      level: soldier.unit.level,
                    })}
                  </span>
                  <span className="company-row__vitals">
                    {t("menu.soldierVitals", {
                      hp: soldier.unit.hp,
                      maxHp: soldier.unit.stats.hp,
                      mp: soldier.unit.mp,
                    })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {selected !== undefined && stats !== null && (
          <aside className="company-detail" data-testid="company-detail">
            <h3 data-testid="company-selected-name">{selected.unit.name}</h3>
            <p className="muted">
              {t(POWER_LABEL_KEYS[selected.unit.power])} · {t("posts.primary")}{" "}
              {primaryPostOf(selected.assignment).name}
              {attachedPostOf(selected.assignment) !== null
                ? ` · ${t("posts.attached")} ${attachedPostOf(selected.assignment)?.name ?? ""}`
                : ""}
            </p>

            <dl className="company-stats" data-testid="company-stats">
              {STAT_COLUMNS.map((key) => (
                <div key={key}>
                  <dt>{t(STAT_LABEL_KEYS[key])}</dt>
                  <dd data-testid={`company-stat-${key}`}>{stats[key]}</dd>
                </div>
              ))}
            </dl>

            <h4>{t("menu.kitHeading")}</h4>
            <ul className="company-kit" data-testid="company-kit">
              {EQUIP_SLOTS.map((slot) => {
                const itemId = selected.unit.equipment[slot];
                return (
                  <li key={slot} data-testid={`company-kit-${slot}`}>
                    <span className="company-kit__slot">{t(SLOT_LABEL_KEYS[slot])}</span>
                    <span className="company-kit__item">
                      {itemId === null ? t("common.none") : itemLabel(itemId)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
    </section>
  );
}

/** The equip screen: the five slots and the legal kit for the selected one. */
function EquipmentMenu({
  soldier,
  onEquip,
}: {
  readonly soldier: MenuSoldier;
  readonly onEquip: (slot: EquipSlot, itemId: EquipmentId | null) => void;
}) {
  const { t } = useTranslation();
  const [openSlot, setOpenSlot] = useState<EquipSlot>("weapon");
  const stats = statsWithKit(soldier);
  const options = useMemo(() => kitFor(soldier.unit, openSlot), [soldier.unit, openSlot]);
  const equippedId = soldier.unit.equipment[openSlot];

  return (
    <section className="menu-equipment" data-testid="equipment-screen" aria-label={t("menu.kit.label")}>
      <header className="menu-panel__header">
        <p className="kicker">{t("menu.equipment")}</p>
        <h2>{soldier.unit.name}</h2>
        <p className="muted">
          {primaryPostOf(soldier.assignment).name} {t("menu.mayFill")}{" "}
          {unitPost(soldier.unit).equipSlots.length} {t("menu.slots")}. {t("menu.drillNote")}
        </p>
      </header>

      <div className="equipment-layout">
        <section className="equipment-slots" aria-label={t("menu.equipSlotsLabel")}>
          <h3>{t("common.equipped")}</h3>
          <ul data-testid="equipment-slots">
            {EQUIP_SLOTS.map((slot) => {
              const itemId = soldier.unit.equipment[slot];
              const allowed = unitPost(soldier.unit).equipSlots.includes(slot);
              return (
                <li key={slot}>
                  <button
                    type="button"
                    className={openSlot === slot ? "equipment-slot is-active" : "equipment-slot"}
                    data-testid={`equipment-slot-${slot}`}
                    aria-pressed={openSlot === slot}
                    onClick={() => setOpenSlot(slot)}
                  >
                    <span className="equipment-slot__name">{t(SLOT_LABEL_KEYS[slot])}</span>
                    <span className="equipment-slot__item" data-testid={`equipment-item-${slot}`}>
                      {itemId === null
                        ? allowed
                          ? t("common.empty")
                          : t("common.notCarried")
                        : itemLabel(itemId)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="equipment-options" aria-label={t("menu.availableKitLabel")}>
          <h3>{t("menu.shelfHeading", { slot: t(SLOT_LABEL_KEYS[openSlot]) })}</h3>
          {options.length === 0 ? (
            <p className="muted" data-testid="equipment-no-options">
              {t("menu.mayNotCarry", { item: t(SLOT_LABEL_KEYS[openSlot]).toLowerCase() })}
            </p>
          ) : (
            <ul data-testid={`equipment-options-${openSlot}`}>
              {options.map((item) => {
                const isEquipped = item.id === equippedId;
                const teaches = item.teaches.map((teach) => abilityLabel(teach.abilityId));
                return (
                  <li
                    key={item.id}
                    className={isEquipped ? "equipment-option is-equipped" : "equipment-option"}
                    data-testid={`equipment-option-${openSlot}-${item.id}`}
                  >
                    <div className="equipment-option__head">
                      <span className="equipment-option__name">{item.name}</span>
                      <span className="equipment-option__mods">{itemModsSummary(item, t)}</span>
                    </div>
                    <p className="equipment-option__desc">{item.description}</p>
                    {teaches.length > 0 && (
                      <p className="equipment-option__teaches">
                        {t("menu.teachesLine", {
                          abilities: teaches.join(", "),
                          drill: item.teaches
                            .map((teach) => t("common.drillAmount", { count: teach.ap }))
                            .join(", "),
                        })}
                      </p>
                    )}
                    <div className="equipment-option__actions">
                      <button
                        type="button"
                        className="button"
                        data-testid={`equipment-equip-${openSlot}-${item.id}`}
                        disabled={isEquipped}
                        onClick={() => onEquip(openSlot, asEquipmentId(item.id))}
                      >
                        {isEquipped ? t("common.equipped") : t("common.equip")}
                      </button>
                      {isEquipped && (
                        <button
                          type="button"
                          className="button button--ghost"
                          data-testid={`equipment-clear-${openSlot}`}
                          onClick={() => onEquip(openSlot, null)}
                        >
                          {t("common.unequip")}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="equipment-stats" aria-label={t("menu.fieldedStats")}>
          <h3>{t("menu.fieldedStats")}</h3>
          <dl data-testid="equipment-stats">
            {STAT_COLUMNS.map((key) => (
              <div key={key}>
                <dt>{t(STAT_LABEL_KEYS[key])}</dt>
                <dd data-testid={`equipment-stat-${key}`}>{stats[key]}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </section>
  );
}

/** The ability ledger: Drill progress, kit instruction and the equipped slots. */
function AbilitiesMenu({ soldier }: { readonly soldier: MenuSoldier }) {
  const { t } = useTranslation();
  const equipped: EquipmentKey[] = [];
  for (const slot of EQUIP_SLOTS) {
    const itemId = soldier.unit.equipment[slot];
    if (itemId !== null && isEquipmentKey(itemId)) equipped.push(itemId);
  }
  const learnedById = new Map(soldier.drill.map((entry) => [entry.abilityId, entry] as const));

  return (
    <section className="menu-abilities" data-testid="abilities-screen" aria-label={t("menu.drill.label")}>
      <header className="menu-panel__header">
        <p className="kicker">{t("menu.abilities")}</p>
        <h2>{soldier.unit.name}</h2>
        <p className="muted">{t("menu.abilitiesNote")}</p>
      </header>

      <div className="abilities-layout">
        <section className="abilities-list" aria-label={t("menu.abilityLedgerLabel")}>
          <h3>{t("menu.skillLedger")}</h3>
          <ul data-testid="ability-list">
            {soldier.drill.map((entry) => (
              <li
                key={entry.abilityId}
                className={entry.mastered ? "ability-row is-mastered" : "ability-row"}
                data-testid={`ability-${entry.abilityId}`}
              >
                <div className="ability-row__head">
                  <span className="ability-row__name">{entry.abilityName}</span>
                  <span className="ability-row__post">{postLabel(entry.postId)}</span>
                </div>
                <progress
                  max={entry.required}
                  value={Math.min(entry.drill, entry.required)}
                  aria-label={`${entry.abilityName} Drill`}
                />
                <div className="ability-row__foot">
                  <span data-testid={`ability-${entry.abilityId}-progress`}>
                    {t("menu.drillFraction", { drill: entry.drill, required: entry.required })}
                  </span>
                  <span data-testid={`ability-${entry.abilityId}-status`}>
                    {entry.mastered ? t("common.mastered") : t("common.inTraining")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="abilities-kit" aria-label={t("menu.kitInstruction")}>
          <h3>{t("menu.kitInstruction")}</h3>
          {equipped.length === 0 ? (
            <p className="muted">{t("menu.noKit")}</p>
          ) : (
            <ul data-testid="ability-kit">
              {equipped.map((itemId) => {
                const item = getEquipment(itemId);
                return (
                  <li key={itemId} data-testid={`ability-kit-${itemId}`}>
                    <span className="ability-kit__item">{item.name}</span>
                    <ul className="ability-kit__teaches">
                      {item.teaches.map((teach) => {
                        const learned = learnedById.get(teach.abilityId);
                        return (
                          <li key={teach.abilityId}>
                            <span>{abilityLabel(teach.abilityId)}</span>
                            <span>
                              {t("common.drillAmount", { count: teach.ap })} ·{" "}
                              {learned?.mastered === true
                                ? t("common.mastered")
                                : t("common.notYetMastered")}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="abilities-slots" aria-label={t("menu.equippedAbilitiesLabel")}>
          <h3>{t("common.equipped")}</h3>
          <dl data-testid="ability-slots">
            {ABILITY_SLOT_KEYS.map((slot) => {
              const abilityId = soldier.assignment.slots[slot];
              return (
                <div key={slot}>
                  <dt>{t(ABILITY_SLOT_LABEL_KEYS[slot])}</dt>
                  <dd data-testid={`ability-slot-${slot}`}>
                    {abilityId === null ? t("common.none") : abilityLabel(abilityId)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </aside>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
 * The suite
 * ------------------------------------------------------------------------ */

/**
 * The camp menu suite. Renders the persistent sidebar beside whichever camp
 * menu is open, and hands `PostScreen` the selected soldier so post changes
 * update the roll in place.
 */
export function Menus({
  company = DEMO_COMPANY,
  soldiers: soldiersProp,
  initialScreen = "main",
  onClose,
}: MenusProps) {
  const { t } = useTranslation();
  const [soldiers, setSoldiers] = useState<readonly MenuSoldier[]>(soldiersProp ?? DEMO_SOLDIERS);
  const [screen, setScreen] = useState<MenuScreen>(initialScreen);
  const [selectedUnitId, setSelectedUnitId] = useState<UnitId | null>(
    (soldiersProp ?? DEMO_SOLDIERS)[0]?.unit.id ?? null,
  );

  const selected = soldiers.find((soldier) => soldier.unit.id === selectedUnitId) ?? soldiers[0];

  /** Replace one soldier's record, keeping the rest of the roll untouched. */
  const updateSoldier = (unitId: UnitId, update: (soldier: MenuSoldier) => MenuSoldier): void => {
    setSoldiers((current) =>
      current.map((soldier) => (soldier.unit.id === unitId ? update(soldier) : soldier)),
    );
  };

  const open = (next: MenuScreen): void => {
    if (isMenuScreen(next)) setScreen(next);
  };

  return (
    <section className="menu-suite" data-testid="menus" aria-label={t("menu.campSuiteLabel")}>
      <MenuSidebar screen={screen} onNavigate={open} onClose={onClose} />

      <div className="menu-content">
        {screen === "main" && (
          <MainMenu company={company} soldierCount={soldiers.length} onNavigate={open} />
        )}

        {screen === "company" && (
          <CompanyMenu
            company={company}
            soldiers={soldiers}
            selectedUnitId={selectedUnitId}
            onSelect={(unitId) => setSelectedUnitId(unitId)}
          />
        )}

        {screen === "post" &&
          (selected === undefined ? (
            <p className="muted">{t("menu.noSoldiers")}</p>
          ) : (
            <PostScreen
              key={selected.unit.id}
              soldier={toPostScreenSoldier(selected)}
              onAssignmentChange={(assignment) =>
                updateSoldier(selected.unit.id, (soldier) => ({ ...soldier, assignment }))
              }
            />
          ))}

        {screen === "equipment" &&
          (selected === undefined ? (
            <p className="muted">{t("menu.noSoldiers")}</p>
          ) : (
            <EquipmentMenu
              soldier={selected}
              onEquip={(slot, itemId) =>
                updateSoldier(selected.unit.id, (soldier) => ({
                  ...soldier,
                  unit: withEquipment(soldier.unit, slot, itemId),
                }))
              }
            />
          ))}

        {screen === "abilities" &&
          (selected === undefined ? (
            <p className="muted">{t("menu.noSoldiers")}</p>
          ) : (
            <AbilitiesMenu soldier={selected} />
          ))}

        {screen === "depot" && <Depot />}
        {screen === "mess" && <Mess />}
        {screen === "campaign-map" && <CampaignMap />}
      </div>
    </section>
  );
}

/** Project a suite soldier into the {@link PostScreen} view-model. */
function toPostScreenSoldier(soldier: MenuSoldier): PostScreenSoldier {
  return {
    name: soldier.unit.name,
    power: soldier.unit.power,
    level: soldier.unit.level,
    assignment: soldier.assignment,
    mastered: soldier.mastered,
    drill: soldier.drill,
  };
}
