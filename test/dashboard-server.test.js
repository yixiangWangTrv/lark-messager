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
    updateConnectionArgs: [],
    updateConnection(args) {
      this.updateConnectionArgs.push(args);
    },
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
        operational_safety: { instruction: "no deploys" },
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
    currentOpenCodeClient.updateConnectionArgs = [];
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
    assert.match(html, /<textarea id="promptOperationalSafety"><\/textarea>/);
    assert.match(html, /operational_safety\.instruction/);
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

  it("GET / serves OpenCode project directory settings", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);

    const html = await res.text();
    assert.match(html, /<h3>OpenCode Project<\/h3>/);
    assert.match(html, /<input type="text" id="opencodeProjectDir"/);
    assert.match(html, /<button onclick="saveOpencodeProjectDir\(\)">Save Project Directory<\/button>/);
    assert.match(html, /document\.getElementById\("opencodeProjectDir"\)\.value=cfg\.opencode\.project_directory/);
    assert.match(html, /async function saveOpencodeProjectDir\(\)/);
    assert.match(html, /JSON\.stringify\(\{opencode:\{project_directory:projectDir\}\}\)/);
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
    assert.equal(data.operational_safety.instruction, "no deploys");
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
        operational_safety: {
          instruction: "no deploys updated",
        },
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.common_task.system_prefix, "common updated");
    assert.equal(data.operational_safety.instruction, "no deploys updated");
    assert.equal(data.common_task.response_format, "English");
    assert.equal(data.common_task.task_instructions, "common task");

    const persisted = JSON.parse(readFileSync(server._configPath, "utf-8"));
    assert.equal(persisted.prompt.common_task.system_prefix, "common updated");
    assert.equal(persisted.prompt.operational_safety.instruction, "no deploys updated");
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

  it("PUT /api/config persists project directory and updates the active opencode client", async () => {
    const projectDir = join(tempDir, "alternate-project");
    const res = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opencode: {
          project_directory: projectDir,
        },
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.opencode.project_directory, projectDir);
    assert.deepEqual(currentOpenCodeClient.updateConnectionArgs, [
      { projectDirectory: projectDir },
    ]);

    const persisted = JSON.parse(readFileSync(server._configPath, "utf-8"));
    assert.equal(persisted.opencode.project_directory, projectDir);
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
      // bot rows have port: null; opencode rows have a numeric port
      assert.ok(s.port === null || typeof s.port === "number");
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
      intent: "common_task",
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
      intent: "common_task",
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
      intent: "common_task",
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

    server.setOpenCodeClient({
      async findOrCreateSession(options) {
        currentClientCalls.push(options);
        return { sessionId: "todo-chat-1", sessionState: "new" };
      },
    });

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

  it("stores todos under data/todos.json by default when todoStorePath is not injected", async () => {
    const isolatedEvents = new EventEmitter();
    const configPath = join(tempDir, "default-store-config.json");
    const defaultTodoStorePath = join(process.cwd(), "data", "todos.json");
    const isolatedServer = new DashboardServer({
      config: { ...config, dashboard: { ...config.dashboard, port: nextPort++ } },
      botEvents: isolatedEvents,
      configPath,
      opencode,
    });

    isolatedEvents.emit("session:created", {
      sessionId: "session-default-store",
      title: "Robot Test-other-2026-06-11-3495402b",
      chatName: "Robot Test",
      intent: "common_task",
      createdAt: new Date().toISOString(),
    });

    isolatedServer._todoStore.create({
      sourceSessionId: "session-default-store",
      sourceSessionTitle: "Robot Test-other-2026-06-11-3495402b",
      title: "Use default path",
      description: "",
    });

    assert.equal(existsSync(defaultTodoStorePath), true);

    isolatedServer.stop();
    rmSync(defaultTodoStorePath, { force: true });
  });

  it("uses an injected todoStorePath for a separately constructed server instance", async () => {
    const isolatedEvents = new EventEmitter();
    const configPath = join(tempDir, "injected-store-config.json");
    const injectedTodoStorePath = join(tempDir, "nested", "isolated-todos.json");
    const defaultTodoStorePath = join(process.cwd(), "data", "todos.json");
    const isolatedServer = new DashboardServer({
      config: { ...config, dashboard: { ...config.dashboard, port: nextPort++ } },
      botEvents: isolatedEvents,
      configPath,
      todoStorePath: injectedTodoStorePath,
      opencode,
    });

    isolatedEvents.emit("session:created", {
      sessionId: "session-injected-store",
      title: "Robot Test-other-2026-06-11-3495402b",
      chatName: "Robot Test",
      intent: "common_task",
      createdAt: new Date().toISOString(),
    });

    isolatedServer._todoStore.create({
      sourceSessionId: "session-injected-store",
      sourceSessionTitle: "Robot Test-other-2026-06-11-3495402b",
      title: "Use injected path",
      description: "",
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
