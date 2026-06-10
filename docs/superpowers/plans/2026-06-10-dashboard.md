# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed a management dashboard into the oncall-bot process providing session monitoring, opencode server management, prompt editing, and language/port configuration.

**Architecture:** Single-process embedded HTTP server using Node `http` module. REST API for config/server CRUD, SSE for real-time session events. Frontend is a single vanilla HTML file with inline CSS/JS. Internal EventEmitter bus connects bot events to dashboard.

**Tech Stack:** Node.js `http`, `child_process`, `EventEmitter`, vanilla HTML/CSS/JS, SSE

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/bot-events.js` | Create | Shared EventEmitter singleton |
| `lib/server-manager.js` | Create | Spawn/kill/restart opencode serve processes |
| `lib/dashboard-server.js` | Create | HTTP server, REST API routes, SSE, static file serving |
| `dashboard/index.html` | Create | Single-page UI (inline CSS + JS) |
| `oncall-bot.js` | Modify | Import and start dashboard, emit session events |
| `lib/config.js` | Modify | Add dashboard defaults |
| `oncall-bot.config.json` | Modify | Add dashboard field |
| `test/bot-events.test.js` | Create | Unit tests for event bus |
| `test/server-manager.test.js` | Create | Unit tests for process manager |
| `test/dashboard-server.test.js` | Create | Integration tests for REST API |

---

### Task 1: Event Bus (`lib/bot-events.js`)

**Files:**
- Create: `lib/bot-events.js`
- Create: `test/bot-events.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/bot-events.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { botEvents } from "../lib/bot-events.js";

describe("botEvents", () => {
  it("is an EventEmitter singleton", () => {
    assert.equal(typeof botEvents.on, "function");
    assert.equal(typeof botEvents.emit, "function");
  });

  it("emits and receives session:created", (t, done) => {
    const payload = { sessionId: "s1", title: "test", chatName: "chat", intent: "other" };
    botEvents.once("session:created", (data) => {
      assert.deepEqual(data, payload);
      done();
    });
    botEvents.emit("session:created", payload);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/bot-events.test.js`
Expected: FAIL — cannot find module `../lib/bot-events.js`

- [ ] **Step 3: Write minimal implementation**

```javascript
// lib/bot-events.js
import { EventEmitter } from "node:events";
export const botEvents = new EventEmitter();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/bot-events.test.js`
Expected: 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/bot-events.js test/bot-events.test.js
git commit -m "feat: add bot-events EventEmitter singleton"
```

---

### Task 2: Server Manager (`lib/server-manager.js`)

**Files:**
- Create: `lib/server-manager.js`
- Create: `test/server-manager.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/server-manager.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ServerManager } from "../lib/server-manager.js";

describe("ServerManager", () => {
  let mgr;

  beforeEach(() => {
    mgr = new ServerManager();
  });

  afterEach(() => {
    mgr.stopAll();
  });

  it("starts with empty server list", () => {
    assert.deepEqual(mgr.list(), []);
  });

  it("start adds a server entry with status 'starting'", async () => {
    // Use a harmless command that exits quickly
    const info = mgr.start({ port: 19999, projectDir: "/tmp", command: "node", args: ["-e", "setTimeout(()=>{},500)"] });
    assert.equal(info.port, 19999);
    assert.equal(info.status, "starting");
    assert.equal(typeof info.id, "string");
    assert.equal(mgr.list().length, 1);
  });

  it("stop kills the process and sets status to stopped", async () => {
    const info = mgr.start({ port: 19998, projectDir: "/tmp", command: "node", args: ["-e", "setTimeout(()=>{},5000)"] });
    const stopped = mgr.stop(info.id);
    assert.equal(stopped, true);
    // Give process time to die
    await new Promise((r) => setTimeout(r, 100));
    const entry = mgr.list().find((s) => s.id === info.id);
    assert.equal(entry.status, "stopped");
  });

  it("stop returns false for unknown id", () => {
    assert.equal(mgr.stop("nonexistent"), false);
  });

  it("restart stops and starts with same config", async () => {
    const info = mgr.start({ port: 19997, projectDir: "/tmp", command: "node", args: ["-e", "setTimeout(()=>{},5000)"] });
    const newInfo = mgr.restart(info.id);
    assert.notEqual(newInfo.id, info.id);
    assert.equal(newInfo.port, 19997);
    assert.equal(mgr.list().filter((s) => s.status !== "stopped").length, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/server-manager.test.js`
Expected: FAIL — cannot find module `../lib/server-manager.js`

- [ ] **Step 3: Write minimal implementation**

```javascript
// lib/server-manager.js
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export class ServerManager {
  constructor() {
    this._servers = new Map(); // id -> { id, port, projectDir, pid, status, startedAt, process, command, args }
  }

  list() {
    return [...this._servers.values()].map(({ process: _p, ...rest }) => rest);
  }

  start({ port, projectDir, command = "opencode", args = ["serve", "--port", String(port)] }) {
    const id = randomUUID().slice(0, 8);
    const proc = spawn(command, args, {
      cwd: projectDir,
      stdio: "ignore",
      detached: false,
    });

    const entry = {
      id,
      port,
      projectDir,
      pid: proc.pid,
      status: "starting",
      startedAt: new Date().toISOString(),
      process: proc,
      command,
      args,
    };

    proc.on("spawn", () => {
      entry.status = "running";
    });

    proc.on("exit", (code) => {
      if (entry.status !== "stopped") {
        entry.status = code === 0 ? "stopped" : "crashed";
      }
    });

    proc.on("error", () => {
      entry.status = "crashed";
    });

    this._servers.set(id, entry);
    return { id, port, projectDir, pid: proc.pid, status: entry.status, startedAt: entry.startedAt };
  }

  stop(id) {
    const entry = this._servers.get(id);
    if (!entry) return false;
    entry.status = "stopped";
    try {
      entry.process.kill("SIGTERM");
    } catch {
      // Already dead
    }
    return true;
  }

  restart(id) {
    const entry = this._servers.get(id);
    if (!entry) return null;
    const { port, projectDir, command, args } = entry;
    this.stop(id);
    return this.start({ port, projectDir, command, args });
  }

  stopAll() {
    for (const [id] of this._servers) {
      this.stop(id);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/server-manager.test.js`
Expected: 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/server-manager.js test/server-manager.test.js
git commit -m "feat: add ServerManager for opencode serve process lifecycle"
```

---

### Task 3: Dashboard Server (`lib/dashboard-server.js`)

**Files:**
- Create: `lib/dashboard-server.js`
- Create: `test/dashboard-server.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// test/dashboard-server.test.js
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { DashboardServer } from "../lib/dashboard-server.js";
import { botEvents } from "../lib/bot-events.js";

describe("DashboardServer", () => {
  let server;
  const TEST_PORT = 18915;
  const baseUrl = `http://localhost:${TEST_PORT}`;
  const config = {
    dashboard: { port: TEST_PORT, enabled: true },
    opencode: { base_url: "http://localhost:3000" },
    prompt: {
      summary: { system_prefix: "sum", task_instructions: "sum task", response_format: "Chinese" },
      incident_analysis: { system_prefix: "inc", task_instructions: "inc task", response_format: "English" },
      pr_review: { system_prefix: "pr", task_instructions: "pr task", response_format: "English" },
      other: { system_prefix: "other", task_instructions: "other task", response_format: "Chinese" },
    },
    lark: { trigger: {} },
    concurrency: {},
    reply: {},
    context: {},
  };

  before(async () => {
    server = new DashboardServer({ config, botEvents, configPath: "/tmp/test-config.json" });
    await server.start();
  });

  after(() => {
    server.stop();
  });

  it("GET /api/status returns ok", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "running");
  });

  it("GET /api/prompts returns prompt config", async () => {
    const res = await fetch(`${baseUrl}/api/prompts`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.summary.system_prefix, "sum");
  });

  it("GET /api/sessions returns empty array initially", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data, []);
  });

  it("GET /api/servers returns empty array initially", async () => {
    const res = await fetch(`${baseUrl}/api/servers`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data, []);
  });

  it("GET / returns HTML", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const ct = res.headers.get("content-type");
    assert.ok(ct.includes("text/html"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL — cannot find module `../lib/dashboard-server.js`

- [ ] **Step 3: Write minimal implementation**

```javascript
// lib/dashboard-server.js
import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ServerManager } from "./server-manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class DashboardServer {
  constructor({ config, botEvents, configPath = "oncall-bot.config.json" }) {
    this._config = config;
    this._botEvents = botEvents;
    this._configPath = resolve(configPath);
    this._server = null;
    this._sseClients = new Set();
    this._sessions = [];
    this._serverManager = new ServerManager();

    this._botEvents.on("session:created", (data) => {
      this._sessions.unshift({ ...data, createdAt: data.createdAt || new Date().toISOString() });
      if (this._sessions.length > 100) this._sessions.pop();
      this._broadcast("session_created", data);
    });
  }

  _broadcast(type, data) {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this._sseClients) {
      try { client.write(msg); } catch { this._sseClients.delete(client); }
    }
  }

  async start() {
    const port = this._config.dashboard?.port || 8015;
    return new Promise((resolve, reject) => {
      this._server = createServer((req, res) => this._handleRequest(req, res));
      this._server.listen(port, () => resolve());
      this._server.on("error", reject);
    });
  }

  stop() {
    this._serverManager.stopAll();
    for (const client of this._sseClients) {
      try { client.end(); } catch {}
    }
    this._sseClients.clear();
    this._server?.close();
  }

  _handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;

    // CORS for local dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    // API routes
    if (path === "/api/status" && method === "GET") return this._apiStatus(req, res);
    if (path === "/api/sessions" && method === "GET") return this._apiSessions(req, res);
    if (path === "/api/config" && method === "GET") return this._apiGetConfig(req, res);
    if (path === "/api/config" && method === "PUT") return this._apiPutConfig(req, res);
    if (path === "/api/prompts" && method === "GET") return this._apiGetPrompts(req, res);
    if (path === "/api/prompts" && method === "PUT") return this._apiPutPrompts(req, res);
    if (path === "/api/servers" && method === "GET") return this._apiListServers(req, res);
    if (path === "/api/servers" && method === "POST") return this._apiStartServer(req, res);
    if (path === "/api/events" && method === "GET") return this._apiSSE(req, res);

    // Server-specific routes: /api/servers/:id/action
    const serverMatch = path.match(/^\/api\/servers\/([^/]+)\/(stop|restart|bind)$/);
    if (serverMatch && method === "POST") {
      const [, id, action] = serverMatch;
      if (action === "stop") return this._apiStopServer(req, res, id);
      if (action === "restart") return this._apiRestartServer(req, res, id);
      if (action === "bind") return this._apiBindServer(req, res, id);
    }
    const deleteMatch = path.match(/^\/api\/servers\/([^/]+)$/);
    if (deleteMatch && method === "DELETE") return this._apiStopServer(req, res, deleteMatch[1]);

    // Static: serve dashboard HTML
    if (path === "/" || path === "/index.html") return this._serveHTML(req, res);

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  _json(res, data, status = 200) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
      req.on("error", reject);
    });
  }

  _saveConfig() {
    const tmp = this._configPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(this._config, null, 2) + "\n");
    renameSync(tmp, this._configPath);
  }

  // --- API handlers ---

  _apiStatus(_req, res) {
    this._json(res, {
      status: "running",
      boundServer: this._config.opencode.base_url,
      dashboardPort: this._config.dashboard?.port || 8015,
      sessionsCount: this._sessions.length,
    });
  }

  _apiSessions(_req, res) {
    this._json(res, this._sessions);
  }

  _apiGetConfig(_req, res) {
    this._json(res, this._config);
  }

  async _apiPutConfig(req, res) {
    try {
      const body = await this._readBody(req);
      // Merge top-level keys (shallow merge for safety)
      for (const key of Object.keys(body)) {
        if (key === "prompt") {
          this._config.prompt = { ...this._config.prompt, ...body.prompt };
        } else if (key === "opencode") {
          this._config.opencode = { ...this._config.opencode, ...body.opencode };
        } else if (key === "dashboard") {
          this._config.dashboard = { ...this._config.dashboard, ...body.dashboard };
        } else {
          this._config[key] = body[key];
        }
      }
      this._saveConfig();
      this._json(res, this._config);
    } catch (e) {
      this._json(res, { error: e.message }, 400);
    }
  }

  _apiGetPrompts(_req, res) {
    this._json(res, this._config.prompt);
  }

  async _apiPutPrompts(req, res) {
    try {
      const body = await this._readBody(req);
      this._config.prompt = { ...this._config.prompt, ...body };
      this._saveConfig();
      this._json(res, this._config.prompt);
    } catch (e) {
      this._json(res, { error: e.message }, 400);
    }
  }

  _apiListServers(_req, res) {
    this._json(res, this._serverManager.list());
  }

  async _apiStartServer(req, res) {
    try {
      const { port, projectDir } = await this._readBody(req);
      if (!port) return this._json(res, { error: "port is required" }, 400);
      const info = this._serverManager.start({ port, projectDir: projectDir || process.cwd() });
      this._json(res, info, 201);
    } catch (e) {
      this._json(res, { error: e.message }, 500);
    }
  }

  _apiStopServer(_req, res, id) {
    const ok = this._serverManager.stop(id);
    if (!ok) return this._json(res, { error: "Server not found" }, 404);
    this._json(res, { stopped: true });
  }

  _apiRestartServer(_req, res, id) {
    const info = this._serverManager.restart(id);
    if (!info) return this._json(res, { error: "Server not found" }, 404);
    this._json(res, info);
  }

  async _apiBindServer(req, res, id) {
    const servers = this._serverManager.list();
    const target = servers.find((s) => s.id === id);
    if (!target) return this._json(res, { error: "Server not found" }, 404);
    this._config.opencode.base_url = `http://localhost:${target.port}`;
    this._saveConfig();
    this._json(res, { bound: true, base_url: this._config.opencode.base_url });
  }

  _apiSSE(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.write("event: connected\ndata: {}\n\n");
    this._sseClients.add(res);
    req.on("close", () => { this._sseClients.delete(res); });
  }

  _serveHTML(_req, res) {
    try {
      const html = readFileSync(resolve(__dirname, "../dashboard/index.html"), "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Dashboard HTML not found");
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-server.test.js`
Expected: 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard-server.js test/dashboard-server.test.js
git commit -m "feat: add DashboardServer with REST API and SSE"
```

---

### Task 4: Dashboard Frontend (`dashboard/index.html`)

**Files:**
- Create: `dashboard/index.html`

- [ ] **Step 1: Write the failing test (smoke test)**

```javascript
// Add to test/dashboard-server.test.js — already exists, append:

it("GET / contains tab structure", async () => {
  const res = await fetch(`${baseUrl}/`);
  const html = await res.text();
  assert.ok(html.includes("Sessions"));
  assert.ok(html.includes("Servers"));
  assert.ok(html.includes("Prompts"));
  assert.ok(html.includes("Settings"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL — HTML does not contain "Sessions" (because `dashboard/index.html` does not exist yet)

- [ ] **Step 3: Create the dashboard HTML**

Create file `dashboard/index.html` with the full single-page application. This is a large file (inline CSS + JS). Key sections:

- Top status bar with connection indicator
- 4 tabs: Sessions, Servers, Prompts, Settings
- SSE listener for real-time session updates
- Fetch-based API interactions for all CRUD operations
- Language selector that maps to response_format strings
- Intent routing keywords displayed read-only

The full HTML content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Oncall Bot Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; min-height: 100vh; }
.header { background: #16213e; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #0f3460; }
.header h1 { font-size: 18px; font-weight: 600; }
.status-bar { display: flex; gap: 16px; align-items: center; font-size: 13px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
.status-dot.green { background: #4caf50; }
.status-dot.red { background: #f44336; }
.tabs { display: flex; background: #16213e; border-bottom: 1px solid #0f3460; padding: 0 24px; }
.tab { padding: 10px 20px; cursor: pointer; border-bottom: 2px solid transparent; font-size: 14px; color: #999; }
.tab.active { color: #e0e0e0; border-bottom-color: #4fc3f7; }
.tab:hover { color: #ccc; }
.content { padding: 24px; max-width: 1200px; margin: 0 auto; }
.panel { display: none; }
.panel.active { display: block; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #2a2a4a; font-size: 13px; }
th { color: #999; font-weight: 500; }
tr.new-row { animation: highlight 2s ease-out; }
@keyframes highlight { from { background: rgba(79,195,247,0.2); } to { background: transparent; } }
.btn { padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
.btn-primary { background: #4fc3f7; color: #1a1a2e; }
.btn-danger { background: #f44336; color: #fff; }
.btn-success { background: #4caf50; color: #fff; }
.btn:hover { opacity: 0.85; }
input, select, textarea { background: #2a2a4a; border: 1px solid #3a3a5a; color: #e0e0e0; padding: 8px 12px; border-radius: 4px; font-size: 13px; font-family: inherit; }
textarea { width: 100%; min-height: 80px; resize: vertical; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; margin-bottom: 6px; font-size: 13px; color: #999; }
.intent-list { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.intent-btn { padding: 6px 14px; border: 1px solid #3a3a5a; border-radius: 4px; cursor: pointer; background: transparent; color: #e0e0e0; font-size: 13px; }
.intent-btn.active { border-color: #4fc3f7; background: rgba(79,195,247,0.1); }
.card { background: #16213e; border: 1px solid #0f3460; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.server-actions { display: flex; gap: 8px; }
.keywords-box { background: #2a2a4a; padding: 12px; border-radius: 4px; font-size: 12px; color: #999; margin-bottom: 16px; }
.empty { color: #666; text-align: center; padding: 40px; }
</style>
</head>
<body>
<div class="header">
  <h1>Oncall Bot Dashboard</h1>
  <div class="status-bar">
    <span><span class="status-dot green" id="statusDot"></span><span id="statusText">Running</span></span>
    <span>Server: <strong id="boundServer">-</strong></span>
    <span>Port: <strong id="dashPort">8015</strong></span>
  </div>
</div>

<div class="tabs">
  <div class="tab active" data-tab="sessions">Sessions</div>
  <div class="tab" data-tab="servers">Servers</div>
  <div class="tab" data-tab="prompts">Prompts</div>
  <div class="tab" data-tab="settings">Settings</div>
</div>

<div class="content">
  <!-- Sessions Panel -->
  <div class="panel active" id="panel-sessions">
    <h3>Real-time Sessions</h3>
    <table>
      <thead><tr><th>Session</th><th>Chat</th><th>Intent</th><th>Time</th></tr></thead>
      <tbody id="sessionsBody"></tbody>
    </table>
    <div class="empty" id="sessionsEmpty">No sessions yet. Waiting for triggers...</div>
  </div>

  <!-- Servers Panel -->
  <div class="panel" id="panel-servers">
    <h3>OpenCode Servers</h3>
    <div class="card">
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
        <div class="form-group" style="margin:0"><label>Port</label><input type="number" id="newServerPort" value="3000" style="width:100px"></div>
        <div class="form-group" style="margin:0"><label>Project Directory</label><input type="text" id="newServerDir" placeholder="/path/to/project" style="width:300px"></div>
        <button class="btn btn-primary" onclick="startServer()">Start Server</button>
      </div>
    </div>
    <table>
      <thead><tr><th>ID</th><th>Port</th><th>PID</th><th>Status</th><th>Started</th><th>Actions</th></tr></thead>
      <tbody id="serversBody"></tbody>
    </table>
    <div class="empty" id="serversEmpty">No managed servers.</div>
  </div>

  <!-- Prompts Panel -->
  <div class="panel" id="panel-prompts">
    <h3>Prompt Configuration</h3>
    <div class="keywords-box">
      <strong>Intent Routing Keywords:</strong><br>
      <strong>summary:</strong> summary, summarize, summarise, 总结, 总结上面, 总结上面的对话<br>
      <strong>incident_analysis:</strong> incident, error, failure, failing, broken, debug, investigate, 排查, 报错, 故障, 异常<br>
      <strong>pr_review:</strong> GitHub PR URL pattern (https://github.com/.../pull/N)<br>
      <strong>other:</strong> fallback for everything else
    </div>
    <div class="intent-list" id="intentList"></div>
    <div id="promptEditor"></div>
  </div>

  <!-- Settings Panel -->
  <div class="panel" id="panel-settings">
    <h3>Settings</h3>
    <div class="card">
      <div class="form-group">
        <label>Reply Language</label>
        <select id="langSelect" onchange="saveLanguage()">
          <option value="Respond in Chinese.">中文</option>
          <option value="Respond in English.">English</option>
          <option value="Respond in Bahasa Indonesia.">Bahasa Indonesia</option>
          <option value="Respond in Elvish (Sindarin style, Tolkien).">精灵语 (Elvish)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Dashboard Port (requires restart)</label>
        <input type="number" id="dashPortInput" value="8015" style="width:120px">
        <button class="btn btn-primary" onclick="saveDashPort()">Save</button>
      </div>
    </div>
  </div>
</div>

<script>
const API = '';

// --- Tabs ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// --- SSE ---
const sse = new EventSource(API + '/api/events');
sse.addEventListener('session_created', (e) => {
  const data = JSON.parse(e.data);
  addSessionRow(data);
});
sse.addEventListener('connected', () => {
  document.getElementById('statusDot').className = 'status-dot green';
  document.getElementById('statusText').textContent = 'Connected';
});
sse.onerror = () => {
  document.getElementById('statusDot').className = 'status-dot red';
  document.getElementById('statusText').textContent = 'Disconnected';
};

// --- Sessions ---
function addSessionRow(s) {
  document.getElementById('sessionsEmpty').style.display = 'none';
  const tbody = document.getElementById('sessionsBody');
  const tr = document.createElement('tr');
  tr.className = 'new-row';
  tr.innerHTML = `<td>${esc(s.title || s.sessionId)}</td><td>${esc(s.chatName || '-')}</td><td>${esc(s.intent || '-')}</td><td>${new Date(s.createdAt).toLocaleTimeString()}</td>`;
  tbody.prepend(tr);
}

async function loadSessions() {
  const res = await fetch(API + '/api/sessions');
  const sessions = await res.json();
  if (sessions.length) document.getElementById('sessionsEmpty').style.display = 'none';
  sessions.forEach(addSessionRow);
}

// --- Servers ---
async function loadServers() {
  const res = await fetch(API + '/api/servers');
  const servers = await res.json();
  const tbody = document.getElementById('serversBody');
  tbody.innerHTML = '';
  document.getElementById('serversEmpty').style.display = servers.length ? 'none' : 'block';
  servers.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(s.id)}</td><td>${s.port}</td><td>${s.pid || '-'}</td><td>${s.status}</td><td>${new Date(s.startedAt).toLocaleTimeString()}</td><td class="server-actions"><button class="btn btn-success" onclick="bindServer('${s.id}')">Bind</button><button class="btn btn-primary" onclick="restartServer('${s.id}')">Restart</button><button class="btn btn-danger" onclick="stopServer('${s.id}')">Stop</button></td>`;
    tbody.appendChild(tr);
  });
}

async function startServer() {
  const port = parseInt(document.getElementById('newServerPort').value);
  const projectDir = document.getElementById('newServerDir').value || undefined;
  await fetch(API + '/api/servers', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({port, projectDir}) });
  loadServers();
}
async function stopServer(id) { await fetch(API + '/api/servers/' + id + '/stop', {method:'POST'}); loadServers(); }
async function restartServer(id) { await fetch(API + '/api/servers/' + id + '/restart', {method:'POST'}); loadServers(); }
async function bindServer(id) { await fetch(API + '/api/servers/' + id + '/bind', {method:'POST'}); loadStatus(); loadServers(); }

// --- Prompts ---
let currentIntent = 'summary';
const INTENTS = ['summary', 'incident_analysis', 'pr_review', 'other'];

function renderIntentList() {
  const el = document.getElementById('intentList');
  el.innerHTML = INTENTS.map(i => `<div class="intent-btn ${i===currentIntent?'active':''}" onclick="selectIntent('${i}')">${i}</div>`).join('');
}

function selectIntent(intent) {
  currentIntent = intent;
  renderIntentList();
  renderPromptEditor();
}

let promptData = {};
async function loadPrompts() {
  const res = await fetch(API + '/api/prompts');
  promptData = await res.json();
  renderIntentList();
  renderPromptEditor();
}

function renderPromptEditor() {
  const p = promptData[currentIntent] || {};
  document.getElementById('promptEditor').innerHTML = `
    <div class="card">
      <div class="form-group"><label>system_prefix</label><textarea id="pf_system">${esc(p.system_prefix||'')}</textarea></div>
      <div class="form-group"><label>task_instructions</label><textarea id="pf_task">${esc(p.task_instructions||'')}</textarea></div>
      <div class="form-group"><label>response_format</label><textarea id="pf_format">${esc(p.response_format||'')}</textarea></div>
      <button class="btn btn-primary" onclick="savePrompt()">Save</button>
    </div>`;
}

async function savePrompt() {
  const body = { [currentIntent]: {
    system_prefix: document.getElementById('pf_system').value,
    task_instructions: document.getElementById('pf_task').value,
    response_format: document.getElementById('pf_format').value,
  }};
  await fetch(API + '/api/prompts', {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  await loadPrompts();
}

// --- Settings ---
async function loadStatus() {
  const res = await fetch(API + '/api/status');
  const data = await res.json();
  document.getElementById('boundServer').textContent = data.boundServer || '-';
  document.getElementById('dashPort').textContent = data.dashboardPort;
  document.getElementById('dashPortInput').value = data.dashboardPort;
}

async function loadConfig() {
  const res = await fetch(API + '/api/config');
  const cfg = await res.json();
  // Set language selector based on first prompt's response_format
  const fmt = cfg.prompt?.summary?.response_format || '';
  const sel = document.getElementById('langSelect');
  for (let i = 0; i < sel.options.length; i++) {
    if (fmt.includes(sel.options[i].value.split(' ').slice(2).join(' ').replace('.', ''))) {
      sel.selectedIndex = i; break;
    }
  }
}

async function saveLanguage() {
  const lang = document.getElementById('langSelect').value;
  const body = {};
  INTENTS.forEach(i => { body[i] = { ...promptData[i], response_format: lang }; });
  await fetch(API + '/api/prompts', {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  await loadPrompts();
}

async function saveDashPort() {
  const port = parseInt(document.getElementById('dashPortInput').value);
  await fetch(API + '/api/config', {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({dashboard:{port}})});
  alert('Dashboard port saved. Restart bot to apply.');
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// --- Init ---
loadStatus();
loadSessions();
loadServers();
loadPrompts();
loadConfig();
</script>
</body>
</html>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-server.test.js`
Expected: All 6 tests passing (including new HTML structure test)

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html test/dashboard-server.test.js
git commit -m "feat: add dashboard frontend single-page HTML"
```

---

### Task 5: Integrate Dashboard into oncall-bot.js

**Files:**
- Modify: `oncall-bot.js`
- Modify: `lib/config.js`
- Modify: `oncall-bot.config.json`

- [ ] **Step 1: Write the failing test**

```javascript
// Add to test/oncall-orchestration.test.js or create test/integration-dashboard.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../lib/config.js";

describe("config dashboard defaults", () => {
  it("applies dashboard defaults when field is missing", () => {
    // Create a minimal config to test defaults
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const path = "/tmp/test-dashboard-cfg.json";
    writeFileSync(path, JSON.stringify({ opencode: { base_url: "http://localhost:3000" } }));
    const cfg = loadConfig(path);
    assert.equal(cfg.dashboard.port, 8015);
    assert.equal(cfg.dashboard.enabled, true);
    unlinkSync(path);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/integration-dashboard.test.js`
Expected: FAIL — `cfg.dashboard` is undefined

- [ ] **Step 3: Modify lib/config.js to add dashboard defaults**

Add after line 74 in `lib/config.js` (after concurrency defaults):

```javascript
  config.dashboard = { port: 8015, enabled: true, ...config.dashboard };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/integration-dashboard.test.js`
Expected: PASS

- [ ] **Step 5: Modify oncall-bot.js to start dashboard and emit events**

In `oncall-bot.js`, add imports and initialization:

After existing imports (line 15), add:
```javascript
import { DashboardServer } from "./lib/dashboard-server.js";
import { botEvents } from "./lib/bot-events.js";
```

In `main()`, after `await preflight()` (line 145), add:
```javascript
  // Start dashboard
  if (config.dashboard.enabled) {
    const dashboard = new DashboardServer({ config, botEvents, configPath });
    await dashboard.start();
    log(`✓ dashboard running at http://localhost:${config.dashboard.port}`);
  }
```

In `handleTrigger()`, after session creation (inside the `opencode` wrapper's `findOrCreateSession`, around line 94), add event emission:
```javascript
        async findOrCreateSession(sessionOptions) {
          const result = await opencode.findOrCreateSession(sessionOptions);
          log(`  session: "${sessionOptions.title}" (${result.sessionId}, ${result.sessionState})`);
          botEvents.emit("session:created", {
            sessionId: result.sessionId,
            title: sessionOptions.title,
            chatName: sessionOptions.title.split("-")[0],
            intent: "unknown",
            createdAt: new Date().toISOString(),
          });
          return result;
        },
```

- [ ] **Step 6: Update oncall-bot.config.json**

Add to `oncall-bot.config.json`:
```json
  "dashboard": {
    "port": 8015,
    "enabled": true
  }
```

- [ ] **Step 7: Run full test suite**

Run: `node --test test/`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add lib/config.js oncall-bot.js oncall-bot.config.json test/integration-dashboard.test.js
git commit -m "feat: integrate dashboard into oncall-bot main process"
```

---

### Task 6: Manual Smoke Test

- [ ] **Step 1: Start the bot**

```bash
node oncall-bot.js
```

Expected output includes:
```
[HH:MM:SS] ✓ dashboard running at http://localhost:8015
```

- [ ] **Step 2: Open browser**

Navigate to `http://localhost:8015`. Verify:
- All 4 tabs render correctly
- Status bar shows "Connected" with green dot
- Sessions tab shows "No sessions yet"
- Servers tab shows empty list
- Prompts tab shows intent keywords and editable textareas
- Settings tab shows language selector and port input

- [ ] **Step 3: Test server management**

Click "Start Server" with port 3001. Verify it appears in the table. Click "Stop" to kill it.

- [ ] **Step 4: Test prompt editing**

Switch to Prompts tab, select `summary`, change `system_prefix`, click Save. Verify `oncall-bot.config.json` on disk updated.

- [ ] **Step 5: Test language switch**

Go to Settings, change language to "English". Verify all intents' `response_format` updated in config file.

- [ ] **Step 6: Commit final state**

```bash
git add -A
git commit -m "chore: final integration verified"
```
