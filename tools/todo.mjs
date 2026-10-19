#!/usr/bin/env node
/**
 * todo.mjs — task runner for the Lines of Glory task board.
 *
 * Parses `todo.md` (format documented in tools/README.md), reports the next
 * actionable task, validates the dependency graph, and can sequentially hand
 * tasks to a coding agent, verify them and mark them done.
 *
 * Zero dependencies (Node built-ins only) so it runs before `npm install`.
 *
 * Usage:
 *   node tools/todo.mjs list [--phase 0] [--status todo] [--json]
 *   node tools/todo.mjs next [--json]
 *   node tools/todo.mjs show T001 [--json]
 *   node tools/todo.mjs prompt T001
 *   node tools/todo.mjs check
 *   node tools/todo.mjs commits            # audit: done tasks vs. their commits
 *   node tools/todo.mjs split [--base <ref>] [--yes] [--dry-run]
 *   node tools/todo.mjs mark T001 done
 *   node tools/todo.mjs verify T001
 *   node tools/todo.mjs run [--agent "<cmd>"] [--from T001] [--until T010]
 *                           [--phase 0] [--limit N] [--dry-run]
 *                           [--no-commit] [--no-push] [--no-split]
 *
 * `run` commits **and pushes** after each task by default (one commit per task);
 * `--no-commit` / `--no-push` opt out independently. Before a run, any `done`
 * tasks left uncommitted by a previous run are split into one commit each and
 * pushed (`--no-split` opts out).
 *
 * Agent command template placeholders: {promptFile} {id} {title} {file}
 * Recommended (cross-platform) agent command:
 *   pi --print "@{promptFile}"
 * If `--agent` is omitted (or TODO_AGENT is unset) `run` is a dry run.
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const STATUSES = ["todo", "doing", "done", "blocked", "failed", "skipped"];
const ROOT = resolve(process.cwd());
const DEFAULT_FILE = "todo.md";

/* ----------------------------- parsing ----------------------------- */

const RE_PHASE = /^##\s+(.+?)\s*$/;
const RE_TASK = /^###\s+(T\d{3,})\s+[—–-]\s+(.+?)\s*$/;
const RE_META = /^-\s+([a-z][a-z-]*):\s*(.*)$/;

function parseDeps(value) {
  if (!value) return [];
  const v = value.trim();
  if (v === "—" || v === "-" || v === "[]" || v.toLowerCase() === "none") return [];
  const inner = v.replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTasks(text) {
  const lines = text.split(/\r?\n/);
  const tasks = [];
  let phase = "";
  let cur = null;
  let inComment = false;

  const flush = () => {
    if (cur) {
      cur.lineEnd = cur._end;
      delete cur._end;
      cur.description = cur.description.join("\n").trim();
      tasks.push(cur);
      cur = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip HTML comment blocks.
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.trimStart().startsWith("<!--")) {
      if (!line.includes("-->")) inComment = true;
      continue;
    }

    const mPhase = line.match(RE_PHASE);
    if (mPhase && !line.startsWith("###")) {
      flush();
      phase = mPhase[1];
      continue;
    }

    const mTask = line.match(RE_TASK);
    if (mTask) {
      flush();
      cur = {
        id: mTask[1],
        title: mTask[2],
        phase,
        status: "todo",
        deps: [],
        files: [],
        verify: null,
        done: "",
        description: [],
        statusLine: -1,
        lineStart: i,
        _end: i,
      };
      continue;
    }

    if (!cur) continue;

    const mMeta = line.match(RE_META);
    if (mMeta) {
      const key = mMeta[1].toLowerCase();
      const val = mMeta[2].trim();
      if (key === "status") {
        cur.status = val.toLowerCase();
        cur.statusLine = i;
      } else if (key === "deps") {
        cur.deps = parseDeps(val);
      } else if (key === "files") {
        cur.files = val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (key === "verify") {
        cur.verify = val === "—" || val === "-" || val === "" ? null : val;
      } else if (key === "done") {
        cur.done = val;
      } else {
        (cur.extra ||= {})[key] = val;
      }
      cur._end = i;
      continue;
    }

    if (line.trim() === "" || line.trim() === "---") {
      cur._end = i;
      continue;
    }
    if (line.startsWith("#") || line.startsWith(">")) {
      cur._end = i;
      continue;
    }
    cur.description.push(line);
    cur._end = i;
  }
  flush();
  return tasks;
}

/* ----------------------------- queries ----------------------------- */

const byId = (tasks) => new Map(tasks.map((t) => [t.id, t]));
const isDone = (t) => t && t.status === "done";

function phaseContains(phase, filter) {
  if (!filter) return true;
  const f = String(filter).trim();
  const num = phase.match(/^Phase\s+(\d+)/i);
  // A bare number matches that phase exactly (so `0` does not match `Phase 10`).
  if (/^\d+$/.test(f) && num) return Number(num[1]) === Number(f);
  return phase.toLowerCase().includes(f.toLowerCase());
}

function actionable(tasks, task) {
  const map = byId(tasks);
  if (task.status !== "todo") return false;
  return task.deps.every((d) => isDone(map.get(d)));
}

function nextTask(tasks) {
  // Resume an in-progress task first.
  const doing = tasks.find((t) => t.status === "doing");
  if (doing) return doing;
  return tasks.find((t) => actionable(tasks, t)) || null;
}

/* ----------------------------- validation ----------------------------- */

function validate(tasks) {
  const errors = [];
  const ids = new Set();
  for (const t of tasks) {
    if (ids.has(t.id)) errors.push(`duplicate id ${t.id}`);
    ids.add(t.id);
    if (!STATUSES.includes(t.status)) errors.push(`${t.id}: invalid status "${t.status}"`);
    if (!t.done) errors.push(`${t.id}: missing "done" condition`);
    if (t.deps.includes(t.id)) errors.push(`${t.id}: depends on itself`);
  }
  for (const t of tasks) {
    for (const d of t.deps) {
      if (!ids.has(d)) errors.push(`${t.id}: unknown dependency ${d}`);
    }
  }
  // Cycle detection (DFS).
  const map = byId(tasks);
  const WHITE = 0,
    GREY = 1,
    BLACK = 2;
  const color = new Map(tasks.map((t) => [t.id, WHITE]));
  const stack = [];
  const visit = (id) => {
    color.set(id, GREY);
    stack.push(id);
    for (const d of map.get(id).deps) {
      if (!map.has(d)) continue;
      if (color.get(d) === GREY) {
        errors.push(`dependency cycle: ${[...stack, d].join(" -> ")}`);
      } else if (color.get(d) === WHITE) {
        visit(d);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };
  for (const t of tasks) if (color.get(t.id) === WHITE) visit(t.id);
  return errors;
}

/* ----------------------------- writing ----------------------------- */

function setStatus(file, task, status) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  if (task.statusLine < 0) throw new Error(`${task.id}: no status line to update`);
  const current = lines[task.statusLine];
  lines[task.statusLine] = current.replace(/^(\s*-\s*status:\s*).*$/, `$1${status}`);
  writeFileSync(file, lines.join("\n"), "utf8");
  task.status = status;
}

/* ----------------------------- prompt ----------------------------- */

function buildPrompt(task) {
  return [
    `You are implementing task ${task.id} — ${task.title} (phase: ${task.phase}).`,
    ``,
    `Read agents.md and docs/NAPOLEONIC_MAPPING.md first. Obey the locked theme`,
    `constraints and the layer rules (engine stays pure and deterministic).`,
    ``,
    `## Task description`,
    task.description || "(no description)",
    ``,
    task.files.length ? `## Expected files\n${task.files.map((f) => `- ${f}`).join("\n")}\n` : "",
    `## Done when`,
    task.done,
    ``,
    `## Verification command`,
    task.verify ? `\`${task.verify}\`` : "(none — ensure typecheck/build still pass)",
    ``,
    `Keep the change scoped to this task. Add or update tests. Update todo.md by`,
    `running: node tools/todo.mjs mark ${task.id} done`,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ----------------------------- run ----------------------------- */

function runAgent(template, task, file) {
  const dir = mkdtempSync(join(tmpdir(), "tactica-"));
  const promptFile = join(dir, `${task.id}.prompt.md`);
  writeFileSync(promptFile, buildPrompt(task), "utf8");
  const cmd = template
    .replaceAll("{promptFile}", promptFile)
    .replaceAll("{id}", task.id)
    .replaceAll("{title}", task.title)
    .replaceAll("{file}", file);
  try {
    const res = spawnSync(cmd, { shell: true, stdio: "inherit" });
    return res.status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runVerify(task) {
  if (!task.verify) return { ok: true, skipped: true };
  const res = spawnSync(task.verify, { shell: true, stdio: "inherit" });
  return { ok: res.status === 0, skipped: false, code: res.status };
}

function git(args, { trim = true } = {}) {
  const res = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  const raw = res.stdout ?? "";
  return {
    ok: res.status === 0,
    code: res.status ?? 1,
    out: trim ? raw.trim() : raw,
    err: (res.stderr ?? "").trim(),
  };
}

const isGitRepo = () => git(["rev-parse", "--is-inside-work-tree"]).out === "true";
const taskSubject = (task) => `feat(${task.id}): ${task.title}`;

/** Find a commit whose subject references this task id ("feat(T014): ..."). */
function findTaskCommit(id) {
  const r = git(["log", "--all", "--format=%H%x09%s"]);
  if (!r.ok) return null;
  for (const line of r.out.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    if (line.slice(tab + 1).includes(`(${id})`)) return line.slice(0, tab);
  }
  return null;
}

function dirtyFiles() {
  const files = new Set();
  // Do NOT trim: porcelain's leading status space is significant.
  const r = git(["status", "--porcelain", "-uall"], { trim: false });
  if (!r.ok) return files;
  for (const line of r.out.split("\n")) {
    if (line.trim().length < 4) continue;
    let path = line.slice(3).trim();
    const arrow = path.lastIndexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    files.add(path.replace(/^"(.*)"$/, "$1"));
  }
  return files;
}

function commitPaths(paths, message) {
  if (!paths.length) return false;
  const add = git(["add", "--", ...paths]);
  if (!add.ok) {
    console.error(`  ! git add failed: ${add.err || add.out}`);
    return false;
  }
  const commit = git(["commit", "-m", message]);
  if (!commit.ok) {
    console.error(`  ! git commit failed: ${commit.err || commit.out}`);
    return false;
  }
  return true;
}

function commitAll(task) {
  git(["add", "-A"]);
  return git(["commit", "-m", taskSubject(task)]).ok;
}

/**
 * Push the current branch after one or more commits. Defaults to the configured
 * upstream; if the branch has none, sets `origin` (or the first remote) as the
 * upstream so a fresh clone can use the runner without a manual `-u`.
 *
 * A failed push is reported but never undoes the local commits, so a network
 * problem cannot lose a verified task. `--no-push` disables pushing entirely.
 */
function pushCommits({ force = false } = {}) {
  if (has("no-push")) return true;
  const remotes = git(["remote"]).out.split("\n").filter(Boolean);
  if (remotes.length === 0) {
    console.error("  ! git push skipped: no remote configured");
    return false;
  }
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).out;
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const args = ["push"];
  if (force) args.push("--force-with-lease");
  if (!upstream.ok && branch && branch !== "HEAD") args.push("-u", remote, branch);
  const res = git(args);
  if (!res.ok) {
    console.error(`  ! git push failed: ${res.err || res.out}`);
    return false;
  }
  console.log(`  pushed ${branch || "HEAD"}`);
  return true;
}

/**
 * Attribute changed files to done tasks via their `files:` lists. A file owned
 * by exactly one task goes to that task; ambiguous (shared) or unreferenced
 * files go to a trailing "chore" commit.
 */
function buildSplitPlan(candidates, changed) {
  const changedSet = new Set(changed);
  const owners = new Map(); // file -> Set(taskId)
  for (const t of candidates) {
    for (const f of t.files) {
      if (!changedSet.has(f)) continue;
      if (!owners.has(f)) owners.set(f, new Set());
      owners.get(f).add(t.id);
    }
  }

  const byTask = new Map(); // taskId -> files[]
  const chore = [];
  for (const [f, set] of owners) {
    if (set.size === 1) {
      const id = [...set][0];
      if (!byTask.has(id)) byTask.set(id, []);
      byTask.get(id).push(f);
    } else {
      chore.push(f);
    }
  }
  for (const f of changed) if (!owners.has(f)) chore.push(f);

  const plan = [];
  for (const t of candidates) {
    const files = byTask.get(t.id);
    if (files && files.length) plan.push({ label: t.id, message: taskSubject(t), files });
  }
  if (chore.length) {
    plan.push({ label: "chore", message: "chore: project config and task board", files: chore });
  }
  return plan;
}

/**
 * Commit work for tasks already marked `done` that have no dedicated commit
 * (an interrupted run, or commits that were batched). One commit per task.
 * Returns how many commits were made.
 */
function splitPending(tasks, { dryRun = false } = {}) {
  const dirty = dirtyFiles();
  if (!dirty.size) return 0;
  const candidates = tasks.filter(isDone);
  if (!candidates.length) return 0;
  const plan = buildSplitPlan(candidates, [...dirty]);
  if (!plan.length) {
    console.log("  (no done tasks map to uncommitted changes)");
    return 0;
  }
  if (dryRun) {
    for (const p of plan) console.log(`  would commit ${p.label} (${p.files.length} file(s))`);
    return plan.length;
  }
  let made = 0;
  for (const p of plan) {
    if (commitPaths(p.files, p.message)) {
      console.log(`  committed ${p.label} (${p.files.length} file(s))`);
      made++;
    }
  }
  if (made > 0) pushCommits();
  return made;
}

/* ----------------------------- CLI ----------------------------- */

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}
const has = (name) => process.argv.includes(`--${name}`);

function main() {
  const file = resolve(ROOT, arg("file", DEFAULT_FILE));
  const tasks = parseTasks(readFileSync(file, "utf8"));
  const cmd = process.argv[2] || "list";

  if (cmd === "check") {
    const errors = validate(tasks);
    if (errors.length) {
      console.error(`✗ ${errors.length} problem(s):`);
      for (const e of errors) console.error("  - " + e);
      process.exit(1);
    }
    const done = tasks.filter(isDone).length;
    console.log(
      `✓ ${tasks.length} tasks, graph valid (${done} done, ${tasks.length - done} remaining).`,
    );
    return;
  }

  if (cmd === "list") {
    const phaseFilter = arg("phase");
    const statusFilter = arg("status");
    let rows = tasks;
    if (phaseFilter) rows = rows.filter((t) => phaseContains(t.phase, phaseFilter));
    if (statusFilter) rows = rows.filter((t) => t.status === statusFilter);
    if (has("json")) return console.log(JSON.stringify(rows, null, 2));
    let lastPhase = "";
    for (const t of rows) {
      if (t.phase !== lastPhase) {
        console.log(`\n## ${t.phase}`);
        lastPhase = t.phase;
      }
      const dep = t.deps.length ? ` deps:${t.deps.join(",")}` : "";
      console.log(
        `  ${t.status === "done" ? "✓" : " "} ${t.id}  ${t.status.padEnd(7)}${dep}  ${t.title}`,
      );
    }
    const done = tasks.filter(isDone).length;
    console.log(`\n${done}/${tasks.length} done`);
    return;
  }

  if (cmd === "next") {
    const t = nextTask(tasks);
    if (!t) return console.log("No actionable task. Everything is done or blocked.");
    if (has("json")) return console.log(JSON.stringify(t, null, 2));
    console.log(`${t.id} — ${t.title}  [${t.phase}]`);
    return;
  }

  const id = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : null;
  const task = id ? byId(tasks).get(id) : null;

  if (cmd === "show" || cmd === "prompt") {
    if (!task) {
      console.error(`Unknown task: ${id}`);
      process.exit(1);
    }
    if (cmd === "prompt") return console.log(buildPrompt(task));
    console.log(`${task.id} — ${task.title}`);
    console.log(`phase:   ${task.phase}`);
    console.log(`status:  ${task.status}`);
    console.log(`deps:    ${task.deps.length ? task.deps.join(", ") : "—"}`);
    console.log(`files:   ${task.files.join(", ") || "—"}`);
    console.log(`verify:  ${task.verify || "—"}`);
    console.log(`done:    ${task.done}`);
    console.log(`\n${task.description}`);
    return;
  }

  if (cmd === "mark") {
    const status = process.argv[4];
    if (!task) return fail(`Unknown task: ${id}`);
    if (!STATUSES.includes(status))
      return fail(`Invalid status "${status}". Use: ${STATUSES.join(", ")}`);
    setStatus(file, task, status);
    console.log(`${task.id} → ${status}`);
    return;
  }

  if (cmd === "verify") {
    if (!task) return fail(`Unknown task: ${id}`);
    const r = runVerify(task);
    if (r.skipped) return console.log(`${task.id}: nothing to verify.`);
    console.log(r.ok ? `✓ ${task.id} verified.` : `✗ ${task.id} verify failed (exit ${r.code}).`);
    process.exit(r.ok ? 0 : 1);
  }

  if (cmd === "commits") {
    if (!isGitRepo()) return fail("Not a git repository.");
    const done = tasks.filter(isDone);
    let missing = 0;
    for (const t of done) {
      const sha = findTaskCommit(t.id);
      if (sha) console.log(`  ✓ ${t.id}  ${sha.slice(0, 8)}  ${t.title}`);
      else {
        missing++;
        console.log(`  · ${t.id}  --------  (no dedicated commit)  ${t.title}`);
      }
    }
    console.log(`\n${done.length - missing}/${done.length} done task(s) have a dedicated commit.`);
    return;
  }

  if (cmd === "split") {
    if (!isGitRepo()) return fail("Not a git repository.");
    const base = typeof arg("base") === "string" ? arg("base") : null;
    const dryRun = has("dry-run") || !has("yes");

    if (!base) {
      // Uncommitted mode: split dirty changes across done tasks by their files.
      const dirty = dirtyFiles();
      if (!dirty.size) return console.log("Nothing to split — working tree is clean.");
      const candidates = tasks.filter(isDone);
      const plan = buildSplitPlan(candidates, [...dirty]);
      if (!plan.length) return console.log("No done task maps to the uncommitted files.");
      console.log(`Split plan (${plan.length} commit(s)):`);
      for (const p of plan) {
        console.log(`  ${p.label.padEnd(6)} ${String(p.files.length).padStart(3)} file(s)  ${p.message}`);
      }
      if (dryRun) return console.log("\nDry run — re-run with --yes to commit.");
      let made = 0;
      for (const p of plan) {
        if (commitPaths(p.files, p.message)) {
          console.log(`  committed ${p.label}`);
          made++;
        }
      }
      if (made > 0) pushCommits();
      return;
    }

    // Rewrite mode: rebuild <base>..HEAD as one commit per done task.
    if (git(["status", "--porcelain"]).out) {
      return fail("Working tree must be clean to rewrite history (--base mode).");
    }
    if (!git(["rev-parse", "--verify", `${base}^{commit}`]).ok) {
      return fail(`Unknown base ref: ${base}`);
    }
    const changed = git(["diff", "--name-only", base, "HEAD"]).out.split("\n").filter(Boolean);
    const candidates = tasks.filter(isDone);
    const plan = buildSplitPlan(candidates, changed);

    console.log(`Rewrite plan for ${base}..HEAD (${changed.length} files → ${plan.length} commit(s)):`);
    for (const p of plan) {
      console.log(`  ${p.label.padEnd(6)} ${String(p.files.length).padStart(3)} file(s)  ${p.message}`);
    }
    console.log("\nAfter rewriting, the runner force-pushes with --force-with-lease (disable with --no-push).");
    if (dryRun) return console.log("Dry run — re-run with --yes to rewrite history.");

    if (!git(["reset", "--soft", base]).ok) return fail("git reset failed.");
    git(["restore", "--staged", "."]);
    let made = 0;
    for (const p of plan) {
      if (commitPaths(p.files, p.message)) made++;
      else console.error(`  ! failed to commit ${p.label}`);
    }
    if (made > 0) pushCommits({ force: true });
    console.log(`\n✓ Rewrote ${base}..HEAD into ${plan.length} commit(s).`);
    return;
  }

  if (cmd === "run") {
    const template = arg("agent", process.env.TODO_AGENT || null);
    const limit = Number(arg("limit", "0")) || Infinity;
    const from = arg("from");
    const until = arg("until");
    const phase = arg("phase");
    const dry = has("dry-run") || !template;

    let queue = tasks.filter((t) => t.status === "todo" || t.status === "doing");
    if (from) {
      const idx = tasks.findIndex((t) => t.id === from);
      if (idx >= 0) queue = queue.filter((t) => tasks.indexOf(t) >= idx);
    }
    if (until) {
      const idx = tasks.findIndex((t) => t.id === until);
      if (idx >= 0) queue = queue.filter((t) => tasks.indexOf(t) <= idx);
    }
    if (phase) queue = queue.filter((t) => phaseContains(t.phase, phase));

    // Fix up tasks a previous run completed but never committed (one commit each).
    if (!has("no-commit") && !has("no-split") && isGitRepo()) {
      if (splitPending(tasks, { dryRun: dry }) > 0 && !dry) console.log("");
    }

    if (dry) {
      const preview = queue.slice(0, limit === Infinity ? 10 : limit);
      console.log(`Dry run — ${queue.length} candidate task(s); showing ${preview.length}.`);
      if (!template)
        console.log(
          `(set --agent "<cmd>" or TODO_AGENT to execute, e.g. --agent 'pi --print "@{promptFile}"')\n`,
        );
      for (const t of preview) {
        console.log(`\n===== ${t.id} — ${t.title} =====\n`);
        console.log(buildPrompt(t));
      }
      return;
    }

    let ran = 0;
    for (const t of queue) {
      if (ran >= limit) break;
      if (!actionable(tasks, t) && t.status !== "doing") continue;
      console.log(`\n▶ ${t.id} — ${t.title}`);
      setStatus(file, t, "doing");
      const okAgent = runAgent(template, t, file);
      if (!okAgent) {
        setStatus(file, t, "failed");
        console.error(`✗ agent failed on ${t.id}`);
        break;
      }
      const v = runVerify(t);
      if (!v.ok) {
        setStatus(file, t, "failed");
        console.error(`✗ verify failed on ${t.id}`);
        break;
      }
      setStatus(file, t, "done");
      if (!has("no-commit") && isGitRepo()) {
        if (commitAll(t)) {
          console.log(`  committed ${t.id}`);
          pushCommits();
        } else {
          console.log(`  (no changes to commit for ${t.id})`);
        }
      }
      console.log(`✓ ${t.id} done`);
      ran++;
    }
    console.log(`\nRan ${ran} task(s).`);
    return;
  }

  console.error(`Unknown command "${cmd}". See tools/README.md.`);
  process.exit(2);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

main();
