import { EventEmitter } from "node:events";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
        common_task: { system_prefix: "common", task_instructions: "common task", response_format: "Chinese" },
      },
      intent_routing: {
        summary: { keywords: ["summary"], channel: "ops" },
        incident_analysis: { keywords: ["incident", "error"] },
        pr_review: { keywords: ["pr"], use_github_pr_url: true },
      },
      lark: { trigger: {} },
      concurrency: {},
      reply: {},
      context: {},
      pua: {
        enabled: false,
        intents: {
          summary: false,
          incident_analysis: false,
          pr_review: false,
          common_task: false,
        },
      },
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

  it("GET / serves Common Task labels in Prompt Editor and PUA sections", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);

    const html = await res.text();
    assert.match(html, />Summary<\/div>/);
    assert.match(html, />Incident Analysis<\/div>/);
    assert.match(html, />PR Review<\/div>/);
    assert.match(html, /data-intent="common_task">Common Task<\/div>/);
    assert.match(html, /id="cardPuaCommonTask"/);
    assert.match(html, /togglePua\('puaCommonTask'\)/);
    assert.match(html, />Common Task<\/div>/);
    assert.match(html, /<strong>Common Task:<\/strong>\s*<code>fallback<\/code>/);
    assert.doesNotMatch(html, /data-intent="other">other<\/div>/);
    assert.doesNotMatch(html, /id="cardPuaOther"/);
    assert.doesNotMatch(html, /<strong>other:<\/strong>\s*<code>fallback<\/code>/);
    assert.doesNotMatch(html, />other<\/div>/);
  });

  it("GET / serves routing editor control ids and save hook wiring", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);

    const html = await res.text();
    assert.match(html, /<textarea id="summaryKeywords"/);
    assert.match(html, /<textarea id="incidentKeywords"/);
    assert.match(html, /<textarea id="prKeywords"/);
    assert.match(html, /<input type="checkbox" id="prUrlToggle"/);
    assert.match(html, /<button onclick="saveIntentRouting\(\)">Save Routing Keywords<\/button>/);
    assert.match(html, /document\.getElementById\("summaryKeywords"\)/);
    assert.match(html, /document\.getElementById\("incidentKeywords"\)/);
    assert.match(html, /document\.getElementById\("prKeywords"\)/);
    assert.match(html, /document\.getElementById\("prUrlToggle"\)/);
    assert.match(html, /async function init\(\)[\s\S]*const cfg=await api\("\/api\/config"\);[\s\S]*loadIntentRoutingFields\(\);/);
    assert.match(html, /<span class="note" id="routingSaveStatus"><\/span>/);
    assert.match(html, /const statusEl=document\.getElementById\("routingSaveStatus"\);/);
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
    assert.equal(data.common_task.system_prefix, "common");
    assert.equal("other" in data, false);
  });

  it("GET /api/config returns intent routing and common_task prompt config", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.prompt.common_task.task_instructions, "common task");
    assert.deepEqual(data.intent_routing.summary.keywords, ["summary"]);
    assert.equal(data.intent_routing.summary.channel, "ops");
    assert.equal(data.intent_routing.pr_review.use_github_pr_url, true);
  });

  it("PUT /api/pua-mode persists pua.intents.common_task", async () => {
    const res = await fetch(`${baseUrl}/api/pua-mode`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        intents: {
          common_task: true,
        },
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.enabled, true);
    assert.equal(data.intents.common_task, true);
    assert.equal(data.intents.summary, false);

    const persisted = JSON.parse(readFileSync(server._configPath, "utf-8"));
    assert.equal(persisted.pua.enabled, true);
    assert.equal(persisted.pua.intents.common_task, true);
    assert.equal(persisted.pua.intents.summary, false);
  });

  it("PUT /api/prompts persists common_task prompt updates", async () => {
    const res = await fetch(`${baseUrl}/api/prompts`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        common_task: {
          system_prefix: "common updated",
          response_format: "English",
        },
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.common_task.system_prefix, "common updated");
    assert.equal(data.common_task.response_format, "English");
    assert.equal(data.common_task.task_instructions, "common task");

    const persisted = JSON.parse(readFileSync(server._configPath, "utf-8"));
    assert.equal(persisted.prompt.common_task.system_prefix, "common updated");
    assert.equal(persisted.prompt.common_task.response_format, "English");
    assert.equal(persisted.prompt.common_task.task_instructions, "common task");
  });

  it("PUT /api/config deep-merges nested intent_routing config and persists it", async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent_routing: {
          summary: {
            keywords: ["summarize", "总结"],
          },
        },
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.intent_routing.summary.keywords, ["summarize", "总结"]);
    assert.equal(data.intent_routing.summary.channel, "ops");
    assert.equal(data.intent_routing.pr_review.use_github_pr_url, true);

    const persisted = JSON.parse(readFileSync(server._configPath, "utf-8"));
    assert.deepEqual(persisted.intent_routing.summary.keywords, ["summarize", "总结"]);
    assert.equal(persisted.intent_routing.summary.channel, "ops");
  });

  it("PUT /api/config persists edited intent_routing keywords across GET /api/config", async () => {
    const updatedRouting = {
      summary: {
        keywords: ["brief", "tl;dr"],
      },
      incident_analysis: {
        keywords: ["investigate", "root cause"],
      },
      pr_review: {
        keywords: ["review my pr", "check this diff"],
        use_github_pr_url: false,
      },
    };

    const putRes = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intent_routing: updatedRouting,
      }),
    });

    assert.equal(putRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/config`);
    assert.equal(getRes.status, 200);
    const data = await getRes.json();

    assert.deepEqual(data.intent_routing.summary.keywords, ["brief", "tl;dr"]);
    assert.deepEqual(data.intent_routing.incident_analysis.keywords, ["investigate", "root cause"]);
    assert.deepEqual(data.intent_routing.pr_review.keywords, ["review my pr", "check this diff"]);
    assert.equal(data.intent_routing.pr_review.use_github_pr_url, false);

    const persisted = JSON.parse(readFileSync(server._configPath, "utf-8"));
    assert.deepEqual(persisted.intent_routing.summary.keywords, ["brief", "tl;dr"]);
    assert.deepEqual(persisted.intent_routing.incident_analysis.keywords, ["investigate", "root cause"]);
    assert.deepEqual(persisted.intent_routing.pr_review.keywords, ["review my pr", "check this diff"]);
    assert.equal(persisted.intent_routing.pr_review.use_github_pr_url, false);
  });

  it("POST /api/distill/start uses prompt.common_task.response_format for distill language selection", async () => {
    const targetName = "distill-language-target";
    const distilledPath = join(process.cwd(), "distilled", `${targetName}.json`);
    const fakeBinDir = join(tempDir, `fake-bin-${Date.now()}-${Math.random()}`);
    const fakeCliPath = join(fakeBinDir, "lark-cli");
    const originalPath = process.env.PATH || "";
    const distillOpenCodeClient = {
      async findOrCreateSession() {
        return {
          sessionId: "distill-session",
          sessionState: "new",
        };
      },
      async sendMessage(_sessionId, prompt) {
        const selectedSummary = prompt.includes("Bahasa Indonesia")
          ? "Bahasa Indonesia selected"
          : "wrong language";
        return JSON.stringify({
          summary: selectedSummary,
          style_tags: ["tag1"],
          expression_patterns: {
            tone: "tone",
            sentence_length: "mixed",
            punctuation_habits: "normal",
            emoji_usage: "rare",
            catchphrases: ["halo"],
          },
          personality_traits: ["careful"],
          communication_style: {
            response_speed: "fast",
            initiative: "proactive",
            conflict_mode: "calm",
          },
          system_prompt: selectedSummary,
        });
      },
    };

    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(fakeCliPath, `#!/usr/bin/env node
const targetName = ${JSON.stringify(targetName)};
const messages = ["halo satu", "halo dua", "halo tiga", "halo empat", "halo lima"].map((text, index) => ({
  sender: { name: targetName },
  msg_type: "text",
  body: { content: JSON.stringify({ text }) },
  create_time: String(1710000000000 + index * 1000),
}));
process.stdout.write(JSON.stringify({ ok: true, data: { messages } }));
`);
    chmodSync(fakeCliPath, 0o755);

    config.prompt.common_task.response_format = "Indonesia";
    config.dashboard.language = "zh";
    process.env.PATH = `${fakeBinDir}:${originalPath}`;
    server.setOpenCodeClient(distillOpenCodeClient);

    try {
      const res = await fetch(`${baseUrl}/api/distill/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: targetName,
          source: "group",
          chatId: "chat-1",
          relation: "peer",
          limit: 5,
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.persona.summary, "Bahasa Indonesia selected");
    } finally {
      server.setOpenCodeClient(currentOpenCodeClient);
      process.env.PATH = originalPath;
      rmSync(fakeBinDir, { recursive: true, force: true });
      rmSync(distilledPath, { force: true });
    }
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

  it("GET / includes trigger mode permission hint labels and containers", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);

    const html = await res.text();
    assert.match(html, /requiredPermissions:"Required"/);
    assert.match(html, /optionalPermissions:"Optional"/);
    assert.match(html, /id="mentionBotPermissions"/);
    assert.match(html, /id="mentionOwnerPermissions"/);
    assert.match(html, /id="allMessagesPermissions"/);
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
