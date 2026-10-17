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
 *   node tools/todo.mjs mark T001 done
 *   node tools/todo.mjs verify T001
 *   node tools/todo.mjs run [--agent "<cmd>"] [--from T001] [--until T010]
 *                           [--phase 0] [--limit N] [--dry-run] [--commit]
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

function gitCommit(task) {
  spawnSync("git", ["add", "-A"], { stdio: "inherit" });
  spawnSync("git", ["commit", "-m", `feat(${task.id}): ${task.title}`], { stdio: "inherit" });
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
      if (has("commit")) gitCommit(t);
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
