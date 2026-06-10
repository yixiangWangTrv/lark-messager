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
});
