import { EventEmitter } from "node:events";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DashboardServer } from "../lib/dashboard-server.js";

describe("DashboardServer", () => {
  let server;
  let tempDir;
  let localFilePath;
  let botEvents;
  let baseUrl;
  let config;
  const constructorClientCalls = [];
  const currentClientCalls = [];
  let currentClientError = null;
  let nextPort = 18915;
  const opencode = {
    async findOrCreateSession(options) {
      constructorClientCalls.push(options);
      return {
        sessionId: "todo-session-constructor",
        sessionState: "new",
      };
    },
  };
  const currentOpenCodeClient = {
    async findOrCreateSession(options) {
      currentClientCalls.push(options);
      if (currentClientError) {
        throw currentClientError;
      }
      return {
        sessionId: "todo-session-current",
        sessionState: "new",
      };
    },
  };

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "dashboard-server-test-"));
  });

  beforeEach(async () => {
    botEvents = new EventEmitter();
    localFilePath = join(tempDir, `kb-local-file-${Date.now()}-${Math.random()}.txt`);
    writeFileSync(localFilePath, "initial local file body");
    config = {
      dashboard: { port: nextPort++, enabled: true },
      opencode: { base_url: "http://localhost:3000", project_directory: tempDir },
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
      knowledge_base: {
        enabled: true,
        items: [
          {
            id: "kb-existing",
            name: "Existing item",
            description: "seed item",
            source_type: "free_text",
            source: {},
            content: { mode: "inline_text", text: "seed body" },
            source_summary: undefined,
            enabled: false,
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "kb-local-file",
            name: "Local file item",
            description: "file-backed item",
            source_type: "local_file",
            source: { path: localFilePath },
            content: { mode: "inline_text", text: "stale file body" },
            source_summary: localFilePath,
            enabled: true,
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    };

    server = new DashboardServer({
      config,
      botEvents,
      configPath: join(tempDir, `config-${Date.now()}-${Math.random()}.json`),
      todoStorePath: join(tempDir, `todos-${Date.now()}-${Math.random()}.json`),
      opencode,
    });
    server.setOpenCodeClient(currentOpenCodeClient);
    await server.start();
    baseUrl = `http://localhost:${config.dashboard.port}`;
  });

  beforeEach(() => {
    constructorClientCalls.length = 0;
    currentClientCalls.length = 0;
    currentClientError = null;
    server.setOpenCodeClient(currentOpenCodeClient);
  });

  afterEach(() => {
    server.stop();
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("GET /api/status returns ok", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "running");
  });

  it("dashboard server listens on localhost only", () => {
    const address = server._httpServer.address();
    assert.equal(address.address, "127.0.0.1");
  });

  it("GET /api/prompts returns prompt config", async () => {
    const res = await fetch(`${baseUrl}/api/prompts`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.summary.system_prefix, "sum");
  });

  it("GET /api/knowledge-base returns knowledge base config", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.enabled, true);
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].id, "kb-existing");
  });

  it("PUT /api/knowledge-base/items/:id merges with the existing item before rebuilding", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/items/kb-existing`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Updated existing item",
        content: { text: "updated body" },
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.id, "kb-existing");
    assert.equal(data.name, "Updated existing item");
    assert.equal(data.description, "seed item");
    assert.equal(data.source_type, "free_text");
    assert.deepEqual(data.source, {});
    assert.equal(data.content.text, "updated body");
    assert.equal(data.enabled, false);

    const getRes = await fetch(`${baseUrl}/api/knowledge-base`);
    const knowledgeBase = await getRes.json();
    const updatedItem = knowledgeBase.items.find((item) => item.id === "kb-existing");
    assert.ok(updatedItem);
    assert.equal(updatedItem.description, "seed item");
    assert.equal(updatedItem.enabled, false);
  });

  it("PUT /api/knowledge-base/items/:id preserves local_file content on metadata-only updates", async () => {
    writeFileSync(localFilePath, "disk changed but update should not reread");

    const res = await fetch(`${baseUrl}/api/knowledge-base/items/kb-local-file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Renamed local file item",
        description: "metadata-only update",
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.id, "kb-local-file");
    assert.equal(data.name, "Renamed local file item");
    assert.equal(data.description, "metadata-only update");
    assert.equal(data.source_type, "local_file");
    assert.equal(data.source.path, localFilePath);
    assert.equal(data.content.mode, "inline_text");
    assert.equal(data.content.text, "stale file body");
    assert.equal(data.source_summary, localFilePath);

    const getRes = await fetch(`${baseUrl}/api/knowledge-base`);
    const knowledgeBase = await getRes.json();
    const updatedItem = knowledgeBase.items.find((item) => item.id === "kb-local-file");
    assert.ok(updatedItem);
    assert.equal(updatedItem.name, "Renamed local file item");
    assert.equal(updatedItem.description, "metadata-only update");
    assert.equal(updatedItem.content.text, "stale file body");
  });

  it("POST /api/knowledge-base/items/:id/refresh refreshes an existing local_file item", async () => {
    writeFileSync(localFilePath, "refreshed local file body");

    const res = await fetch(`${baseUrl}/api/knowledge-base/items/kb-local-file/refresh`, {
      method: "POST",
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.id, "kb-local-file");
    assert.equal(data.source_type, "local_file");
    assert.equal(data.source.path, localFilePath);
    assert.equal(data.content.mode, "inline_text");
    assert.equal(data.content.text, "refreshed local file body");
    assert.equal(data.source_summary, localFilePath);

    const getRes = await fetch(`${baseUrl}/api/knowledge-base`);
    const knowledgeBase = await getRes.json();
    const refreshedItem = knowledgeBase.items.find((item) => item.id === "kb-local-file");
    assert.ok(refreshedItem);
    assert.equal(refreshedItem.content.text, "refreshed local file body");
  });

  it("POST /api/knowledge-base/items creates a free_text item", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Runbook",
        description: "manual notes",
        source_type: "free_text",
        content: { text: "hello knowledge base" },
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, "Runbook");
    assert.equal(data.source_type, "free_text");
    assert.equal(data.content.text, "hello knowledge base");
    assert.equal(data.enabled, true);

    const getRes = await fetch(`${baseUrl}/api/knowledge-base`);
    const knowledgeBase = await getRes.json();
    assert.equal(knowledgeBase.items.length, 3);
    assert.ok(knowledgeBase.items.some((item) => item.id === data.id));
  });

  it("PUT /api/knowledge-base updates enabled flag", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.enabled, false);

    const getRes = await fetch(`${baseUrl}/api/knowledge-base`);
    const knowledgeBase = await getRes.json();
    assert.equal(knowledgeBase.enabled, false);
  });

  it("DELETE /api/knowledge-base/items/:id returns 404 for missing item", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/items/missing-item`, {
      method: "DELETE",
    });

    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, "knowledge base item not found");
  });

  it("POST /api/knowledge-base/items returns 500 when config persistence fails", async () => {
    const originalSaveConfig = server._saveConfig;
    server._saveConfig = () => {
      throw new Error("disk full");
    };

    try {
      const res = await fetch(`${baseUrl}/api/knowledge-base/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Should Fail",
          source_type: "free_text",
          content: { text: "cannot persist" },
        }),
      });

      assert.equal(res.status, 500);
      const data = await res.json();
      assert.equal(data.error, "disk full");
    } finally {
      server._saveConfig = originalSaveConfig;
    }
  });

  it("GET /api/sessions returns empty array initially", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data, []);
  });

  it("GET /api/servers returns array (may include detected external servers)", async () => {
    const res = await fetch(`${baseUrl}/api/servers`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
    for (const s of data) {
      assert.ok(typeof s.port === "number");
      assert.ok(typeof s.status === "string");
    }
  });

  it("GET / returns HTML", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const ct = res.headers.get("content-type");
    assert.ok(ct.includes("text/html"));
  });

  it("GET / contains tab structure", async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    assert.ok(html.includes("Sessions"));
    assert.ok(html.includes("Knowledge Base"));
    assert.ok(html.includes("Servers"));
    assert.ok(html.includes("Prompts"));
    assert.ok(html.includes("Settings"));
  });

  it("GET / orders Knowledge Base tab between Sessions and Distill and escapes source input values for attributes", async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();

    const sessionsIndex = html.indexOf('data-tab="sessions"');
    const knowledgeBaseIndex = html.indexOf('data-tab="knowledge-base"');
    const distillIndex = html.indexOf('data-tab="distill"');

    assert.notEqual(sessionsIndex, -1);
    assert.notEqual(knowledgeBaseIndex, -1);
    assert.notEqual(distillIndex, -1);
    assert.ok(sessionsIndex < knowledgeBaseIndex);
    assert.ok(knowledgeBaseIndex < distillIndex);

    assert.ok(html.includes("function escAttr(s)"));
    assert.ok(html.includes('value="${escAttr(values.path)}"'));
    assert.ok(html.includes('value="${escAttr(values.project_name)}"'));
    assert.ok(html.includes('value="${escAttr(values.url)}"'));
    assert.ok(!html.includes('value="${esc(values.path)}"'));
  });

  it("GET /api/sessions/:id/todos returns [] initially", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/session-1/todos`);

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });

  it("POST /api/sessions/:id/todos creates todo with dedicated OpenCode session", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-1",
      title: "Ops Room-other-2026-06-11",
      chatName: "Ops Room",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const res = await fetch(`${baseUrl}/api/sessions/session-1/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Investigate alert burst",
        description: "Look into the upstream spikes",
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.parentSessionId, "session-1");
    assert.equal(data.title, "Investigate alert burst");
    assert.equal(data.description, "Look into the upstream spikes");
    assert.equal(data.status, "open");
    assert.equal(data.todoSessionId, "todo-session-current");
    assert.match(data.id, /^todo_/);

    assert.deepEqual(currentClientCalls.pop(), {
      title: "TODO Ops Room-other-2026-06-11 - Investigate alert burst",
      cacheKey: "todo:session-1:Investigate alert burst",
      reuse: false,
    });
    assert.equal(constructorClientCalls.length, 0);
  });

  it("POST /api/sessions/:id/todos registers the created child session in the dashboard session list", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-parent",
      title: "Ops Room-other-2026-06-11",
      chatName: "Ops Room",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const firstRes = await fetch(`${baseUrl}/api/sessions/session-parent/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Parent task",
      }),
    });

    assert.equal(firstRes.status, 200);
    const firstTodo = await firstRes.json();
    assert.equal(firstTodo.todoSessionId, "todo-session-current");

    const sessionsRes = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(sessionsRes.status, 200);
    const sessions = await sessionsRes.json();
    assert.ok(sessions.some((session) => session.sessionId === "todo-session-current"));

    const nestedRes = await fetch(`${baseUrl}/api/sessions/${firstTodo.todoSessionId}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Nested task",
      }),
    });

    assert.equal(nestedRes.status, 400);
    assert.deepEqual(await nestedRes.json(), { error: "nested todos are not supported" });

    assert.deepEqual(currentClientCalls, [
      {
        title: "TODO Ops Room-other-2026-06-11 - Parent task",
        cacheKey: "todo:session-parent:Parent task",
        reuse: false,
      },
    ]);
  });

  it("POST /api/sessions/:id/todos does not persist todo when todo session creation fails", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-fail",
      title: "Ops Room-other-2026-06-11",
      chatName: "Ops Room",
      intent: "other",
      createdAt: new Date().toISOString(),
    });
    currentClientError = new Error("session creation failed");

    const createRes = await fetch(`${baseUrl}/api/sessions/session-fail/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "This should not persist",
      }),
    });

    assert.equal(createRes.status, 500);
    assert.deepEqual(await createRes.json(), { error: "session creation failed" });

    const listRes = await fetch(`${baseUrl}/api/sessions/session-fail/todos`);
    assert.equal(listRes.status, 200);
    assert.deepEqual(await listRes.json(), []);
  });

  it("POST /api/sessions/:id/todos returns 404 for unknown parent session", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/unknown-session/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Should fail",
      }),
    });

    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "session not found" });
    assert.equal(currentClientCalls.length, 0);
    assert.equal(constructorClientCalls.length, 0);
  });

  it("POST /api/sessions/:id/todos returns 400 for invalid JSON body", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-invalid-json",
      title: "Ops Room-other-2026-06-11",
      chatName: "Ops Room",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const res = await fetch(`${baseUrl}/api/sessions/session-invalid-json/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /JSON|Unexpected end of JSON input/);
    assert.equal(currentClientCalls.length, 0);
    assert.equal(constructorClientCalls.length, 0);
  });

  it("POST /api/sessions/:id/todos returns 400 for valid JSON bodies that are not plain objects", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-non-object-json",
      title: "Ops Room-other-2026-06-11",
      chatName: "Ops Room",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    for (const body of [null, "todo", 42, ["todo"]]) {
      const res = await fetch(`${baseUrl}/api/sessions/session-non-object-json/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "body must be a JSON object" });
    }

    assert.equal(currentClientCalls.length, 0);
    assert.equal(constructorClientCalls.length, 0);
  });

  it("POST /api/sessions/:id/todos returns 400 for invalid title field values in otherwise valid objects", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-invalid-title-field",
      title: "Ops Room-other-2026-06-11",
      chatName: "Ops Room",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    for (const title of [123, "   "]) {
      const res = await fetch(`${baseUrl}/api/sessions/session-invalid-title-field/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: "still valid",
        }),
      });

      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "title required" });
    }

    assert.equal(currentClientCalls.length, 0);
    assert.equal(constructorClientCalls.length, 0);
  });

  it("POST /api/sessions/:id/todos returns 400 for non-string description in otherwise valid objects", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-invalid-description-field",
      title: "Ops Room-other-2026-06-11",
      chatName: "Ops Room",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const res = await fetch(`${baseUrl}/api/sessions/session-invalid-description-field/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Valid title",
        description: 123,
      }),
    });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "description must be a string" });
    assert.equal(currentClientCalls.length, 0);
    assert.equal(constructorClientCalls.length, 0);
  });

  it("POST /api/todos/:todoId/complete marks todo completed", async () => {
    botEvents.emit("session:created", {
      sessionId: "session-2",
      title: "Ops Room-other-2026-06-11",
      chatName: "Ops Room",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    const createRes = await fetch(`${baseUrl}/api/sessions/session-2/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Close the loop" }),
    });
    const created = await createRes.json();

    const res = await fetch(`${baseUrl}/api/todos/${created.id}/complete`, {
      method: "POST",
    });

    assert.equal(res.status, 200);
    const completed = await res.json();
    assert.equal(completed.id, created.id);
    assert.equal(completed.status, "completed");
    assert.ok(completed.completedAt);
  });

  it("stores todos under data/session-todos.json by default when todoStorePath is not injected", async () => {
    const isolatedEvents = new EventEmitter();
    const configPath = join(tempDir, "default-store-config.json");
    const defaultTodoStorePath = join(process.cwd(), "data", "session-todos.json");
    const isolatedServer = new DashboardServer({
      config: { ...config, dashboard: { ...config.dashboard, port: nextPort++ } },
      botEvents: isolatedEvents,
      configPath,
      opencode,
    });

    isolatedEvents.emit("session:created", {
      sessionId: "session-default-store",
      title: "Ops Room-other-2026-06-11",
      chatName: "Ops Room",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    await isolatedServer._createTodoSession("session-default-store", "Use default path");
    isolatedServer._todoStore.create({
      parentSessionId: "session-default-store",
      title: "Use default path",
      description: "",
      todoSessionId: "todo-session-constructor",
    });

    assert.equal(existsSync(defaultTodoStorePath), true);

    isolatedServer.stop();
    rmSync(defaultTodoStorePath, { force: true });
  });

  it("uses an injected todoStorePath for a separately constructed server instance", async () => {
    const isolatedEvents = new EventEmitter();
    const configPath = join(tempDir, "injected-store-config.json");
    const injectedTodoStorePath = join(tempDir, "nested", "isolated-todos.json");
    const defaultTodoStorePath = join(process.cwd(), "data", "session-todos.json");
    const isolatedServer = new DashboardServer({
      config: { ...config, dashboard: { ...config.dashboard, port: nextPort++ } },
      botEvents: isolatedEvents,
      configPath,
      todoStorePath: injectedTodoStorePath,
      opencode,
    });

    isolatedEvents.emit("session:created", {
      sessionId: "session-injected-store",
      title: "Ops Room-other-2026-06-11",
      chatName: "Ops Room",
      intent: "other",
      createdAt: new Date().toISOString(),
    });

    await isolatedServer._createTodoSession("session-injected-store", "Use injected path");
    isolatedServer._todoStore.create({
      parentSessionId: "session-injected-store",
      title: "Use injected path",
      description: "",
      todoSessionId: "todo-session-constructor",
    });

    assert.equal(existsSync(injectedTodoStorePath), true);
    assert.equal(existsSync(defaultTodoStorePath), false);

    isolatedServer.stop();
    rmSync(injectedTodoStorePath, { force: true });
  });

  it("GET /api/sessions starts empty for each test", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`);

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });

  it("stop unregisters the session:created listener", () => {
    const isolatedEvents = new EventEmitter();
    const isolatedServer = new DashboardServer({
      config,
      botEvents: isolatedEvents,
      configPath: join(tempDir, "listener-config.json"),
      todoStorePath: join(tempDir, "listener-todos.json"),
      opencode,
    });

    assert.equal(isolatedEvents.listenerCount("session:created"), 1);

    isolatedServer.stop();

    assert.equal(isolatedEvents.listenerCount("session:created"), 0);
  });
});
