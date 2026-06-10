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

  it("GET / contains tab structure", async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    assert.ok(html.includes("Sessions"));
    assert.ok(html.includes("Servers"));
    assert.ok(html.includes("Prompts"));
    assert.ok(html.includes("Settings"));
  });
});
