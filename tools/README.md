# tools/

## `todo.mjs` — task runner

A zero-dependency Node CLI that parses `todo.md`, reports the next actionable
task, validates the dependency graph, and can sequentially drive a coding agent.

```bash
node tools/todo.mjs check                 # validate the task graph (IDs, deps, cycles)
node tools/todo.mjs list                  # list tasks grouped by phase
node tools/todo.mjs list --status todo    # filter by status
node tools/todo.mjs next                  # print the next actionable task
node tools/todo.mjs show T014             # full task detail
node tools/todo.mjs prompt T014           # the agent prompt for a task
node tools/todo.mjs verify T014           # run the task's verify command
node tools/todo.mjs mark T014 doing       # set a task's status
node tools/todo.mjs commits               # audit: done tasks vs. their commits
node tools/todo.mjs split                 # commit + push done-but-uncommitted work, one commit per task
```

### Running tasks sequentially

```bash
# Dry run: show what would happen and the prompts (default when no --agent).
node tools/todo.mjs run --phase 0

# Drive the Pi coding agent, verifying and marking each task done in turn.
# `@file` includes the generated prompt; works cross-platform.
node tools/todo.mjs run --agent 'pi --print "@{promptFile}"'
node tools/todo.mjs run --from T011 --until T023 --no-push
TODO_AGENT='pi --print "@{promptFile}"' node tools/todo.mjs run
```

Options:

| Flag | Meaning |
| ---- | ------- |
| `--agent "<cmd>"` | Command template (or `TODO_AGENT` env var). Omit for dry run. |
| `--from T0NN` | Start at this task (inclusive). |
| `--until T0NN` | Stop after this task (inclusive). |
| `--phase 3` | Restrict to a phase (a bare number matches that phase exactly). |
| `--limit N` | Run at most N tasks. |
| `--dry-run` | Print prompts without executing. |
| `--no-commit` | Do not commit after each task. |
| `--no-push` | Commit locally but do not push after committing. |
| `--no-split` | Skip the pre-run commit of unfinished prior work. |
| `--file todo.md` | Use a different task file. |

**`run` loop per task:** mark `doing` → run the agent command → run `verify` →
mark `done` → **`git commit` (one commit per task, subject `feat(T0NN): title`) →
`git push`**. Use `--no-commit` to skip the commit (and therefore the push) or
`--no-push` to keep local commits without publishing. A task is only actionable
when every dependency is `done`.

**Keep `verify` task-scoped.** A task's `verify` should be the narrowest command
that proves its `done:` condition — normally its own spec/test files (e.g.
`npm run test -- --run tests/unit/grid.test.ts` or
`npm run test:e2e -- tests/e2e/settings.spec.ts`), never the whole suite. A
whole-suite `verify` marks a task `failed` for an **unrelated** regression,
which is exactly the noise the board should avoid. Chain commands with `&&` when
a task owns both unit and e2e coverage, and reserve `npm run build` /
`npm run typecheck` for foundation/render tasks that have no dedicated tests.

Template placeholders: `{promptFile}`, `{id}`, `{title}`, `{file}`.

### Commits

Each completed task gets its own commit so history is task-granular, and commits
made by the runner are pushed by default. A failed push logs a warning but leaves
the local commits intact; pass `--no-push` when working offline.

- `commits` — for every `done` task, show its dedicated commit (by matching
  `feat(T0NN)` in the log) or flag it as missing.
- `split` — take work a previous run left uncommitted and commit it **one task
  at a time**, then push. Files are attributed to tasks via each task's `files:`
  list; a file owned by more than one task (or by none) goes into a trailing
  `chore: project config and task board` commit. Runs automatically (dry-run
  preview, commit, then push) before a `run` unless `--no-split`.
- `split --base <ref>` — rewrite `<ref>..HEAD` into one commit per task
  (history rewrite; the runner force-pushes with `--force-with-lease` unless
  `--no-push`). Requires a clean tree and `--yes`.

```bash
node tools/todo.mjs commits
node tools/todo.mjs split --dry-run          # preview
node tools/todo.mjs split --yes              # commit + push uncommitted done work
node tools/todo.mjs split --base HEAD~5 --yes # rewrite a range, then force-push
```

### `todo.md` format

- Phases: `## <name>`
- Tasks: `### TNNN — Title` (three-digit, unique)
- Bullets (one per line): `status:` (`todo|doing|done|blocked|failed|skipped`),
  `deps:` (`[]` or `[T001, T002]`), `verify:` (shell command or `—`), `done:`,
  optional `files:`, optional `milestone:`.
- Free prose after the bullets is the description; the runner passes it to the
  agent.

Keep bullets to a single line — wrapped values will be read as description text.
