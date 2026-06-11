import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { DashboardServer } from "../lib/dashboard-server.js";
import { botEvents } from "../lib/bot-events.js";

describe("DashboardServer", () => {
  let server;
  const TEST_PORT = 18915;
  const baseUrl = `http://localhost:${TEST_PORT}`;
  const localFilePath = "/tmp/dashboard-server-kb-local-file.txt";
  const config = {
    dashboard: { port: TEST_PORT, enabled: true },
    opencode: { base_url: "http://localhost:3000", project_directory: "/tmp" },
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

  before(async () => {
    writeFileSync(localFilePath, "initial local file body");
    server = new DashboardServer({ config, botEvents, configPath: "/tmp/test-config.json" });
    await server.start();
  });

  after(() => {
    server.stop();
    try {
      unlinkSync("/tmp/test-config.json");
    } catch {
      // ignore
    }
    try {
      unlinkSync(localFilePath);
    } catch {
      // ignore
    }
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
    // Each entry should have expected fields
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
});
