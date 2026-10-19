# The combat loop contract

This is the canonical, player-facing combat loop for **Lines of Glory**. It is a
contract, not a tutorial: future changes to input, controller, UI, AI or engine
must preserve it. The implementation lives in `src/app/battleController.ts` and
`src/app/input.ts`; the rules live in `src/engine/battle.ts`.

See also `agents.md` §7 (commands are the only way to mutate the world) and
`docs/PEER_COMBAT_LESSONS.md` L3 (why the engine has a folded move clause at
all).

The canonical loop is **select → preview/commit move → action menu →
target/confirm act → or End Turn**.

---

## The loop

```
select a soldier
      │
      ▼
preview a march ──confirm──▶ commit `move`   (optional)
      │                         │
      │ cancel                  ▼
      └────────────────▶ action menu (same soldier, new tile)
                                │
                                ├── choose an order
                                │        │
                                │        ▼
                                │   target → forecast → confirm
                                │        │
                                │        ▼
                                │   dispatch one `act` → turn ends
                                │
                                └── End Turn ──▶ dispatch one `wait`
```

A turn therefore has **two optional halves and an explicit close**:

1. **Move (optional).** Select the acting soldier, preview a legal path, then
   confirm the destination. The preview itself changes no state. Confirming
   dispatches exactly one `move` command and resolves it immediately. The march
   does **not** end the turn.
2. **Act (optional).** The same soldier still owns the turn and stays in the
   `command` phase with the action menu. Choosing an order computes targeting
   from the soldier's **committed tile**, never from a previewed destination.
   Confirming dispatches exactly one `act` command; acting closes the turn.
3. **End Turn (always available while the turn is open).** The explicit End
   Turn control dispatches exactly one `wait` command. It closes a turn whether
   the soldier marched, acted not at all, or did neither.

The UI phases mirror this exactly (`BATTLE_UI_PHASES`):

| Phase     | Player is doing                                      | Confirm dispatches |
| --------- | ---------------------------------------------------- | ------------------ |
| `select`  | Choosing which soldier to inspect / command          | —                  |
| `command` | Reading the action menu, or choosing End Turn        | —                  |
| `move`    | Previewing a march                                   | `move`             |
| `target`  | Aiming an order                                      | —                  |
| `confirm` | Accepting the forecasted order                       | `act`              |
| `finished` | Reading the after-action result                     | —                  |

---

## Invariants

### One confirm, one command

Every player confirm produces **exactly one** entry in
`BattleController.lastCommands`:

- march confirm → `["move"]`
- order confirm → `["act"]`
- End Turn → `["wait"]`

The player path must never produce `["move", "act"]` or `["move", "wait"]` in a
single dispatch. In particular:

- `commitMarch` is the only player-path way to move and it sends only a `move`.
- `chooseAction` refuses while a march is merely previewed; the player must
  commit or cancel the preview first.
- `dispatchPlan` builds an `act` from the soldier's current `unit.at`; it never
  reads a retained path and never folds a move into the command.
- End Turn uses `waitOrder`, never a synthetic move or a bundled order.

### The folded `move` clause is AI/replay-only

`ActCommand.move` (`src/engine/commands.ts`, T124) can carry
`{ to, order: "before" | "after" }` so a complete move-and-act turn is one
atomically validated, replayable command. That is deliberately retained for:

- AI decisions and headless balance harnesses;
- replays, scripts and future lockstep netcode;
- engine unit tests that pin the atomic-fold behaviour.

It is **not** a player command. `BattleController` never builds an
`ActCommand.move`. Do not reintroduce staged `[move, act]` by retaining a
preview path across `chooseAction`, by making `dispatchPlan` look at
`pendingPath`, or by "optimising" the two UI dispatches into one. The human loop
is intentionally two commands in two confirms, so the player sees the action
menu and forecast from the tile they actually occupy.

### The engine is authoritative

- Target tiles, forecasts, affordability and legality are derived from committed
  state (`unit.at`, `hasMovedThisTurn`, `hasActedThisTurn`), never from a
  preview.
- The controller's `turnBudget` reads the same flags `validateCommand` enforces,
  so the UI cannot offer a march after a march or an action after an action.
- Cancelling a preview or backing out of targeting consumes no slot and
  dispatches no command.
- A rejected confirm emits no command and leaves the open turn open.

---

## What the tests pin

- `tests/unit/battleController.test.ts` — the controller's dispatch records:
  march confirmation, action-from-committed-tile, End Turn, and the absence of
  bundled `[move, act]` / `[move, wait]`.
- `tests/unit/battle.test.ts` — the engine's own move-once / act-once budget and
  the AI-only folded `ActCommand.move`.
- `tests/e2e/turnLoop.spec.ts` — the loop through the real canvas: command band
  after a march, targeting/forecast from the new tile, explicit End Turn, and
  one command per confirm.
- `tests/e2e/endTurn.spec.ts` — End Turn before and after a march.

If you change the loop, update this document and those tests together.
