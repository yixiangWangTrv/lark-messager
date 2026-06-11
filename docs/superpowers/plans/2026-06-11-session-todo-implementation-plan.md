# Session Todo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-persisted todos to the dashboard session detail view, creating a dedicated OpenCode analysis session for each todo and allowing todos to be marked completed.

**Architecture:** Add a small file-backed todo store module, expose session-scoped todo APIs from the dashboard server, and extend the existing session detail UI to load, create, and complete todos. Todo creation is atomic from the dashboard user's perspective: create the OpenCode session first, then persist the todo record.

**Tech Stack:** Node.js, vanilla HTML/CSS/JS dashboard, file-backed JSON storage, node:test, existing OpenCode client.

---

## File Structure

- Create: `lib/session-todo-store.js`
  - File-backed JSON store for session todos.
- Modify: `lib/dashboard-server.js`
  - Add todo API routes and handlers.
- Modify: `dashboard/index.html`
  - Add todo UI inside session detail and JS handlers for load/create/complete.
- Modify: `test/dashboard-server.test.js`
  - Add API coverage for todo endpoints.
- Create: `test/session-todo-store.test.js`
  - Add storage-level tests.
- Modify: `.gitignore`
  - Ignore persisted runtime todo data if needed.

### Task 1: Add File-Backed Todo Store

**Files:**
- Create: `lib/session-todo-store.js`
- Test: `test/session-todo-store.test.js`

- [ ] **Step 1: Write the failing storage tests**

```js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionTodoStore } from "../lib/session-todo-store.js";

describe("SessionTodoStore", () => {
  let dir;
  let filePath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-todo-store-"));
    filePath = join(dir, "session-todos.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list for a session with no todos", () => {
    const store = new SessionTodoStore(filePath);
    assert.deepEqual(store.listBySession("session-1"), []);
  });

  it("creates and persists a todo under a parent session", () => {
    const store = new SessionTodoStore(filePath);
    const todo = store.create({
      parentSessionId: "session-1",
      title: "Investigate spike",
      description: "Check queue growth",
      todoSessionId: "todo-session-1",
    });

    assert.equal(todo.parentSessionId, "session-1");
    assert.equal(todo.status, "open");
    assert.equal(todo.todoSessionId, "todo-session-1");
    assert.equal(store.listBySession("session-1").length, 1);
  });

  it("marks an existing todo as completed", () => {
    const store = new SessionTodoStore(filePath);
    const todo = store.create({
      parentSessionId: "session-1",
      title: "Investigate spike",
      description: "",
      todoSessionId: "todo-session-1",
    });

    const updated = store.complete(todo.id);
    assert.equal(updated.status, "completed");
    assert.ok(updated.completedAt);
  });

  it("throws a clear error when the storage file contains invalid JSON", () => {
    writeFileSync(filePath, "{not-json");
    const store = new SessionTodoStore(filePath);
    assert.throws(() => store.listBySession("session-1"), /Invalid session todo storage JSON/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/session-todo-store.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../lib/session-todo-store.js`

- [ ] **Step 3: Write minimal storage implementation**

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export class SessionTodoStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  listBySession(parentSessionId) {
    const data = this._readAll();
    return data[parentSessionId] || [];
  }

  create({ parentSessionId, title, description = "", todoSessionId }) {
    const data = this._readAll();
    const todo = {
      id: `todo_${randomUUID()}`,
      parentSessionId,
      title,
      description,
      status: "open",
      todoSessionId,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    data[parentSessionId] = data[parentSessionId] || [];
    data[parentSessionId].push(todo);
    this._writeAll(data);
    return todo;
  }

  complete(todoId) {
    const data = this._readAll();
    for (const todos of Object.values(data)) {
      const todo = todos.find((item) => item.id === todoId);
      if (todo) {
        todo.status = "completed";
        todo.completedAt = new Date().toISOString();
        this._writeAll(data);
        return todo;
      }
    }
    return null;
  }

  _readAll() {
    if (!existsSync(this.filePath)) return {};
    const raw = readFileSync(this.filePath, "utf-8").trim();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("Invalid session todo storage JSON");
    }
  }

  _writeAll(data) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/session-todo-store.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/session-todo-store.test.js lib/session-todo-store.js
git commit -m "feat: add session todo store"
```

### Task 2: Add Todo API Endpoints To Dashboard Server

**Files:**
- Modify: `lib/dashboard-server.js`
- Test: `test/dashboard-server.test.js`

- [ ] **Step 1: Write the failing dashboard API tests**

Add these tests to `test/dashboard-server.test.js`:

```js
  it("GET /api/sessions/:id/todos returns an empty list initially", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/session-1/todos`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });

  it("POST /api/sessions/:id/todos creates a todo with a dedicated OpenCode session", async () => {
    server.setOpenCodeClient({
      findOrCreateSession: async ({ title, cacheKey, reuse }) => {
        assert.equal(title, "TODO Parent Session - Investigate spike");
        assert.equal(cacheKey, "todo:session-1:Investigate spike");
        assert.equal(reuse, false);
        return { sessionId: "todo-session-1", sessionState: "new" };
      },
    });

    const res = await fetch(`${baseUrl}/api/sessions/session-1/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Investigate spike", description: "Check queue growth" }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.parentSessionId, "session-1");
    assert.equal(data.todoSessionId, "todo-session-1");
    assert.equal(data.status, "open");
  });

  it("POST /api/todos/:todoId/complete marks an existing todo completed", async () => {
    server.setOpenCodeClient({
      findOrCreateSession: async () => ({ sessionId: "todo-session-1", sessionState: "new" }),
    });

    const createRes = await fetch(`${baseUrl}/api/sessions/session-1/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Investigate spike", description: "Check queue growth" }),
    });
    const created = await createRes.json();

    const completeRes = await fetch(`${baseUrl}/api/todos/${encodeURIComponent(created.id)}/complete`, {
      method: "POST",
    });
    assert.equal(completeRes.status, 200);
    const updated = await completeRes.json();
    assert.equal(updated.status, "completed");
    assert.ok(updated.completedAt);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL with 404 responses for the new todo routes

- [ ] **Step 3: Wire store and route handlers into the dashboard server**

Update `lib/dashboard-server.js` with these changes:

```js
import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ServerManager } from "./server-manager.js";
import { SessionTodoStore } from "./session-todo-store.js";
```

```js
    this._todoStore = new SessionTodoStore(resolve(__dirname, "../data/session-todos.json"));
```

Add route matching in `_handleRequest` before the final 404:

```js
    const sessionTodosMatch = path.match(/^\/api\/sessions\/([^/]+)\/todos$/);
    if (sessionTodosMatch && req.method === "GET") {
      return this._handleGetSessionTodos(sessionTodosMatch[1], res);
    }
    if (sessionTodosMatch && req.method === "POST") {
      return this._handlePostSessionTodo(sessionTodosMatch[1], req, res);
    }

    const todoCompleteMatch = path.match(/^\/api\/todos\/([^/]+)\/complete$/);
    if (todoCompleteMatch && req.method === "POST") {
      return this._handleCompleteTodo(todoCompleteMatch[1], res);
    }
```

Add handlers near the other API handlers:

```js
  _findSessionTitle(sessionId) {
    const session = this._sessions.find((item) => item.sessionId === sessionId);
    return session?.title || sessionId;
  }

  _handleGetSessionTodos(sessionId, res) {
    try {
      this._jsonResponse(res, this._todoStore.listBySession(sessionId));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePostSessionTodo(sessionId, req, res) {
    try {
      const { title, description = "" } = await this._readBody(req);
      if (!title) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "title required" }));
        return;
      }
      if (!this._openCodeClient) {
        throw new Error("OpenCode client not configured");
      }

      const parentTitle = this._findSessionTitle(sessionId);
      const todoSession = await this._openCodeClient.findOrCreateSession({
        title: `TODO ${parentTitle} - ${title}`,
        cacheKey: `todo:${sessionId}:${title}`,
        reuse: false,
      });

      const todo = this._todoStore.create({
        parentSessionId: sessionId,
        title,
        description,
        todoSessionId: todoSession.sessionId,
      });
      this._jsonResponse(res, todo);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  _handleCompleteTodo(todoId, res) {
    try {
      const todo = this._todoStore.complete(todoId);
      if (!todo) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "todo not found" }));
        return;
      }
      this._jsonResponse(res, todo);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-server.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard-server.js test/dashboard-server.test.js
git commit -m "feat: add dashboard todo api"
```

### Task 3: Make Dashboard Tests Isolated From Real Todo Data

**Files:**
- Modify: `lib/dashboard-server.js`
- Modify: `test/dashboard-server.test.js`

- [ ] **Step 1: Write the failing isolation test**

Add this test to `test/dashboard-server.test.js`:

```js
  it("uses an injected todo store path for test isolation", async () => {
    const isolatedServer = new DashboardServer({
      config: { ...config, dashboard: { ...config.dashboard, port: 18916 } },
      botEvents,
      configPath: "/tmp/test-config-2.json",
      todoStorePath: "/tmp/test-session-todos.json",
    });
    await isolatedServer.start();
    const res = await fetch("http://localhost:18916/api/sessions/session-1/todos");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
    isolatedServer.stop();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL because `todoStorePath` is ignored

- [ ] **Step 3: Add injectable todo store path support**

Update the `DashboardServer` constructor signature and store initialization:

```js
  constructor({ config, botEvents, configPath, opencode, todoStorePath }) {
    this._config = config;
    this._botEvents = botEvents;
    this._configPath = configPath;
    this._opencode = opencode || null;
    this._sessions = [];
    this._sseClients = new Set();
    this._serverManager = new ServerManager();
    this._httpServer = null;
    this._todoStore = new SessionTodoStore(todoStorePath || resolve(__dirname, "../data/session-todos.json"));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-server.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard-server.js test/dashboard-server.test.js
git commit -m "test: isolate dashboard todo storage"
```

### Task 4: Add Todo UI To Session Detail Panel

**Files:**
- Modify: `dashboard/index.html`

- [ ] **Step 1: Add the todo panel markup and styles**

Insert this markup below the existing session messages area inside `#sessionDetail`:

```html
      <div class="card" id="sessionTodosCard" style="margin-top:16px;margin-bottom:0;padding:16px">
        <h3 style="margin-bottom:12px">Todos</h3>
        <div class="field-group">
          <label>Title</label>
          <input type="text" id="todoTitleInput" placeholder="Add a task for this session..." style="width:100%">
        </div>
        <div class="field-group">
          <label>Description</label>
          <textarea id="todoDescriptionInput" placeholder="Optional details for the follow-up analysis"></textarea>
        </div>
        <div class="form-row" style="margin-bottom:16px">
          <button id="addTodoBtn" onclick="createSessionTodo()">Add Todo</button>
          <span class="note" id="todoStatusText"></span>
        </div>
        <div id="sessionTodosList">
          <p class="empty">No todos yet.</p>
        </div>
      </div>
```

Add these styles near the session detail CSS:

```css
.todo-item{background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px}
.todo-item:last-child{margin-bottom:0}
.todo-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--text-secondary);margin-top:6px}
.todo-badge{padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
.todo-badge-open{background:var(--accent-bg);color:var(--accent)}
.todo-badge-completed{background:rgba(76,175,80,.15);color:var(--success)}
.todo-actions{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
```

- [ ] **Step 2: Add session todo state and renderer**

Add these script variables and helpers near the session detail code:

```js
let currentSessionId = null;

function renderSessionTodos(todos){
  const el=document.getElementById("sessionTodosList");
  if(!todos.length){
    el.innerHTML='<p class="empty">No todos yet.</p>';
    return;
  }
  el.innerHTML=todos.map(todo=>{
    const badgeClass=todo.status==="completed"?"todo-badge-completed":"todo-badge-open";
    const completeBtn=todo.status==="open"
      ? `<button class="secondary" onclick="completeSessionTodo('${esc(todo.id)}')">Complete</button>`
      : "";
    return `<div class="todo-item">
      <div><strong>${esc(todo.title)}</strong></div>
      ${todo.description?`<div class="note" style="margin-top:6px">${esc(todo.description)}</div>`:""}
      <div class="todo-meta">
        <span class="todo-badge ${badgeClass}">${esc(todo.status)}</span>
        <span>Created: ${esc(todo.createdAt||"-")}</span>
        <span>Session: <code>${esc(todo.todoSessionId)}</code></span>
      </div>
      <div class="todo-actions">
        ${completeBtn}
      </div>
    </div>`;
  }).join("");
}
```

- [ ] **Step 3: Load todos when opening session detail**

Update `openSessionDetail` to also fetch todos:

```js
async function openSessionDetail(sessionId,title){
  const panel=document.getElementById("sessionDetail");
  const msgEl=document.getElementById("sessionMessages");
  document.getElementById("sessionDetailTitle").textContent=title;
  panel.classList.add("active");
  currentSessionId=sessionId;
  msgEl.innerHTML='<div class="msg-loading">Loading messages...</div>';
  document.getElementById("sessionTodosList").innerHTML='<div class="msg-loading">Loading todos...</div>';

  try{
    const [messages,todos]=await Promise.all([
      api(`/api/sessions/${encodeURIComponent(sessionId)}/messages`),
      api(`/api/sessions/${encodeURIComponent(sessionId)}/todos`),
    ]);
    if(!messages.length){
      msgEl.innerHTML='<div class="msg-loading">No messages in this session.</div>';
    }else{
      let html="";
      for(const msg of messages){
        const role=msg.info?.role||"unknown";
        const text=msg.parts?.filter(p=>p.type==="text").map(p=>p.text).join("\n")||"";
        if(!text.trim())continue;
        const roleClass=role==="user"?"msg-user":"msg-assistant";
        const roleLabelClass=role==="user"?"msg-role-user":"msg-role-assistant";
        html+=`<div class="msg-bubble ${roleClass}"><div class="msg-role ${roleLabelClass}">${esc(role)}</div>${esc(text)}</div>`;
      }
      msgEl.innerHTML=html||'<div class="msg-loading">No text messages found.</div>';
      msgEl.scrollTop=msgEl.scrollHeight;
    }
    renderSessionTodos(todos);
  }catch(e){
    msgEl.innerHTML=`<div class="msg-loading">Error: ${esc(e.message)}</div>`;
    document.getElementById("sessionTodosList").innerHTML=`<div class="msg-loading">Error: ${esc(e.message)}</div>`;
  }
}
```

- [ ] **Step 4: Add create and complete todo actions**

Add these functions near the session detail code:

```js
async function createSessionTodo(){
  if(!currentSessionId)return;
  const titleEl=document.getElementById("todoTitleInput");
  const descEl=document.getElementById("todoDescriptionInput");
  const statusEl=document.getElementById("todoStatusText");
  const btn=document.getElementById("addTodoBtn");
  const title=titleEl.value.trim();
  const description=descEl.value.trim();
  if(!title){
    statusEl.textContent="Title is required.";
    statusEl.style.color="var(--danger)";
    return;
  }
  btn.disabled=true;
  statusEl.textContent="Creating todo session...";
  statusEl.style.color="var(--text-secondary)";
  try{
    await api(`/api/sessions/${encodeURIComponent(currentSessionId)}/todos`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({title,description}),
    });
    titleEl.value="";
    descEl.value="";
    statusEl.textContent="Todo created.";
    statusEl.style.color="var(--success)";
    const todos=await api(`/api/sessions/${encodeURIComponent(currentSessionId)}/todos`);
    renderSessionTodos(todos);
  }catch(e){
    statusEl.textContent=`Failed: ${e.message}`;
    statusEl.style.color="var(--danger)";
  }finally{
    btn.disabled=false;
  }
}

async function completeSessionTodo(todoId){
  if(!currentSessionId)return;
  try{
    await api(`/api/todos/${encodeURIComponent(todoId)}/complete`,{method:"POST"});
    const todos=await api(`/api/sessions/${encodeURIComponent(currentSessionId)}/todos`);
    renderSessionTodos(todos);
  }catch(e){
    alert(`Failed: ${e.message}`);
  }
}
```

- [ ] **Step 5: Run a manual smoke test**

Run the app, then verify:

```bash
node oncall-bot.js --config oncall-bot.config.json
```

Manual expected results:
- opening a session detail shows a Todos section
- adding a todo shows a new todo item
- refreshing the page keeps the todo
- clicking Complete changes the status to completed

- [ ] **Step 6: Commit**

```bash
git add dashboard/index.html
git commit -m "feat: add session todo dashboard ui"
```

### Task 5: Ignore Runtime Todo Data And Run Final Verification

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add runtime todo data path to gitignore**

Append this line to `.gitignore` if it is not already present:

```gitignore
data/session-todos.json
```

- [ ] **Step 2: Run focused automated verification**

Run:

```bash
node --test test/session-todo-store.test.js test/dashboard-server.test.js test/opencode-client.test.js
```

Expected: PASS

- [ ] **Step 3: Run broader regression verification**

Run:

```bash
node --test test/intent-router.test.js test/oncall-orchestration.test.js
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore session todo runtime data"
```

## Self-Review

- Spec coverage checked:
  - session detail todo UI: Task 4
  - local file persistence: Task 1
  - add todo and create dedicated session: Task 2
  - complete todo: Task 2 and Task 4
  - invalid JSON handling: Task 1
  - persistence after refresh: Task 4 manual verification
- Placeholder scan checked:
  - no TBD or deferred implementation notes remain in task steps
- Type consistency checked:
  - `SessionTodoStore` methods are `listBySession`, `create`, `complete`
  - todo fields are consistent across store, API, and UI: `id`, `parentSessionId`, `title`, `description`, `status`, `todoSessionId`, `createdAt`, `completedAt`

Plan complete and saved to `docs/superpowers/plans/2026-06-11-session-todo-implementation-plan.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
