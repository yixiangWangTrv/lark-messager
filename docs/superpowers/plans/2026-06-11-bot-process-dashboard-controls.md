# Bot Process Dashboard Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the running `oncall-bot` process in the dashboard `Servers` panel and allow the user to stop or restart it from the UI.

**Architecture:** Extend the single-instance lock file to persist bot launch metadata, treat that lock file as the source of truth for the live bot process, and expose the bot as an additional row in the existing `/api/servers` response. Add bot-specific stop/restart server handlers in the dashboard backend and wire corresponding buttons into the existing `Servers` table.

**Tech Stack:** Node.js, `node:test`, vanilla HTML/CSS/JS dashboard, existing dashboard HTTP server, existing single-instance lock file.

---

## File Structure

- Modify: `lib/single-instance-lock.js`
  - Persist richer bot launch metadata in the lock file and expose small helpers for reading/validating the active bot entry.
- Modify: `test/single-instance.test.js`
  - Add lock payload tests for stored launch metadata and stale lock behavior.
- Modify: `oncall-bot.js`
  - Pass startup metadata into the lock acquisition call.
- Modify: `lib/dashboard-server.js`
  - Include the bot process in `/api/servers`, add bot-aware stop/restart handling, and keep existing opencode server behavior intact.
- Modify: `test/dashboard-server.test.js`
  - Add bot-row listing and bot stop/restart tests with injected fakes.
- Modify: `dashboard/index.html`
  - Render bot rows distinctly and add `Restart` button support.

### Task 1: Persist Bot Launch Metadata In The Lock File

**Files:**
- Modify: `lib/single-instance-lock.js`
- Test: `test/single-instance.test.js`

- [ ] **Step 1: Write the failing metadata test**

Add this test to `test/single-instance.test.js`:

```js
  it("stores launch metadata in the lock file payload", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");

    const lock = await acquireSingleInstanceLock({
      lockPath,
      pid: 12345,
      startedAt: 1718102400000,
      cwd: "/tmp/oncall-bot",
      execPath: "/opt/homebrew/bin/node",
      argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
    });

    const payload = JSON.parse(readFileSync(lockPath, "utf-8"));

    assert.deepEqual(payload, {
      pid: 12345,
      startedAt: 1718102400000,
      cwd: "/tmp/oncall-bot",
      execPath: "/opt/homebrew/bin/node",
      argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
    });

    lock.release();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/single-instance.test.js`
Expected: FAIL because the current lock payload only contains `pid` and `startedAt`.

- [ ] **Step 3: Write minimal lock metadata support**

Update `lib/single-instance-lock.js` like this:

```js
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code !== "ESRCH";
  }
}

export function readLockFile(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf-8"));
  } catch {
    return null;
  }
}

function removeLockFile(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch {
    // Ignore lock cleanup failures.
  }
}

export async function acquireSingleInstanceLock({
  lockPath,
  pid = process.pid,
  processExistsFn = processExists,
  startedAt = Date.now(),
  cwd = process.cwd(),
  execPath = process.execPath,
  argv = process.argv.slice(1),
} = {}) {
  const payload = JSON.stringify({ pid, startedAt, cwd, execPath, argv });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, payload, { flag: "wx" });

      return {
        lockPath,
        release() {
          const existing = readLockFile(lockPath);
          if (existing?.pid && existing.pid !== pid) return;
          removeLockFile(lockPath);
        },
      };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;

      const existing = readLockFile(lockPath);
      if (existing?.pid && existing.pid !== pid && processExistsFn(existing.pid)) {
        throw new Error(`Another oncall-bot process is already running (pid ${existing.pid})`);
      }

      removeLockFile(lockPath);
    }
  }

  throw new Error(`Failed to acquire single instance lock at ${lockPath}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/single-instance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/single-instance-lock.js test/single-instance.test.js
git commit -m "feat: store bot launch metadata in lock file"
```

### Task 2: Add Helpers For Reading The Active Bot Process

**Files:**
- Modify: `lib/single-instance-lock.js`
- Test: `test/single-instance.test.js`

- [ ] **Step 1: Write the failing bot-entry helper test**

Add these imports and test to `test/single-instance.test.js`:

```js
import { acquireSingleInstanceLock, getActiveBotProcess } from "../lib/single-instance-lock.js";
```

```js
  it("returns the active bot process when the lock file points to a live pid", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");
    writeFileSync(lockPath, JSON.stringify({
      pid: 71371,
      startedAt: 1718102400000,
      cwd: "/tmp/oncall-bot",
      execPath: "/opt/homebrew/bin/node",
      argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
    }));

    assert.deepEqual(
      getActiveBotProcess({ lockPath, processExistsFn: (pid) => pid === 71371 }),
      {
        id: "bot-71371",
        kind: "bot",
        source: "local",
        label: "oncall-bot",
        pid: 71371,
        startedAt: 1718102400000,
        projectDir: "/tmp/oncall-bot",
        port: null,
        status: "running",
        execPath: "/opt/homebrew/bin/node",
        argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
      },
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/single-instance.test.js`
Expected: FAIL with `getActiveBotProcess is not a function`.

- [ ] **Step 3: Implement the helper**

Add this code near the bottom of `lib/single-instance-lock.js`:

```js
export function getActiveBotProcess({
  lockPath,
  processExistsFn = processExists,
} = {}) {
  const existing = readLockFile(lockPath);
  if (!existing?.pid || !processExistsFn(existing.pid)) {
    return null;
  }

  return {
    id: `bot-${existing.pid}`,
    kind: "bot",
    source: "local",
    label: "oncall-bot",
    pid: existing.pid,
    startedAt: existing.startedAt,
    projectDir: existing.cwd || null,
    port: null,
    status: "running",
    execPath: existing.execPath || null,
    argv: Array.isArray(existing.argv) ? existing.argv : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/single-instance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/single-instance-lock.js test/single-instance.test.js
git commit -m "feat: expose active bot process from lock file"
```

### Task 3: Pass Real Launch Metadata From The Bot Entrypoint

**Files:**
- Modify: `oncall-bot.js`

- [ ] **Step 1: Update lock acquisition to pass launch metadata**

Change the lock acquisition call in `oncall-bot.js`:

```js
    instanceLock = await acquireSingleInstanceLock({
      lockPath: resolve(".oncall-bot.lock"),
      cwd: process.cwd(),
      execPath: process.execPath,
      argv: process.argv.slice(1),
    });
```

- [ ] **Step 2: Run single-instance tests**

Run: `node --test test/single-instance.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add oncall-bot.js
git commit -m "feat: record bot startup command in lock acquisition"
```

### Task 4: Include The Bot In `/api/servers`

**Files:**
- Modify: `lib/dashboard-server.js`
- Test: `test/dashboard-server.test.js`

- [ ] **Step 1: Write the failing dashboard listing test**

Add these imports to `test/dashboard-server.test.js`:

```js
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
```

Add this test:

```js
  it("GET /api/servers includes the active bot process from the lock file", async () => {
    const lockPath = join(tempDir, "bot.lock");
    writeFileSync(lockPath, JSON.stringify({
      pid: 71371,
      startedAt: 1718102400000,
      cwd: "/tmp/oncall-bot",
      execPath: "/opt/homebrew/bin/node",
      argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
    }));

    server._botLockPath = lockPath;
    server._processExists = (pid) => pid === 71371;

    const res = await fetch(`${baseUrl}/api/servers`);
    const data = await res.json();
    const bot = data.find((entry) => entry.id === "bot-71371");

    assert.ok(bot);
    assert.equal(bot.kind, "bot");
    assert.equal(bot.label, "oncall-bot");
    assert.equal(bot.port, null);
    assert.equal(bot.status, "running");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL because the bot row is missing.

- [ ] **Step 3: Add bot row support to the dashboard server**

Update `lib/dashboard-server.js` imports:

```js
import { getActiveBotProcess } from "./single-instance-lock.js";
```

Update the constructor:

```js
  constructor({ config, botEvents, configPath, opencode, todoStorePath, botLockPath }) {
    this._config = config;
    this._botEvents = botEvents;
    this._configPath = resolve(configPath);
    this._opencode = opencode || null;
    this._todoStore = new SessionTodoStore(todoStorePath ?? resolve(__dirname, "../data/session-todos.json"));
    this._botLockPath = botLockPath ?? resolve(__dirname, "../.oncall-bot.lock");
    this._processExists = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return err?.code !== "ESRCH";
      }
    };
```

Add helper:

```js
  _getBotProcessEntry() {
    return getActiveBotProcess({
      lockPath: this._botLockPath,
      processExistsFn: this._processExists,
    });
  }
```

Update `_handleGetServers`:

```js
  async _handleGetServers(res) {
    const managed = this._serverManager.list();
    const external = await this._detectExternalServers();
    const managedPorts = new Set(managed.map((s) => s.port));
    const merged = [
      ...managed,
      ...external.filter((s) => !managedPorts.has(s.port)),
    ];

    const botEntry = this._getBotProcessEntry();
    if (botEntry) {
      merged.unshift(botEntry);
    }

    const boundUrl = this._config.opencode?.base_url || "";
    for (const s of merged) {
      s.bound = typeof s.port === "number" && boundUrl.includes(`:${s.port}`);
    }
    this._jsonResponse(res, merged);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-server.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard-server.js test/dashboard-server.test.js
git commit -m "feat: show active bot process in dashboard servers"
```

### Task 5: Add Bot Stop And Restart Backend Actions

**Files:**
- Modify: `lib/dashboard-server.js`
- Test: `test/dashboard-server.test.js`

- [ ] **Step 1: Write the failing bot control tests**

Add these tests to `test/dashboard-server.test.js`:

```js
  it("POST /api/servers/:id/stop sends SIGTERM to the active bot process", async () => {
    const lockPath = join(tempDir, "bot-stop.lock");
    writeFileSync(lockPath, JSON.stringify({
      pid: 71371,
      startedAt: 1718102400000,
      cwd: "/tmp/oncall-bot",
      execPath: "/opt/homebrew/bin/node",
      argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
    }));

    const killCalls = [];
    server._botLockPath = lockPath;
    server._processExists = (pid) => pid === 71371;
    server._killProcess = (pid, signal) => {
      killCalls.push({ pid, signal });
    };

    const res = await fetch(`${baseUrl}/api/servers/bot-71371/stop`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.deepEqual(killCalls, [{ pid: 71371, signal: "SIGTERM" }]);
  });
```

```js
  it("POST /api/servers/:id/restart spawns a replacement bot with the stored command", async () => {
    const lockPath = join(tempDir, "bot-restart.lock");
    writeFileSync(lockPath, JSON.stringify({
      pid: 71371,
      startedAt: 1718102400000,
      cwd: "/tmp/oncall-bot",
      execPath: "/opt/homebrew/bin/node",
      argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
    }));

    const spawnCalls = [];
    const killCalls = [];
    server._botLockPath = lockPath;
    server._processExists = (pid) => pid === 71371;
    server._spawnBotProcess = ({ execPath, argv, cwd }) => {
      spawnCalls.push({ execPath, argv, cwd });
      return { pid: 88888 };
    };
    server._killProcess = (pid, signal) => {
      killCalls.push({ pid, signal });
    };

    const res = await fetch(`${baseUrl}/api/servers/bot-71371/restart`, { method: "POST" });
    assert.equal(res.status, 200);
    assert.deepEqual(spawnCalls, [{
      execPath: "/opt/homebrew/bin/node",
      argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
      cwd: "/tmp/oncall-bot",
    }]);
    assert.deepEqual(killCalls, [{ pid: 71371, signal: "SIGTERM" }]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL because bot stop/restart behavior does not exist.

- [ ] **Step 3: Implement bot process control helpers**

Add imports near the top of `lib/dashboard-server.js`:

```js
import { spawn } from "node:child_process";
```

Add constructor defaults:

```js
    this._killProcess = (pid, signal) => process.kill(pid, signal);
    this._spawnBotProcess = ({ execPath, argv, cwd }) => {
      return spawn(execPath, argv, {
        cwd,
        detached: true,
        stdio: "ignore",
      });
    };
```

Add helpers:

```js
  _getBotProcessById(id) {
    const botEntry = this._getBotProcessEntry();
    if (!botEntry || botEntry.id !== id) {
      return null;
    }
    return botEntry;
  }

  _stopBotProcess(id, res) {
    const bot = this._getBotProcessById(id);
    if (!bot) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "server not found" }));
      return true;
    }

    try {
      this._killProcess(bot.pid, "SIGTERM");
      this._jsonResponse(res, { ok: true, killed_pid: bot.pid });
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Failed to kill PID ${bot.pid}: ${e.message}` }));
    }
    return true;
  }

  _restartBotProcess(id, res) {
    const bot = this._getBotProcessById(id);
    if (!bot) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "server not found" }));
      return true;
    }

    if (!bot.execPath || !bot.projectDir || !Array.isArray(bot.argv)) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "bot process metadata missing from lock file" }));
      return true;
    }

    try {
      const replacement = this._spawnBotProcess({
        execPath: bot.execPath,
        argv: bot.argv,
        cwd: bot.projectDir,
      });
      if (typeof replacement?.unref === "function") {
        replacement.unref();
      }
      this._killProcess(bot.pid, "SIGTERM");
      this._jsonResponse(res, {
        ok: true,
        replacementPid: replacement?.pid ?? null,
      });
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Failed to restart bot process: ${e.message}` }));
    }
    return true;
  }
```

Update `_handleStopServer`:

```js
  _handleStopServer(id, res) {
    if (id.startsWith("bot-")) {
      if (this._stopBotProcess(id, res)) return;
    }

    const ok = this._serverManager.stop(id);
    if (ok) {
      this._jsonResponse(res, { ok: true });
      return;
    }

    if (id.startsWith("ext-")) {
      const pid = parseInt(id.slice(4), 10);
      if (pid > 0) {
        try {
          this._killProcess(pid, "SIGTERM");
          this._jsonResponse(res, { ok: true, killed_pid: pid });
          return;
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Failed to kill PID ${pid}: ${e.message}` }));
          return;
        }
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "server not found" }));
  }
```

Update `_handleRestartServer`:

```js
  _handleRestartServer(id, res) {
    if (id.startsWith("bot-")) {
      if (this._restartBotProcess(id, res)) return;
    }

    const result = this._serverManager.restart(id);
    if (!result) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "server not found" }));
      return;
    }
    this._jsonResponse(res, result);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-server.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard-server.js test/dashboard-server.test.js
git commit -m "feat: add bot stop and restart dashboard actions"
```

### Task 6: Render Bot Rows And Restart Buttons In The Dashboard UI

**Files:**
- Modify: `dashboard/index.html`

- [ ] **Step 1: Update the server row renderer**

Replace `renderServers()` in `dashboard/index.html` with this version:

```js
function renderServers(servers){
  const el=document.getElementById("serversContent");
  if(!servers.length){
    el.innerHTML=`<p class="empty">${t("noServers")}</p>`;
    return;
  }
  let html='<table><thead><tr><th>Port</th><th>PID</th><th>Status</th><th>Source</th><th>Actions</th></tr></thead><tbody>';
  for(const s of servers){
    const isBot=s.kind==="bot";
    const portLabel=isBot?"-":esc(s.port);
    const boundBadge=s.bound?`<span class="badge badge-safe" style="margin-left:6px">${t("bound")}</span>`:"";
    const sourceBadge=isBot
      ?`<span style="color:var(--warn)">Bot</span>`
      :s.source==="external"
        ?`<span style="color:var(--text-secondary)">${t("external")}</span>`
        :`<span style="color:var(--accent)">${t("managed")}</span>`;
    const rowClass=s.bound?"server-row-bound":"";
    html+=`<tr class="${rowClass}"><td>${portLabel}${boundBadge}</td><td>${esc(s.pid||"-")}</td><td>${esc(s.status)}</td><td>${sourceBadge}</td>`;
    html+='<td>';
    if(s.status==="running"){
      html+=`<button class="danger" onclick="confirmStopServer('${escJsStr(s.id)}',${isBot?"'oncall-bot'":s.port},${!!s.bound})">Stop</button>`;
      html+=` <button class="secondary" onclick="restartServer('${escJsStr(s.id)}')">Restart</button>`;
    }
    html+='</td></tr>';
  }
  html+='</tbody></table>';
  el.innerHTML=html;
}
```

- [ ] **Step 2: Adjust the stop confirmation text for bot rows**

Update `confirmStopServer()`:

```js
function confirmStopServer(id,portOrLabel,isBound){
  let msg=t("stopConfirmMsg")+"\n\n";
  if(isBound&&typeof portOrLabel==="number"){
    msg+=t("stopConfirmBound",{port:portOrLabel})+"\n\n";
  }
  msg+=typeof portOrLabel==="number"?`Port: ${portOrLabel}`:`Process: ${portOrLabel}`;
  if(confirm(msg)){
    stopServer(id);
  }
}
```

- [ ] **Step 3: Run a manual UI smoke test**

Run:

```bash
node oncall-bot.js --config oncall-bot.config.json
```

Manual expected results:

- `Servers` panel shows an `oncall-bot` row
- that row has `Stop` and `Restart`
- `Restart` refreshes the table without breaking opencode server rows

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html
git commit -m "feat: add bot controls to dashboard server list"
```

### Task 7: Run Final Regression Verification

**Files:**
- Modify: none
- Test: `test/single-instance.test.js`
- Test: `test/dashboard-server.test.js`

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test test/single-instance.test.js test/dashboard-server.test.js
```

Expected: PASS

- [ ] **Step 2: Run full regression suite**

Run:

```bash
npm test
```

Expected: PASS

- [ ] **Step 3: Commit if verification required fixes**

If any final verification changes were needed:

```bash
git add <files>
git commit -m "test: stabilize bot dashboard process controls"
```

If no changes were needed, skip this step.

## Self-Review

- Spec coverage checked:
  - bot process visible in dashboard: Task 4
  - stop button for bot process: Task 5 and Task 6
  - restart button for bot process: Task 5 and Task 6
  - restart uses original launch command: Tasks 1, 2, 3, 5
  - fail closed when lock metadata is incomplete: Task 5
- Placeholder scan checked:
  - no `TBD`, `TODO`, or vague “handle appropriately” steps remain
- Type consistency checked:
  - lock payload fields are consistently `pid`, `startedAt`, `cwd`, `execPath`, `argv`
  - bot row fields are consistently `id`, `kind`, `label`, `source`, `pid`, `startedAt`, `projectDir`, `port`, `status`
  - dashboard bot ids consistently use `bot-<pid>`

Plan complete and saved to `docs/superpowers/plans/2026-06-11-bot-process-dashboard-controls.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
