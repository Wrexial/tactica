# Peer combat-engine lessons

Three open-source turn-based tactics engines were studied as reference for
**Lines of Glory**'s combat loop. This file records what they do, what is worth
copying, and what is deliberately *not* worth copying. It is a design note, not
a contract; `agents.md` + `todo.md` remain authoritative.

Sources (consulted 2026-xx; not vendored, not dependencies):

- **TinyWarsClient** — <https://github.com/Babygogogo/TinyWarsClient>
  An *Advance Wars*–style lockstep-multiplayer tactics game (Egret/TypeScript).
  Relevant modules under `src/modules/{baseWar/model,tools/warHelpers}`:
  `BwTurnManager`, `WarActionReviser`, `WarActionExecutor`, `WarDamageCalculator`.
- **The Unseen Hand** — <https://github.com/Raafiq/the-unseen-hand-turn-based>
  A *Final Fantasy Tactics*–style game with a **pure headless simulation**
  (`src/sim`) plus a thin viewer, 1088 tests and a determinism guard. Its
  `docs/05-simulation-and-state-model.md` and `docs/01-combat-system.md` are the
  most directly comparable design docs to our `src/engine`.
- **fft-phaser / FFT Blue** — <https://github.com/kuirsan26-lab/fft-phaser>,
  live at <https://fft-blue.vercel.app/>. A small *Final Fantasy Tactics* hobby
  clone on **Phaser 4 + Vite** (`ARCHITECTURE.md`,
  `src/systems/{TurnManager,CombatSystem,Pathfinder}.ts`). No tests, no
  determinism, logic lives in `BattleScene`. Its value here is **gameplay feel
  and UI** — especially its per-character HUD — and as a catalogue of
  anti-patterns to avoid.

All three are FFT/Advance-Wars lineage. None is FFTA, but all solve the same
problems we do: charge-time turns, grid combat, deterministic replays, and an
engine that must run headless for tests and AI.

---

## 1. What the peers do (short version)

### TinyWars — validate, then execute, then log

The whole game is expressed as a single **action container**: a discriminated
union with exactly one populated field (`WarActionUnitAttackUnit`,
`WarActionPlayerEndTurn`, …). Every mutation flows through it.

```
player/AI -> raw action
          -> WarActionReviser.revise(war, raw)   // validate + NORMALISE, throws on illegal
          -> WarActionExecutor.checkAndExecute(war, revised, isFast)
          -> ExecutedActionManager.addExecutedAction(revised)
```

- **Revision is separate from execution.** `revise` re-derives the canonical
  action, rejects illegal ones, and *rewrites* stale input (e.g. `getRevisedPath`
  re-walks a move path so hidden units / fog-of-war differences between clients
  can't desync). The **revised** action is what gets logged and broadcast.
- **A monotonic `actionId` guard.** `addExecutedAction` throws unless
  `actionId === executedActionsCount`. A missing/duplicated/reordered action is
  caught immediately.
- **`fast` vs `normal` execution.** The *same* executor has a headless `fast`
  path (state only, no animation) and a `normal` path (state + `await`ed
  animation + sounds). The two produce identical state.
- **Estimated vs final damage.** `getEstimatedBattleDamage` (no luck) drives the
  UI preview; `getFinalBattleDamage` (with a seeded "luck" roll) drives the real
  hit. Both read the battle's seeded `RandomNumberManager`.
- **Turn phases are an explicit ordered list.** Start-of-turn
  (`WaitBeginTurn`) runs: income → fuel → tile repair → out-of-fuel destruction
  → unit supply → CO recovery → map weapons → AI mode → `Main`. End-of-turn
  (`Main`) runs: reset unit action state → reset vision → tick turn/player index
  → reset skills → reset votes → weather → vision → `WaitBeginTurn`.
- **Pinned, id-based resolution order** for repair/supply (`cost` desc, then
  `unitId` asc) so array order can never change the outcome.

### The Unseen Hand — one timeline, one driver, pinned tie-breaks

A pure `(seed, command log)` simulation. Highlights:

- **Units and charged actions are first-class actors on the same timeline.**
  `Actor = Unit | ChargedAction`, both with `ct`, `ctRate()`, and a priority key.
  A charge carries its **own speed**, can be interrupted at maturity, and can
  outlive its caster.
- **Pinned, RNG-free tie-break:** higher `ct` → charged action before unit →
  **lower actor id (locale-independent lexicographic)**. `tieBreak` is a total
  order; the code explicitly refuses to fall back on array/insertion order.
- **One decision primitive shared by UI and harness:**
  `advanceToDecision(state)` auto-resolves matured charges and KO crystal ticks
  and surfaces the next living unit; `applyCommand` then applies exactly one
  command. Interactive play and the AI benchmark harness call the *same*
  primitive, so "who acts next" can never diverge.
- **Action economy folded into one command.** A turn is Move + Act each once, in
  either order. `act` may carry an optional `move { to, order: "before"|"after" }`
  clause and settles **exactly once** (−100 both / −80 one / −60 wait). They call
  out that before the fold the −100 case was unreachable dead code.
- **Charged resolution is tile-based and interruptible.** A charge aims at a
  *tile*; if the occupant walks away it whiffs. At maturity, KO/Stop/Sleep/
  Don't-Act cancels it. Charge effects are carried *inside* the charge so the
  resolver never re-reads a content registry during replay.
- **Declared RNG consumption order** (hit → reaction trigger → reaction swing →
  crit → status), with a test asserting that a unit *without* a reaction
  consumes exactly the pre-reaction number of draws.
- **Accounting events for every resolution**, credited to the actor, with a
  **friendly-fire tripwire** that throws if an action lowers a same-team unit's
  HP — so a future mechanic surfaces instead of silently mis-crediting. A
  reaction (counter) emits its **own** event credited to the *reactor*.
- **Statuses decay in CT ticks** inside the scheduler; permanent statuses are a
  sentinel and never decay.
- **Six independent `schemaVersion` lines** (battle, content, roster, campaign,
  encounter, story) each with its own migration registry and loud-fail loader.

### FFT Phaser — a thin, direct gameplay slice (and a cautionary tale)

A 2.3k-line implementation of the same idea, with the whole game in one
`BattleScene` plus four systems. It has no tests and no determinism, but it
ships a surprisingly complete **feel**:

- **Threat overlay on hover.** Hovering an enemy paints every tile it could
  reach with its longest-ranged ability (`showDangerZone(getCellsInRange(...))`)
  — the single most useful tactical readout in the genre.
- **Turn-order rail with CT bars.** `TurnOrderPanel` sorts living units by `ct`
  and paints a per-unit CT meter, so the player sees the clock, not just the
  current actor.
- **Autobattle toggle**, floating damage numbers, HP bars coloured by fraction,
  and a battle log.
- **Per-turn flags** (`hasMoved`, `hasActed`) and a start-of-turn ordering:
  `ct -= 100` → `resetTurnFlags()` → `tickStatuses()` → `regenMp()`.
- **Simple, inspectable AI:** provoked → hit the provoker; else best affordable
  ability in range; else melee the **weakest** foe; else step toward the nearest.
- **Campaign string:** permadeath, stat-scaled encounters (×0.7 → ×1.7), and
  HP/MP carried between battles.

It also demonstrates the failure modes that our `agents.md` §2 rules exist to
prevent — see §3.

---

## 2. Lessons we should adopt (ranked)

Each item names the file/task it touches and why it matters for us.

### L1 — Take the RNG out of the turn-order tie-break *(highest value)*

**Peer:** Unseen Hand pins `(ct desc, charge-first, id asc)` and keeps the
scheduler RNG-free. TinyWars' turn order is deterministic round-robin.

**Us:** `src/engine/turn.ts` `chooseActor()` breaks same-charge ties with
`Rng.fromState(state.rng)`, and `src/engine/actions/resolve.ts` consumes the
**same** stream. So the turn order depends on how many combat rolls happened
before a tie, and adding/removing a single combat roll can reorder turns.

**Why it's a problem:** turn order is a *rules* quantity, not a random effect.
Coupling it to the combat stream makes it fragile across balance tweaks and
makes "why did this unit act first?" unreproducible without replaying all rolls.

**Recommendation:** break ties by charge desc, then a stable id order
(branded id ascending). Keep the seeded RNG exclusively for combat
(hit/crit/status/luck).
This is a documented design decision in `turn.ts`, so change it deliberately and
add a crafted tie test (T019).

### L2 — Split the engine into `advanceToDecision` + `applyCommand`

**Peer:** Unseen Hand's single decision primitive is reused by interactive play
and the headless benchmark harness.

**Us:** `step()` in `src/engine/battle.ts` inlines three jobs: validate, apply,
and advance the clock (including resolving matured charges and skipping downed
actors). AI lookahead (T095/T099) and replays therefore have to reimplement or
round-trip through `step`.

**Recommendation:** expose
`advanceToDecision(state) -> { state, actorId, terminal }` (auto-resolving
matured charges / skipping downed actors) and
`applyCommand(state, command) -> BattleStepResult`, then keep
`step = advanceToDecision` + `applyCommand` as the ergonomic wrapper. This is
the single biggest enabler for AI simulation and balance harnesses, and it
matches our existing event-driven architecture.

### L3 — Make Move+Act a single atomic command (with two-command UX kept)

**Peer:** Unseen Hand folds both sub-phases into one `act` command carrying an
optional `move { to, order: "before"|"after" }`, settling once.

**Us:** `battle.ts` keeps a turn open with `hasMovedThisTurn`; the controller
composes a `move` then a later `act`/`wait` (T115). A `move` that is never
closed leaves a half-open turn the driver must remember to finish.

**Recommendation:** allow an optional `move` clause on `ActCommand` (or a
dedicated `moveAct` command) so a *full* turn is one logged, atomically
validated command, while the input layer keeps the friendly two-step UX. Settle
once, and make the "before" (close-and-strike) vs "after" (hit-and-retreat)
order explicit — never defaulted, because it changes the tile the act resolves
from. Add a test that a folded turn costs exactly one turn and the same charge
as its two-command equivalent.

### L4 — Decide tile- vs unit-anchored charged abilities (and test it)

**Peer:** Unseen Hand resolves a matured charge against the **target tile**, so
the target can dodge by walking away; interrupt set is pinned.

**Us:** `pendingTargetOf` in `resolve.ts` reconstructs a unit-targeted charge as
`{ kind: "unit", unitId }`, so a delayed single-target ability **homes** onto
the named soldier's current position. FFTA-family games resolve delayed
abilities on the tile/grid.

**Recommendation:** pick the faithful reading (tile-anchored, can whiff),
document it, and add a test. Keep the out-of-action caster cancellation we
already have. This is a genuine rules divergence hiding in the pipeline.

### L5 — Hoist charges to first-class actors in Orders Tempo

**Peer:** Unseen Hand: `Actor = Unit | ChargedAction`, each with its own speed.

**Us:** `TempoCharge` lives inside a `TempoEntry.pending[]` and ticks down by 1
per tick. It works, but it means a charge cannot outlive its unit entry and its
timing is tied to the unit's presence.

**Recommendation (medium):** at minimum guarantee a charge resolves even if its
caster entry is removed, and record an interrupt check at maturity. Optionally
move charges into a top-level actor list so `advanceToDecision` handles them
uniformly. Also consider a per-charge `speed` field (FFTA charge time is fixed
ticks, but data-driven speed lets "Short Charge"-style content exist later).

### L6 — Per-unit action budget, not just `hasMovedThisTurn`

**Peer:** TinyWars tracks `UnitActionState.Idle | Acted`; Unseen Hand tracks
`didMove` / `didAct` to price the turn.

**Us:** `hasMovedThisTurn` is a single boolean; "acted" is implicit in ending
the turn.

**Recommendation:** track `hasMovedThisTurn` **and** `hasActedThisTurn` (or a
small `turnBudget` record) so free actions, combos/Volleys, and reaction-driven
extra actions are expressible without special-casing `commandEndsTurn`. It also
makes the −100/−80/−60-style pricing available if we ever want it.

### L7 — Pin the per-action RNG consumption order

**Peer:** Unseen Hand documents hit → reaction trigger → reaction swing → crit →
status and tests exact draw counts, including "no reaction consumes no extra
draws".

**Us:** the shared stream is documented in `turn.ts`/`resolve.ts`, but the
*order* of draws within an action is implicit.

**Recommendation:** write the order down next to the resolution pipeline and
add an exact-draw-count test (extends `determinism.test.ts`). This is cheap and
catches a whole class of "adding an optional roll shifted everything" bugs.

### L8 — Depend on a single pinned total order for all sorts

**Peer:** both engines sort by explicit `(primary desc, then id asc)` and never
rely on array position.

**Us:** we already do this in places (objective, repair-style sorters). Make it
a rule: any time two entities can tie, add an id tiebreaker. Audit the new
schedulers/reaction resolution for it.

### L9 — Add resolution-accounting with a friendly-fire tripwire

**Peer:** Unseen Hand credits contributions by diffing HP and *throws* if an
action lowers a same-team unit's HP, forcing new friendly-fire mechanics to
account themselves. Reactions emit their own credited events.

**Recommendation:** a pure `accountResolution(before, after, sourceUnitId)`
helper used by AI evaluation (T095/T099), battle reports, and the difficulty
harness. The tripwire is the valuable part: it turns a silent mis-credit into a
loud failure.

### L10 — Explicit, ordered turn-phase pipelines

**Peer:** TinyWars lists start/end-of-turn phases in code, in order.

**Us:** `step` resolves charges then scores the objective; start-of-turn
upkeep (poison/Élan regen/conditions, general orders, article checks) is
scattered across `rules/`.

**Recommendation:** define an explicit ordered `beginTurn`/`endTurn` phase list
for an Orders Tempo turn (upkeep → optional move → optional act → reactions →
charge drain → objective → next actor) and test the order. This is the natural
home for T039/T040/T054+ upkeep.

### L11 — Headless fast-forward for AI and balance

**Peer:** TinyWars' `fast` executor; Unseen Hand's benchmark harness runs full
AI-vs-AI battles headlessly (its "build-diversity gate").

**Recommendation:** once L2 lands, add a `runBattle(setup, aiA, aiB)` headless
loop that never touches render/UI. Use it for AI tuning (T095), difficulty
tiers (T099), and a balance smoke test — the same way both peers use their sim.

### L12 — Paint the enemy danger zone on hover/select

**Peer:** fft-phaser (`BattleScene.setupUnitSprite`, `GridSystem.showDangerZone`)
computes the union of every reachable tile and the max ability range and paints
it when an enemy is hovered.

**Us:** we have reach/targeting previews (T085) and a move overlay, but a
combined "what can this enemy hit next turn" readout is the highest-value
missing UX affordance. It is pure presentation over `pathfinding` + `targeting`;
it must live in `src/render`/`src/ui` and call the same range functions the
engine uses — never a parallel formula. (Cf. Unseen Hand's AC-016, which asserts
the viewer's reach equals the engine's `inAbilityRange`.)
**Recommendation:** add the overlay, importing `movement.ts`/`targeting.ts` so
preview and rules can never drift.

### L13 — A turn-order rail must show the CT clock, not just the next actor

**Peer:** fft-phaser's `TurnOrderPanel` sorts by `ct` and draws a CT bar per
unit; Unseen Hand's viewer has a turn-order rail too.

**Us:** T083 (Orders Tempo tray) is done; make sure it exposes each unit's
current charge as a bar and re-sorts after every `step`, not only on
`turnStarted`. This is a read-only projection of `OrdersTempo` — exactly what
`previewTurns` was built for.

### L14 — Start-of-turn upkeep is a pinned, ordered list

**Peer:** fft-phaser runs `ct -= 100` → `resetTurnFlags()` → `tickStatuses()` →
`regenMp()` at the moment a unit is granted its turn; TinyWars lists its whole
upkeep pipeline.

**Recommendation:** this is the concrete shape of **L10**. Order matters:
charge spend, then per-turn flags reset, then condition ticks, then Élan regen,
then objective scoring. Pin it in one function and test the order.

### L15 — Keep a cheap fallback AI tier

**Peer:** fft-phaser's AI is ~40 lines (provoked → best ability → weakest foe →
advance). It is inspectable and adequate for MVT encounters.

**Recommendation:** our utility AI (T095) is the right target, but keep a
`naiveAi` fallback for fixtures, cold-start encounters, and "ally auto-battle"
(T098). A degenerate-but-deterministic policy is invaluable for tests.

### L16 — A per-character HUD, not a permanent side panel

**Peer:** FFT Blue. It keeps almost no persistent chrome:

- `BattleScene.showUnitInfo(unit)` builds a small rounded panel — name, HP/MP,
  ATK/DEF, MAG/SPD, MOV/JMP — and **anchors it beside the hovered soldier's
  screen position**, flipping to the other side near the right edge and clamping
  to the top (`ix + w > width - 10 ? pos.x - w - 20 : pos.x + 20`).
- `ui/ActionMenu.ts` is a **content-sized vertical menu pinned bottom-left**
  showing only the active unit's available commands.
- `ui/TurnOrderPanel.ts` is a **top rail** of CT bars; `UIScene.ts` carries only
  a one-line “whose turn” status and the end-of-battle overlay.
- HP bars, team colour and state read off the soldier on the field itself.

**Us:** `src/ui/App.tsx` stacks everything into a permanent `aside.hud` — unit
card, phase, stat chips, key hints, rejection, forecast, the full action menu
and the battle log. The information is right but the placement is wrong: it
steals a fixed column, duplicates the world-space bars we already draw
(`src/render/units.ts`), and never follows the action on the field.
**Recommendation:** adopt the FFT Blue arrangement — an anchored hover/selection
card, a bottom command band, a toggled log, details in tooltips — while keeping
the existing `data-testid`s so the e2e suite stays the contract. Tracked as
**Phase 15** in `todo.md`.

---

## 3. What *not* to copy

- **TinyWars' renderer/sound coupling inside the executor.** Its `normal`
  executor `await`s animation and plays SFX. We already do better: the engine
  emits `BattleEvent`s and the renderer subscribes (`agents.md` §7). Keep it
  that way — do **not** let animation timing leak into `src/engine`.
- **TinyWars' `Math.random`-seeded "luck".** Fine for a client-authoritative
  game; our determinism invariant requires the seeded engine PRNG (which we
  have). Do not import a second randomness source.
- **Unseen Hand's 1000-line e2e suite and 6-way schema split verbatim.** Good
  ideas, but our project is smaller; adopt the *pattern*, not the volume.
- **Units vs. battalions scale, permadeath/crystal timers, Zodiac/Brave/Faith.**
  Out of scope per `NAPOLEONIC_MAPPING.md` §14 (we have Reprimands/Court-Martials
  and Jagd loss instead).
- **fft-phaser's engine-in-the-scene, `Math.random`-in-rules style.** Concretely
  do **not**: put simulation logic in scene classes (our engine is DOM-free);
  roll `Math.random()` inside a damage formula
  (`raw - mitigation + Math.random() * 6 - 3`); stagger starting CT with
  `Math.random()`; or pass campaign state through `scene.start`. Every one of
  these breaks `agents.md` §2 determinism/engine-purity and makes replays and
  tests impossible. It also has **no tests and no lint**, which is why these
  bugs are invisible there.
- **Per-tile terrain with no mechanical effect.** fft-phaser's own backlog calls
  this out ("forest = an ordinary tile") — a reminder that our `terrain.ts`
  bonuses must actually be read by damage/hit (T033/T037), not just rendered.

---

## 4. Suggested follow-ups

These are proposals; add them to `todo.md` (with ids) before implementing.

| #   | Change                                              | Files                                    | Task   |
| --- | --------------------------------------------------- | ---------------------------------------- | ------ |
| A   | Deterministic, RNG-free turn-order tie-break        | `src/engine/turn.ts`, `tests/unit/turn.test.ts` | T019 |
| B   | `advanceToDecision` + `applyCommand` split          | `src/engine/battle.ts`                   | T022   |
| C   | Optional `move` clause on `ActCommand`, one settle  | `src/engine/commands.ts`, `battle.ts`    | T115   |
| D   | Tile-anchored charged abilities + whiff test        | `src/engine/actions/resolve.ts`          | T024   |
| E   | Document + test exact RNG draw order per action     | `resolve.ts`, `tests/unit/determinism.test.ts` | T023 |
| F   | `hasActedThisTurn` / turn-budget record             | `src/engine/battle.ts`                   | T115   |
| G   | `accountResolution` helper + friendly-fire tripwire | new `src/engine/accounting.ts`           | T095   |
| H   | Ordered `beginTurn`/`endTurn` phase pipeline        | `src/engine/battle.ts`                   | T024   |
| I   | Headless `runBattle` loop for AI/balance            | `src/ai/`, `tests/unit`                  | T095/T099 |
| J   | Enemy danger-zone overlay sharing engine range fns  | `src/render/`, `src/ui/`                 | T085   |
| K   | CT bar per unit in the Orders Tempo rail            | `src/ui/TempoTray.tsx`                   | T083   |
| L   | Pinned start-of-turn upkeep order + test            | `src/engine/battle.ts`                   | T040   |
| M   | Cheap deterministic `naiveAi` fallback              | `src/ai/naive.ts`                        | T098   |
| N   | Camera-aware `Scene.project` + HUD anchor helper    | `src/render/`, `src/ui/unitHud.ts`       | T133   |
| O   | Per-character HUD replacing `aside.hud`             | `src/ui/App.tsx`, `src/ui/styles.css`    | T134–T137 |
