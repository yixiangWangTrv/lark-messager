import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ServerManager } from "../lib/server-manager.js";

describe("ServerManager", () => {
  let mgr;

  beforeEach(() => {
    mgr = new ServerManager();
  });

  afterEach(() => {
    mgr.stopAll();
  });

  it("starts with empty server list", () => {
    assert.deepEqual(mgr.list(), []);
  });

  it("start adds a server entry with status 'starting'", async () => {
    const info = mgr.start({ port: 19999, projectDir: "/tmp", command: "node", args: ["-e", "setTimeout(()=>{},500)"] });
    assert.equal(info.port, 19999);
    assert.equal(info.status, "starting");
    assert.equal(typeof info.id, "string");
    assert.equal(mgr.list().length, 1);
  });

  it("stop kills the process and sets status to stopped", async () => {
    const info = mgr.start({ port: 19998, projectDir: "/tmp", command: "node", args: ["-e", "setTimeout(()=>{},5000)"] });
    const stopped = mgr.stop(info.id);
    assert.equal(stopped, true);
    await new Promise((r) => setTimeout(r, 100));
    const entry = mgr.list().find((s) => s.id === info.id);
    assert.equal(entry.status, "stopped");
  });

  it("stop returns false for unknown id", () => {
    assert.equal(mgr.stop("nonexistent"), false);
  });

  it("restart stops and starts with same config", async () => {
    const info = mgr.start({ port: 19997, projectDir: "/tmp", command: "node", args: ["-e", "setTimeout(()=>{},5000)"] });
    const newInfo = mgr.restart(info.id);
    assert.notEqual(newInfo.id, info.id);
    assert.equal(newInfo.port, 19997);
    assert.equal(mgr.list().filter((s) => s.status !== "stopped").length, 1);
  });
});
