import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
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
          enabled: true,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  };

  before(async () => {
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

  it("GET /api/knowledge-base returns knowledge base config", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.enabled, true);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].id, "kb-existing");
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
    assert.equal(knowledgeBase.items.length, 2);
    assert.equal(knowledgeBase.items[1].id, data.id);
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

  it("GET / contains tab structure", async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    assert.ok(html.includes("Sessions"));
    assert.ok(html.includes("Servers"));
    assert.ok(html.includes("Prompts"));
    assert.ok(html.includes("Settings"));
  });
});
