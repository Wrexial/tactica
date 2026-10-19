/**
 * i18n scaffolding (T111) — the single source of user-facing copy for the
 * presentation layer.
 *
 * Every string a player reads should be looked up through {@link t} (or the
 * React {@link useTranslation} hook) rather than written inline in a component.
 * That keeps the English text in one reviewable place, makes a second language a
 * data problem instead of a code problem, and lets a QA pseudo-locale surface
 * copy that never went through a key.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Edge layer, not engine.** This module is pure TypeScript with no DOM
 *   access. It does import React for the optional hook, but nothing under
 *   `src/engine/` may import it, so the deterministic simulation stays
 *   framework-free.
 * - **Data, not branches.** Adding a locale is `registerLocale(...)`; adding a
 *   string is a catalog entry. The only logic here is lookup, interpolation,
 *   plural selection and fallback.
 * - **Napoleonic fiction.** Keys and copy describe a free company at war, not an
 *   FFTA clan (mapping §1, §14 D6).
 *
 * ## Usage
 *
 * ```ts
 * import { t, useTranslation } from "../i18n";
 *
 * t("nav.battlefield");                       // "Field"
 * t("common.tiles", { count: 3 });            // "3 tiles"
 * t("hud.elan", { amount: 4 });               // "Élan 4"
 *
 * function Orders() {
 *   const { t } = useTranslation();           // re-renders on setLocale()
 *   return <h2>{t("hud.orders")}</h2>;
 * }
 * ```
 *
 * ## Adding a language
 *
 * 1. Author a partial `MessageCatalog` with the keys the translation covers.
 * 2. Call {@link registerLocale} once at startup.
 * 3. Any key the translation omits falls back to {@link DEFAULT_LOCALE}, so a
 *    locale can ship incrementally. {@link missingKeys} records the gaps.
 */

import { useCallback, useSyncExternalStore } from "react";

/* --------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------ */

/** A CLDR plural category, as returned by `Intl.PluralRules`. */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/** A message with an explicit form per plural category. */
export type PluralForms = Readonly<Partial<Record<PluralCategory, string>>>;

/** A translatable message: a plain template, or a plural form table. */
export type Message = string | PluralForms;

/** A flat, dotted-key catalog (e.g. `"nav.battlefield": "Field"`). */
export type MessageCatalog = Readonly<Record<string, Message>>;

/** Values substituted into `{placeholders}`. Numbers are locale-formatted. */
export type TranslationVars = Readonly<Record<string, string | number>>;

/** A translator bound to one locale. */
export type Translator = (key: MessageKey, vars?: TranslationVars) => string;

/* --------------------------------------------------------------------------
 * English catalog — the source of truth
 * ------------------------------------------------------------------------ */

/**
 * The English catalog. Keys are dotted namespaces; plural entries carry `one`
 * and `other` forms and are selected by the `count` variable.
 *
 * This is the reference catalog: every other locale falls back to it, so it must
 * always contain every key the UI asks for.
 */
const en = {
  /* ---------------------------------------------------------------------- */
  /* Common                                                                 */
  /* ---------------------------------------------------------------------- */
  "common.none": "—",
  "common.tiles": {
    one: "{count} tile",
    other: "{count} tiles",
  },
  "common.soldiers": {
    one: "{count} soldier",
    other: "{count} soldiers",
  },
  "common.days": {
    one: "{count} day",
    other: "{count} days",
  },
  "common.level": "Lv",
  "common.hp": "HP",
  "common.elan": "Élan",
  "common.drill": "Drill",
  "common.crowns": "Crowns",
  "common.honours": "Honours",
  "common.company": "Company",
  "common.roster": "Roster",
  "common.day": "Day",
  "common.region": "Region",
  "common.terrain": "Terrain",
  "common.action": "Action",
  "common.key": "Key",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.close": "Close",
  "common.load": "Load",
  "common.save": "Save",
  "common.buy": "Buy",
  "common.sell": "Sell",
  "common.equipped": "Equipped",
  "common.unequip": "Unequip",

  /* ---------------------------------------------------------------------- */
  /* App shell                                                              */
  /* ---------------------------------------------------------------------- */
  "app.skipToBattlefield": "Skip to the battlefield",
  "app.kicker": "A Napoleonic small-squad tactics RPG",
  "app.title": "Lines of Glory",
  "app.badge": "Prototype · Phase 4",
  "stage.label": "Battlefield and camp",
  "canvas.label": "Battlefield",

  /* ---------------------------------------------------------------------- */
  /* Navigation + screen names                                             */
  /* ---------------------------------------------------------------------- */
  "nav.label": "Screens",
  "nav.battlefield": "Field",
  "nav.quickBattle": "Quick Battle",
  "nav.campOrders": "Camp Orders",
  "nav.barracks": "Barracks",
  "nav.mess": "Officers' Mess",
  "nav.campaignMap": "Campaign Map",
  "nav.quartermaster": "Quartermaster",
  "nav.saves": "Saves",
  "nav.settings": "Settings",
  "nav.lobby": "Skirmish",
  "nav.drillSquare": "Drill Square",
  "screen.battlefield": "Battlefield",
  "screen.campOrders": "Camp orders",
  "screen.barracks": "Barracks and posts",
  "screen.mess": "Officers' mess",
  "screen.campaignMap": "Campaign map",
  "screen.quartermaster": "Quartermaster",
  "screen.saves": "Saves",
  "screen.settings": "Settings",
  "screen.lobby": "Lobby",
  "screen.fallback": "Screen",

  /* ---------------------------------------------------------------------- */
  /* Field HUD                                                              */
  /* ---------------------------------------------------------------------- */
  "hud.orders": "Field Orders",
  "hud.controls":
    "Arrows / WASD / D-pad move the cursor · Enter / A confirms · O opens Orders · Esc / B backs out · M / Start opens the camp · drag to pan, wheel to zoom.",
  "hud.tempo": "Orders Tempo",
  "hud.phase": "Phase",
  "hud.cursor": "Cursor",
  "hud.selected": "Selected",
  "hud.moveRange": "Move range",
  "hud.plannedMarch": "Planned march",
  "hud.targetReach": "Target reach",
  "hud.area": "Area",
  "hud.dangerZone": "Danger zone",
  "hud.elevation": "Elevation",
  "hud.elevationLevel": "level",
  "hud.ordersHeading": "Orders",
  "hud.elanCost": "Élan {amount}",
  "hud.battleLog": "Battle log",
  "hud.battleLogLabel": "Battle animations",
  "hud.ordersLabel": "Orders",
  "hud.help.tempo":
    "The soldier taking the current Orders Tempo turn. Turns are not round-robin — higher Speed acts more often.",
  "hud.help.phase":
    "What the field is asking of you: select a soldier, plan a march, aim an order, then confirm it.",
  "hud.help.cursor": "The tile your movement or aim is pointed at.",
  "hud.help.selected": "The soldier you have picked. Only the acting soldier may be given orders.",
  "hud.help.moveRange":
    "Tiles the selected soldier can reach this turn, given their Move rate, terrain and Climb.",
  "hud.help.plannedMarch":
    "The march you have queued. Moving does not end the turn — resolve an order (or Wait) to close it.",
  "hud.help.targetReach": "Tiles the chosen order can reach from the soldier's position.",
  "hud.help.area": "The tiles the order's effect covers — friends and foes alike.",
  "hud.help.dangerZone":
    "Tiles the enemy could strike next turn. Do not leave a soldier standing in the open.",
  "hud.help.elevation":
    "Height difference between the soldier and the cursor. High ground helps the blow and can block line of sight.",
  "tip.moreInfo": "More information",
  "unit.conditions": "Conditions",
  "unit.vitals": "Vitals",
  "unit.cardLabel": "Soldier detail: {name}",
  "ability.class": "Type",
  "ability.class.action": "Action",
  "ability.class.reaction": "Reaction",
  "ability.class.support": "Support",
  "ability.class.combo": "Volley",
  "ability.cost": "Cost",
  "ability.range": "Range",
  "ability.power": "Power",
  "ability.charge": "Charge",
  "ability.chargeValue": "{ticks} ticks",
  "ability.element": "Element",
  "ability.target": "Target",
  "ability.target.self": "Self",
  "ability.target.ally": "Ally",
  "ability.target.enemy": "Enemy",
  "ability.target.any": "Any",
  "ability.target.tile": "Tile",
  "equip.slot": "Slot",
  "equip.cost": "Cost",
  "equip.teaches": "Teaches",

  /* ---------------------------------------------------------------------- */
  /* Settings                                                               */
  /* ---------------------------------------------------------------------- */
  "settings.header.kicker": "Camp Keep · Settings",
  "settings.header.title": "Preferences & Keybinds",
  "settings.header.blurb":
    "Set the volume, the pace of dispatches and how the field reads — then bind the keys the company answers to. Preferences are filed with the campaign record.",
  "settings.volume": "Volume",
  "settings.textSpeed": "Text speed",
  "settings.damageNumbers": "Damage numbers",
  "settings.colourBlind": "Colour-blind",
  "settings.format": "Format",
  "settings.filed": "Filed",
  "settings.shown": "Shown",
  "settings.hidden": "Hidden",
  "settings.audio": "Audio",
  "settings.masterVolume": "Master volume",
  "settings.mute": "Mute",
  "settings.full": "Full",
  "settings.audioNote": "The audio layer honours this once its files are in (T107).",
  "settings.dispatchPacing": "Dispatch pacing",
  "settings.fieldHud": "Field HUD",
  "settings.showDamageNumbers": "Show damage numbers",
  "settings.damageNumbersNote":
    "Casualty figures float over the field after each volley. Turn them off for a cleaner board.",
  "settings.colourBlindMode": "Colour-blind mode",
  "settings.palette": "Palette",
  "settings.keybinds": "Keybinds",
  "settings.keybindsNote":
    "Order the company answers to. Choose Rebind, then press a key; Escape cancels.",
  "settings.rebind": "Rebind",
  "settings.pressAKey": "Press a key…",
  "settings.resetKeybinds": "Reset keybinds",
  "settings.restoreDefaults": "Restore defaults",
  "settings.restoreDefaultsNote": "Return every preference and binding to the issue settings.",
  "settings.resetAll": "Reset all settings",
  "settings.ready": "Ready.",
  "settings.filedStatus": "Preferences filed.",
  "settings.keybindsRestored": "Keybinds restored to issue defaults.",
  "settings.defaultsRestored": "Settings restored to issue defaults.",
  "settings.readError": "Could not read saved settings: {error}",
  "settings.writeError": "Could not save settings: {error}",

  /* ---------------------------------------------------------------------- */
  /* Saves                                                                  */
  /* ---------------------------------------------------------------------- */
  "saves.kicker": "Camp Keep · Saves",
  "saves.title": "Autosave, Slots & Records",
  "saves.blurb":
    "The company is autosaved whenever it changes. File it into a slot, restore an earlier posting, or carry the campaign in and out as JSON.",
  "saves.autosave": "Autosave",
  "saves.autosaveNow": "Autosave now",
  "saves.slots": "Filing slots",
  "saves.slotLabel": "Slot label",
  "saves.slot": "Slot",
  "saves.record": "Record",
  "saves.written": "Written",
  "saves.strike": "Strike",
  "saves.advanceDay": "Advance a day",
  "saves.exportJson": "Export JSON",
  "saves.exportNote": "A canonical record of the campaign — seed, company, map, clock and history.",
  "saves.export": "Export",
  "saves.download": "Download .json",
  "saves.importJson": "Import JSON",
  "saves.importNote":
    "Paste an exported record. It is validated against the engine before it replaces the working campaign.",
  "saves.import": "Import",
  "saves.importPlaceholder": "Paste an exported campaign JSON here…",
  "saves.ledger": "Ledger",
  "saves.noOrders": "No save orders yet.",
  "saves.importRejected": "Import rejected",
  "saves.imported": "Imported",

  /* ---------------------------------------------------------------------- */
  /* Menus / camp orders                                                    */
  /* ---------------------------------------------------------------------- */
  "menu.returnToField": "Return to the Field",
  "menu.kicker": "Camp · Orders",
  "menu.blurb":
    "The free company rests between contracts. Choose an order; every rule behind it lives with the data and the engine.",
  "menu.companyRoll": "Company · The Roll",
  "menu.underColours": "under the colours",
  "menu.inChest": "in the chest",
  "menu.honours": "honours",
  "menu.equipment": "Equipment · Kit",
  "menu.mayFill": "may fill",
  "menu.slots": "slots",
  "menu.drillNote": "Drill is earned by carrying kit.",
  "menu.shelf": "shelf",
  "menu.mayNotCarry": "This post may not carry a {item}.",
  "menu.teaches": "Teaches",
  "menu.fieldedStats": "Fielded stats",
  "menu.abilities": "Abilities · Drill",
  "menu.abilitiesNote":
    "Battles award Drill; mastering an ability bound to equipped kit makes it permanent.",
  "menu.skillLedger": "Skill ledger",
  "menu.kitInstruction": "Kit instruction",
  "menu.noKit": "No kit carried.",
  "menu.noSoldiers": "No soldiers on the roll.",

  /* ---------------------------------------------------------------------- */
  /* Officers' Mess                                                         */
  /* ---------------------------------------------------------------------- */
  "mess.kicker": "Garrison Town · Officers' Mess",
  "mess.title": "Mission Board",
  "mess.blurb": "Contracts of the free company, posted by the officers of the garrison.",
  "mess.all": "All",
  "mess.chapter": "Chapter",
  "mess.detachment": "Detachment",
  "mess.requirements": "Requirements",
  "mess.noRequirements": "None — any company may take this contract.",
  "mess.reward": "Reward on success",
  "mess.experience": "Experience",
  "mess.kitMark": "(kit)",
  "mess.insufficientCrowns": "Insufficient Crowns — the fee is {fee}.",
  "mess.contractKind": "Contract kind",

  /* ---------------------------------------------------------------------- */
  /* Depot                                                                  */
  /* ---------------------------------------------------------------------- */
  "depot.noneOpen": "No depots are open in the theatre.",
  "depot.kicker": "Quartermaster's Stores · Depot",
  "depot.title": "Buy & Sell",
  "depot.blurb":
    "A depot favours the kit of its own power and charges more for other schools' gear. Trade is only open where the company stands.",
  "depot.marchThereFirst": "March there first",
  "depot.marchAway": "is a day's march away — the company cannot trade here from {region}.",
  "depot.kit": "Kit",
  "depot.tier": "Tier",
  "depot.owned": "Owned",
  "depot.reserve": "Company reserve",
  "depot.reserveEmpty": "The reserve is empty.",
  "depot.ledger": "Ledger",
  "depot.noTrades": "No trades yet.",

  /* ---------------------------------------------------------------------- */
  /* Campaign map                                                           */
  /* ---------------------------------------------------------------------- */
  "campaign.kicker": "The Theatre · Campaign Map",
  "campaign.title": "Lines of March",
  "campaign.blurb":
    "Grow the theatre with campaign markers, then march and hunt. What a hunt finds depends on what a location was placed beside.",
  "campaign.placed": "Placed",
  "campaign.slots": "Campaign slots",
  "campaign.hunted": "Hunted",
  "campaign.markers": "Campaign markers",
  "campaign.allPlaced": "Every marker has been placed.",
  "campaign.selectedLocation": "Selected location",
  "campaign.chooseSlot": "Choose a slot on the map.",
  "campaign.emptySlot": "Empty slot",
  "campaign.treasure": "Treasure",
  "campaign.marchHere": "March here",
  "campaign.dispatchLog": "Dispatch log",
  "campaign.noOrders": "No orders issued yet.",
  "campaign.availableMarkers": "Available markers",

  /* ---------------------------------------------------------------------- */
  /* Posts / barracks                                                       */
  /* ---------------------------------------------------------------------- */
  "posts.kicker": "Barracks · Change Post",
  "posts.level": "· Level",
  "posts.primary": "Primary post",
  "posts.attached": "Attached post",
  "posts.roleTree": "Role tree —",
  "posts.actionSkillset": "Action skillset",
  "posts.skillsetNote":
    "Chosen from the primary post or any post whose abilities you have mastered.",
  "posts.attachedCommand": "Attached command",
  "posts.drillProgress": "Drill progress",
  "posts.drillNote": "Battles award Drill; master abilities bound to equipped kit.",
  "posts.stats": "Stats —",

  /* ---------------------------------------------------------------------- */
  /* Forecast                                                               */
  /* ---------------------------------------------------------------------- */
  "forecast.outOfAction": "Out of action",
  "forecast.hit": "Hit",
  "forecast.damage": "Damage",
  "forecast.medicine": "Medicine",
  "forecast.strength": "Strength",
  "forecast.facing": "Facing",
  "forecast.noReaction": "No reaction expected",
  "forecast.noSoldier": "No soldier is selected.",
  "forecast.title": "Battle Forecast",
  "forecast.reactionRisk": "Reaction risk",

  /* ---------------------------------------------------------------------- */
  /* Orders Tempo tray                                                      */
  /* ---------------------------------------------------------------------- */
  "tempo.title": "Orders Tempo",
  "tempo.upcoming": "Upcoming turn order",
  "tempo.noneReady": "No soldier is ready to act.",
  "tempo.onTurn": "On turn",
  "tempo.speed": "· Speed",

  /* ---------------------------------------------------------------------- */
  /* Lobby / online skirmish                                                */
  /* ---------------------------------------------------------------------- */
  "lobby.kicker": "The Theatre · Officers' Lobby",
  "lobby.title": "Free Company Skirmish",
  "lobby.blurb":
    "Match your free company against a rival's and fight a deterministic 1v1 action over the command log.",
  "lobby.yourCompany": "Your company",
  "lobby.opponent": "Opponent",
  "lobby.rating": "Rating",
  "lobby.roster": "Roster",
  "lobby.soldiers": {
    one: "{count} soldier",
    other: "{count} soldiers",
  },
  "lobby.find": "Find opponent",
  "lobby.searching": "Looking for a rival…",
  "lobby.pool": "Companies in the lobby",
  "lobby.noOpponent": "No rival company is waiting in the lobby.",
  "lobby.ready": "Ready",
  "lobby.readyToggle": "Mark company ready",
  "lobby.waiting": "Waiting for the rival to confirm…",
  "lobby.start": "Start skirmish",
  "lobby.vs": "vs",
  "lobby.result": "After-action report",
  "lobby.ceasefire": "Ceasefire — no decision",
  "lobby.victory": "Company victory",
  "lobby.defeat": "Company defeat",
  "lobby.draw": "Draw",
  "lobby.frames": "Frames",
  "lobby.commands": "Orders",
  "lobby.agreed": "Hashes agree",
  "lobby.desync": "Desync detected",
  "lobby.hashHome": "Home hash",
  "lobby.hashAway": "Away hash",
  "lobby.rematch": "New opponent",
  "lobby.readyYes": "Ready",
  "lobby.readyNo": "Not ready",
  "lobby.sideCompany": "Company",
  "lobby.sideEnemy": "Enemy",

  /* ---------------------------------------------------------------------- */
  /* Tutorial                                                               */
  /* ---------------------------------------------------------------------- */
  "tutorial.kicker": "Drill Square",
  "tutorial.leave": "Leave exercise",
  "tutorial.complete": "Exercise complete",
  "tutorial.completeNote":
    "You have marched, fired, read the tempo, kept the Articles and earned your first Drill.",
  "tutorial.returnToField": "Return to the field",
  "tutorial.lessonOf": "Lesson {index} of {total}",
  "tutorial.orderOfBattle": "Order of battle",
  "tutorial.confirmTempo": "Confirm the order of battle",
  "tutorial.standingOrders": "Today's standing orders",
  "tutorial.acknowledgeArticles": "Acknowledge the standing orders",
  "tutorial.drillByKit": "Drill by kit",
  "tutorial.binds": "{weapon} binds {ability}.",
  "tutorial.collectDrill": "Collect {amount} Drill",
  "tutorial.drillResult": "{trained} ability trained · {mastered} mastered",
  "tutorial.drillHeld": " — the drill has taken hold.",
  "tutorial.forbidden": "Forbidden",
  "tutorial.commended": "Commended",

  /* ---------------------------------------------------------------------- */
  /* T116 — shared labels, camp screens & screen-reader descriptions        */
  /* ---------------------------------------------------------------------- */
  "common.crownsAmount": {
    one: "{count} Crown",
    other: "{count} Crowns",
  },
  "common.honoursAmount": {
    one: "{count} Honour",
    other: "{count} Honours",
  },
  "common.drillAmount": "{count} Drill",
  "common.empty": "Empty",
  "common.notCarried": "Not carried",
  "common.noStatModifier": "No stat modifier",
  "common.mastered": "Mastered",
  "common.inTraining": "In training",
  "common.notYetMastered": "Not yet mastered",
  "common.met": "Met",
  "common.unmet": "Unmet",
  "common.posted": "Posted",
  "common.equip": "Equip",
  "common.owned": "Owned",
  "common.primary": "Primary",
  "common.attached": "Attached",
  "common.seed": "Seed",
  "common.format": "Format",
  "common.betweenPostings": "between postings",
  "common.unsearched": "Unsearched",

  "power.france": "France",
  "power.britain": "Britain",
  "power.prussia": "Prussia",
  "power.russia": "Russia",
  "power.austria": "Austria",

  "stat.hp": "HP",
  "stat.mp": "Élan",
  "stat.atk": "Steel",
  "stat.def": "Guard",
  "stat.mag": "Powder",
  "stat.res": "Faith",
  "stat.spd": "Speed",
  "stat.move": "Move",
  "stat.jump": "Climb",

  "slot.weapon": "Weapon",
  "slot.offhand": "Off-hand",
  "slot.armour": "Uniform",
  "slot.head": "Head",
  "slot.accessory": "Accessory",
  "slot.reaction": "Reaction",
  "slot.trait": "Trait",
  "slot.volley": "Volley",

  "role.line": "Line",
  "role.skirmisher": "Skirmisher",
  "role.cavalry": "Cavalry",
  "role.artillery": "Artillery",
  "role.medical": "Medical",
  "role.command": "Command",
  "role.engineer": "Engineer",
  "role.irregular": "Irregular",

  "side.company": "Company",
  "side.enemy": "Enemy",
  "side.neutral": "Neutral",

  "facing.front": "Front",
  "facing.side": "Flank",
  "facing.rear": "Rear",

  /* Menus / camp orders */
  "menu.sidebarLabel": "Camp menus",
  "menu.returnKicker": "Battle",
  "menu.orders.label": "Orders",
  "menu.orders.kicker": "Camp",
  "menu.orders.blurb": "The hub: every camp order from one place.",
  "menu.company.label": "Company",
  "menu.company.kicker": "Roster",
  "menu.company.blurb": "The roll of the free company, soldier by soldier.",
  "menu.barracks.label": "Barracks",
  "menu.barracks.kicker": "Post",
  "menu.barracks.blurb": "Change a soldier's post and read the role tree.",
  "menu.kit.label": "Equipment",
  "menu.kit.kicker": "Kit",
  "menu.kit.blurb": "Inspect and swap the kit a soldier carries.",
  "menu.drill.label": "Abilities",
  "menu.drill.kicker": "Drill",
  "menu.drill.blurb": "Mastered actions, reaction/trait/volley slots.",
  "menu.depot.label": "Quartermaster",
  "menu.depot.kicker": "Depot",
  "menu.depot.blurb": "Buy and sell kit by depot and power.",
  "menu.mess.label": "Officers' Mess",
  "menu.mess.kicker": "Contracts",
  "menu.mess.blurb": "Take contracts posted by the garrison.",
  "menu.map.label": "Campaign Map",
  "menu.map.kicker": "Theatre",
  "menu.map.blurb": "Place markers, march and hunt for treasure.",
  "menu.companySummary":
    "{soldiers} under the colours · {crowns} in the chest · {honours} honours.",
  "menu.kitHeading": "Kit",
  "menu.equipSlotsLabel": "Equip slots",
  "menu.availableKitLabel": "Available kit",
  "menu.shelfHeading": "{slot} shelf",
  "menu.teachesLine": "Teaches {abilities} · {drill}",
  "menu.drillFraction": "{drill} / {required} Drill",
  "menu.soldierMeta": "{power} · {post} · Lv {level}",
  "menu.soldierVitals": "{hp}/{maxHp} HP · {mp} Élan",
  "menu.equippedAbilitiesLabel": "Equipped abilities",
  "menu.abilityLedgerLabel": "Ability ledger",
  "menu.campSuiteLabel": "Camp menu suite",

  /* Officers' Mess */
  "mess.soldiers": "Soldiers",
  "mess.regimentalHonours": "Regimental Honours",
  "mess.kind.battle": "Battle",
  "mess.kind.skirmish": "Skirmish",
  "mess.kind.detachment": "Detachment",
  "mess.kind.pacification": "Pacification",
  "mess.chapterBadge": "Chapter {chapter}",
  "mess.takeContract": "Take contract · {fee}",
  "mess.experienceAmount": "{count} Experience",
  "mess.kitReward": "{item} (kit)",

  /* Campaign loop (T121) — active contract, field orders & after-action report */
  "contract.battle.label": "Active contract",
  "contract.battle.objectiveLabel": "Objective",
  "contract.battle.objective.none": "No authored objective",
  "contract.battle.objective.annihilation": "Defeat every hostile",
  "contract.battle.objective.rout": "Break the enemy ({count} out of action)",
  "contract.battle.objective.survive": "Hold out for {count} turns",
  "contract.battle.objective.capture": "Seize the marked ground",
  "contract.battle.objective.defend": "Hold the marked ground for {count} turns",
  "contract.battle.hold": "Hold position",
  "contract.battle.resolve": "Commit the company",
  "contract.result.label": "After-action report",
  "contract.result.victory": "The company holds the field",
  "contract.result.defeat": "The company quits the field",
  "contract.result.draw": "The action ends in a draw",
  "contract.result.day": "Day {before} → {after}",
  "contract.result.crowns": "{before} → {after} Crowns",
  "contract.result.honours": "{before} → {after} Honours",
  "contract.result.dismiss": "Return to the Mess",
  "skirmish.label": "Quick Battle",
  "skirmish.resultLabel": "Quick Battle result",
  "skirmish.restart": "Fight again",

  /* Depot */
  "depot.label": "Depot",
  "depot.storesLabel": "Quartermaster's Stores",
  "depot.theRoad": "the road",
  "depot.powerRegion": "{power} · {region}",
  "depot.depotsLabel": "Depots",
  "depot.stockLabel": "Depot stock",
  "depot.reserveLabel": "Company reserve",
  "depot.ledgerLabel": "Ledger",
  "depot.buyHeader": "Buy",
  "depot.sellHeader": "Sell",
  "depot.boughtLog": "Bought {item} for {price}.",
  "depot.soldLog": "Sold {item} for {price}.",
  "depot.tier.favoured": "Favoured",
  "depot.tier.standard": "Standard",
  "depot.tier.foreign": "Foreign",

  /* Campaign map */
  "campaign.label": "Campaign Map",
  "campaign.placedCount": "{placed} / {total}",
  "campaign.slotsLabel": "Campaign slots",
  "campaign.emptySlotAria": "Empty slot {x}, {y}",
  "campaign.markerAria": "{name} at {x}, {y}",
  "campaign.markersLabel": "Campaign markers",
  "campaign.selectedLabel": "Selected location",
  "campaign.pickMarker": " — pick a marker, then click here to place it.",
  "campaign.placeMarker": " — click again to place the selected marker.",
  "campaign.alreadyHunted": "Already hunted",
  "campaign.treasureHunt": "Treasure hunt",
  "campaign.dispatchLogLabel": "Dispatch log",
  "campaign.nothingFound": "nothing but empty ground",
  "campaign.placedLog": "Placed {marker} ({terrain}).",
  "campaign.alreadyAtLog": "Already at {name}.",
  "campaign.marchedLog": {
    one: "Marched {count} day to {name}.",
    other: "Marched {count} days to {name}.",
  },
  "campaign.huntLog": "Treasure hunt at {name}: {spoils}.",

  /* Posts / barracks */
  "posts.label": "Change post",
  "posts.levelLine": "{power} · Level {level}",
  "posts.roleTreeHeading": "Role tree — {power}",
  "posts.currentBadge": "Current",
  "posts.unlockedBadge": "Unlocked",
  "posts.lockedBadge": "Locked",
  "posts.setPrimary": "Set primary",
  "posts.primaryButton": "Primary",
  "posts.requirement": "Requires {abilities} from {post} ({have}/{required})",
  "posts.skillsetLabel": "Action skillset",
  "posts.drillProgressLabel": "Drill progress",
  "posts.statsLabel": "Derived stats",
  "posts.statsHeading": "Stats — {post}",
  "posts.kitSuffix": "{post} Kit",

  /* Saves */
  "saves.label": "Saves",
  "saves.campaignLabel": "{company} · Day {day}",
  "saves.empty": "Empty",
  "saves.noAutosave": "No autosave yet",
  "saves.autosaveLabel": "Autosave",
  "saves.slotsLabel": "Save slots",
  "saves.exportLabel": "Export",
  "saves.exportJsonLabel": "Exported campaign JSON",
  "saves.importLabel": "Import",
  "saves.importJsonLabel": "Campaign JSON to import",
  "saves.ledgerLabel": "Ledger",
  "saves.ledger.autosaveFailed": "Autosave failed: {error}",
  "saves.ledger.filed": "Filed {label} in {slot}.",
  "saves.ledger.saveFailed": "Could not save to {slot}: {error}",
  "saves.ledger.emptySlot": "{slot} is empty.",
  "saves.ledger.restored": "Restored {slot} — {label}.",
  "saves.ledger.loadFailed": "Could not load {slot}: {error}",
  "saves.ledger.struck": "Struck {slot}.",
  "saves.ledger.alreadyEmpty": "{slot} was already empty.",
  "saves.ledger.strikeFailed": "Could not strike {slot}: {error}",
  "saves.ledger.autosaved": "Autosaved {label}.",
  "saves.ledger.exported": "Exported {label} as JSON.",
  "saves.ledger.imported": "Imported {label} from JSON.",
  "saves.ledger.importRejected": "Import rejected: {error}",

  /* Settings */
  "settings.label": "Settings",
  "settings.textSpeedLabel": "Text speed",
  "settings.speed.slow": "Slow",
  "settings.speed.normal": "Normal",
  "settings.speed.fast": "Fast",
  "settings.speed.instant": "Instant",
  "settings.speedNote.slow": "Messages crawl; every word lands.",
  "settings.speedNote.normal": "The standard drumbeat of the dispatches.",
  "settings.speedNote.fast": "Crisp, clipped orders.",
  "settings.speedNote.instant": "No waiting — the whole message at once.",
  "settings.paletteAria": "{palette} swatches",
  "settings.restoreLabel": "Restore defaults",
  "settings.keybind.up": "March north",
  "settings.keybind.down": "March south",
  "settings.keybind.left": "March west",
  "settings.keybind.right": "March east",
  "settings.keybind.confirm": "Confirm order",
  "settings.keybind.cancel": "Cancel / back",
  "settings.keybind.orders": "Open Orders",
  "settings.keybind.menu": "Open camp",
  "settings.key.space": "Space",
  "settings.key.arrowUp": "↑ Up",
  "settings.key.arrowDown": "↓ Down",
  "settings.key.arrowLeft": "← Left",
  "settings.key.arrowRight": "→ Right",
  "settings.palette.off.name": "Issue palette",
  "settings.palette.off.note": "The full army colours — friend, foe and neutral read at a glance.",
  "settings.palette.protanopia.name": "Martian (red-weak)",
  "settings.palette.protanopia.note": "Red and green kept apart by brightness and shape.",
  "settings.palette.deuteranopia.name": "Grass (green-weak)",
  "settings.palette.deuteranopia.note": "Green and red distinguished by a blue-safe pair.",
  "settings.palette.tritanopia.name": "Violet (blue-weak)",
  "settings.palette.tritanopia.note": "Blue and green separated by a warm-to-cool ramp.",

  /* Forecast */
  "forecast.label": "Battle forecast",
  "forecast.noTarget": "No soldier in the footprint",
  "forecast.rejectionFallback": "This order cannot be aimed there.",
  "forecast.possible": "(possible)",

  /* Orders Tempo */
  "tempo.entryMeta": "{role} · {power} · Speed {speed} · {side}",
  "tempo.entryAria": "{rank}. {name}, {role}, {power}",
  "tempo.entryCharge": "charge {charge} of {threshold}",

  /* Tutorial */
  "tutorial.label": "Tutorial exercise",
  "tutorial.projectedLabel": "Projected turn order",
  "tutorial.articlesLabel": "Articles of War",
  "tutorial.drillByKitLabel": "Drill by kit",
  "tutorial.drillFraction": "{drill} / {required} Drill",

  /* Screen-reader descriptions */
  "a11y.side.company": "free company",
  "a11y.side.enemy": "hostile",
  "a11y.side.neutral": "neutral",
  "a11y.facing.north": "north",
  "a11y.facing.east": "east",
  "a11y.facing.south": "south",
  "a11y.facing.west": "west",
  "a11y.unit.level": "level {level}",
  "a11y.unit.strength": "strength {hp} of {maxHp}",
  "a11y.unit.elan": "Élan {mp} of {maxMp}",
  "a11y.unit.honour": "Honour {honour}",
  "a11y.unit.facing": "facing {facing}",
  "a11y.unit.tile": "tile {x}, {y}",
  "a11y.unit.conditions": "conditions {conditions}",
  "a11y.event.moved": "{name} marches to tile {x}, {y}",
  "a11y.event.shoved": "{name} is driven back",
  "a11y.event.faced": "{name} turns to face {facing}",
  "a11y.event.volleyStarted": "{name} opens a volley with {honour} Honour",
  "a11y.event.volleyChained": "{name} chains into the volley",
  "a11y.event.guardSortie": "{name} calls a Guard Sortie",
  "a11y.event.damaged": "{name} takes {amount} damage",
  "a11y.event.damagedFatal": "{name} takes {amount} damage and is out of action",
  "a11y.event.healed": "{name} recovers {amount} strength",
  "a11y.event.missed": "{name} avoids the attack",
  "a11y.event.outOfAction": "{name} is out of action",
  "a11y.event.revived": "{name} is revived",
  "a11y.event.elanChanged": "{name} Élan {delta}",
  "a11y.event.honourChanged": "{name} Honour {delta}",
  "a11y.event.conditionApplied": "{name} is affected by {condition}",
  "a11y.event.conditionRemoved": "{name} recovers from {condition}",
  "a11y.event.drillGained": "{name} gains {amount} Drill",
  "a11y.event.abilityLearned": "{name} masters an ability",
  "a11y.event.experienceGained": "{name} gains {amount} experience",
  "a11y.event.levelUp": "{name} reaches level {level}",
  "a11y.event.postUnlocked": "{name} unlocks a new post",
  "a11y.event.articleBroken": "{name} breaks an Article of War",
  "a11y.event.reprimand": "{name} is issued a Reprimand",
  "a11y.event.courtMartial": "{name} is court-martialled and leaves the field",
  "a11y.event.commended": "{name} is commended with {honour} Honour",
  "a11y.event.battleEnded": "The battle has ended: {outcome}",
  "a11y.event.rewardGranted": "The company is awarded {crowns} Crowns",
} as const satisfies MessageCatalog;

/** The strong key union derived from the English catalog. */
export type MessageKey = keyof typeof en;

/* --------------------------------------------------------------------------
 * Locales
 * ------------------------------------------------------------------------ */

/** The locale every other catalog falls back to. */
export const DEFAULT_LOCALE = "en";

/** The locale shipped in this build (a QA pseudo-locale is derived from `en`). */
export const SUPPORTED_LOCALES = ["en", "pseudo"] as const;

/** Human-readable names for the built-in locales. */
export const LOCALE_NAMES: Readonly<Record<string, string>> = {
  en: "English",
  pseudo: "Pseudo (QA)",
};

/* --------------------------------------------------------------------------
 * Pseudolocalization
 * ------------------------------------------------------------------------ */

const PSEUDO_LETTERS: Readonly<Record<string, string>> = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "ð",
  e: "é",
  f: "ƒ",
  g: "ğ",
  h: "ĥ",
  i: "í",
  j: "ĵ",
  k: "ķ",
  l: "ļ",
  m: "ɱ",
  n: "ñ",
  o: "ó",
  p: "þ",
  q: "q",
  r: "ŕ",
  s: "š",
  t: "ţ",
  u: "ú",
  v: "v",
  w: "ŵ",
  x: "ẋ",
  y: "ý",
  z: "ž",
  A: "Á",
  B: "Ɓ",
  C: "Ç",
  D: "Ð",
  E: "É",
  F: "Ƒ",
  G: "Ğ",
  H: "Ĥ",
  I: "Í",
  J: "Ĵ",
  K: "Ķ",
  L: "Ļ",
  M: "Ṁ",
  N: "Ñ",
  O: "Ó",
  P: "Þ",
  Q: "Q",
  R: "Ŕ",
  S: "Š",
  T: "Ţ",
  U: "Ú",
  V: "V",
  W: "Ŵ",
  X: "Ẋ",
  Y: "Ý",
  Z: "Ž",
};

/**
 * Pseudo-localize a template: accent every letter and wrap the result in
 * `⟦…⟧`. Interpolation placeholders (`{count}`) are preserved so the result
 * still resolves. Used by the `pseudo` QA locale to flush out copy that never
 * went through a key.
 */
export function pseudolocalize(text: string): string {
  const placeholders: string[] = [];
  // Private-use sentinels keep placeholders out of the letter mapping without
  // tripping the `no-control-regex` lint rule.
  const tokenized = text.replace(/\{(\w+)\}/g, (_match, name: string) => {
    placeholders.push(name);
    return `\uE000${placeholders.length - 1}\uE001`;
  });
  const mapped = tokenized.replace(/[a-zA-Z]/g, (letter) => PSEUDO_LETTERS[letter] ?? letter);
  const restored = mapped.replace(
    /\uE000(\d+)\uE001/g,
    (_match, index: string) => `{${placeholders[Number(index)]}}`,
  );
  return `⟦${restored}⟧`;
}

function pseudolocalizeCatalog(source: MessageCatalog): MessageCatalog {
  const out: Record<string, Message> = {};
  for (const [key, message] of Object.entries(source)) {
    if (typeof message === "string") {
      out[key] = pseudolocalize(message);
    } else {
      const forms: Record<string, string> = {};
      for (const [category, value] of Object.entries(message)) {
        if (typeof value === "string") forms[category] = pseudolocalize(value);
      }
      out[key] = forms;
    }
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Catalog registry
 * ------------------------------------------------------------------------ */

const builtinCatalogs: Readonly<Record<string, MessageCatalog>> = {
  en,
  pseudo: pseudolocalizeCatalog(en),
};

let catalogs: Record<string, MessageCatalog> = { ...builtinCatalogs };

/** Return the catalog for a locale, or `undefined` when none is registered. */
export function catalogFor(locale: string): MessageCatalog | undefined {
  return catalogs[locale];
}

/**
 * Register (or replace) the catalog for a locale. Author a partial catalog and
 * omit keys the translation does not cover yet — lookups fall back to the
 * default locale.
 */
export function registerLocale(locale: string, catalog: MessageCatalog): void {
  catalogs = { ...catalogs, [locale]: catalog };
}

/** True when a locale has been registered (built-in or via `registerLocale`). */
export function isLocaleAvailable(locale: string): boolean {
  return Object.prototype.hasOwnProperty.call(catalogs, locale);
}

/** Every registered locale tag, built-ins first. */
export function availableLocales(): string[] {
  return Object.keys(catalogs);
}

/* --------------------------------------------------------------------------
 * Current locale + subscription
 * ------------------------------------------------------------------------ */

type LocaleListener = (locale: string) => void;

const listeners = new Set<LocaleListener>();
let currentLocale = DEFAULT_LOCALE;

/** The active locale. */
export function getLocale(): string {
  return currentLocale;
}

/**
 * Switch the active locale. Unknown locales are ignored (the current locale is
 * kept), the change is idempotent, and every subscriber is notified once.
 */
export function setLocale(locale: string): void {
  if (locale === currentLocale) return;
  if (!isLocaleAvailable(locale)) return;
  currentLocale = locale;
  for (const listener of listeners) listener(locale);
}

/** Subscribe to locale changes; returns an unsubscribe function. */
export function subscribe(listener: LocaleListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Pick the best supported locale from an ordered list of preferences (e.g.
 * `navigator.languages`). Matches exact tags first, then the primary subtag
 * (`en-GB` → `en`), then falls back to {@link DEFAULT_LOCALE}.
 */
export function matchSupportedLocale(preferences: readonly string[]): string {
  for (const preference of preferences) {
    if (isLocaleAvailable(preference)) return preference;
  }
  for (const preference of preferences) {
    const primary = preference.split("-")[0];
    if (primary !== undefined && isLocaleAvailable(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/* --------------------------------------------------------------------------
 * Missing-key reporting
 * ------------------------------------------------------------------------ */

const missing = new Set<string>();
let onMissingKey: ((locale: string, key: string) => void) | undefined;

/**
 * Called whenever a lookup cannot be resolved in any catalog. The renderer and
 * tests can hook this to fail fast; by default the key itself is returned.
 */
export function setMissingKeyHandler(
  handler: ((locale: string, key: string) => void) | undefined,
): void {
  onMissingKey = handler;
}

function recordMissing(locale: string, key: string): void {
  missing.add(`${locale}:${key}`);
  onMissingKey?.(locale, key);
}

/** Every unresolved `locale:key` pair seen since the last clear. */
export function missingKeys(): string[] {
  return [...missing];
}

/** Forget the recorded missing keys. */
export function clearMissingKeys(): void {
  missing.clear();
}

/* --------------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------------ */

/** Locale-aware number formatting that degrades gracefully for QA locales. */
export function formatNumber(value: number, locale: string = currentLocale): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return new Intl.NumberFormat(DEFAULT_LOCALE).format(value);
  }
}

/** Locale-aware list formatting (`a, b and c`). */
export function formatList(items: readonly string[], locale: string = currentLocale): string {
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return new Intl.ListFormat(DEFAULT_LOCALE, { style: "long", type: "conjunction" }).format(
      items,
    );
  }
}

/* --------------------------------------------------------------------------
 * Lookup + interpolation
 * ------------------------------------------------------------------------ */

function pluralCategory(count: number, locale: string): PluralCategory {
  try {
    return new Intl.PluralRules(locale).select(count) as PluralCategory;
  } catch {
    return new Intl.PluralRules(DEFAULT_LOCALE).select(count) as PluralCategory;
  }
}

function selectMessage(
  message: Message | undefined,
  locale: string,
  vars: TranslationVars,
): string | null {
  if (message === undefined) return null;
  if (typeof message === "string") return message;
  const count = vars["count"];
  if (typeof count !== "number") {
    return message.other ?? Object.values(message)[0] ?? null;
  }
  return message[pluralCategory(count, locale)] ?? message.other ?? null;
}

/**
 * Substitute `{name}` placeholders. Numbers are formatted with the locale's
 * `Intl.NumberFormat`; unknown placeholders are left untouched so a typo is
 * visible rather than silently blank.
 */
export function interpolate(
  template: string,
  vars: TranslationVars = {},
  locale: string = currentLocale,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(value, locale) : String(value);
  });
}

/**
 * Resolve a key for a specific locale, falling back through
 * {@link DEFAULT_LOCALE}. Unresolved keys are recorded via {@link missingKeys}
 * and returned verbatim.
 */
export function translate(
  locale: string,
  key: string,
  vars: TranslationVars = {},
  override?: Record<string, MessageCatalog>,
): string {
  const registry = override ?? catalogs;
  const selected =
    selectMessage(registry[locale]?.[key], locale, vars) ??
    selectMessage(registry[DEFAULT_LOCALE]?.[key], DEFAULT_LOCALE, vars);
  if (selected === null) {
    recordMissing(locale, key);
    return key;
  }
  return interpolate(selected, vars, locale);
}

/** The active translator: a thin wrapper over {@link translate}. */
export function t(key: MessageKey, vars?: TranslationVars): string {
  return translate(currentLocale, key, vars);
}

/** A translator bound to one locale, independent of the global locale. */
export function createTranslator(locale: string): Translator {
  return (key, vars) => translate(locale, key, vars);
}

/** True when the locale's catalog (or the fallback) defines a key. */
export function hasKey(locale: string, key: string): boolean {
  return catalogs[locale]?.[key] !== undefined || catalogs[DEFAULT_LOCALE]?.[key] !== undefined;
}

/** The keys defined directly in a locale's own catalog. */
export function listKeys(locale: string = DEFAULT_LOCALE): string[] {
  return Object.keys(catalogs[locale] ?? {});
}

/* --------------------------------------------------------------------------
 * Test / lifecycle helpers
 * ------------------------------------------------------------------------ */

/**
 * Restore the module to its startup state: drop any locales registered at
 * runtime, reset to {@link DEFAULT_LOCALE} and clear the missing-key log.
 * Intended for tests, not the running game.
 */
export function resetI18n(): void {
  catalogs = { ...builtinCatalogs };
  currentLocale = DEFAULT_LOCALE;
  clearMissingKeys();
  onMissingKey = undefined;
}

/* --------------------------------------------------------------------------
 * React binding
 * ------------------------------------------------------------------------ */

/**
 * React binding for the i18n store. Re-renders the component whenever
 * {@link setLocale} runs and returns a memoized translator plus the active
 * locale.
 */
export function useTranslation(): {
  readonly t: Translator;
  readonly locale: string;
  readonly setLocale: (locale: string) => void;
} {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  const translator = useCallback<Translator>((key, vars) => translate(locale, key, vars), [locale]);
  return { t: translator, locale, setLocale };
}

/** The full English catalog, exposed for tooling (coverage checks, exports). */
export const enMessages: MessageCatalog = en;
