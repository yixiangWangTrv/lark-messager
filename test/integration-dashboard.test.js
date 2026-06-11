import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { loadConfig } from "../lib/config.js";

describe("config dashboard defaults", () => {
  it("applies dashboard defaults when field is missing", () => {
    const path = "/tmp/test-dashboard-cfg.json";
    writeFileSync(path, JSON.stringify({ opencode: { base_url: "http://localhost:3000" } }));
    const cfg = loadConfig(path);
    assert.equal(cfg.dashboard.port, 8015);
    assert.equal(cfg.dashboard.enabled, true);
    unlinkSync(path);
  });

  it("respects custom dashboard config", () => {
    const path = "/tmp/test-dashboard-cfg2.json";
    writeFileSync(path, JSON.stringify({
      opencode: { base_url: "http://localhost:3000" },
      dashboard: { port: 9000, enabled: false }
    }));
    const cfg = loadConfig(path);
    assert.equal(cfg.dashboard.port, 9000);
    assert.equal(cfg.dashboard.enabled, false);
    unlinkSync(path);
  });

  it("applies knowledge_base defaults when field is missing", () => {
    const path = "/tmp/test-dashboard-cfg3.json";
    writeFileSync(path, JSON.stringify({
      opencode: { base_url: "http://localhost:3000" },
    }));
    const cfg = loadConfig(path);
    assert.equal(cfg.knowledge_base.enabled, true);
    assert.deepEqual(cfg.knowledge_base.items, []);
    unlinkSync(path);
  });

  it("respects custom knowledge_base config", () => {
    const path = "/tmp/test-dashboard-cfg4.json";
    writeFileSync(path, JSON.stringify({
      opencode: { base_url: "http://localhost:3000" },
      knowledge_base: {
        enabled: false,
        items: [
          { title: "Runbook", url: "https://example.com/runbook" },
        ],
      },
    }));
    const cfg = loadConfig(path);
    assert.equal(cfg.knowledge_base.enabled, false);
    assert.deepEqual(cfg.knowledge_base.items, [
      { title: "Runbook", url: "https://example.com/runbook" },
    ]);
    unlinkSync(path);
  });
});
