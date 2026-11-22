# todo.md — Lines of Glory task board

> **Machine-readable.** This file is parsed and updated by `tools/todo.mjs`
> (see `tools/README.md`). Keep the format exact:
>
> - Phases are `## <Phase name>` headings.
> - Tasks are `### TNNN — Title` headings (three digits, unique).
> - Each task has bullet metadata: `status`, `deps`, `verify`, `done`, and
>   optionally `files`. **One bullet per line** (no wrapped values).
> - `status` ∈ `todo | doing | done | blocked | failed | skipped`.
> - `deps` is `[]` or `[T001, T002]`; a task is *actionable* only when every
>   dependency is `done`.
> - `verify` is a single shell command the runner executes to accept the task
>   (use `—` when there is nothing to run).
> - Free prose after the bullets is the task description; the runner includes it
>   in the prompt it hands to the coding agent.
> - This comment block is ignored by the parser.

Legend: `todo` · `doing` · `done` · `blocked` · `failed` · `skipped`
Milestones: **MVP** = Phases 0–6 · **Beta** = 7–10 · **Polish** = 11 · **Stretch** = 12

---

## Phase 0 — Foundation

### T001 — Bootstrap Vite + React + TypeScript (strict)
- status: done
- deps: []
- files: package.json, tsconfig.json, vite.config.ts, index.html, src/main.tsx
- verify: npm run build
- done: `npm run dev` serves a placeholder battlefield page; `npm run build` passes.

Initialise the project with Vite, React and TypeScript in `strict` mode. Add the
core npm scripts (`dev`, `build`, `preview`, `typecheck`). No game logic yet.

### T002 — Lint & format tooling
- status: done
- deps: [T001]
- files: eslint.config.js, .prettierrc, package.json
- verify: npm run lint
- done: `npm run lint` and `npm run format:check` both pass on the scaffold.

Add ESLint (typescript-eslint) + Prettier with `lint`, `format`, `format:check`
scripts. Enforce no `any` without an inline justification comment.

### T003 — Vitest unit-test setup
- status: done
- deps: [T001]
- files: vitest.config.ts, tests/unit/smoke.test.ts
- verify: npm run test -- --run tests/unit/smoke.test.ts
- done: `npm run test -- --run` runs and passes a smoke test.

Configure Vitest for `tests/unit` and `src/**/*.test.ts`. Add the one-shot test
script used by CI.

### T004 — Playwright e2e setup
- status: done
- deps: [T001]
- files: playwright.config.ts, tests/e2e/smoke.spec.ts
- verify: npm run test:e2e -- tests/e2e/smoke.spec.ts
- done: A smoke spec loads the dev/preview page and asserts the canvas exists.

Configure Playwright with a preview-server webServer entry and one smoke spec.

### T005 — Source layer skeleton + import boundaries
- status: done
- deps: [T001]
- files: src/engine/, src/data/, src/ai/, src/app/, src/render/, src/ui/, src/persist/
- verify: npm run typecheck
- done: Empty modules exist per `agents.md` §6; an ESLint rule forbids `src/engine` importing from `render`/`ui`/`app`.

### T006 — Netlify build config
- status: done
- deps: [T001, T002, T003]
- files: netlify.toml, .nvmrc, .gitignore
- verify: npm run build
- done: netlify.toml builds `npm run build` into `dist` with an SPA redirect and a pinned Node version (`.nvmrc`); CI/deploys are handled by Netlify (user-managed).

### T007 — Placeholder battlefield canvas + HUD shell
- status: done
- deps: [T001, T005]
- files: src/render/scene.ts, src/ui/App.tsx, src/main.tsx
- verify: npm run build
- done: A blank isometric-styled grid renders behind a DOM HUD shell.

### T008 — Data schema (rethemed) + Zod validation
- status: done
- deps: [T001, T005]
- files: src/data/schema.ts, src/data/README.md
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Zod schemas define Post, Ability, Equipment, Enemy, Article, Contract, Element, Condition; keys are FFTA-shaped with `name`/`description`/`flavour` display fields.

### T009 — Data integrity test (no `TBD` names)
- status: done
- deps: [T008]
- files: tests/unit/data.test.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Every loaded data def has a non-empty Napoleonic `name` and no `TBD`/placeholder strings.

### T010 — README + docs wiring
- status: done
- deps: [T001]
- files: README.md
- verify: —
- done: README explains the game, links `agents.md`, `docs/NAPOLEONIC_MAPPING.md`, `site/index.html`, and how to run the todo tool.

---

## Phase 1 — Deterministic engine foundation

### T011 — Seeded PRNG
- status: done
- deps: [T001, T005]
- files: src/engine/rng.ts, tests/unit/rng.test.ts
- verify: npm run test -- --run tests/unit/rng.test.ts
- done: Same seed + call sequence yields identical values; RNG state is serialisable. No `Math.random` anywhere in `src/engine`.

### T012 — Branded ID types
- status: done
- deps: [T001]
- files: src/engine/ids.ts
- verify: npm run typecheck
- done: `UnitId`, `PostId`, `AbilityId`, `ContractId`, etc. are branded strings with helpers.

### T013 — Coordinates & grid model
- status: done
- deps: [T011, T012]
- files: src/engine/grid.ts, tests/unit/grid.test.ts
- verify: npm run test -- --run tests/unit/grid.test.ts
- done: Square-isometric grid of tiles with bounds checks, neighbours and cardinal facing.

### T014 — Terrain & elevation
- status: done
- deps: [T013]
- files: src/engine/terrain.ts
- verify: npm run test -- --run tests/unit/grid.test.ts
- done: Tile terrain types (field, wood, village, river, redoubt...) and height with passability and move-cost data.

### T015 — Pathfinding (A*)
- status: done
- deps: [T013, T014]
- files: src/engine/pathfinding.ts, tests/unit/pathfinding.test.ts
- verify: npm run test -- --run tests/unit/pathfinding.test.ts
- done: A* returns least-cost paths honouring terrain cost, elevation climb limit and occupied tiles.

### T016 — Range & line of sight
- status: done
- deps: [T013, T014]
- files: src/engine/targeting.ts, tests/unit/targeting.test.ts
- verify: npm run test -- --run tests/unit/targeting.test.ts
- done: Range checks and LoS blocking by terrain/elevation verified by tests.

### T017 — Unit model
- status: done
- deps: [T012, T013]
- files: src/engine/unit.ts
- verify: npm run test -- --run tests/unit/unit.test.ts
- done: Units carry power, post, level, stats, HP, Élan, Honour, facing, conditions, equipment, learned abilities.

### T018 — Derived stats
- status: done
- deps: [T017, T008]
- files: src/engine/stats.ts, tests/unit/stats.test.ts
- verify: npm run test -- --run tests/unit/stats.test.ts
- done: Effective stats = base growth × level + post modifiers + equipment, fully data-driven.

### T019 — Orders Tempo (CTB scheduler)
- status: done
- deps: [T017, T011]
- files: src/engine/turn.ts, tests/unit/turn.test.ts
- verify: npm run test -- --run tests/unit/turn.test.ts
- done: Integer charge ticks; higher Speed acts sooner/more often; deterministic given a seed.

### T020 — Command types
- status: done
- deps: [T012]
- files: src/engine/commands.ts
- verify: npm run typecheck
- done: Discriminated-union Commands (move, act, wait, face, hold, use-volley, guard-sortie...) are serialisable.

### T021 — Event types
- status: done
- deps: [T012]
- files: src/engine/events.ts
- verify: npm run typecheck
- done: Events describe everything the renderer needs (moved, damaged, condition applied, article broken, ability learned...).

### T022 — Battle create/step
- status: done
- deps: [T013, T017, T019, T020, T021]
- files: src/engine/battle.ts, tests/unit/battle.test.ts
- verify: npm run test -- --run tests/unit/battle.test.ts
- done: `createBattle(seed, setup)` and `step(state, command) -> {state, events}`; invalid commands are rejected without mutation.

### T023 — State serialise + hash + determinism test
- status: done
- deps: [T022]
- files: src/engine/serialize.ts, tests/unit/determinism.test.ts
- verify: npm run test -- --run tests/unit/determinism.test.ts
- done: A scripted battle replayed from seed + command log produces an identical state hash.

---

## Phase 2 — Battle core + first render

### T024 — Action resolution pipeline
- status: done
- deps: [T022]
- files: src/engine/actions/resolve.ts
- verify: npm run test -- --run tests/unit/battle.test.ts
- done: Declare → charge → resolve → end-turn → advance tempo, all via events.

### T025 — Move command
- status: done
- deps: [T015, T024]
- files: src/engine/actions/move.ts
- verify: npm run test -- --run tests/unit/move.test.ts
- done: Path validation, cost, elevation/jump, and movement events.

### T026 — Wait / Facing / Hold
- status: done
- deps: [T024]
- files: src/engine/actions/basic.ts
- verify: npm run test -- --run tests/unit/move.test.ts
- done: Wait, change facing, and Hold (brace) actions resolve correctly.

### T027 — Battle UI state machine
- status: done
- deps: [T024]
- files: src/app/battleController.ts
- verify: npm run test -- --run tests/unit/battleController.test.ts
- done: Select unit → show move range → move → choose action → target → confirm; state exposed to UI.

### T028 — Targeting system
- status: done
- deps: [T016, T020]
- files: src/engine/targeting.ts
- verify: npm run test -- --run tests/unit/targeting.test.ts
- done: Single/AoE/self/ally/enemy target predicates with range and LoS.

### T029 — PixiJS isometric renderer (grid + camera)
- status: done
- deps: [T007, T013]
- files: src/render/scene.ts, src/render/tiles.ts
- verify: npm run build
- done: Terrain, elevation and grid render isometrically with pan/zoom.

### T030 — Input controller + path preview
- status: done
- deps: [T025, T029]
- files: src/app/input.ts, src/render/overlay.ts, tests/e2e/input.spec.ts
- verify: npm run test:e2e -- tests/e2e/input.spec.ts
- done: Mouse/touch/keyboard select tiles; move range and path preview render.

### T031 — Win/lose conditions
- status: done
- deps: [T022]
- files: src/engine/objectives.ts
- verify: npm run test -- --run tests/unit/battle.test.ts
- done: Annihilation, rout, survive-N, capture/defend objectives; battle-end event.

### T032 — Movement & targeting tests
- status: done
- deps: [T025, T028]
- files: tests/unit/movement.test.ts
- verify: npm run test -- --run tests/unit/movement.test.ts
- done: Edge cases for blocked paths, AoE shapes, and elevation in LoS.

### T115 — Native move-and-act turn
- status: done
- deps: [T024, T025]
- files: src/engine/battle.ts, src/app/battleController.ts
- verify: npm run test -- --run tests/unit/battle.test.ts
- done: A turn may move and then act without spending Orders Tempo on the move, so the controller stops composing `applyMove` and the move stays a real command in the log.

Today `step` ends the Orders Tempo turn for **every** command, so the battle UI
controller (T027) has to compose the FFTA free move (`applyMove`) before
committing the action through `step`. Promote that into the engine: let a `move`
command leave the actor's turn open until an `act` / `wait` / `hold` order (or an
explicit end-turn) closes it, keeping the command log replayable and
deterministic.

---

## Phase 3 — Combat, actions, conditions

### T033 — Steel (physical) damage
- status: done
- deps: [T024, T018]
- files: src/engine/rules/damage.ts, tests/unit/damage.test.ts
- verify: npm run test -- --run tests/unit/damage.test.ts
- done: `WeaponAtk − TargetWeaponDef/2`, then × `Power/100`, data-driven; ambiguous secondary line from the wiki resolved and documented.

### T034 — Powder (magical) damage
- status: done
- deps: [T033]
- files: src/engine/rules/damage.ts
- verify: npm run test -- --run tests/unit/damage.test.ts
- done: `MagicPower − TargetMagicRes/2`, then × `Power/100`.

### T035 — Weapon-type variants
- status: done
- deps: [T033]
- files: src/data/weapons.ts
- verify: npm run test -- --run tests/unit/damage.test.ts
- done: Variant formulas (sabre, lance, rifle, gun, instrument...) from `Attack_(command).md`.

### T036 — Healing formula
- status: done
- deps: [T033]
- files: src/engine/rules/damage.ts
- verify: npm run test -- --run tests/unit/damage.test.ts
- done: A documented healing formula (authored, since the wiki does not specify one).

### T037 — Hit, evasion & facing
- status: done
- deps: [T033, T013]
- files: src/engine/rules/hit.ts
- verify: npm run test -- --run tests/unit/hit.test.ts
- done: Hit chance with front/side/rear facing modifiers, seeded.

### T038 — Elements
- status: done
- deps: [T033]
- files: src/engine/rules/elements.ts, src/data/elements.ts
- verify: npm run test -- --run tests/unit/elements.test.ts
- done: Eight reflavoured elements with weak/resist/absorb and damage modification.

### T039 — Condition (status) engine
- status: done
- deps: [T017, T024]
- files: src/engine/rules/conditions.ts, src/data/conditions.ts, src/data/schema.ts, tests/unit/conditions.test.ts
- verify: npm run test -- --run tests/unit/conditions.test.ts
- done: Apply/stack/expire/tick for all mapped conditions (Bleeding, Dazed, Deafened, Pinned, Formed, Braced...).

### T040 — Élan resource + morale
- status: done
- deps: [T017, T039]
- files: src/engine/rules/elan.ts
- verify: npm run test -- --run tests/unit/elan.test.ts
- done: Élan is spent by actions and regenerates on a tunable schedule; low Élan applies Shaken and zero applies Routed.

### T041 — Action executor
- status: done
- deps: [T033, T034, T038, T039]
- files: src/engine/actions/ability.ts
- verify: npm run test -- --run tests/unit/ability.test.ts
- done: Executes data-defined actions: physical, ranged, artillery, medical, buffs, debuffs, drains, revival.

### T042 — Reaction abilities
- status: done
- deps: [T041]
- files: src/engine/reactions.ts
- verify: npm run test -- --run tests/unit/reactions.test.ts
- done: Trigger hooks for Riposte, Return Fire, Dodge, Field Dressing.

### T043 — Support traits
- status: done
- deps: [T041]
- files: src/engine/traits.ts
- verify: npm run test -- --run tests/unit/traits.test.ts
- done: Passive modifiers (Thrift, Drilled Guards, Two-Handed Grip...) via composable hooks.

### T044 — Shove (knockback)
- status: done
- deps: [T015, T033]
- files: src/engine/rules/shove.ts
- verify: npm run test -- --run tests/unit/shove.test.ts
- done: Push/pull with collision and elevation handling.

### T045 — Combat tests
- status: done
- deps: [T033, T041, T042, T043, T044]
- files: tests/unit/combat.test.ts
- verify: npm run test -- --run tests/unit/combat.test.ts
- done: Damage tiers, element interactions, condition lifecycle, reactions and traits covered.

---

## Phase 4 — Progression: posts, Drill, kit, leveling

### T046 — Post (job) definition
- status: done
- deps: [T008]
- files: src/data/posts.ts
- verify: npm run test -- --run tests/unit/posts.test.ts
- done: `PostDef` with power restriction, stat growth, usable kit, skill sets and unlock requirements.

### T047 — Author powers & role trees
- status: done
- deps: [T046]
- files: src/data/posts/*.ts
- verify: npm run test -- --run tests/unit/posts.test.ts
- done: All five powers and their role trees authored (≥ 25 posts, names from the mapping doc).

### T048 — Drill learning from kit
- status: done
- deps: [T046, T050]
- files: src/engine/progression/drill.ts, tests/unit/drill.test.ts
- verify: npm run test -- --run tests/unit/drill.test.ts
- done: Abilities are bound to equipment; battle awards Drill distributed to equipped unmastered abilities; mastery is permanent.

### T049 — XP & level growth
- status: done
- deps: [T018, T046]
- files: src/engine/progression/level.ts
- verify: npm run test -- --run tests/unit/level.test.ts
- done: XP from actions/KOs; level-ups apply power/post stat growth.

### T050 — Equipment model
- status: done
- deps: [T008]
- files: src/data/equipment.ts
- verify: npm run test -- --run tests/unit/equipment.test.ts
- done: Weapons, uniforms/armour and accessories with stat mods, taught abilities (Drill cost), elements and on-hit conditions.

### T051 — Primary / attached post
- status: done
- deps: [T046, T050]
- files: src/engine/progression/posts.ts
- verify: npm run test -- --run tests/unit/posts.test.ts
- done: Stats from primary post; skill set choice from any mastered post; reaction/trait/volley slots.

### T052 — Post-change screen
- status: done
- deps: [T051]
- files: src/ui/PostScreen.tsx, tests/e2e/postScreen.spec.ts
- verify: npm run test:e2e -- tests/e2e/postScreen.spec.ts
- done: UI gates post changes by unlock requirements and shows drill progress.

### T053 — Progression validation + tests
- status: done
- deps: [T047, T048, T049, T051]
- files: tests/unit/progression.test.ts
- verify: npm run test -- --run tests/unit/progression.test.ts
- done: Unlock rules, Drill distribution, growth and equip legality covered.

---

## Phase 5 — Articles of War & the Provost

### T054 — Article definition
- status: done
- deps: [T008]
- files: src/data/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: `ArticleDef` forbids/commends actions, elements, weapon types, posts and conditions.

### T055 — Daily orders generation
- status: done
- deps: [T054, T011]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Seeded daily Articles per campaign day, with a pool and frequency model.

### T056 — Violation detection
- status: done
- deps: [T055, T024]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Actions are checked against active Articles at resolution time.

### T057 — Reprimand / Court-Martial escalation
- status: done
- deps: [T056]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: 1st offence = Reprimand; 2nd or illegal KO = Court-Martial.

### T058 — Court-martial removal + commander game over
- status: done
- deps: [T057]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Court-martialled units leave the field; the commander's court-martial ends the battle in defeat.

### T059 — Commissions (hero medals)
- status: done
- deps: [T057]
- files: src/engine/rules/articles.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: Commissioned units are immune to Court-Martial and may break Articles freely.

### T060 — Honour economy
- status: done
- deps: [T056, T017]
- files: src/engine/rules/honour.ts
- verify: npm run test -- --run tests/unit/honour.test.ts
- done: Honour from legal KOs and commended acts; cap 10; no stacking for one event.

### T061 — Volleys (combos)
- status: done
- deps: [T060, T041]
- files: src/engine/actions/volley.ts
- verify: npm run test -- --run tests/unit/volley.test.ts
- done: Initiator spends Honour; adjacent allies chain in; damage scales with Honour spent.

### T062 — Guard Sorties
- status: done
- deps: [T060]
- files: src/engine/actions/guardSortie.ts, src/data/guards.ts
- verify: npm run test -- --run tests/unit/guardSortie.test.ts
- done: Five national Guard Sorties cost 10 Honour, hit the whole field, and must be unlocked via story.

### T063 — Standing / Counter-Orders
- status: done
- deps: [T055]
- files: src/engine/actions/orders.ts
- verify: npm run test -- --run tests/unit/orders.test.ts
- done: Cards add or nullify an Article mid-battle; max Articles enforced.

### T064 — General Orders
- status: done
- deps: [T063]
- files: src/engine/rules/generalOrders.ts
- verify: npm run test -- --run tests/unit/orders.test.ts
- done: Company privilege nullifies one active Article.

### T065 — No-Man's Land
- status: done
- deps: [T055, T022]
- files: src/engine/rules/noMansLand.ts
- verify: npm run test -- --run tests/unit/articles.test.ts
- done: No Provost or Articles; no Honour; KO is permanent; commander KO ends the campaign.

### T066 — Provost entity
- status: done
- deps: [T057]
- files: src/engine/provost.ts
- verify: npm run test -- --run tests/unit/provost.test.ts
- done: A neutral, non-combatant unit that issues cards and moves casualties.

### T067 — Article system tests
- status: done
- deps: [T055, T057, T058, T060, T061, T062]
- files: tests/unit/law.test.ts
- verify: npm run test -- --run tests/unit/law.test.ts
- done: Full violation → card → removal flow, Honour economy, Volley and Guard Sortie covered.

---

## Phase 6 — Campaign: company, contracts, map, depots

### T068 — Company model
- status: done
- deps: [T017, T046]
- files: src/engine/company.ts
- verify: npm run test -- --run tests/unit/company.test.ts
- done: Company holds roster, Crowns, Regimental Honours and current theatre state.

### T069 — Recruit & dismiss
- status: done
- deps: [T068]
- files: src/engine/company.ts
- verify: npm run test -- --run tests/unit/company.test.ts
- done: Recruit by power at recruiting offices; dismiss; roster limits.

### T070 — Contract definitions
- status: done
- deps: [T008]
- files: src/data/contracts.ts
- verify: npm run test -- --run tests/unit/contracts.test.ts
- done: Battle, Skirmish, Detachment and Pacification contracts with fees, requirements and rewards.

### T071 — Officers' Mess UI
- status: done
- deps: [T070, T068]
- files: src/ui/Mess.tsx, tests/e2e/mess.spec.ts
- verify: npm run test:e2e -- tests/e2e/mess.spec.ts
- done: Mission board with fee, requirements (item/post/unit) and reward preview.

### T072 — Detachments
- status: done
- deps: [T070, T076]
- files: src/engine/detach.ts
- verify: npm run test -- --run tests/unit/detach.test.ts
- done: Send unit(s) away for N days; resolve on return.

### T073 — Campaign Map + markers
- status: done
- deps: [T068]
- files: src/engine/campaignMap.ts, src/ui/CampaignMap.tsx
- verify: npm run test -- --run tests/unit/campaignMap.test.ts
- done: Empty map grows as Campaign Markers are placed into slots; travel and treasure hunts; rewards depend on placement.

### T074 — Locations & battle maps data
- status: done
- deps: [T013, T014]
- files: src/data/maps/*.ts
- verify: npm run test -- --run tests/unit/maps.test.ts
- done: Location/terrain data and battle map definitions validate.

### T075 — Depots (shops)
- status: done
- deps: [T050, T068]
- files: src/ui/Depot.tsx
- verify: npm run test -- --run tests/unit/depot.test.ts
- done: Buy/sell with power-specific discounts and region gating.

### T076 — Calendar & daily orders
- status: done
- deps: [T055, T068]
- files: src/engine/calendar.ts
- verify: npm run test -- --run tests/unit/calendar.test.ts
- done: Campaign date advances; Articles rotate daily; dispatch timers tick.

### T077 — Story spine
- status: done
- deps: [T070, T073]
- files: src/data/story.ts
- verify: npm run test -- --run tests/unit/story.test.ts
- done: Chapter triggers gate story contracts and unlock Guard Sorties.

### T078 — Auxiliary Barracks
- status: done
- deps: [T069]
- files: src/engine/barracks.ts
- verify: npm run test -- --run tests/unit/barracks.test.ts
- done: Capture/cajole irregulars and deploy them; Foreign Drill learns enemy actions.

### T079 — Campaign tests
- status: done
- deps: [T070, T072, T073, T075, T076]
- files: tests/unit/campaign.test.ts
- verify: npm run test -- --run tests/unit/campaign.test.ts
- done: Contract gating, dispatch timing, marker rewards and economy covered.

---

## Phase 7 — Rendering, UI & UX (Beta)

### T080 — Terrain rendering
- status: done
- deps: [T029, T014]
- files: src/render/tiles.ts
- verify: npm run build
- done: All terrain types and elevations render distinctly (fields, woods, villages, rivers, redoubts).

### T081 — Unit presentation
- status: done
- deps: [T029, T017]
- files: src/render/units.ts
- verify: npm run build
- done: Placeholder soldier sprites by power/post, facing, HP/Élan bars, condition icons, Honour indicator.

### T082 — Event-driven animations
- status: done
- deps: [T021, T081]
- files: src/render/animations.ts, tests/e2e/animations.spec.ts
- verify: npm run test:e2e -- tests/e2e/animations.spec.ts
- done: Movement, volleys, artillery and condition popups animate from engine events only.

### T083 — Orders Tempo tray
- status: done
- deps: [T019, T081]
- files: src/ui/TempoTray.tsx, src/ui/tempoOrder.ts, tests/e2e/tempoTray.spec.ts
- verify: npm run test:e2e -- tests/e2e/tempoTray.spec.ts
- done: Upcoming turn order is visualised.

### T084 — Menu suite
- status: done
- deps: [T052, T071, T075]
- files: src/ui/Menus.tsx, tests/e2e/menus.spec.ts
- verify: npm run test:e2e -- tests/e2e/menus.spec.ts
- done: Main, company, post, equipment, abilities, depot, mess and campaign-map menus.

### T085 — Targeting UX
- status: done
- deps: [T028, T030]
- files: src/render/overlay.ts, tests/e2e/targeting.spec.ts
- verify: npm run test:e2e -- tests/e2e/targeting.spec.ts
- done: Range/AoE highlight, danger zones, elevation preview.

### T086 — Battle forecast
- status: done
- deps: [T033, T037]
- files: src/ui/Forecast.tsx, tests/e2e/forecast.spec.ts
- verify: npm run test -- --run tests/unit/forecast.test.ts && npm run test:e2e -- tests/e2e/forecast.spec.ts
- done: Expected damage, hit chance and reaction risk before confirming.

### T087 — Keyboard & gamepad navigation
- status: done
- deps: [T084]
- files: src/app/input.ts
- verify: npm run test:e2e -- tests/e2e/input.spec.ts
- done: Full menu and battle navigation without a mouse; responsive layout.

---

## Phase 8 — Content pipeline & data

### T088 — Wiki → data converter
- status: done
- deps: [T008]
- files: scripts/wiki_to_data.mjs, scripts/wiki_to_data.d.mts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Converts scraped wiki tables (weapons/armour/abilities) into validated data, re-authored as our own balance.

### T089 — Ability sets per post
- status: done
- deps: [T047, T088]
- files: src/data/abilities/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Every post has a complete, validated action set.

### T090 — Equipment tables
- status: done
- deps: [T050, T088]
- files: src/data/equipment/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Full weapon/armour/accessory tables with Drill costs and taught abilities.

### T091 — Enemy roster + drops
- status: done
- deps: [T008, T047]
- files: src/data/enemies/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Irregular/auxiliary troop roster with stats, actions, drops and AI profiles.

### T092 — Battle maps
- status: done
- deps: [T014, T074]
- files: src/data/maps/*.json
- verify: npm run test -- --run tests/unit/maps.test.ts
- done: 10–20 varied battle maps with objectives.

### T093 — Article & contract pools
- status: done
- deps: [T054, T070]
- files: src/data/articles/*.ts, src/data/contracts/*.ts
- verify: npm run test -- --run tests/unit/data.test.ts
- done: Full Article-of-War card pool and contract list (main + side + dispatch + pacification).

### T094 — Content integrity test
- status: done
- deps: [T089, T090, T091, T092, T093]
- files: tests/unit/content.test.ts
- verify: npm run test -- --run tests/unit/content.test.ts
- done: All cross-references resolve; no dangling IDs; every def has a Napoleonic name.

---

## Phase 9 — AI

### T095 — Utility-based AI
- status: done
- deps: [T028, T041]
- files: src/ai/utility.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Scores targets by expected damage, kill potential, threat and positioning; issues only legal commands.

### T096 — Article-aware AI
- status: done
- deps: [T095, T056]
- files: src/ai/utility.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Avoids Article violations except for Commissioned units.

### T097 — Ability/item heuristics
- status: done
- deps: [T095]
- files: src/ai/heuristics.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Sensible heal/buff/consumable and Élan management.

### T098 — Ally auto-battle
- status: done
- deps: [T095]
- files: src/app/autoBattle.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Optional AI control for allied units.

### T099 — Difficulty tiers + perf
- status: done
- deps: [T095]
- files: src/ai/difficulty.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: Seeded aggression/mistake tiers; decision budget < 16 ms for a typical encounter.

---

## Phase 10 — Persistence & release

### T100 — SaveStore + IndexedDB
- status: done
- deps: [T005]
- files: src/persist/saveStore.ts
- verify: npm run test -- --run tests/unit/persist.test.ts
- done: A versioned `SaveStore` interface with an IndexedDB implementation and an in-memory test double.

### T101 — Save/load campaign
- status: done
- deps: [T068, T100]
- files: src/persist/campaign.ts
- verify: npm run test -- --run tests/unit/persist.test.ts
- done: Full company, map, contract and seed/history round-trip.

### T102 — Autosave, slots & export/import
- status: done
- deps: [T101]
- files: src/ui/Saves.tsx, src/ui/styles.css, tests/e2e/saves.spec.ts
- verify: npm run test:e2e -- tests/e2e/saves.spec.ts
- done: Autosave, multiple slots, JSON export/import.

### T103 — Settings
- status: done
- deps: [T100]
- files: src/ui/Settings.tsx, src/ui/settingsModel.ts, src/ui/styles.css, tests/e2e/settings.spec.ts
- verify: npm run test:e2e -- tests/e2e/settings.spec.ts
- done: Volume, text speed, damage numbers, colour-blind mode and keybinds.

### T104 — Error boundary + save migrations
- status: done
- deps: [T100]
- files: src/app/ErrorBoundary.tsx, src/persist/migrations.ts
- verify: npm run test -- --run tests/unit/persist.test.ts
- done: Graceful failures and versioned save migrations.

### T105 — Performance pass
- status: done
- deps: [T080, T081]
- files: src/render/atlas.ts
- verify: npm run build
- done: Texture atlas, lazy map loading, memory check.

### T106 — Deploy + how to play
- status: done
- deps: [T104]
- files: README.md, .github/workflows/deploy.yml
- verify: npm run build
- done: Static build deployed (Pages/Vercel/Netlify) with a player-facing how-to-play.

---

## Phase 11 — Audio, accessibility & polish

### T107 — Sound effects
- status: done
- deps: [T082]
- files: src/audio/sfx.ts
- verify: npm run build
- done: Royalty-free SFX for UI, volleys, guns and cards.

### T108 — Music
- status: done
- deps: [T107]
- files: src/audio/music.ts
- verify: npm run build
- done: Original/licensed music with volume mixing.

### T109 — Accessibility
- status: done
- deps: [T084]
- files: src/ui/a11y.ts, src/ui/App.tsx, src/ui/Settings.tsx, src/ui/styles.css, src/render/scene.ts, src/app/input.ts, tests/unit/a11y.test.ts, tests/e2e/a11y.spec.ts
- verify: npm run test -- --run tests/unit/a11y.test.ts && npm run test:e2e -- tests/e2e/a11y.spec.ts
- done: Keyboard nav, screen-reader labels, reduced-motion, colour-blind-safe palette.

### T110 — Tutorial mission
- status: done
- deps: [T071, T084]
- files: src/data/tutorial.ts, src/app/tutorial.ts, src/ui/Tutorial.tsx, src/ui/App.tsx, src/ui/styles.css, tests/unit/tutorial.test.ts, tests/e2e/tutorial.spec.ts
- verify: npm run test -- --run tests/unit/tutorial.test.ts && npm run test:e2e -- tests/e2e/tutorial.spec.ts
- done: Teaches move/act/tempo/Articles/Drill.

### T111 — i18n scaffolding
- status: done
- deps: [T010]
- files: src/i18n/index.ts, tests/unit/i18n.test.ts, src/ui/App.tsx
- verify: npm run test -- --run tests/unit/i18n.test.ts
- done: All UI strings via keys; no hard-coded copy.

### T116 — Adopt i18n keys across the remaining screens
- status: done
- deps: [T111]
- files: src/ui/Menus.tsx, src/ui/Mess.tsx, src/ui/Depot.tsx, src/ui/CampaignMap.tsx, src/ui/PostScreen.tsx, src/ui/Saves.tsx, src/ui/Settings.tsx, src/ui/Forecast.tsx, src/ui/TempoTray.tsx, src/ui/Tutorial.tsx, src/ui/a11y.ts
- verify: npm run test -- --run tests/unit/i18n.test.ts
- done: Every camp screen and the screen-reader descriptions resolve copy through `t()`; no user-facing literal remains in `src/ui`.

T111 built `src/i18n/index.ts` and moved the main shell (`src/ui/App.tsx`) onto
keys. This follow-up walks the rest of the presentation layer onto the same
catalog. Settings' option labels/notes currently live as data in
`src/ui/settingsModel.ts`, so those need keys or key references before the
screen can be fully keyed.

---

## Phase 12 — Multiplayer (stretch)

### T112 — Lockstep netcode
- status: done
- deps: [T023]
- files: src/net/lockstep.ts
- verify: npm run test -- --run tests/unit/lockstep.test.ts
- done: Deterministic command-log lockstep with state-hash desync detection.

### T113 — Lobby & matchmaking
- status: done
- deps: [T112]
- files: src/net/lobby.ts, tests/e2e/lobby.spec.ts
- verify: npm run test:e2e -- tests/e2e/lobby.spec.ts
- done: 1v1 skirmish between two free companies.

### T114 — Replays, trading & spectator
- status: done
- deps: [T112]
- files: src/net/replay.ts
- verify: npm run test -- --run tests/unit/replay.test.ts
- done: Replay a battle from seed + command log; trade kit and prisoners.

`src/net/replay.ts` builds on T112/T113: a `ReplayRecorder` captures lockstep
frames into a versioned `BattleReplay` (seed + setup + participants + frames),
`replayFinalState` re-runs the log through the pure `step` loop, and
`serializeReplay`/`parseReplay` round-trip it as validated text. A read-only
`BattleSpectator` walks or scrubs the log one command/frame at a time and
exposes state, events and hash. `resolveTrade` swaps **kit** (the
`DepotInventory` reserve) and **prisoners** (Auxiliary Barracks captives)
between two companies as pure values, with `tradeBlockers` reporting self/wrong
peer, empty, missing kit/prisoner, id-collision and overfull-pen reasons.

---

## Phase 13 — The campaign loop (playable game)

### T117 — Resolve ability effects through `step`
- status: done
- deps: [T041, T042, T043]
- files: src/engine/actions/resolve.ts, src/engine/battle.ts, tests/unit/combat.test.ts, tests/unit/determinism.test.ts
- verify: npm run test -- --run tests/unit/combat.test.ts tests/unit/determinism.test.ts
- done: An `act` committed through `step` applies its damage/healing/conditions via `executeAbility` (T041), runs reactions (T042) and support traits (T043), and yields byte-identical state for a fixed seed and command log.

`declareOrResolveAction` (`src/engine/actions/resolve.ts`) emits
`abilityUsed`/`abilityResolved` and spends Élan but never calls the executor —
see the "Ability effects are not wired into `step`" note under *Research & open
questions*. Nothing takes damage, so no objective can ever be met and T113's
headless skirmish ends in a ceasefire. Compose `executeAbility` into the
pipeline for both instant actions and `resolveCompletedCharges`, run reactions
and support traits, and emit the executor's events in order. Keep `step` pure
and deterministic: all randomness from the battle's seeded RNG. The
replay/determinism suite must stay byte-identical while a live `act` now reduces
HP and can KO.

### T118 — Deploy a battle from a contract
- status: done
- deps: [T117, T068, T070, T091, T092]
- files: src/app/battleSetup.ts, src/data/enemies/, src/data/maps/battleMaps.ts, tests/unit/battleSetup.test.ts
- verify: npm run test -- --run tests/unit/battleSetup.test.ts
- done: `buildBattleFromContract` returns a deterministic `BattleState` from a `Company`, a combat `ContractDef` and its `BattleMapDef`: the roster on the map's `company` tiles, authored enemies on its `enemy` tiles, the map's `objective`, and the company's learned actions; a combat contract with no map (or a map with no order of battle) fails loudly.

Battle maps already name a `contractId`, `deployment` and `objective`
(`src/data/maps/battleMaps.ts`), but nothing maps an `EnemyDef` to a tile and
nothing assembles a campaign battle. Author an **order of battle** per battle
map (a small data table keyed by map/contract id that binds enemy ids, levels
and deployment tiles), then write `src/app/battleSetup.ts` on top of
`createBattle`, `battleMapToTerrainMap` and the roster's derived stats
(T018/T051). No `Math.random`; the seed is a parameter. Follow the shape of the
existing `src/app/demoScenario.ts`.

### T119 — Deterministic enemy AI turn runner
- status: done
- deps: [T117, T095, T098]
- files: src/app/battleRunner.ts, tests/unit/battleRunner.test.ts
- verify: npm run test -- --run tests/unit/battleRunner.test.ts
- done: `runAiTurn(state, unitId)` plans the current non-company actor through `src/ai/utility.ts` and commits the resulting move/act commands through the same `step` path the player uses; `runAiUntilPlayer(state)` advances past consecutive AI actors, stops on a company actor or a finished battle, and is deterministic and loop-guarded.

`src/ai/utility.ts` already exposes `chooseTurn`/`chooseCommand` and
`src/app/autoBattle.ts` wraps them for allies, but the Field battle has no AI at
all: enemy turns never resolve, so a battle cannot reach its objective. Add
`src/app/battleRunner.ts` that drives enemy turns through `step` with the
command shapes `battleController` already uses. Reuse `autoBattleAllies` (T098)
if company allies should also be automated. Keep it pure and deterministic
(seeded RNG lives in state) and guard against a turn that never yields.

### T120 — Campaign progression: accept, outcome, day
- status: done
- deps: [T101, T118, T031, T055, T076]
- files: src/app/campaign.ts, tests/unit/campaignProgression.test.ts
- verify: npm run test -- --run tests/unit/campaignProgression.test.ts
- done: Pure functions over a `CampaignSave` accept a contract (pay the fee, mark it posted), apply a finished battle's outcome (Crowns/Drill/XP/kit rewards, Honour, casualties and removals), advance the day, rotate the daily Articles of War and append history — returning a new `CampaignSave` with no mutation and no randomness.

`CampaignSave` (T101) already bundles the company, map, calendar, depot,
progress and history, and the primitives exist (`advanceDay`,
`spendCrowns`/`addCrowns`, `awardHonours`, drill/XP from T048/T049,
`createCalendar` for the next day's Articles), but nothing applies a battle
result to the campaign. Write the reducer in `src/app/campaign.ts` using the
`src/persist` factories; it must never mutate its input. Cover a win with
rewards and an item, a loss with casualties, an objective failure, and a day
boundary that rotates the Articles.

### T121 — Wire the campaign loop into the app
- status: done
- deps: [T119, T120, T071, T102]
- files: src/app/campaignController.ts, src/ui/App.tsx, src/ui/Mess.tsx, tests/e2e/campaign.spec.ts
- verify: npm run test:e2e -- tests/e2e/campaign.spec.ts
- done: Taking a postable combat contract in the Officers' Mess launches its battle on the Field (player company vs. AI), the battle resolves to the map's objective outcome, rewards and the day advance are applied, the campaign autosaves, and the player sees a result summary; the seeded demo campaign stays deterministic for tests.

This is the missing glue named in the field report. Add
`src/app/campaignController.ts` owning the working `CampaignSave` plus the
active `BattleState`. Wire `src/ui/Mess.tsx`'s accept action to it, switch the
Field to `buildBattleFromContract`, resolve enemy turns with `battleRunner`, and
on `battleEnded` call the T120 reducer, autosave through `SaveStore` (T102) and
show the outcome. Do not change `src/engine`. Author `tests/e2e/campaign.spec.ts`:
Mess → take a contract → Field battle visible → commit an order → result summary
→ day advanced and Crowns changed. Prefer a short, deterministic objective
(e.g. a survive-N-turns board) so the spec is stable.

---

## Phase 14 — Battle-flow hardening (peer-engine review)

Refinements found by comparing three peer tactics engines (TinyWarsClient, The
Unseen Hand, fft-phaser); the full write-up and rationale live in
`docs/PEER_COMBAT_LESSONS.md`. Each task names the lesson (L#) it implements.
T122 and T123 are independent and should land first; T124 and T130 build on the
driver split.

### T122 — Deterministic, RNG-free Orders Tempo tie-break
- status: done
- deps: [T019]
- files: src/engine/turn.ts, tests/unit/turn.test.ts, tests/unit/determinism.test.ts
- verify: npm run test -- --run
- done: `chooseActor` breaks a same-charge tie by a stable total order (charge desc, then unit id ascending) and consumes no randomness; turn order no longer depends on how many combat rolls preceded the tie, and every affected fixture/expectation is updated so the whole suite is green.

Peer lesson L1. Today `chooseActor` (`src/engine/turn.ts`) draws from the same
`OrdersTempo.rng` stream that `src/engine/actions/resolve.ts` uses for combat, so
the turn order changes if a combat roll is added or removed — a rules quantity
coupled to effect randomness. Compare `tieBreak` in The Unseen Hand's
`src/sim/scheduler.ts`, which is an explicit total order and consumes no RNG.
Replace the draw with charge desc then unit-id ascending, keep `OrdersTempo.rng`
for combat only, and add a crafted same-charge test asserting the id order.
Update the seeded-tie assertions in `tests/unit/turn.test.ts` ("breaks
same-charge ties with the seeded stream only") and `tests/unit/determinism.test.ts`
("lets the seed decide same-charge tie-breaks"). This is a cross-cutting
behaviour change, so run the full suite and fix every fixture it moves.

### T123 — Split `advanceToDecision` from `applyCommand`
- status: done
- deps: [T022]
- files: src/engine/battle.ts, tests/unit/battle.test.ts
- verify: npm run test -- --run tests/unit/battle.test.ts tests/unit/determinism.test.ts tests/unit/battleRunner.test.ts
- done: `advanceToDecision(state)` advances the clock, resolves matured charges and skips out-of-action actors to surface the next living actor (or a terminal state); `applyCommand(state, command)` validates and applies exactly one command; `step` is a thin wrapper over the two and every existing state hash and behaviour is unchanged.

Peer lesson L2. `step` currently inlines three jobs (validate, apply, advance),
so AI lookahead and balance harnesses cannot reuse the “who acts next” logic.
Mirror The Unseen Hand's `advanceToDecision`/`applyCommand` split
(`src/sim/driver.ts`): expose both as pure functions from `src/engine/battle.ts`,
keep `step` as the ergonomic wrapper, and add tests that `advanceToDecision` is
idempotent at a decision point and that `step` still produces byte-identical
state for a fixed seed and command log.

### T124 — Fold an optional move clause into `ActCommand`
- status: done
- deps: [T115, T123]
- files: src/engine/commands.ts, src/engine/battle.ts, tests/unit/battle.test.ts, tests/unit/move.test.ts
- verify: npm run test -- --run tests/unit/battle.test.ts tests/unit/move.test.ts tests/unit/determinism.test.ts
- done: an `act` command may carry an optional `move { to, order: "before" | "after" }` clause and settles the turn exactly once at one threshold; a folded move+act produces the same resulting state as the equivalent two-command `move` then `act` sequence, and `order` is required (never defaulted).

Peer lesson L3. Today a free move opens a turn via `hasMovedThisTurn` and a
second command must close it, so a half-open turn is representable. The Unseen
Hand folds both sub-phases into one `act` command with a required
`order: "before" | "after"` (`src/sim/driver.ts`). Add the optional clause to
`ActCommand` (`src/engine/commands.ts`), validate the move with the same
`validateMove` gate a standalone `move` uses, execute `before` (act resolves
from the destination) or `after` (act from the origin, then move), and settle
the Orders Tempo turn exactly once. Keep the two-step UI in
`src/app/battleController.ts`; this is an additive engine command shape.

### T125 — Tile-anchored charged abilities
- status: done
- deps: [T024]
- files: src/engine/actions/resolve.ts, tests/unit/combat.test.ts, tests/unit/ability.test.ts
- verify: npm run test -- --run tests/unit/combat.test.ts tests/unit/ability.test.ts tests/unit/determinism.test.ts
- done: a charging action resolves against the tile/area recorded when it was declared, so a unit that leaves the tile dodges it; a charge whose caster is out of action or whose target tile holds no living unit whiffs without error; the behaviour is covered by tests.

Peer lesson L4. `pendingTargetOf` (`src/engine/actions/resolve.ts`) reconstructs a
unit-targeted charge as `{ kind: "unit", unitId }`, so a delayed single-target
action homes onto the named soldier's current position instead of the declared
grid. FFTA-family peers resolve delayed effects on the tile (The Unseen Hand:
“the occupant may walk off”), which is what makes charge timing a real tactical
risk. Make the labelled target tile authoritative for charged abilities, keep the
out-of-action caster cancellation already present, and pin the whiff case.

### T126 — Pin the RNG draw order per action
- status: done
- deps: [T117]
- files: src/engine/actions/resolve.ts, tests/unit/determinism.test.ts
- verify: npm run test -- --run tests/unit/determinism.test.ts
- done: the order in which hit, crit, condition and reaction rolls consume the battle's seeded stream is documented next to the resolution pipeline and asserted by tests that count draws, including that a unit without a reaction consumes exactly the draws it did before.

Peer lesson L7. The shared stream is documented but the per-action draw order is
implicit, so adding one optional roll silently shifts every later effect. The
Unseen Hand writes the order down (hit → reaction trigger → reaction swing → crit
→ status) and tests exact consumption. Document ours in
`src/engine/actions/resolve.ts` and add draw-count assertions to
`tests/unit/determinism.test.ts`.

### T127 — Per-turn action budget (`hasActedThisTurn`)
- status: done
- deps: [T115]
- files: src/engine/battle.ts, src/app/battleController.ts, tests/unit/battle.test.ts
- verify: npm run test -- --run tests/unit/battle.test.ts tests/unit/battleController.test.ts
- done: `BattleState` records both whether the current actor has moved and whether it has acted this turn; a second `move` is still rejected, a `face`/`hold`/`wait` does not consume the act slot, and both flags reset exactly once when the turn advances.

Peer lesson L6. Only `hasMovedThisTurn` exists; “acted” is implicit in ending the
turn, which makes free/extra actions (Volleys, reactions, future combo links)
hard to express. fft-phaser's `Unit` carries `hasMoved`/`hasActed`; The Unseen
Hand prices the turn from `didMove`/`didAct`. Add the second flag to
`BattleState`, keep the controller's two-step flow, and test reset timing.

### T128 — Resolution accounting helper + friendly-fire tripwire
- status: done
- deps: [T117]
- files: src/engine/accounting.ts, src/engine/index.ts, tests/unit/accounting.test.ts
- verify: npm run test -- --run tests/unit/accounting.test.ts
- done: a pure `accountResolution(before, after, sourceUnitId)` reports damage dealt, healing, KOs and newly applied conditions by diffing two battle states; a reaction is credited to its reactor, not the attacker; unexpected same-team HP loss throws; the helper is deterministic and documented.

Peer lesson L9. The Unseen Hand's `hpDiffEvent` (`src/sim/driver.ts`) is the model:
credit by HP diff, give reactions their own credited event, and make a future
friendly-fire path fail loudly instead of silently mis-crediting. Add
`src/engine/accounting.ts`, export it from `src/engine/index.ts`, and use it later
from AI evaluation and battle reports. Nothing in `step` changes.

### T129 — Ordered `beginTurn`/`endTurn` upkeep pipeline
- status: done
- deps: [T024, T040]
- files: src/engine/battle.ts, tests/unit/battle.test.ts, tests/unit/combat.test.ts
- verify: npm run test -- --run tests/unit/battle.test.ts tests/unit/combat.test.ts
- done: the per-Orders-Tempo-turn upkeep (charge spend, per-turn flag reset, condition ticks, Élan regeneration and objective scoring) runs through one explicit, ordered function, and a test pins the order.

Peer lesson L10/L14. Start-of-turn upkeep is scattered across `rules/`; order
matters and is currently implicit. Make it one named pipeline (fft-phaser runs
`ct -= 100` → `resetTurnFlags()` → `tickStatuses()` → `regenMp()`; TinyWars lists
its whole phase list). Keep it pure and deterministic and pin the sequence with a
test.

### T130 — Headless AI-vs-AI gauntlet for balance
- status: done
- deps: [T119, T123]
- files: src/ai/gauntlet.ts, src/ai/index.ts, tests/unit/gauntlet.test.ts
- verify: npm run test -- --run tests/unit/gauntlet.test.ts
- done: `runGauntlet(setup, seed, policyA, policyB)` plays a full headless battle to a terminal state without touching render or UI, is deterministic and loop-guarded, and returns a summary (outcome, turns, units lost) that tests can assert.

Peer lesson L11. TinyWars runs a headless `fast` path and The Unseen Hand drives
AI-vs-AI battles as its balance harness. Build `src/ai/gauntlet.ts` on
`advanceToDecision`/`applyCommand` (T123) and the existing `src/ai/utility.ts` and
`src/app/autoBattle.ts`, wiring both sides to policies. No DOM, no `Math.random`;
the seed is a parameter.

### T131 — Charge bars in the Orders Tempo rail
- status: done
- deps: [T083]
- files: src/ui/TempoTray.tsx, src/ui/tempoOrder.ts, tests/unit/tempoTray.test.ts
- verify: npm run test -- --run tests/unit/tempoTray.test.ts
- done: each Orders Tempo tray entry shows that soldier's current charge as a bar and the tray re-sorts after every `step`, derived from `chargeOf`/`previewTurns` with no new range or tempo math in the UI.

Peer lesson L13. The tray shows the projected order and Speed but not the charge
clock; fft-phaser's `TurnOrderPanel` paints a CT bar per unit. Extend the pure
projection in `src/ui/tempoOrder.ts` to carry charge and render it in
`src/ui/TempoTray.tsx`. Presentation only; the engine stays the source of truth.

### T132 — Deterministic `naiveAi` fallback
- status: done
- deps: [T095]
- files: src/ai/naive.ts, src/ai/index.ts, tests/unit/ai.test.ts
- verify: npm run test -- --run tests/unit/ai.test.ts
- done: a small deterministic policy (if provoked, target the provoker; else use the best affordable action in range; else strike the weakest reachable foe; else advance toward the nearest foe; else wait) is available for fixtures and ally auto-battle, consumes no randomness, and emits the same command shapes the utility AI does.

Peer lesson L15. fft-phaser's ~40-line AI is inspectable and adequate for early
encounters and is a good “is the plumbing working” oracle. Add `src/ai/naive.ts`
and export it, keeping the utility AI (T095) as the default.

---

## Phase 15 — Battlefield HUD (per-character, FFT Blue style)

Model the battle screen on **FFT Blue** (<https://fft-blue.vercel.app/>, the
deployed `kuirsan26-lab/fft-phaser`): a hover/selection unit card
(`BattleScene.showUnitInfo`), a compact bottom command menu (`ui/ActionMenu.ts`),
a top turn-order rail (`ui/TurnOrderPanel.ts`) and a near-empty overlay
(`UIScene.ts`) — instead of our persistent `aside.hud` column. The information is
already in the HUD; the placement is the change. Preserve every existing
`data-testid` (the e2e suite is the contract) and update only the specs that
assert the old side-panel layout. Background and rationale:
`docs/PEER_COMBAT_LESSONS.md` (L12, L13, L16).

### T133 — Camera-aware projection + HUD anchor helper
- status: done
- deps: []
- files: src/render/scene.ts, src/render/iso.ts, src/ui/unitHud.ts, tests/unit/unitHud.test.ts
- verify: npm run test -- --run tests/unit/unitHud.test.ts
- done: `Scene.project(at)` returns the screen position of a soldier's tile top-face through the live camera, and a pure `anchorFor(screen, viewport, size)` (new `src/ui/unitHud.ts`) returns `{ left, top, side }` with edge-flip and clamp; both are deterministic and covered by `tests/unit/unitHud.test.ts`.

The UI needs a soldier's screen position to place a card but must not reach into
`scene.camera` itself. Add a `project` method to the `Scene` interface
(`src/render/scene.ts`) built on `worldToScreen`/`toScreen` in
`src/render/iso.ts`, and a pure anchoring module in `src/ui/unitHud.ts` that
mirrors FFT Blue's `showUnitInfo` (`ix + w > width - 10 ? pos.x - w - 20 : pos.x + 20`,
clamp `top`). Update the anchor as the camera pans/zooms and as units move —
prefer a pixi-ticker/rAF subscription over a React render per frame.

### T134 — Per-character unit card anchored to the soldier
- status: done
- deps: [T133]
- files: src/ui/App.tsx, src/ui/UnitCard.tsx, src/ui/StatChips.tsx, src/ui/styles.css
- verify: npm run test:e2e -- tests/e2e/input.spec.ts
- done: hovering or selecting a soldier shows its `UnitCard` in the HUD; the card was originally anchored beside the soldier via `anchorFor`, but is now **docked bottom-left inside `.field-dock`, above the readout and Orders band**, so it never covers the tiles being inspected or aimed at (`anchorFor` still serves the forecast/tile cards); `hud-actor`, `unit-card`, `hud-selected` and `hud-chips` remain in the DOM and `input.spec.ts` passes.

Build on the in-progress `UnitCard.tsx`/`StatChips.tsx`/`unitLabels.ts` (commit
that WIP first). Reuse the existing hover/selection plumbing in `App.tsx`
(`controller.cursor`, `controller.selectedUnitId`) and the T133 projector, so the
same component serves the hovered, selected and acting soldier. Keep the
screen-reader text (`hud-selected`, `visually-hidden`) and the tooltip that
already carries the exact figures.

### T135 — Bottom command band and target-anchored forecast
- status: done
- deps: [T133]
- files: src/ui/App.tsx, src/ui/Forecast.tsx, src/ui/styles.css
- verify: npm run test:e2e -- tests/e2e/forecast.spec.ts
- done: the action menu renders as a compact bottom command band during the command and move phases (FFT Blue's `ActionMenu`), and the forecast card appears near the target soldier instead of the side panel; `action-menu` and the forecast testids survive and `forecast.spec.ts` passes.

The menu is already `controller.actions`; only its placement changes — a
docked bottom band sized to its contents, with the same
tooltips/`data-testid`s (`action-${id}`, `order-info-${id}`). Move `Forecast`
next to the aimed-at soldier using T133's projector, keeping the existing
forecast testids so `forecast.spec.ts` stays the contract.

### T136 — World-space charge pip and status plate
- status: done
- deps: []
- files: src/render/units.ts, src/render/scene.ts, tests/unit/units.test.ts
- verify: npm run test -- --run tests/unit/units.test.ts
- done: `unitPresentation`/`unitDrawOps` draw the soldier's Orders Tempo charge as a meter (alongside HP, Élan, Honour pips and condition icons), sourced from the engine's charge rather than a duplicate, and the drawing stays pure and unit-tested.

Only HP and Élan are on the world plate today (`HP_BAR`/`ELAN_BAR` in
`src/render/units.ts`); FFT Blue's readout also carries a CT bar in the rail. Add
an optional charge input (from `chargeOf`/`previewTurns`) so the world plate and
the T131 rail agree, and keep the function pure (`Unit` + numbers in, draw ops
out).

### T137 — Retire the side panel
- status: done
- deps: [T134, T135, T136]
- files: src/ui/App.tsx, src/ui/styles.css
- verify: npm run test:e2e -- tests/e2e/animations.spec.ts
- done: the persistent `aside.hud` column is gone; the battle log sits behind a toggle and the remaining readouts are the anchored card, the bottom band, the world plate and the tempo rail; `animation-log` and `hud-phase` stay in the DOM and `animations.spec.ts` passes.

Final cleanup once T134–T136 have moved the content: delete the `aside.hud`
column, put the `animation-log` behind a details/toggle control (testid
`animation-log` preserved), and make the stage full-bleed. Sweep the e2e specs
(`skirmish`, `targeting`, `tutorial`, `tooltips`, `animations`) for layout
assumptions and update them — the `data-testid`s are the stable contract, the
pixel layout is not.

---

## Phase 16 — Core combat loop (move → act → end turn)

The player-facing battle loop is currently wrong: confirming a march dispatches
`[move, wait]`, so the turn ends before the soldier can act, and selecting an
action while a march is only *previewed* stages `[move, act]`, so both resolve as
one bundled order. The peer tactics loop is a **two-step, immediate** turn —
compare The Unseen Hand's two-step UX around its folded command
(`docs/PEER_COMBAT_LESSONS.md` L3) and fft-phaser's per-turn budget (L6).

These rules are the contract for this phase. A task is not done until they all
hold:

1. **Move is optional and commits on its own.** A reachable tile is previewed
   first; confirming the destination dispatches exactly one `move` command and
   resolves it immediately. The march never ends the turn and never carries an
   action (or a `wait`) with it.
2. **Act is optional and resolves from the committed tile.** After the march the
   same soldier still owns the turn. Choosing a legal, affordable ability and
   target dispatches exactly one `act` command from the soldier's *current*
   position. Acting closes the turn (FFTA-style), unless a future data flag
   marks the ability as a free/extra action.
3. **End Turn is explicit.** The acting soldier always has an **End Turn**
   control while it owns the turn; it dispatches exactly one `wait` command and
   nothing else. This is how a player passes after moving without acting, or
   passes before doing anything.
4. **No bundled player orders.** A single UI confirm produces exactly one command
   in `lastCommands`. `[move, act]` and `[move, wait]` are forbidden on the
   player path. The engine's optional `ActCommand.move` fold (T124) stays for
   AI, replays and atomic scripts; the human UI must not use it.
5. **The engine stays authoritative.** Target tiles, forecasts and legal actions
   are derived from committed state, never from a previewed destination.
   `hasMovedThisTurn` / `hasActedThisTurn` gate the two slots, and cancel/back-out
   never consumes a slot.
6. **“If the ability allows it” is data-driven.** Post-move action availability
   uses the same affordability/legality gate as any action; any future
   `requiresStationary` / `cannotAfterMove` ability flag must be enforced in the
   engine, not by hiding a UI button.

### T138 — Commit a march immediately (moving no longer ends the turn)
- status: done
- deps: []
- files: src/app/battleController.ts, src/app/input.ts, tests/unit/battleController.test.ts, tests/unit/input.test.ts
- verify: npm run test -- --run tests/unit/battleController.test.ts tests/unit/input.test.ts
- done: Confirming a previewed march dispatches exactly one `move` command; `lastCommands` is `["move"]`, `lastEvents` contains `moved` but no `turnEnded`, the same soldier stays selected in `command` with `pendingPath` cleared, `moveRange` empty and the action menu still available; the `move` input phase calls the dedicated march-commit intent, and cancel back to `command` never moves.

Today `confirmOrder` for a `move` phase goes through `dispatchPlan`, which
appends `{ kind: "wait" }` when no action is staged (`src/app/battleController.ts`).
That is why a march ends the turn. Introduce a dedicated **commit march** intent
(or narrow `confirmOrder` to actions) used by the `move` case in
`src/app/input.ts`, and dispatch the `move` through `step` immediately. The
controller must return to the same soldier's `command` phase, clear
`pendingPath`, keep the actor selected, hide the now-empty `moveRange`
(`hasMovedThisTurn`) and leave `actions` populated. Remove `[move, wait]` from
the player path; `waitOrder` remains the End Turn control (T140). Update the
assertions that currently expect `["move", "wait"]` in
`tests/unit/battleController.test.ts` and the input ladder tests.

### T139 — Resolve actions from the committed tile; never bundle move+act
- status: done
- deps: [T138]
- files: src/app/battleController.ts, src/app/input.ts, tests/unit/battleController.test.ts, tests/unit/input.test.ts
- verify: npm run test -- --run tests/unit/battleController.test.ts tests/unit/input.test.ts
- done: After T138's march has committed, `chooseAction` computes target tiles from the soldier's new tile and the final confirm dispatches exactly one `act` command (`lastCommands === ["act"]`), which ends the turn; while a march is only previewed the action menu cannot stage an action (cancel or commit the march first), and a regression test proves no controller intent can emit `[move, act]` in one dispatch.

`dispatchPlan` currently builds `[move, act]` when a path and an action are both
staged, so a previewed march and its action resolve as one batch. With T138 the
march is already committed before the action is chosen. Make the action path
state-only: `chooseAction` / `chooseTarget` / the action confirm must derive
targets from the current committed `unit.at`, never from a retained path. If the
controller is in phase `move`, reject `chooseAction` with a clear message (or
require the player to cancel the preview); do not silently fold the preview into
the action. `act()` updates to the action-only confirm. Keep the engine's folded
`ActCommand.move` behaviour covered by `tests/unit/battle.test.ts` for AI and
replay use, and add a test that a full human turn yields `["move"]` followed by
`["act"]`, never one bundled dispatch.

### T140 — Add the explicit End Turn control
- status: done
- deps: [T138]
- files: src/ui/App.tsx, src/ui/styles.css, tests/e2e/endTurn.spec.ts, tests/unit/battleController.test.ts
- verify: npm run test:e2e -- tests/e2e/endTurn.spec.ts
- done: While the selected soldier owns the turn in `command` or `move`, the command band shows an `End Turn` button (`data-testid="end-turn"`) that dispatches exactly one `wait` command and advances the tempo; it is hidden or disabled in `target` / `confirm` / `finished` and for read-only selections, and ending after a march emits neither a second `move` nor an `act`.

`waitOrder` exists but there is no player-facing control. Add an **End Turn**
button to the command band, visible whenever the selected soldier owns the turn
in `command` or `move` (including after a march and when no action is
affordable). Activating it dispatches exactly one `wait` and lets
`advanceToDecision` pick the next actor. Keep the campaign `hold` (Braced)
button distinct: End Turn is `wait`, not `hold`/`face`. Wire an accessible
keyboard/gamepad path and update the HUD help copy so the loop is discoverable.
New spec `tests/e2e/endTurn.spec.ts` should select the actor, press End Turn, and
assert the tempo advances without a move or action event.

### T141 — Make the turn budget authoritative (move-once, act-once)
- status: done
- deps: [T138, T139]
- files: src/engine/battle.ts, src/app/battleController.ts, tests/unit/battle.test.ts, tests/unit/battleController.test.ts
- verify: npm run test -- --run tests/unit/battle.test.ts tests/unit/battleController.test.ts
- done: `validateCommand` refuses `act` when `hasActedThisTurn` is true (and a folded `act.move` still respects move-once), the controller exposes the same budget (`canMove` / `canAct`, or a small `turnBudget`) and uses it to build `moveRange` and `actions`, and tests cover move-after-move, act-after-act, wait after either slot, and a mid-turn save/restore.

`BattleState` already records `hasMovedThisTurn` and `hasActedThisTurn` (T127),
but `validateCommand` only checks the move slot and the controller's `canAct` is
derived only from temporal ownership. Make the budget the single source of
truth for both the engine and the overlay: reject an `act` after an action has
been spent, keep the move-once check on `ActCommand.move`, and expose the same
predicates to the controller. This future-proofs free/extra actions and
Volleys without reopening the bundled-order bug, and keeps a mid-turn save
honest when it is loaded back into the UI.

### T142 — Lock the loop with an e2e spec and a written contract
- status: done
- deps: [T138, T139, T140, T141]
- files: docs/COMBAT_LOOP.md, docs/PEER_COMBAT_LESSONS.md, tests/e2e/turnLoop.spec.ts, src/ui/Tutorial.tsx, src/ui/App.tsx
- verify: npm run test:e2e -- tests/e2e/turnLoop.spec.ts
- done: `docs/COMBAT_LOOP.md` states the canonical select → preview/commit move → action menu → target/confirm act → or End Turn loop and is linked from the peer lessons; `tests/e2e/turnLoop.spec.ts` drives the loop end-to-end and asserts that committing a march leaves the actor in command with the action menu visible, that the action resolves from the moved tile, that End Turn advances the tempo, and that no single confirm dispatches more than one command; tutorial/HUD copy no longer says a move ends the turn.

Final guardrail for the phase. Write `docs/COMBAT_LOOP.md` as the canonical
loop contract (including the rule that the engine's folded `move` clause is
AI/replay-only), link it from `docs/PEER_COMBAT_LESSONS.md` §2/L3 so future
agents cannot reintroduce staged `[move, act]`, and add
tests/e2e/turnLoop.spec.ts (or extend `input.spec.ts`) to drive the loop through
the real canvas. The spec must observe the command band after the march, the
action forecast/target from the new tile, the explicit End Turn control, and the
single-command-per-confirm rule. Sweep the tutorial and HUD help copy for stale
"move ends the turn" wording.

---

## Phase 17 — Field AI, elevation & tile inspection

Three gaps surfaced in playtesting:

1. **The initial sandbox Field has no AI driver.** `src/ui/App.tsx` starts in
   `fieldMode === "demo"` with `createDemoBattle()`, but the AI effects only
   run for `"campaign"` and `"skirmish"`, so the demo hostiles hold their turns
   forever. The battle modes should share one enemy-phase driver.
2. **The Quick Battle board is flat.** `farmhouse-assault.json` (and every other
   authored map) omits the optional `elevation` layer, so `expandBattleMap`
   returns height 0 for every tile. The isometric renderer and the elevation
   rules have nothing to show or use in Quick Battle.
3. **Tiles cannot be inspected.** Moving the cursor only updates `hud-cursor`
   and a relative elevation delta. The player cannot see the terrain name, its
   movement/cover/sight rules, or the tile's absolute height unless they infer
   it from the art.

### T143 — Run the enemy AI on the initial sandbox Field
- status: done
- deps: []
- files: src/ui/App.tsx, src/app/demoScenario.ts, src/app/skirmishScenario.ts, tests/unit/demoScenario.test.ts, tests/e2e/input.spec.ts
- verify: npm run test -- --run tests/unit/demoScenario.test.ts tests/unit/skirmishScenario.test.ts
- done: One shared Field-AI path drives `demo`, `skirmish` and `campaign` battles; after the player passes the opening turn the demo enemy takes its turn without player input, emits its AI events, and control returns to a company soldier; a new `tests/unit/demoScenario.test.ts` proves the hostile acts and no battle mode silently skips the AI phase.

The app opens on `createDemoBattle()` in `fieldMode === "demo"`, but the two AI
effects in `src/ui/App.tsx` are gated on `campaignAiHoldsTurn(campaign)` and
`fieldMode !== "skirmish"`. Nothing advances a hostile turn on the initial
Field. Extract the existing enemy-phase pacing into one driver that accepts a
`BattleState` (or fold the demo into the same `runAiUntilPlayer` path the other
modes use), keep the `AI_THINK_MS` pacing and `busy` gate, and make the mode
switch (`startSkirmish`, `acceptContract`, `dismissResult`) reset cleanly. Add a
demo-scenario test that gives the turn to an enemy and asserts the AI advances
it; add an e2e assertion (or extend `input.spec.ts`) that the initial Field's
hostile phase resolves after the player passes.

### T144 — Author elevation for Quick Battle (and audit the map set)
- status: done
- deps: []
- files: src/data/maps/farmhouse-assault.json, tests/unit/maps.test.ts, tests/unit/skirmishScenario.test.ts, tests/e2e/skirmish.spec.ts
- verify: npm run test -- --run tests/unit/maps.test.ts tests/unit/skirmishScenario.test.ts
- done: `farmhouse-assault.json` carries a valid `elevation` layer with at least two distinct height bands (a low approach and a raised farmhouse/orchard terrace); the quick-battle board's deployment tiles and capture objective remain passable and reachable, and `tests/unit/maps.test.ts` asserts the expanded board has more than one distinct height and that its objective/deployment tiles are valid.

`expandBattleMap` defaults a missing elevation row to height 0
(`src/data/maps/layout.ts`), and no map JSON currently authors an `elevation`
layer. That makes Quick Battle visually and mechanically flat even though the
isometric renderer, pathfinding climb costs and elevation combat rules all
expect height. Author an `elevation` block for `farmhouse-assault.json` (same
width/height as `layout`, using `0`–`9`/`a`–`f` codes), keeping the approach
low, the farmhouse core raised and the orchard banks readable. Re-check the
enemy/company deployment zones and the `(6, 4)` capture objective against the
raised tiles. Audit the other authored maps in the same pass and add elevation
where their terrain description implies relief; if a board is deliberately
flat, say so in its description or a focused test.

### T145 — Tile inspection: terrain, elevation and effects
- status: done
- deps: []
- files: src/ui/tileInfo.ts, src/ui/TileCard.tsx, src/ui/App.tsx, src/ui/styles.css, tests/unit/tileInfo.test.ts, tests/e2e/tileInfo.spec.ts
- verify: npm run test -- --run tests/unit/tileInfo.test.ts && npm run test:e2e -- tests/e2e/tileInfo.spec.ts
- done: Hovering or selecting any in-bounds tile, empty or occupied, shows an anchored `tile-card` with the terrain name, description/category, absolute elevation, elevation delta relative to the selected/acting soldier, move cost, passable/blocked and sight/water flags; the data comes from a pure `tileInfoFor(map, at, reference, units)` helper covered by `tests/unit/tileInfo.test.ts`, and the card reuses `scene.project` + `anchorFor` without mutating engine state. `hud-tile` mirrors the same summary; the card steps aside while a forecast is aimed so the two never cover each other.

The cursor already tracks hover and click (`controller.cursor`), and the HUD
shows only its coordinate plus a relative elevation chevron. Add a pure tile
inspector that reads `terrainTileAt`, `getTerrainDef`, `heightAt`,
`isPassableAt`, `moveCostAt` and `blocksSightAt` from `src/engine/terrain.ts`,
returning a small display value (terrain name/description/category, height,
delta, cost, flags, and whether the tile is occupied). Render it as an anchored
card beside the cursor using T133's projector and `anchorFor`, following the
`UnitCard` pattern so the anchor follows pan/zoom. If a unit card is also up,
offset or merge the terrain line rather than covering it. Keep the card visible
on empty tiles and while browsing orders; expose a stable
`data-testid="tile-card"` and `hud-tile` text for the e2e contract.

### T146 — Make the opening Field a resolvable action
- status: done
- deps: [T143, T145]
- files: src/app/demoScenario.ts, src/app/skirmishScenario.ts, src/ui/App.tsx, src/i18n/index.ts, tests/unit/demoScenario.test.ts, tests/e2e/demoBattle.spec.ts
- verify: npm run test -- --run tests/unit/demoScenario.test.ts && npm run test:e2e -- tests/e2e/demoBattle.spec.ts
- done: The initial demo Field carries an annihilation objective, shows its objective in a Field panel with a deterministic Resolve control, freezes at a terminal outcome and offers a restart; `resolveDemoBattle` shares the generic `resolveFieldBattle` auto-battle path with Quick Battle, and the opening action now visibly plays out and resolves instead of running forever.

Playtesting kept hitting the first screen, which looked like a playable battle
but had no objective: the opening demo could never finish, so the only way to
see a resolved action was to discover Quick Battle. Give `createDemoBattle` an
authored annihilation objective, expose a small Field panel (`demo-battle`) with
the objective and a **Resolve** button, and show a `demo-result` card with the
outcome and a restart when the battle freezes. Reuse the same deterministic
auto-battle path as Quick Battle rather than authoring a second AI resolver.

### T147 — Out-of-action soldiers stop blocking movement
- status: done
- deps: [T025, T146]
- files: src/engine/actions/move.ts, src/engine/battle.ts, src/app/battleController.ts, src/ai/utility.ts, src/ai/naive.ts, tests/unit/move.test.ts
- verify: npm run test -- --run tests/unit/move.test.ts tests/unit/demoScenario.test.ts
- done: A soldier at 0 HP no longer occupies their tile for the move validator, folded `act.move` pathfinder, controller move range, or either AI; a march may cross the tile a fallen soldier held, so a body on the only bridge cannot seal the route or stall an annihilation objective.

T146 surfaced a real engine bug: `occupiedTiles` counted every deployed soldier,
including those out of action, so the first soldier to fall on the demo's single
bridge blocked both surviving sides from ever reaching each other. The
auto-battle loop then stalled with the objective still active. Filter
out-of-action soldiers from every occupancy source (engine validator, folded
move pathfinder, controller, utility AI, naive AI) so corpses do not hold
ground, and pin a march across a fallen soldier's tile.

---

## Phase 18 — Balance pass I (the authored numbers)

Four of the open questions below are really *decisions we never recorded*: the
reference mirror documents the shape but not the numbers, or documents neither.
This phase closes them with authored, named, tested values and a written
rationale, so later content work has a baseline instead of a guess. Each task
owns one system; the final task writes the decisions down and checks the
questions off.

### T148 — Per-action Orders Tempo costs
- status: done
- deps: []
- files: src/engine/turn.ts, src/engine/battle.ts, src/engine/serialize.ts, tests/unit/turn.test.ts, tests/unit/battle.test.ts, docs/COMBAT_LOOP.md
- verify: npm run test -- --run tests/unit/turn.test.ts tests/unit/battle.test.ts
- done: A closed turn's charge cost depends on what it spent — acting 80%, a move-only turn 70%, a hold/wait 50% of the threshold — authored as `TEMPO_TURN_COSTS`, carried per soldier in `TempoEntry.turnCost`, and spent when that soldier's next turn opens, so a soldier who acts returns later than one who merely holds; the cost survives a save/load round-trip and `previewTurns` projects with the stored costs.

The FFTA charge-time reference is explicit about the *post-turn* CT
(`docs/wiki/pages/Charge_time.md`, "Final Fantasy Tactics Advance"): after a
turn CT is set to 500 of the 1000 threshold, then lowered by 300 if the soldier
**acted** or 200 if they **moved**. In our 100-threshold model that is a turn
cost of 80% for acting, 70% for a move-only turn and 50% for a hold. Today
`spendTurn` always deducts a full threshold, so acting and waiting pace the
turn order identically and waiting has no tempo value. Add the authored cost
ratios to `turn.ts`, store the last closed turn's cost on the `TempoEntry`, make
`spendTurn`'s default read it, and have `battle.ts` record it when a command
closes a turn (`act` → act, move + close → move, `wait`/`face`/`hold` → wait).
Keep the first turn at the full threshold, keep `recordTurnCost` state-pure, and
round-trip the new field in `serialize.ts`. Pin the ordering in unit tests and
update the combat-loop contract.

### T149 — Élan regeneration scales with the pool
- status: done
- deps: []
- files: src/engine/rules/elan.ts, tests/unit/elan.test.ts
- verify: npm run test -- --run tests/unit/elan.test.ts
- done: The default Élan schedule restores a share of each soldier's maximum pool (`ELAN_REGEN_RATIO_PERCENT`) rather than a flat amount, so a 40-Élan officer recovers more per step than a 15-Élan fusilier while every soldier still recovers at least one point; flat `amount` schedules remain supported for content and tests, and morale thresholds are unchanged.

`MP_(stat).md`'s FFTA section is an empty stub (`agents.md` §10), so T040
authored a flat `ELAN_REGEN_AMOUNT` (5) every `ELAN_REGEN_INTERVAL_TICKS` (10).
That is the wrong shape: Élan doubles as morale and is derived from each post's
`mp` growth, so a flat rate recovers a 15-point fusilier at three times the
relative pace of a 45-point officer, and the morale thresholds fire at
different rates for the same play. Make the recovery a percentage of the
soldier's maximum (authored, floor, minimum 1), keep `amount` for explicit
schedules, and pin both paths plus the Shaken/Routed interaction in tests.

### T150 — Volley damage counts the firing line
- status: done
- deps: []
- files: src/engine/actions/volley.ts, tests/unit/volley.test.ts
- verify: npm run test -- --run tests/unit/volley.test.ts
- done: A Volley's power multiplier now reads `(10 + 4×Honour + 2×linkers) / 10`, capped by an authored `VOLHONOUR_MAX_LINKERS`, so chaining allies add damage on top of the committed Honour; the linker count is taken from the same `volleyLinkers` list the executor fires, `scaleVolleyPower` stays backwards compatible, and the curve is pinned for 0, 1 and capped linkers.

`Combo_(Tactics_Advance).md` says a combo's damage grows with the initiator's
Judge Points **and** that more characters joining increases it, but only the
Honour half is implemented: the firing line adds shots, never force. Add an
authored per-linker term to the multiplier (each chaining ally adds a little
weight, capped so a large line cannot dwarf the Honour commitment), compute it
from the executor's own linker list, and pin the exact integer curve. This keeps
the FFTA shape (10 + 4×JP)/10 intact at zero linkers.

### T151 — Record the balance decisions
- status: done
- deps: [T148, T149, T150]
- files: docs/BALANCE.md, README.md, todo.md
- verify: —
- done: `docs/BALANCE.md` states every authored balance decision with its reference status (documented, garbled, or absent) and the chosen value; the resolved questions in `todo.md` are checked off with a pointer to the section that answers them, and the README docs table links the new page.

Seven systems now carry authored numbers whose rationale lives in code
comments scattered across `turn.ts`, `elan.ts`, `volley.ts`, `damage.ts` and
`level.ts`. Write one page that states, per system, what the reference actually
documents (with the wiki page), what we chose and why, and what a later pass
may retune. Then check off the open questions that are now answered — damage
formula resolution and healing (T033/T036), Élan regeneration (T040), Orders
Tempo costs (T019), post-unlock thresholds (T046), Articles (T055), Volley
scaling (T061) and stat growth (T018/T049) — leaving only genuinely open
design questions on the list.

---

## Phase 19 — Measure the baseline

The balance pass (Phase 18) recorded *what* the numbers are. This phase records
*what they do*: play the authored Quick Battle headlessly at those values over a
fixed seed set, and write the observed outcome, length and casualty baseline
next to the decisions it comes from.

### T152 — Measure the balance baseline with the gauntlet
- status: done
- deps: [T130, T148, T149, T150, T151]
- files: src/app/skirmishScenario.ts, src/data/conditions.ts, tests/unit/balanceBaseline.test.ts, docs/BALANCE.md
- verify: npm run test -- --run tests/unit/balanceBaseline.test.ts
- done: The Quick Battle roster is exposed as a reusable `BattleSetup`, a headless baseline test plays it over a fixed seed set with the shipped field AI and a recruit-vs-elite match, asserts every run reaches a terminal state deterministically, and `docs/BALANCE.md` records the measured outcome/length/casualty baseline with the exact command that reproduces it; the first run exposed (and fixed) a zero-damage deadlock in the Shaken morale penalty.

`runGauntlet` (T130) plays a full AI-vs-AI battle headlessly, but no test drives
it against the **authored** Quick Battle roster: the current gauntlet specs use
a synthetic two-soldier duel. Extract `skirmishSetup()` from
`createSkirmishBattle()` (same roster, board, actions and objective, returned as
a `BattleSetup`) and use it in a new `tests/unit/balanceBaseline.test.ts` that
runs a fixed seed set twice — a mirror match and a `recruit` company against an
`elite` enemy — asserting every run finishes, stays under the turn cap, and
replays identically. Print the summary table in the test output and record it in
`docs/BALANCE.md` under the D16–D24 decisions, so a later tuning pass has a
"before" to compare against. Do not assert specific win rates: the test guards
the harness and determinism, the document holds the numbers.

---

## Phase 20 — Rebalance from the baseline

T152 measured the authored Quick Battle and found a lopsided action: under the
same field AI on both sides the enemy won every seed. This phase fixes the
roster from that measurement rather than from intuition.

### T153 — Make the Quick Battle a contest, not a walkover
- status: done
- deps: [T152]
- files: src/app/skirmishScenario.ts, tests/unit/balanceBaseline.test.ts, docs/BALANCE.md
- verify: npm run test -- --run tests/unit/balanceBaseline.test.ts
- done: Under the shipped field AI across the fixed baseline seeds the company wins at least two and loses at least two of the eight, the roster change is explained from the baseline (Speed cohesion, not stat inflation), the public scenario and its tests still pass, and the "after" table replaces the "before" in `docs/BALANCE.md`.

The baseline showed the company losing 8/8 while the enemy lost 0–3. The cause
is the **Speed spread**, not raw power: the marksman's Speed 40 outruns the rest
of the line (36/30/32), so the AI commits him alone and the defenders focus him
down. Trial runs confirmed the lever: holding every other stat fixed and
tightening the company's Speeds to 35/32/34/33 turns the matchup into a 4–4
split, while raising HP changed nothing and raising attack made it 8–0. Author
the cohesive line, add the "not a foregone conclusion" tripwire to the baseline
spec, and record the new table. Do **not** assert a specific split beyond
"both sides win at least twice".

---

## Phase 21 — Keep the line together

The T152/T153 baseline exposed a systemic AI habit: each soldier advances on its
own, so the fastest reaches the enemy first and is focus-fired. Tightening the
Quick Battle's Speeds hid the symptom; this phase fixes the cause in the utility
AI so every roster — campaign included — behaves sensibly.

### T154 — Isolation-aware positioning in the utility AI
- status: done
- deps: [T095, T153]
- files: src/ai/utility.ts, tests/unit/ai.test.ts, tests/unit/balanceBaseline.test.ts, docs/BALANCE.md
- verify: npm run test -- --run tests/unit/ai.test.ts tests/unit/balanceBaseline.test.ts
- done: Every candidate destination carries an `isolation` score — hostiles who could reach the tile next turn minus living allies within supporting distance — weighted by a new `isolation` term (enabled in the default and field weights), so a soldier with the line behind it prefers ground that is not surrounded; unit tests pin the term and the Quick Battle baseline is re-measured and recorded.

`scoreCandidate` already values exposure at the destination, but that term is
per-target expected damage, not numbers on the ground: a soldier stepping into
three enemies with no ally within reach can score the same as one stepping into
a single enemy. Add a support/threat count term: an enemy counts as threatening
if it could reach the tile within its movement next turn, an ally counts as
supporting if it is within a short radius, and only the excess of threats over
supporters is penalised. Keep it data-driven (weight + radii exported), keep the
existing weights' meaning, and prove with a focused test that the same soldier
scores an isolated advance below a supporting one. Then re-run the T152 baseline
and record whether the line actually stays together.

---

## Phase 22 — Engineering safeguards

The last few phases added a lot of surface (engine rules, AI, authored numbers)
backed by 2332 unit tests and 81 e2e specs — all run by hand. This phase makes
the repository defend itself: one CI gate and a format baseline so the checks
are meaningful.

### T155 — Normalise formatting, then gate it
- status: done
- deps: []
- files: src/, tests/, tools/, scripts/, package.json
- verify: npm run format:check
- done: `npm run format:check` passes on a clean checkout: the whole code surface is formatted with the committed Prettier config, no behavioural file changes are included beyond whitespace/wrapping, and the unit and e2e suites still pass.

`npm run format` and `format:check` are documented commands, but `format:check`
currently fails on 57 files (line wrapping and multi-line literals written
without running Prettier). A format gate that is red on `main` cannot be added
to CI, so normalise the surface first. Keep this commit mechanical: run the
script, confirm the diff is formatting only, and re-run the suite.

### T156 — Add a CI workflow for lint, types, tests and e2e
- status: done
- deps: [T155]
- files: .github/workflows/ci.yml
- verify: npm run lint
- done: A push or pull request runs `lint`, `typecheck`, `format:check`, the unit suite and the production build in one job, and the Playwright e2e suite (with a cached Chromium) in a second, using the Node version pinned by `.nvmrc` and failing the run on any step; the workflow mirrors the existing deploy job's conventions and uploads the Playwright report on failure.

Nothing currently runs the 2332 unit tests or 81 e2e specs on push — only the
deploy workflow, which just builds. Add `.github/workflows/ci.yml` on
`push`/`pull_request`: a `verify` job (`npm ci`, lint, typecheck, format check,
unit tests, build) and an `e2e` job (`npm ci`, install Chromium with its OS
deps, `npm run test:e2e`). Use `actions/setup-node` with `node-version-file:
.nvmrc` and npm caching, `concurrency` keyed by workflow + ref, and
`actions/upload-artifact` for `playwright-report` on failure. Keep the deploy
workflow unchanged.

### T157 — Repair the Pages deployment
- status: blocked
- deps: [T156]
- files: .github/workflows/deploy.yml, README.md
- verify: —
- done: The deploy workflow enables GitHub Pages for the repository on its first run (`enablement: true` on `configure-pages`) instead of failing at that step, the README states the one-time Pages prerequisite and that the workflow requests it, and a push to `main` reaches the publish step.

**Blocked on a repository setting the agent cannot change.** The workflow now
tries `enablement: true`, and when the token is not allowed to create the site
it emits a warning and skips the publish instead of failing every push. To
finish: open **Settings → Pages**, set **Source: GitHub Actions**, then re-run
the Deploy workflow (or push). Confirm `has_pages` is true on the repository and
that <https://wrexial.github.io/tactica/> serves the build; only then flip this
task to done.

The new CI workflow exposed a pre-existing failure: every `Deploy static build`
run since the Pages workflow was added stops at **Configure Pages**, because the
repository has `has_pages: false` — Pages was never switched on, so the
`wrexial.github.io/tactica` link in the README serves a 404. `configure-pages`
can create the site itself when given `enablement: true` and a token with
`pages: write` (which the workflow already has), so request enablement there and
document the prerequisite. If the token lacks the right to enable it, the
workflow should say so plainly rather than leaving a bare 404 link.

---

## Phase 23 — Chapter 7: the Sunken Lane

The campaign's story spine ends at chapter 6 and its last authored board is the
guerrilla camp. This phase adds one more late-game beat with a board that plays
differently from the farmhouse: low ground with cover, high banks, and a single
long approach.

### T158 — Author chapter 7, "The Sunken Lane"
- status: done
- deps: []
- files: src/data/maps/sunken-lane.json, src/data/maps/battleMaps.ts, src/data/maps/locations.ts, src/data/enemies/ordersOfBattle.ts, src/data/contracts/battles.ts, src/data/story.ts, tests/unit/maps.test.ts
- verify: npm run test -- --run tests/unit/maps.test.ts tests/unit/story.test.ts tests/unit/content.test.ts tests/unit/battleSetup.test.ts
- done: A chapter-7 battle is playable end to end: a 13×9 authored board whose lane sits at height 0 between height-2 banks with a mill yard at the far end, a five-troop order of battle of late-game irregulars, a chapter-7 contract that posts it, a matching location and a reachable story chapter; the deployment validates, the rout objective is reachable, and the maps/story/content/deployment tests pass.

Fiction: with the guerrilla camp broken, a rearguard bars the sunken lane off the
crossroads so the column behind it can escape. The company must clear the lane
and the mill beyond it. Mechanically the board inverts the farmhouse: the
**lane is the low ground** (height 0) with the banks two layers above it, so
units inside it are covered from the flanks but cannot see over the banks, and
the only approach is a long straight road — a natural place for a ranged
rearguard (`pass-sniper`) and a gun at the mill (`six-pounder-section`).

Author it as JSON beside `farmhouse-assault.json`, add it to
`JSON_BATTLE_MAP_KEYS`/`BATTLE_MAP_KEYS` and the merged table, add the location
and its region, the order of battle, a `battle` contract gated to chapter 7, and
a chapter-7 story entry triggered by reaching a later day (`reach-day`), since
chapter 6 opens no contract that could trigger it. Keep every deployment tile
passable and every objective tile reachable, and pin the height inversion in the
map tests.

### T159 — Chapter 8, "Hold the Churchyard"
- status: done
- deps: [T158]
- files: src/data/maps/churchyard-stand.json, src/data/maps/battleMaps.ts, src/data/maps/locations.ts, src/data/enemies/ordersOfBattle.ts, src/data/contracts/battles.ts, src/data/story.ts, tests/unit/maps.test.ts, tests/unit/story.test.ts
- verify: npm run test -- --run tests/unit/maps.test.ts tests/unit/story.test.ts tests/unit/content.test.ts tests/unit/battleSetup.test.ts
- done: The campaign has a defending finale: a 13×9 hilltop churchyard on a height-3 plateau with a single gate and two breaches, the company deployed around the altar and six late-game irregulars on the low road, a `defend` objective for six turns, a chapter-8 contract gated behind clearing the Sunken Lane, a matching location and a story chapter triggered by that completion; the board validates and the siege resolves headlessly.

Where the Sunken Lane made the company assault low ground, the finale inverts
the roles: the company holds the **high ground** while the column withdraws.
The walled churchyard sits on a height-3 plateau reachable only through a
one-tile west gate or two collapsed breaches (rubble), so the enemy must funnel
uphill under fire while the company's job is simply to stand on the altar tile
for six turns. Keep the Totema structure intact — all five Guard Sorties are
already unlocked by chapter 6, so chapter 8 opens a battle, not a formation.
Trigger the chapter on completing `clear-the-sunken-lane` (chapter 7, so the
spine's reachability rule holds) and update the story test's completion facts.

---

## Phase 24 — The AI plays the mission

The chapter-8 siege exposed a gap that affects every `capture` and `defend`
battle: the utility AI scores damage, threat, position and exposure, but **never
the mission objective**, so a company that wipes the garrison can still fail to
stand on the point and stall the clock.

### T160 — Score the objective tile
- status: done
- deps: [T159]
- files: src/ai/utility.ts, tests/unit/ai.test.ts, tests/unit/balanceBaseline.test.ts, docs/BALANCE.md
- verify: npm run test -- --run tests/unit/ai.test.ts tests/unit/balanceBaseline.test.ts
- done: Every candidate destination is scored by its distance to a `capture`/`defend` objective tile (a bounded `objective` term for both sides), so the company walks onto the point and the enemy contests it; annihilation/rout/survive boards are unchanged, the churchyard siege resolves on every seed instead of hitting the turn cap, and the Quick Battle baseline is re-measured and recorded.

`scoreCandidate` already values ground for its own sake (`cover`, `elevation`,
`advance`), but nothing in the AI knows *why* the detachment is on the field.
Add an `objective` weight (default on) and a small integer pull — 4 on the tile,
decreasing by one per tile of distance, zero beyond four — read from
`state.objective` for `capture` and `defend` only. Apply it to both sides:
the attacker must take or deny the point, the defender must hold it. Keep the
term bounded so a good attack still outranks a pointless tile, pin it with unit
tests (capture, defend, and no pull on annihilation), then re-run the
churchyard probe and the T152 baseline and record the new table.

### T161 — Chapter 9, the campaign's closing beat
- status: done
- deps: [T160]
- files: src/data/maps/headquarters-raid.json, src/data/maps/battleMaps.ts, src/data/maps/locations.ts, src/data/enemies/ordersOfBattle.ts, src/data/contracts/battles.ts, src/data/story.ts, tests/unit/maps.test.ts, tests/unit/story.test.ts
- verify: npm run test -- --run tests/unit/maps.test.ts tests/unit/story.test.ts tests/unit/content.test.ts tests/unit/battleSetup.test.ts
- done: The campaign ends on a deliberate note: a 12×8 billet village whose flat street threads between raised houses, a walled headquarters compound with one gate, a six-troop command garrison (general, captain, Old Guard detachment and aides), a `capture` objective on the headquarters, a chapter-9 contract triggered by holding the churchyard, and a matching location and story chapter; the board validates, the raid resolves headlessly, and the objective pull carries the company to the HQ.

After the churchyard defence the column is gone and the enemy headquarters is
exposed in its billet village. The closing beat is a **street raid**: the
company comes up a flat street between houses raised a layer above it, takes the
one gate in the headquarters compound and seizes the HQ tile. The garrison is a
command group — `enemy-general`, `enemy-captain`, `old-guard-detachment` and
three aides — so the fight is against quality rather than numbers. Keep the
`capture` objective (T160's objective pull now makes both sides fight for the
tile), add the location and chapter, trigger chapter 9 on completing
`hold-the-churchyard`, and update the story test's completion facts.

---

## Phase 25 — Closing the campaign in the UI

The story spine now ends at chapter 9, but the Officers' Mess still gates its
board on a hard-coded chapter (`5`) because the app never passes the campaign's
real chapter. That makes late contracts appear too early and leaves the
completion of the finale invisible.

### T162 — Show the campaign chapter and conclusion in the Mess
- status: done
- deps: [T161]
- files: src/data/story.ts, src/app/campaign.ts, src/ui/Mess.tsx, src/ui/App.tsx, src/i18n/index.ts, src/ui/styles.css, tests/unit/story.test.ts, tests/unit/campaign.test.ts, tests/e2e/mess.spec.ts
- verify: npm run test -- --run tests/unit/story.test.ts tests/unit/campaign.test.ts && npm run test:e2e -- tests/e2e/mess.spec.ts
- done: The Mess gates on the campaign's real chapter — derived with `advanceChapter`, so a fresh save opens at chapter 1 — shows that chapter's name, and displays a `campaign-concluded` panel once the last chapter's contract is completed; story/campaign unit tests pin `campaignConcluded` and the helpers, and the mess e2e proves gating, the chapter line and the conclusion from an imported save.

Add `campaignConcluded(facts)` to the story module (last chapter reached **and**
every contract it opens completed — derived, no new save field), plus
`campaignChapter(save)` / `isCampaignConcluded(save)` in `src/app/campaign.ts`.
Pass both into `<Mess>`: the chapter gates the board for real, the header shows
"Chapter N — Name", and a concluded panel appears above the board once the
finale is done (the contract sandbox stays open). Fix `Mess`'s default chapter
to `MAX_STORY_CHAPTER` so standalone rendering still shows the whole board.

### T163 — Make the Saves screen work on the working campaign
- status: done
- deps: []
- files: src/ui/App.tsx, src/ui/Saves.tsx, tests/e2e/saves.spec.ts
- verify: npm run test:e2e -- tests/e2e/saves.spec.ts
- done: The camp keep shows and edits the **working** campaign rather than a fresh demo copy: App passes `campaign.save` and adopts every load/import via a new `onChange`, an imported record becomes the campaign the Mess and Field use, and the saves e2e proves an import changes the day seen outside the screen.

The Saves screen renders `<Saves />` with no props, so it initialises its own
`createDemoCampaign()` and autosaves that over the working campaign's slot:
importing or loading a record only changes the Saves screen's local copy, while
the Mess and Field keep the old campaign. Pass the working save in and adopt
`onChange` (`createCampaignState(save)`) so the camp keep, the board and the
field share one campaign. Verify with the existing saves e2e plus one assertion
that a day advanced in Saves is still the day after leaving the screen.

---

## Phase 26 — Every contract can be fought

The campaign board has 24 combat contracts but only 12 authored battle maps, and
`startCampaignBattle` quietly accepts a map-less contract and returns no battle:
the player pays the fee for an action that never happens. This phase makes every
postable combat contract deploy.

### T164 — Let a contract name its battlefield, and make the board playable
- status: done
- deps: [T161]
- files: src/data/schema.ts, src/data/contracts/battles.ts, src/data/contracts/skirmishes.ts, src/data/contracts/pacifications.ts, src/data/enemies/ordersOfBattle.ts, src/app/battleSetup.ts, src/app/campaignController.ts, tests/unit/battleSetup.test.ts, tests/unit/maps.test.ts, tests/unit/content.test.ts
- verify: npm run test -- --run tests/unit/battleSetup.test.ts tests/unit/maps.test.ts tests/unit/content.test.ts tests/unit/campaignController.test.ts
- done: A combat contract may either **post** a map (the map's `contractId`) or **name** one to fight on (`ContractDef.mapId`), `battleMapFor` resolves both, and every combat contract in the authored board resolves to a map **with an order of battle** — pinned by a test that iterates the whole board, with a built-battle assertion for a named-map contract.

Twelve combat contracts (`take-the-mill`, `clear-the-orchard`,
`silence-the-battery`, `carry-the-pass`, `the-roadside-ambush`,
`the-deserters-camp`, `sabres-at-the-ford`, `the-foragers-quarrel`,
`pacify-the-highlands`, `clear-the-green-valley`, `sweep-the-ridge`,
`open-the-crossroads`) post no map, so taking one charges the fee and opens
nothing. Add an optional `mapId` to `ContractDef` so a contract can reuse a
board (FFTA revisits maps for different missions), resolve it in
`src/app/battleSetup.ts`, relax the map/contract identity check for that case,
and point the twelve at suitable existing boards. Author the missing orders of
battle for the boards that gain a combat contract (`millford-crossing`,
`highland-pass`, `green-valley-forage`, `ridge-reconnaissance`). Then pin the
invariant: every combat contract resolves to a map with a garrison.

### T165 — Measure every campaign action
- status: done
- deps: [T164]
- files: tests/unit/campaignBaseline.test.ts, docs/BALANCE.md
- verify: npm run test -- --run tests/unit/campaignBaseline.test.ts
- done: Every combat contract is built from its resolved board and played headlessly at the map's recommended level on a fixed seed set, the test asserts each run reaches a terminal state, and `docs/BALANCE.md` records the outcome/length/casualty table with the command that reproduces it.

T164 proved every combat contract **deploys**; this proves every one **resolves**.
Some actions now share boards and others reuse garrisons, and the objective term
(T160) changed how capture/defend missions play, so a full sweep is the cheapest
way to catch a stall or a broken pairing before content grows. Use the field AI
on both sides, one seed per contract, the map's `recommendedLevel` for the
company, and assert only the structural contract (finished, terminal, under the
turn cap) — the numbers go in the document, not the test.

---

## Phase 27 — Make the campaign's actions fair

T165 measured every action and found three orientation/balance faults. Each is
its own task so the fixes can be measured one at a time.

### T166 — Put the defender on the ground it defends
- status: done
- deps: [T165]
- files: src/data/maps/redoubt-stand.json, src/data/maps/battleMaps.ts, src/data/contracts/battles.ts, src/data/contracts/pacifications.ts, tests/unit/maps.test.ts, tests/unit/campaignBaseline.test.ts
- verify: npm run test -- --run tests/unit/maps.test.ts tests/unit/campaignBaseline.test.ts
- done: On every `defend` board the company deploys on or adjacent to the defended tile and no enemy starts as close to it, so the defeat rule cannot fire before the company can contest the ground; contracts that describe an assault no longer reuse a `defend` board, a map test pins the orientation, and the T165 sweep shows those actions lasting long enough to be fights.

T165 showed `carry-the-pass` and `pacify-the-highlands` ending after **one**
turn and `hold-the-redoubt`/`silence-the-battery` after three: on
`redoubt-stand` and `highland-pass` the company starts two-plus tiles from the
point while the enemy is as close or closer, and an enemy on the tile is an
immediate defeat. Move the company deployment onto the defended ground (the
redoubt crest, the pass track) and push the enemy back, then give the assault
contracts (`carry-the-pass`, `silence-the-battery`) an assault board or objective
rather than a defend map. Re-run the sweep and record the new rows.

### T167 — Reconcile recommended levels with the company's growth
- status: done
- deps: [T165]
- files: src/engine/stats.ts, src/data/posts/*.ts, src/data/maps/*.json, docs/BALANCE.md, tests/unit/stats.test.ts, tests/unit/campaignBaseline.test.ts
- verify: npm run test -- --run tests/unit/stats.test.ts tests/unit/campaignBaseline.test.ts
- done: A level-1 company is a plausible starting detachment (not an order of magnitude weaker than the authored irregulars), each map's `recommendedLevel` reflects the level at which that action is a contest, and the T165 table records the after-state.

A level-2 post-derived soldier has ~16 HP and ~17 ATK while every authored
irregular carries 50–70 HP and ~30 ATK at any level, so the actions recommending
levels 1–3 cannot be won by the field AI and all five chapter battles lose at
their advertised level. Decide the level-1 baseline — either add a per-post
**base stat block** to `deriveStats` (so growth multiplies on top of a
starting line) or raise the map `recommendedLevel`s to where the company's
linear growth matches the flat enemy line — implement it consistently, and
re-measure. This is a D24-level decision; record it in `docs/BALANCE.md`.

### T168 — A stable campaign baseline and the last level retune
- status: done
- deps: [T167]
- files: tests/unit/campaignBaseline.test.ts, src/data/maps/orchard-skirmish.json, src/data/maps/battleMaps.ts, docs/BALANCE.md
- verify: npm run test -- --run tests/unit/campaignBaseline.test.ts
- done: The sweep plays each action on two fixed seeds and reports the win split, the two boards whose actions lost consistently at their hint are retuned (`orchard-skirmish` 3, `guerrilla-camp` 4), and the after-table is recorded.

T167 left six low-level losses, but a single seed is a noisy read: re-running the
same actions on a second seed flipped several results. Play each action twice,
report the split, and retune only the boards that lost both seeds — the orchard
(where every action is level 3 now) and the guerrilla camp (level 4). The coast
road remains a genuine 1–1 split, which is a contest rather than a fault.

### T169 — Show a contract's recommended level in the Mess
- status: done
- deps: [T168]
- files: src/ui/contractLevel.ts, src/ui/Mess.tsx, src/i18n/index.ts, src/ui/styles.css, tests/unit/contractLevel.test.ts, tests/e2e/mess.spec.ts
- verify: npm run test -- --run tests/unit/contractLevel.test.ts && npm run test:e2e -- tests/e2e/mess.spec.ts
- done: Each combat contract's card shows its board's recommended level, and a company below that level sees an under-strength note; the pure helpers are unit-tested and the mess e2e pins the line for a level-1 and a level-6 action.

`recommendedLevel` is authored on every map (and T168 made it honest) but the
player never sees it: the board shows fee, requirements and reward only. Add the
hint to the card from `battleMapFor`, with a plain `isUnderLevel(company,
contract)` comparison against the roster's average level, and style the
under-strength case so a fresh company can see which posts are out of reach.

---

## Research & open questions

Resolved decisions are recorded with their reasoning in **`docs/BALANCE.md`**
(D16–D25); the numbers live in named constants and authored data, never in
logic.

- [x] Physical/magical damage formulas — step-wise reading kept, garbled secondary line rejected, healing authored (**D16/D17**, T033/T034/T036).
- [x] Élan (MP) regeneration — authored as 20% of each soldier's maximum pool per 10 ticks, with Shaken at 50% and Routed at 0 (**D20**, T040/T149).
- [x] Orders Tempo charge values, per-action tempo and Speed scaling — threshold 100; act 80% / move 70% / hold 50%; Haste ×2, Slow ÷2; first turn full (**D19**, T019/T148).
- [x] Drill-to-mastery thresholds per ability — authored as `EquipmentDef.teaches[].ap` and resolved by `src/engine/progression/drill.ts` (**D25**, T048).
- [x] Post-unlock thresholds — two abilities for a branch post, three for a deeper one, authored per post (**D21**, T046).
- [x] Article generation frequency/pool and commended-action weighting — day schedule 1+1 → 2+1 → 2+2 → 3+2 at days 1/8/16/32, weighted draw without replacement, Article `honour` paid on a commended act (**D22**, T055).
- [x] Volley damage scaling with Honour and number of linkers — `(10 + 4×honour + 2×min(linkers, 4))/10` (**D23**, T061/T150).
- [x] FFTA-specific stat-growth formula — `floor(growth × level)` truncated once, incremental level-ups, cap 50 and 100 XP per level (**D24**, T018/T049).
- [ ] **Tune the baseline.** The D16–D24 values are a defensible starting point, not a verdict; run the headless gauntlet (T130) and playtests, then record any change in `docs/BALANCE.md`.
- [ ] **FFTA's own MP regeneration is still undocumented** — `MP_(stat).md`'s FFTA section remains a stub, so D20 is ours; revisit if the reference expands.
- [ ] **Campaign content breadth** — contracts, maps and enemies are thin for a full campaign; that is content work, not a formula question.
- [x] **Ability effects are wired into `step` (T117).** `declareOrResolveAction` (`src/engine/actions/resolve.ts`) now composes `executeAbility` (T041), reactions (T042) and support traits (T043) into both instant and charged resolution, drawing all randomness from the battle's seeded PRNG stream (`tempo.rng`). A live `act` reduces HP and can KO, so T113's headless skirmish reaches a decision instead of a ceasefire; replays stay byte-identical.
