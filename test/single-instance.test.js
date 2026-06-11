import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSingleInstanceLock } from "../lib/single-instance-lock.js";

describe("single instance lock", () => {
  it("stores launch metadata in the lock file payload", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");

    const lock = await acquireSingleInstanceLock({
      lockPath,
      pid: 12345,
      startedAt: 1718102400000,
      cwd: "/tmp/oncall-bot",
      execPath: "/opt/homebrew/bin/node",
      argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
    });

    const payload = JSON.parse(readFileSync(lockPath, "utf-8"));

    assert.deepEqual(payload, {
      pid: 12345,
      startedAt: 1718102400000,
      cwd: "/tmp/oncall-bot",
      execPath: "/opt/homebrew/bin/node",
      argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
    });

    lock.release();
  });

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

  it("takes over a stale lock file", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");

    writeFileSync(lockPath, JSON.stringify({ pid: 41001, startedAt: 1718102400000 }));

    const lock = await acquireSingleInstanceLock({
      lockPath,
      pid: 42001,
      startedAt: 1718102401000,
      processExistsFn: () => false,
    });

    assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf-8")), {
      pid: 42001,
      startedAt: 1718102401000,
      cwd: process.cwd(),
      execPath: process.execPath,
      argv: process.argv.slice(1),
    });

    lock.release();
  });

  it("does not release a lock file that has been replaced by another owner", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");

    const lock = await acquireSingleInstanceLock({
      lockPath,
      pid: 12345,
      startedAt: 1718102400000,
    });

    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 12345,
        startedAt: 1718102400001,
      }),
    );

    lock.release();

    assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf-8")), {
      pid: 12345,
      startedAt: 1718102400001,
    });
  });

  it("does not remove a stale lock that was replaced before takeover", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");
    let checkedStalePid = false;

    writeFileSync(lockPath, JSON.stringify({ pid: 41001, startedAt: 1718102400000 }));

    await assert.rejects(
      acquireSingleInstanceLock({
        lockPath,
        pid: 42001,
        startedAt: 1718102401000,
        processExistsFn(existingPid) {
          if (existingPid === 41001) {
            checkedStalePid = true;
            writeFileSync(lockPath, JSON.stringify({ pid: 43001, startedAt: 1718102402000 }));
            return false;
          }

          return true;
        },
      }),
      /failed to acquire single instance lock|another oncall-bot process is already running/i,
    );

    assert.equal(checkedStalePid, true);
    assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf-8")), {
      pid: 43001,
      startedAt: 1718102402000,
    });
  });

  it("fails with the lock acquisition error when the existing lock file is unreadable", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");

    writeFileSync(lockPath, "not json");

    await assert.rejects(
      acquireSingleInstanceLock({
        lockPath,
        pid: 42001,
        startedAt: 1718102401000,
      }),
      /failed to acquire single instance lock/i,
    );
  });
});
