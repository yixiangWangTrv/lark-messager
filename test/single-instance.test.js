import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSingleInstanceLock, getActiveBotProcess } from "../lib/single-instance-lock.js";

function createFsImpl(overrides = {}) {
  return {
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
    ...overrides,
  };
}

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

  it("returns the active bot process when the lock file points to a live pid", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");

    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 71371,
        startedAt: 1718102400000,
        cwd: "/tmp/oncall-bot",
        execPath: "/opt/homebrew/bin/node",
        argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
      }),
    );

    assert.deepEqual(
      getActiveBotProcess({ lockPath, processExistsFn: (pid) => pid === 71371 }),
      {
        id: "bot-71371",
        kind: "bot",
        source: "local",
        label: "oncall-bot",
        pid: 71371,
        startedAt: 1718102400000,
        projectDir: "/tmp/oncall-bot",
        port: null,
        status: "running",
        execPath: "/opt/homebrew/bin/node",
        argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
      },
    );
  });

  it("returns null when active bot liveness cannot be confirmed", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");

    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 71371,
        startedAt: 1718102400000,
        cwd: "/tmp/oncall-bot",
        execPath: "/opt/homebrew/bin/node",
        argv: ["/tmp/oncall-bot/oncall-bot.js", "--config", "oncall-bot.config.json"],
      }),
    );

    assert.equal(
      getActiveBotProcess({
        lockPath,
        processExistsFn() {
          throw Object.assign(new Error("EPERM"), { code: "EPERM" });
        },
      }),
      null,
    );
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

  it("writes cleanup guard owner metadata before retiring a stale lock", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");
    const cleanupPath = `${lockPath}.cleanup`;
    const owner = { pid: 42001, startedAt: 1718102401000 };
    let cleanupOwner = null;
    const fsImpl = createFsImpl({
      writeFileSync(path, data, options) {
        if (path === cleanupPath) {
          cleanupOwner = JSON.parse(String(data));
        }

        return writeFileSync(path, data, options);
      },
    });

    writeFileSync(lockPath, JSON.stringify({ pid: 41001, startedAt: 1718102400000 }));

    const lock = await acquireSingleInstanceLock({
      lockPath,
      ...owner,
      fsImpl,
      processExistsFn: () => false,
    });

    assert.deepEqual(cleanupOwner, owner);
    lock.release();
  });

  it("takes over a stale lock even when a stale cleanup guard exists", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");
    const cleanupPath = `${lockPath}.cleanup`;

    writeFileSync(lockPath, JSON.stringify({ pid: 41001, startedAt: 1718102400000 }));
    writeFileSync(cleanupPath, JSON.stringify({ pid: 41002, startedAt: 1718102400500 }));

    const lock = await acquireSingleInstanceLock({
      lockPath,
      pid: 42001,
      startedAt: 1718102401000,
      processExistsFn: () => false,
    });

    assert.equal(existsSync(cleanupPath), false);
    assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf-8")), {
      pid: 42001,
      startedAt: 1718102401000,
      cwd: process.cwd(),
      execPath: process.execPath,
      argv: process.argv.slice(1),
    });

    lock.release();
  });

  it("lets only one stale contender retire the lock and preserves the winner's lock", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");
    const cleanupPath = `${lockPath}.cleanup`;
    const winnerOwner = { pid: 42002, startedAt: 1718102402000 };
    const loserOwner = { pid: 42001, startedAt: 1718102401000 };
    let startedSecondContender = false;
    let retiredLocks = 0;
    let winnerLockPromise = null;
    const fsImpl = createFsImpl({
      writeFileSync(path, data, options) {
        if (path === cleanupPath && !startedSecondContender) {
          startedSecondContender = true;
          winnerLockPromise = acquireSingleInstanceLock({
            lockPath,
            ...winnerOwner,
            fsImpl,
            processExistsFn: (existingPid) => existingPid === winnerOwner.pid,
          });
        }

        return writeFileSync(path, data, options);
      },
      renameSync(from, to) {
        if (from === lockPath && to.startsWith(`${lockPath}.retired.`)) {
          retiredLocks += 1;
        }

        return renameSync(from, to);
      },
    });

    writeFileSync(lockPath, JSON.stringify({ pid: 41001, startedAt: 1718102400000 }));

    await assert.rejects(
      acquireSingleInstanceLock({
        lockPath,
        ...loserOwner,
        fsImpl,
        processExistsFn: (existingPid) => existingPid === winnerOwner.pid,
      }),
      new RegExp(`pid ${winnerOwner.pid}`),
    );

    assert.equal(startedSecondContender, true);

    const winnerLock = await winnerLockPromise;
    assert.equal(retiredLocks, 1);
    assert.equal(existsSync(cleanupPath), false);
    assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf-8")), {
      pid: winnerOwner.pid,
      startedAt: winnerOwner.startedAt,
      cwd: process.cwd(),
      execPath: process.execPath,
      argv: process.argv.slice(1),
    });

    winnerLock.release();
    assert.equal(existsSync(lockPath), false);
  });

  it("does not release a same-owner lock until the original handle also releases", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");

    const firstLock = await acquireSingleInstanceLock({
      lockPath,
      pid: 42001,
      startedAt: 1718102401000,
    });
    const before = statSync(lockPath);

    const secondLock = await acquireSingleInstanceLock({
      lockPath,
      pid: 42001,
      startedAt: 1718102401000,
    });
    const after = statSync(lockPath);

    assert.equal(after.ino, before.ino);
    assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf-8")), {
      pid: 42001,
      startedAt: 1718102401000,
      cwd: process.cwd(),
      execPath: process.execPath,
      argv: process.argv.slice(1),
    });

    secondLock.release();
    assert.equal(existsSync(lockPath), true);
    assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf-8")), {
      pid: 42001,
      startedAt: 1718102401000,
      cwd: process.cwd(),
      execPath: process.execPath,
      argv: process.argv.slice(1),
    });

    firstLock.release();
    assert.equal(existsSync(lockPath), false);
  });

  it("tracks same-owner handles without key collisions across different lock paths", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const firstLockPath = join(tempDir, "alpha:41:1000");
    const secondLockPath = join(tempDir, "alpha");
    const owner = { pid: 41, startedAt: 1000 };

    const firstLock = await acquireSingleInstanceLock({
      lockPath: firstLockPath,
      ...owner,
    });
    const secondLock = await acquireSingleInstanceLock({
      lockPath: secondLockPath,
      pid: 41,
      startedAt: 1000,
    });

    firstLock.release();

    assert.equal(existsSync(firstLockPath), false);
    assert.equal(existsSync(secondLockPath), true);

    secondLock.release();
    assert.equal(existsSync(secondLockPath), false);
  });

  it("returns the active bot process with null fields when launch metadata is incomplete", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");

    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 71371,
        cwd: "/tmp/oncall-bot",
          execPath: "/opt/homebrew/bin/node",
          argv: ["/tmp/oncall-bot/oncall-bot.js"],
        }),
    );

    assert.deepEqual(getActiveBotProcess({ lockPath, processExistsFn: () => true }), {
      id: "bot-71371",
      kind: "bot",
      source: "local",
      label: "oncall-bot",
      pid: 71371,
      startedAt: null,
      projectDir: "/tmp/oncall-bot",
      port: null,
      status: "running",
      execPath: "/opt/homebrew/bin/node",
      argv: ["/tmp/oncall-bot/oncall-bot.js"],
    });

    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 71371,
        startedAt: 1718102400000,
        cwd: "/tmp/oncall-bot",
          execPath: "/opt/homebrew/bin/node",
          argv: "not-an-array",
        }),
    );

    assert.deepEqual(getActiveBotProcess({ lockPath, processExistsFn: () => true }), {
      id: "bot-71371",
      kind: "bot",
      source: "local",
      label: "oncall-bot",
      pid: 71371,
      startedAt: 1718102400000,
      projectDir: "/tmp/oncall-bot",
      port: null,
      status: "running",
      execPath: "/opt/homebrew/bin/node",
      argv: null,
    });
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

  it("retires the validated lock before unlinking so a replacement lock survives cleanup", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");
    const replacement = { pid: 54321, startedAt: 1718102400001 };
    let replacementCreated = false;
    let retiredPath = null;
    let unlinkedLockPath = false;
    const fsImpl = createFsImpl({
      renameSync(from, to) {
        const result = renameSync(from, to);
        if (from === lockPath && !replacementCreated) {
          retiredPath = to;
          writeFileSync(lockPath, JSON.stringify(replacement));
          replacementCreated = true;
        }

        return result;
      },
      unlinkSync(path, ...args) {
        if (path === lockPath) {
          unlinkedLockPath = true;
          if (!replacementCreated) {
            writeFileSync(lockPath, JSON.stringify(replacement));
            replacementCreated = true;
          }
        }

        return unlinkSync(path, ...args);
      },
    });

    const lock = await acquireSingleInstanceLock({
      lockPath,
      fsImpl,
      pid: 12345,
      startedAt: 1718102400000,
    });

    lock.release();

    assert.equal(replacementCreated, true);
    assert.equal(unlinkedLockPath, false);
    assert.match(retiredPath ?? "", new RegExp(`^${lockPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.retired\\.`));
    assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf-8")), replacement);
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

  it("does not remove a stale lock when it was replaced with the same owner metadata before cleanup", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");
    let livenessChecks = 0;

    writeFileSync(lockPath, JSON.stringify({ pid: 41001, startedAt: 1718102400000 }));

    await assert.rejects(
      acquireSingleInstanceLock({
        lockPath,
        pid: 42001,
        startedAt: 1718102401000,
        processExistsFn(existingPid) {
          if (existingPid !== 41001) {
            return true;
          }

          livenessChecks += 1;
          if (livenessChecks === 1) {
            writeFileSync(lockPath, JSON.stringify({ pid: 41001, startedAt: 1718102400000 }));
            return false;
          }

          return true;
        },
      }),
      /another oncall-bot process is already running/i,
    );

    assert.equal(livenessChecks, 2);
    assert.deepEqual(JSON.parse(readFileSync(lockPath, "utf-8")), {
      pid: 41001,
      startedAt: 1718102400000,
    });
  });

  it("treats an unreadable existing lock file as stale and replaces it", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-lock-"));
    const lockPath = join(tempDir, "oncall-bot.lock");

    writeFileSync(lockPath, "not json");

    const lock = await acquireSingleInstanceLock({
      lockPath,
      pid: 42001,
      startedAt: 1718102401000,
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
});
