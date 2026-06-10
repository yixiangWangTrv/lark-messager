import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSingleInstanceLock } from "../lib/single-instance-lock.js";

describe("single instance lock", () => {
  it("rejects startup when a lock file already exists for another live process", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));

    await assert.rejects(
      acquireSingleInstanceLock({
        lockPath,
        pid: process.pid + 1,
        processExistsFn: () => true,
      }),
      /another oncall-bot process is already running/i,
    );
  });
});
