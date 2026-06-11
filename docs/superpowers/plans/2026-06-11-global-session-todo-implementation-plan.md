# Global Session Todo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the session-scoped todo feature with a global todo workflow that starts from a session-row `Add Todo` action, supports summary drafts, persists todos globally, and lazily creates dedicated todo chat sessions.

**Architecture:** Replace the existing session-grouped todo store with a global file-backed todo store, then rewrite the dashboard server todo routes around todo-first APIs. After the server APIs are in place, rebuild the sessions UI so the add flow starts from each session row and render a dedicated global todos card below the real-time sessions area.

**Tech Stack:** Node.js, vanilla HTML/CSS/JS dashboard, file-backed JSON storage, node:test, existing OpenCode client.

---

## File Structure

- Create: `lib/todo-store.js`
  - Global todo persistence with CRUD, comments, status updates, and chat-session linkage.
- Modify: `lib/dashboard-server.js`
  - Replace the old session todo endpoints with draft, todo CRUD, comment, delete, and lazy chat-session endpoints.
- Modify: `dashboard/index.html`
  - Move todo creation out of session detail, add per-session `Add Todo` actions, add add-todo dialog UI, and render the global todos section.
- Modify: `test/dashboard-server.test.js`
  - Replace old session-scoped todo endpoint coverage with global todo and draft endpoint coverage.
- Create: `test/todo-store.test.js`
  - Storage-level tests for the new global todo model.
- Delete: `lib/session-todo-store.js`
  - Remove the session-scoped store superseded by the new global store.
- Delete: `test/session-todo-store.test.js`
  - Remove tests for the superseded session-scoped store.

### Task 1: Replace Session Todo Storage With A Global Todo Store

**Files:**
- Create: `lib/todo-store.js`
- Create: `test/todo-store.test.js`
- Delete: `lib/session-todo-store.js`
- Delete: `test/session-todo-store.test.js`

- [ ] **Step 1: Write the failing storage tests**

Create `test/todo-store.test.js` with this content:

```js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore } from "../lib/todo-store.js";

describe("TodoStore", () => {
  let dir;
  let filePath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "todo-store-"));
    filePath = join(dir, "todos.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list when the file does not exist", () => {
    const store = new TodoStore(filePath);
    assert.deepEqual(store.list(), []);
  });

  it("creates and persists a global todo", () => {
    const store = new TodoStore(filePath);
    const todo = store.create({
      sourceSessionId: "session-1",
      sourceSessionTitle: "Robot Test-other-2026-06-11-3495402b",
      title: "Investigate alert burst",
      description: "Check the upstream spike pattern.",
    });

    assert.equal(todo.sourceSessionId, "session-1");
    assert.equal(todo.sourceSessionTitle, "Robot Test-other-2026-06-11-3495402b");
    assert.equal(todo.status, "open");
    assert.equal(todo.chatSessionId, null);
    assert.deepEqual(todo.comments, []);
    assert.equal(store.list().length, 1);
  });

  it("updates title, description, and status", () => {
    const store = new TodoStore(filePath);
    const todo = store.create({
      sourceSessionId: "session-1",
      sourceSessionTitle: "Session 1",
      title: "Investigate alert burst",
      description: "Check the upstream spike pattern.",
    });

    const updated = store.update(todo.id, {
      title: "Investigate alert burst deeply",
      description: "Compare with the previous spike.",
      status: "blocked",
    });

    assert.equal(updated.title, "Investigate alert burst deeply");
    assert.equal(updated.description, "Compare with the previous spike.");
    assert.equal(updated.status, "blocked");
    assert.ok(updated.updatedAt);
  });

  it("adds a comment to a todo", () => {
    const store = new TodoStore(filePath);
    const todo = store.create({
      sourceSessionId: "session-1",
      sourceSessionTitle: "Session 1",
      title: "Investigate alert burst",
      description: "",
    });

    const comment = store.addComment(todo.id, "Need to compare queue growth.");

    assert.equal(comment.content, "Need to compare queue growth.");
    assert.equal(store.get(todo.id).comments.length, 1);
  });

  it("stores and reuses a chat session id", () => {
    const store = new TodoStore(filePath);
    const todo = store.create({
      sourceSessionId: "session-1",
      sourceSessionTitle: "Session 1",
      title: "Investigate alert burst",
      description: "",
    });

    const linked = store.setChatSessionId(todo.id, "todo-chat-1");

    assert.equal(linked.chatSessionId, "todo-chat-1");
    assert.equal(store.get(todo.id).chatSessionId, "todo-chat-1");
  });

  it("deletes a todo", () => {
    const store = new TodoStore(filePath);
    const todo = store.create({
      sourceSessionId: "session-1",
      sourceSessionTitle: "Session 1",
      title: "Investigate alert burst",
      description: "",
    });

    const removed = store.delete(todo.id);

    assert.equal(removed.id, todo.id);
    assert.deepEqual(store.list(), []);
  });

  it("throws a clear error when the storage file contains invalid JSON", () => {
    writeFileSync(filePath, "{not-json");
    const store = new TodoStore(filePath);

    assert.throws(() => store.list(), /Invalid todo storage JSON/);
  });

  it("throws a clear error when the storage file does not contain a todos array", () => {
    writeFileSync(filePath, JSON.stringify({ wrong: [] }));
    const store = new TodoStore(filePath);

    assert.throws(
      () => store.list(),
      /Invalid todo storage JSON: expected an object with a todos array/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/todo-store.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../lib/todo-store.js`

- [ ] **Step 3: Write the minimal global todo store implementation**

Create `lib/todo-store.js` with this content:

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

const ALLOWED_STATUSES = new Set(["open", "in_progress", "blocked", "completed"]);

export class TodoStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  list() {
    const data = this._readAll();
    return [...data.todos].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  }

  get(todoId) {
    const data = this._readAll();
    return data.todos.find((todo) => todo.id === todoId) || null;
  }

  create({ sourceSessionId, sourceSessionTitle, title, description = "" }) {
    const data = this._readAll();
    const now = new Date().toISOString();
    const todo = {
      id: `todo_${randomUUID()}`,
      sourceSessionId,
      sourceSessionTitle,
      title,
      description,
      status: "open",
      chatSessionId: null,
      comments: [],
      createdAt: now,
      updatedAt: now,
    };

    data.todos.push(todo);
    this._writeAll(data);
    return todo;
  }

  update(todoId, fields) {
    const data = this._readAll();
    const todo = data.todos.find((item) => item.id === todoId);
    if (!todo) return null;

    if (Object.hasOwn(fields, "title")) todo.title = fields.title;
    if (Object.hasOwn(fields, "description")) todo.description = fields.description;
    if (Object.hasOwn(fields, "status")) {
      if (!ALLOWED_STATUSES.has(fields.status)) {
        throw new Error("invalid todo status");
      }
      todo.status = fields.status;
    }

    todo.updatedAt = new Date().toISOString();
    this._writeAll(data);
    return todo;
  }

  addComment(todoId, content) {
    const data = this._readAll();
    const todo = data.todos.find((item) => item.id === todoId);
    if (!todo) return null;

    const comment = {
      id: `comment_${randomUUID()}`,
      content,
      createdAt: new Date().toISOString(),
    };

    todo.comments.push(comment);
    todo.updatedAt = new Date().toISOString();
    this._writeAll(data);
    return comment;
  }

  setChatSessionId(todoId, chatSessionId) {
    const data = this._readAll();
    const todo = data.todos.find((item) => item.id === todoId);
    if (!todo) return null;

    todo.chatSessionId = chatSessionId;
    todo.updatedAt = new Date().toISOString();
    this._writeAll(data);
    return todo;
  }

  delete(todoId) {
    const data = this._readAll();
    const index = data.todos.findIndex((item) => item.id === todoId);
    if (index === -1) return null;

    const [removed] = data.todos.splice(index, 1);
    this._writeAll(data);
    return removed;
  }

  _readAll() {
    if (!existsSync(this.filePath)) return { todos: [] };

    const raw = readFileSync(this.filePath, "utf-8").trim();
    if (!raw) return { todos: [] };

    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.todos)) {
        throw new Error("Invalid todo storage JSON: expected an object with a todos array");
      }
      return { todos: [...data.todos] };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid todo storage JSON:")) {
        throw error;
      }
      throw new Error("Invalid todo storage JSON");
    }
  }

  _writeAll(data) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }
}
```

- [ ] **Step 4: Run the storage tests to verify they pass**

Run: `node --test test/todo-store.test.js`
Expected: PASS

- [ ] **Step 5: Remove the superseded session-scoped store files and commit**

Delete these files:

```text
lib/session-todo-store.js
test/session-todo-store.test.js
```

Run:

```bash
git add lib/todo-store.js test/todo-store.test.js lib/session-todo-store.js test/session-todo-store.test.js
git commit -m "feat: replace session todo store with global todo store"
```

### Task 2: Replace The Dashboard Todo API With Todo-First Endpoints

**Files:**
- Modify: `lib/dashboard-server.js`
- Modify: `test/dashboard-server.test.js`

- [ ] **Step 1: Write failing API tests for the new todo endpoints**

Add these tests to `test/dashboard-server.test.js` near the current todo coverage, replacing the old session-scoped todo tests:

```js
  it("GET /api/todos returns an empty array initially", async () => {
    const res = await fetch(`${baseUrl}/api/todos`);

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });

  it("POST /api/todos creates a global todo without creating a chat session", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-1",
      title: "Robot Test-other-2026-06-11-3495402b",
      chatName: "Robot Test",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const res = await fetch(`${baseUrl}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceSessionId: "session-1",
        title: "Investigate alert burst",
        description: "Check the upstream spike pattern.",
      }),
    });

    assert.equal(res.status, 201);
    const todo = await res.json();
    assert.equal(todo.sourceSessionId, "session-1");
    assert.equal(todo.sourceSessionTitle, "Robot Test-other-2026-06-11-3495402b");
    assert.equal(todo.status, "open");
    assert.equal(todo.chatSessionId, null);
    assert.deepEqual(currentClientCalls, []);
    assert.deepEqual(constructorClientCalls, []);
  });

  it("PATCH /api/todos/:id updates status", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-2",
      title: "Robot Test-other-2026-06-11-3495402b",
      chatName: "Robot Test",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const createdRes = await fetch(`${baseUrl}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceSessionId: "session-2",
        title: "Investigate alert burst",
        description: "",
      }),
    });
    const created = await createdRes.json();

    const res = await fetch(`${baseUrl}/api/todos/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "blocked" }),
    });

    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.equal(updated.status, "blocked");
  });

  it("POST /api/todos/:id/comments persists a comment without creating a chat session", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-3",
      title: "Robot Test-other-2026-06-11-3495402b",
      chatName: "Robot Test",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const createdRes = await fetch(`${baseUrl}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceSessionId: "session-3",
        title: "Investigate alert burst",
        description: "",
      }),
    });
    const created = await createdRes.json();

    const res = await fetch(`${baseUrl}/api/todos/${created.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Need to compare queue growth." }),
    });

    assert.equal(res.status, 201);
    const comment = await res.json();
    assert.equal(comment.content, "Need to compare queue growth.");
    assert.deepEqual(currentClientCalls, []);
  });

  it("DELETE /api/todos/:id removes a todo", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-4",
      title: "Robot Test-other-2026-06-11-3495402b",
      chatName: "Robot Test",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const createdRes = await fetch(`${baseUrl}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceSessionId: "session-4",
        title: "Investigate alert burst",
        description: "",
      }),
    });
    const created = await createdRes.json();

    const deleteRes = await fetch(`${baseUrl}/api/todos/${created.id}`, {
      method: "DELETE",
    });

    assert.equal(deleteRes.status, 200);
    assert.equal((await deleteRes.json()).id, created.id);

    const listRes = await fetch(`${baseUrl}/api/todos`);
    assert.deepEqual(await listRes.json(), []);
  });
```

- [ ] **Step 2: Run the dashboard API tests to verify they fail**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL with `404` for `/api/todos` and `/api/todos/:id/comments`

- [ ] **Step 3: Replace the old todo routes and handlers in `lib/dashboard-server.js`**

Make these import and constructor changes near the top of `lib/dashboard-server.js`:

```js
import { TodoStore } from "./todo-store.js";
```

```js
    this._todoStore = new TodoStore(todoStorePath ?? resolve(__dirname, "../data/todos.json"));
```

Replace the old todo route dispatch block in `_handleRequest`:

```js
    if (path === "/api/todos" && req.method === "GET") {
      return this._handleGetTodos(res);
    }
    if (path === "/api/todos" && req.method === "POST") {
      return this._handlePostTodo(req, res);
    }

    const todoMatch = path.match(/^\/api\/todos\/([^/]+)$/);
    if (todoMatch && req.method === "PATCH") {
      return this._handlePatchTodo(todoMatch[1], req, res);
    }
    if (todoMatch && req.method === "DELETE") {
      return this._handleDeleteTodo(todoMatch[1], res);
    }

    const todoCommentsMatch = path.match(/^\/api\/todos\/([^/]+)\/comments$/);
    if (todoCommentsMatch && req.method === "POST") {
      return this._handlePostTodoComment(todoCommentsMatch[1], req, res);
    }

    const todoChatSessionMatch = path.match(/^\/api\/todos\/([^/]+)\/chat-session$/);
    if (todoChatSessionMatch && req.method === "POST") {
      return this._handlePostTodoChatSession(todoChatSessionMatch[1], res);
    }
```

Add these handlers below `_handleGetSessionMessages` and delete `_handleGetSessionTodos`, `_handlePostSessionTodo`, `_handleCompleteTodo`, `_isTodoChildSession`, and `_createTodoSession`:

```js
  _findSession(sessionId) {
    return this._sessions.find((session) => session.sessionId === sessionId) || null;
  }

  _handleGetTodos(res) {
    try {
      this._jsonResponse(res, this._todoStore.list());
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePostTodo(req, res) {
    let body;
    try {
      body = await this._readBody(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "body must be a JSON object" }));
      return;
    }

    const { sourceSessionId, title, description = "" } = body;
    if (typeof sourceSessionId !== "string" || sourceSessionId.trim() === "") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "sourceSessionId required" }));
      return;
    }
    if (typeof title !== "string" || title.trim() === "") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "title required" }));
      return;
    }
    if (typeof description !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "description must be a string" }));
      return;
    }

    const sourceSession = this._findSession(sourceSessionId);
    if (!sourceSession) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "session not found" }));
      return;
    }

    try {
      const todo = this._todoStore.create({
        sourceSessionId,
        sourceSessionTitle: sourceSession.title || sourceSession.sessionId,
        title: title.trim(),
        description,
      });

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(todo));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePatchTodo(todoId, req, res) {
    let body;
    try {
      body = await this._readBody(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "body must be a JSON object" }));
      return;
    }

    const patch = {};
    if (Object.hasOwn(body, "title")) {
      if (typeof body.title !== "string" || body.title.trim() === "") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "title must be a non-empty string" }));
        return;
      }
      patch.title = body.title.trim();
    }
    if (Object.hasOwn(body, "description")) {
      if (typeof body.description !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "description must be a string" }));
        return;
      }
      patch.description = body.description;
    }
    if (Object.hasOwn(body, "status")) {
      if (!["open", "in_progress", "blocked", "completed"].includes(body.status)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid todo status" }));
        return;
      }
      patch.status = body.status;
    }

    try {
      const updated = this._todoStore.update(todoId, patch);
      if (!updated) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "todo not found" }));
        return;
      }
      this._jsonResponse(res, updated);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePostTodoComment(todoId, req, res) {
    let body;
    try {
      body = await this._readBody(req);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    if (typeof body?.content !== "string" || body.content.trim() === "") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "content required" }));
      return;
    }

    try {
      const comment = this._todoStore.addComment(todoId, body.content.trim());
      if (!comment) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "todo not found" }));
        return;
      }

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(comment));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  _handleDeleteTodo(todoId, res) {
    try {
      const removed = this._todoStore.delete(todoId);
      if (!removed) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "todo not found" }));
        return;
      }
      this._jsonResponse(res, removed);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }
```

- [ ] **Step 4: Run the dashboard API tests to verify they pass**

Run: `node --test test/dashboard-server.test.js`
Expected: PASS for the new todo CRUD tests and FAIL only for the draft-summary and lazy chat-session tests that are not implemented yet

- [ ] **Step 5: Commit the API replacement**

Run:

```bash
git add lib/dashboard-server.js test/dashboard-server.test.js
git commit -m "feat: replace session todo api with global todo api"
```

### Task 3: Add Draft Summary And Lazy Todo Chat Session Support

**Files:**
- Modify: `lib/dashboard-server.js`
- Modify: `test/dashboard-server.test.js`

- [ ] **Step 1: Write failing tests for draft summary, lazy chat session creation, and comment mirroring**

Add these tests to `test/dashboard-server.test.js` after the todo CRUD tests:

```js
  it("POST /api/sessions/:id/todo-draft returns suggested title and description", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-draft",
      title: "Robot Test-other-2026-06-11-3495402b",
      chatName: "Robot Test",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    server.setOpenCodeClient({
      async findOrCreateSession(options) {
        currentClientCalls.push(options);
        return { sessionId: "draft-session-1", sessionState: "new" };
      },
      async sendMessage(sessionId, prompt) {
        assert.equal(sessionId, "draft-session-1");
        assert.match(prompt, /suggestedTitle/i);
        return JSON.stringify({
          suggestedTitle: "Investigate alert burst",
          suggestedDescription: "Check the upstream spike pattern and summarize likely causes.",
        });
      },
    });

    const res = await fetch(`${baseUrl}/api/sessions/session-draft/todo-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      suggestedTitle: "Investigate alert burst",
      suggestedDescription: "Check the upstream spike pattern and summarize likely causes.",
      draftSessionId: "draft-session-1",
    });
  });

  it("POST /api/todos/:id/chat-session lazily creates and persists a chat session", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-chat",
      title: "Robot Test-other-2026-06-11-3495402b",
      chatName: "Robot Test",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const createdTodoRes = await fetch(`${baseUrl}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceSessionId: "session-chat",
        title: "Investigate alert burst",
        description: "",
      }),
    });
    const todo = await createdTodoRes.json();

    server.setOpenCodeClient({
      async findOrCreateSession(options) {
        currentClientCalls.push(options);
        return { sessionId: "todo-chat-1", sessionState: "new" };
      },
    });

    const res = await fetch(`${baseUrl}/api/todos/${todo.id}/chat-session`, {
      method: "POST",
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      todoId: todo.id,
      chatSessionId: "todo-chat-1",
      created: true,
    });
    assert.deepEqual(currentClientCalls, [{
      title: `Investigate alert burst ${todo.id}`,
      cacheKey: `todo-chat:${todo.id}`,
      reuse: false,
    }]);
  });

  it("POST /api/todos/:id/chat-session reuses an existing chat session id", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-chat-existing",
      title: "Robot Test-other-2026-06-11-3495402b",
      chatName: "Robot Test",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const createdTodoRes = await fetch(`${baseUrl}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceSessionId: "session-chat-existing",
        title: "Investigate alert burst",
        description: "",
      }),
    });
    const todo = await createdTodoRes.json();

    await fetch(`${baseUrl}/api/todos/${todo.id}/chat-session`, { method: "POST" });
    currentClientCalls.length = 0;

    const res = await fetch(`${baseUrl}/api/todos/${todo.id}/chat-session`, {
      method: "POST",
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      todoId: todo.id,
      chatSessionId: "todo-chat-1",
      created: false,
    });
    assert.deepEqual(currentClientCalls, []);
  });

  it("POST /api/todos/:id/comments mirrors the comment into the todo chat session when linked", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-comment",
      title: "Robot Test-other-2026-06-11-3495402b",
      chatName: "Robot Test",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const createdTodoRes = await fetch(`${baseUrl}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceSessionId: "session-comment",
        title: "Investigate alert burst",
        description: "",
      }),
    });
    const todo = await createdTodoRes.json();

    const submitCalls = [];
    server.setOpenCodeClient({
      async findOrCreateSession() {
        return { sessionId: "todo-chat-comment", sessionState: "new" };
      },
      async submitMessage(sessionId, prompt) {
        submitCalls.push({ sessionId, prompt });
        return { sessionId, submittedAt: Date.now(), userMessageId: "msg-1" };
      },
    });

    await fetch(`${baseUrl}/api/todos/${todo.id}/chat-session`, { method: "POST" });

    const res = await fetch(`${baseUrl}/api/todos/${todo.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Need to compare queue growth." }),
    });

    assert.equal(res.status, 201);
    assert.equal(submitCalls.length, 1);
    assert.equal(submitCalls[0].sessionId, "todo-chat-comment");
    assert.match(submitCalls[0].prompt, /Need to compare queue growth\./);
  });
```

- [ ] **Step 2: Run the dashboard tests to verify they fail for the new behaviors**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL with `404` for `/api/sessions/:id/todo-draft` and `/api/todos/:id/chat-session`

- [ ] **Step 3: Implement the draft summary flow, lazy chat-session creation, and comment/status mirroring**

Add these route matches inside `_handleRequest` before the generic `/api/todos/:id` route handling:

```js
    const sessionTodoDraftMatch = path.match(/^\/api\/sessions\/([^/]+)\/todo-draft$/);
    if (sessionTodoDraftMatch && req.method === "POST") {
      return this._handlePostSessionTodoDraft(sessionTodoDraftMatch[1], req, res);
    }
```

Add these helper methods below `_findSession`:

```js
  async _sendTodoSessionNote(sessionId, prompt) {
    const opencodeClient = this._openCodeClient || this._opencode;
    if (!opencodeClient?.submitMessage) {
      return;
    }
    await opencodeClient.submitMessage(sessionId, prompt);
  }

  async _findOrCreateTodoChatSession(todo) {
    if (todo.chatSessionId) {
      return { chatSessionId: todo.chatSessionId, created: false };
    }

    const opencodeClient = this._openCodeClient || this._opencode;
    if (!opencodeClient?.findOrCreateSession) {
      throw new Error("opencode client not available");
    }

    const result = await opencodeClient.findOrCreateSession({
      title: `${todo.title} ${todo.id}`,
      cacheKey: `todo-chat:${todo.id}`,
      reuse: false,
    });

    this._todoStore.setChatSessionId(todo.id, result.sessionId);
    return { chatSessionId: result.sessionId, created: true };
  }
```

Add these handlers:

```js
  async _handlePostSessionTodoDraft(sessionId, req, res) {
    const sourceSession = this._findSession(sessionId);
    if (!sourceSession) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "session not found" }));
      return;
    }

    const opencodeClient = this._openCodeClient || this._opencode;
    if (!opencodeClient?.findOrCreateSession || !opencodeClient?.sendMessage) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "opencode client not available" }));
      return;
    }

    try {
      await this._readBody(req).catch(() => ({}));
      const draftSession = await opencodeClient.findOrCreateSession({
        title: `Todo Draft ${sourceSession.title || sourceSession.sessionId}`,
        cacheKey: `todo-draft:${sessionId}:${Date.now()}`,
        reuse: false,
      });

      const prompt = [
        "Read the source session and suggest a todo.",
        "Return strict JSON with keys suggestedTitle and suggestedDescription.",
        `Source session title: ${sourceSession.title || sourceSession.sessionId}`,
      ].join("\n");

      const reply = await opencodeClient.sendMessage(draftSession.sessionId, prompt);
      const parsed = JSON.parse(reply);

      this._jsonResponse(res, {
        suggestedTitle: parsed.suggestedTitle || "",
        suggestedDescription: parsed.suggestedDescription || "",
        draftSessionId: draftSession.sessionId,
      });
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePostTodoChatSession(todoId, res) {
    try {
      const todo = this._todoStore.get(todoId);
      if (!todo) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "todo not found" }));
        return;
      }

      const result = await this._findOrCreateTodoChatSession(todo);
      this._jsonResponse(res, {
        todoId,
        chatSessionId: result.chatSessionId,
        created: result.created,
      });
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }
```

Update `_handlePatchTodo` so status changes mirror into a linked chat session without forcing creation:

```js
      const before = this._todoStore.get(todoId);
      const updated = this._todoStore.update(todoId, patch);
      if (!updated) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "todo not found" }));
        return;
      }
      if (before?.chatSessionId && patch.status && patch.status !== before.status) {
        await this._sendTodoSessionNote(before.chatSessionId, `Todo status changed to ${patch.status}.`);
      }
```

Update `_handlePostTodoComment` so comments mirror into a linked chat session without forcing creation:

```js
      const todo = this._todoStore.get(todoId);
      const comment = this._todoStore.addComment(todoId, body.content.trim());
      if (!comment) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "todo not found" }));
        return;
      }
      if (todo?.chatSessionId) {
        await this._sendTodoSessionNote(todo.chatSessionId, `Todo comment: ${comment.content}`);
      }
```

- [ ] **Step 4: Run the dashboard tests to verify they pass**

Run: `node --test test/dashboard-server.test.js`
Expected: PASS

- [ ] **Step 5: Commit the draft-summary and lazy-session support**

Run:

```bash
git add lib/dashboard-server.js test/dashboard-server.test.js
git commit -m "feat: add todo draft and lazy chat session support"
```

### Task 4: Rebuild The Dashboard UI Around Session-Row Actions And A Global Todo List

**Files:**
- Modify: `dashboard/index.html`
- Modify: `test/dashboard-server.test.js`

- [ ] **Step 1: Write failing HTML tests for the new sessions actions column and global todos card**

Add these tests to `test/dashboard-server.test.js` near the existing HTML assertions:

```js
  it("GET / renders an Actions column and add-todo button hooks in the sessions table", async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();

    assert.ok(html.includes("<th>Actions</th>"));
    assert.ok(html.includes("openAddTodoDialog"));
    assert.ok(html.includes("globalTodosContent"));
  });

  it("GET / no longer renders the old session-detail todo form", async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();

    assert.equal(html.includes("sessionTodoTitle"), false);
    assert.equal(html.includes("sessionTodoDescription"), false);
    assert.equal(html.includes("sessionTodosList"), false);
  });
```

- [ ] **Step 2: Run the dashboard tests to verify the HTML assertions fail**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL because the existing HTML still contains the old session-detail todo UI and has no actions column

- [ ] **Step 3: Replace the old session-detail todo UI with the new dialog and global todos UI**

Update the CSS block in `dashboard/index.html` by replacing the old `.todo-section` rules with these new rules:

```css
.session-actions{display:flex;justify-content:flex-end}
.table-action-btn{padding:6px 12px;font-size:12px}
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:24px;z-index:50}
.modal-backdrop.active{display:flex}
.modal-card{width:min(640px,100%);background:var(--bg-surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:20px}
.modal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.modal-header h4{font-size:15px;color:var(--accent)}
.modal-body{display:flex;flex-direction:column;gap:12px}
.todo-dialog-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.todo-dialog-status{font-size:12px;color:var(--text-muted)}
.global-todo-list{display:flex;flex-direction:column;gap:12px}
.global-todo-item{background:var(--bg-input);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.global-todo-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.global-todo-title{font-size:14px;font-weight:600;color:var(--text-primary)}
.global-todo-subtitle{margin-top:4px;font-size:12px;color:var(--text-secondary)}
.global-todo-meta{margin-top:8px;display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--text-secondary)}
.global-todo-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.global-todo-comments{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.todo-comment{background:var(--bg-surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.5}
.todo-comment-form{display:flex;gap:8px;flex-wrap:wrap}
.todo-comment-form input{flex:1;min-width:220px}
```

Replace the sessions panel markup block with this content:

```html
  <div class="panel active" id="panel-sessions">
    <div class="card">
      <h3>Real-time Sessions</h3>
      <div id="sessionsContent">
        <p class="empty">No sessions yet. Waiting for triggers...</p>
      </div>
    </div>

    <div class="card">
      <h3>Todos</h3>
      <div id="globalTodosContent" class="global-todo-list">
        <p class="empty">No todos yet.</p>
      </div>
    </div>

    <div class="session-detail" id="sessionDetail">
      <div class="session-detail-header">
        <h4 id="sessionDetailTitle">Session Messages</h4>
        <button class="session-detail-close" onclick="closeSessionDetail()">&times;</button>
      </div>
      <div id="sessionMessages" class="msg-list"></div>
    </div>

    <div class="modal-backdrop" id="addTodoModal">
      <div class="modal-card">
        <div class="modal-header">
          <h4>Add Todo</h4>
          <button class="session-detail-close" onclick="closeAddTodoDialog()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="field-group">
            <label>Source Session</label>
            <div id="addTodoSourceSession" class="note">-</div>
          </div>
          <div class="field-group">
            <label for="addTodoTitle">Todo Title</label>
            <input type="text" id="addTodoTitle" placeholder="Investigate alert burst">
          </div>
          <div class="field-group">
            <label for="addTodoDescription">Todo Description</label>
            <textarea id="addTodoDescription" placeholder="Describe the follow-up work"></textarea>
          </div>
          <div class="todo-dialog-actions">
            <button class="secondary" id="addTodoSummaryBtn" onclick="generateTodoDraft()">One-click Summary</button>
            <button id="addTodoCreateBtn" onclick="createGlobalTodo()">Create Todo</button>
            <button class="secondary" onclick="closeAddTodoDialog()">Cancel</button>
            <span class="todo-dialog-status" id="addTodoStatus"></span>
          </div>
        </div>
      </div>
    </div>
  </div>
```

Replace `renderSessions`, `addSessionRow`, and the old session-detail todo functions with this code:

```js
let addTodoSourceSession=null;
let globalTodos=[];

function renderSessions(sessions){
  const el=document.getElementById("sessionsContent");
  currentSessionsById={};
  for(const s of sessions){
    currentSessionsById[s.sessionId]=s;
  }
  if(!sessions.length){
    el.innerHTML='<p class="empty">No sessions yet. Waiting for triggers...</p>';
    return;
  }
  let html='<table><thead><tr><th>Session</th><th>Chat</th><th>Intent</th><th>Created</th><th>Actions</th></tr></thead><tbody>';
  for(const s of sessions){
    html+=`<tr class="session-row"><td onclick="openSessionDetail('${escJsStr(s.sessionId)}','${escJsStr(s.title||s.sessionId)}')">${esc(s.title||s.sessionId)}</td><td onclick="openSessionDetail('${escJsStr(s.sessionId)}','${escJsStr(s.title||s.sessionId)}')">${esc(s.chatName||"-")}</td><td onclick="openSessionDetail('${escJsStr(s.sessionId)}','${escJsStr(s.title||s.sessionId)}')">${esc(s.intent||"-")}</td><td onclick="openSessionDetail('${escJsStr(s.sessionId)}','${escJsStr(s.title||s.sessionId)}')">${esc(s.createdAt||"-")}</td><td class="session-actions"><button class="secondary table-action-btn" onclick="event.stopPropagation();openAddTodoDialog('${escJsStr(s.sessionId)}')">Add Todo</button></td></tr>`;
  }
  html+='</tbody></table>';
  el.innerHTML=html;
}

function addSessionRow(s){
  currentSessionsById[s.sessionId]=s;
  renderSessions(Object.values(currentSessionsById));
}

function openAddTodoDialog(sessionId){
  addTodoSourceSession=currentSessionsById[sessionId]||null;
  if(!addTodoSourceSession)return;
  document.getElementById("addTodoModal").classList.add("active");
  document.getElementById("addTodoSourceSession").textContent=addTodoSourceSession.title||addTodoSourceSession.sessionId;
  document.getElementById("addTodoTitle").value="";
  document.getElementById("addTodoDescription").value="";
  document.getElementById("addTodoStatus").textContent="";
  document.getElementById("addTodoSummaryBtn").disabled=false;
  document.getElementById("addTodoCreateBtn").disabled=false;
}

function closeAddTodoDialog(){
  addTodoSourceSession=null;
  document.getElementById("addTodoModal").classList.remove("active");
}

async function loadTodos(){
  try{
    globalTodos=await api("/api/todos");
    renderGlobalTodos(globalTodos);
  }catch(e){
    document.getElementById("globalTodosContent").innerHTML=`<div class="msg-loading">Error: ${esc(e.message)}</div>`;
  }
}

function renderGlobalTodos(todos){
  const el=document.getElementById("globalTodosContent");
  if(!todos.length){
    el.innerHTML='<p class="empty">No todos yet.</p>';
    return;
  }
  let html="";
  for(const todo of todos){
    const comments=(todo.comments||[]).map(comment=>`<div class="todo-comment">${esc(comment.content)}<div class="note">${esc(comment.createdAt)}</div></div>`).join("")||'<div class="note">No comments yet.</div>';
    html+=`<div class="global-todo-item"><div class="global-todo-header"><div><div class="global-todo-title">${esc(todo.title)}</div><div class="global-todo-subtitle">Source: ${esc(todo.sourceSessionTitle||todo.sourceSessionId||"-")}</div><div class="todo-desc">${esc(todo.description||"")}</div><div class="global-todo-meta"><span>ID: ${esc(todo.id)}</span><span>Updated: ${esc(todo.updatedAt||todo.createdAt||"-")}</span></div></div><div class="global-todo-controls"><select onchange="updateTodoStatus('${escJsStr(todo.id)}', this.value)"><option value="open" ${todo.status==="open"?"selected":""}>open</option><option value="in_progress" ${todo.status==="in_progress"?"selected":""}>in_progress</option><option value="blocked" ${todo.status==="blocked"?"selected":""}>blocked</option><option value="completed" ${todo.status==="completed"?"selected":""}>completed</option></select><button class="secondary" onclick="openTodoChat('${escJsStr(todo.id)}')">Chat</button><button class="danger" onclick="deleteTodo('${escJsStr(todo.id)}')">Delete</button></div></div><div class="global-todo-comments">${comments}<div class="todo-comment-form"><input type="text" id="commentInput_${escAttr(todo.id)}" placeholder="Add comment"><button class="secondary" onclick="addTodoComment('${escJsStr(todo.id)}')">Add Comment</button></div></div></div>`;
  }
  el.innerHTML=html;
}

async function generateTodoDraft(){
  if(!addTodoSourceSession)return;
  const statusEl=document.getElementById("addTodoStatus");
  const summaryBtn=document.getElementById("addTodoSummaryBtn");
  summaryBtn.disabled=true;
  statusEl.textContent="Generating summary...";
  statusEl.style.color="var(--text-muted)";
  try{
    const draft=await api(`/api/sessions/${encodeURIComponent(addTodoSourceSession.sessionId)}/todo-draft`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});
    document.getElementById("addTodoTitle").value=draft.suggestedTitle||"";
    document.getElementById("addTodoDescription").value=draft.suggestedDescription||"";
    statusEl.textContent="Summary ready. Review and create the todo.";
    statusEl.style.color="var(--success)";
  }catch(e){
    statusEl.textContent=`Error: ${e.message}`;
    statusEl.style.color="var(--danger)";
  }finally{
    summaryBtn.disabled=false;
  }
}

async function createGlobalTodo(){
  if(!addTodoSourceSession)return;
  const title=document.getElementById("addTodoTitle").value.trim();
  const description=document.getElementById("addTodoDescription").value.trim();
  const statusEl=document.getElementById("addTodoStatus");
  const createBtn=document.getElementById("addTodoCreateBtn");
  if(!title){
    statusEl.textContent="Title required.";
    statusEl.style.color="var(--danger)";
    return;
  }
  createBtn.disabled=true;
  statusEl.textContent="Creating todo...";
  statusEl.style.color="var(--text-muted)";
  try{
    await api("/api/todos",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourceSessionId:addTodoSourceSession.sessionId,title,description})});
    await loadTodos();
    closeAddTodoDialog();
  }catch(e){
    statusEl.textContent=`Error: ${e.message}`;
    statusEl.style.color="var(--danger)";
  }finally{
    createBtn.disabled=false;
  }
}

async function updateTodoStatus(todoId,status){
  await api(`/api/todos/${encodeURIComponent(todoId)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});
  await loadTodos();
}

async function addTodoComment(todoId){
  const input=document.getElementById(`commentInput_${todoId}`);
  const content=input.value.trim();
  if(!content)return;
  await api(`/api/todos/${encodeURIComponent(todoId)}/comments`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content})});
  await loadTodos();
}

async function deleteTodo(todoId){
  if(!confirm("Delete this todo?"))return;
  await api(`/api/todos/${encodeURIComponent(todoId)}`,{method:"DELETE"});
  await loadTodos();
}

async function openTodoChat(todoId){
  const data=await api(`/api/todos/${encodeURIComponent(todoId)}/chat-session`,{method:"POST"});
  await loadTodos();
  openSessionDetail(data.chatSessionId, `Todo: ${todoId}`);
}
```

In `init()`, load todos right after sessions:

```js
  try{
    const sessions=await api("/api/sessions");
    renderSessions(sessions);
  }catch(e){console.error("sessions",e)}

  try{
    await loadTodos();
  }catch(e){console.error("todos",e)}
```

In the SSE handler, keep `addSessionRow(s)` and do not auto-refresh todos.

- [ ] **Step 4: Run the dashboard tests to verify they pass**

Run: `node --test test/dashboard-server.test.js`
Expected: PASS

- [ ] **Step 5: Run the full test suite and commit the UI migration**

Run: `node --test`
Expected: PASS

Then run:

```bash
git add dashboard/index.html test/dashboard-server.test.js lib/dashboard-server.js lib/todo-store.js test/todo-store.test.js
git commit -m "feat: add global session todo dashboard workflow"
```

## Self-Review

### Spec Coverage

- Session-row `Add Todo` action: covered in Task 4.
- Global todos section below real-time sessions: covered in Task 4.
- One-click summary returning title and description: covered in Task 3.
- Permanent todo creation without immediate chat-session creation: covered in Task 2.
- Lazy creation and reuse of todo chat session: covered in Task 3.
- Status dropdown with `open`, `in_progress`, `blocked`, `completed`: covered in Tasks 1, 2, and 4.
- Comments with optional session mirroring: covered in Tasks 1, 3, and 4.
- Todo deletion without deleting linked session: covered in Tasks 1, 2, and 4.
- Removal of old session-detail todo UI: covered in Task 4.

### Placeholder Scan

- No `TODO`, `TBD`, or deferred implementation markers remain.
- Each task includes explicit file paths, test code, commands, and expected outcomes.

### Type Consistency

- Store API uses `TodoStore`, `list`, `get`, `create`, `update`, `addComment`, `setChatSessionId`, and `delete` consistently across all tasks.
- API property names use `sourceSessionId`, `sourceSessionTitle`, `chatSessionId`, `suggestedTitle`, and `suggestedDescription` consistently across tests, server code, and UI.
