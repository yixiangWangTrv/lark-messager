import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

const ownerHandleCounts = new Map();
const defaultFsImpl = { readFileSync, renameSync, statSync, unlinkSync, writeFileSync };

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code !== "ESRCH";
  }
}

function readLockFile(lockPath, fsImpl = defaultFsImpl) {
  try {
    return JSON.parse(fsImpl.readFileSync(lockPath, "utf-8"));
  } catch {
    return null;
  }
}

function statLockFile(lockPath, fsImpl = defaultFsImpl) {
  try {
    return fsImpl.statSync(lockPath, { bigint: true });
  } catch {
    return null;
  }
}

function sameLockFile(first, second) {
  return Boolean(first && second)
    && first.dev === second.dev
    && first.ino === second.ino
    && first.size === second.size
    && first.mtimeNs === second.mtimeNs
    && first.ctimeNs === second.ctimeNs;
}

function inspectLockFile(lockPath, fsImpl = defaultFsImpl) {
  const beforeRead = statLockFile(lockPath, fsImpl);
  if (!beforeRead) return null;

  try {
    const owner = JSON.parse(fsImpl.readFileSync(lockPath, "utf-8"));
    const afterRead = statLockFile(lockPath, fsImpl);
    if (!sameLockFile(beforeRead, afterRead)) return null;

    return { owner, unreadable: false, stat: afterRead };
  } catch {
    const afterRead = statLockFile(lockPath, fsImpl);
    if (!sameLockFile(beforeRead, afterRead)) return null;

    return { owner: null, unreadable: true, stat: afterRead };
  }
}

function removeLockFile(lockPath, fsImpl = defaultFsImpl) {
  try {
    fsImpl.unlinkSync(lockPath);
    return true;
  } catch {
    // Ignore lock cleanup failures.
    return false;
  }
}

function hasValidOwnerPayload(owner) {
  return Number.isInteger(owner?.pid)
    && owner.pid > 0
    && Number.isFinite(owner?.startedAt);
}

function acquireCleanupGuard(lockPath, lockOwner, processExistsFn, fsImpl = defaultFsImpl) {
  const cleanupPath = `${lockPath}.cleanup`;
  const payload = JSON.stringify(lockOwner);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fsImpl.writeFileSync(cleanupPath, payload, { flag: "wx" });
      return cleanupPath;
    } catch (err) {
      if (err?.code !== "EEXIST") {
        throw err;
      }

      const existing = inspectLockFile(cleanupPath, fsImpl);
      if (!existing) {
        continue;
      }

      if (
        !existing.unreadable
        && hasValidOwnerPayload(existing.owner)
        && !sameLockOwner(existing.owner, lockOwner)
        && processExistsFn(existing.owner.pid)
      ) {
        return null;
      }

      removeLockFileIfUnchanged(cleanupPath, existing, fsImpl);
    }
  }

  return null;
}

function retireLockFile(lockPath, fsImpl = defaultFsImpl) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const retiredPath = `${lockPath}.retired.${process.pid}.${Date.now()}.${attempt}`;

    try {
      fsImpl.renameSync(lockPath, retiredPath);
      return retiredPath;
    } catch (err) {
      if (err?.code === "EEXIST") {
        continue;
      }

      return null;
    }
  }

  return null;
}

function getOwnerKey(lockPath, owner) {
  if (!owner) return null;
  return JSON.stringify([lockPath, owner.pid, owner.startedAt]);
}

function sameLockOwner(existing, expected) {
  if (!expected) return false;
  return existing?.pid === expected.pid && existing?.startedAt === expected.startedAt;
}

function removeLockFileIfUnchanged(lockPath, expected, fsImpl = defaultFsImpl) {
  const existing = inspectLockFile(lockPath, fsImpl);
  if (!existing) return false;

  if (expected?.stat) {
    if (!sameLockFile(existing.stat, expected.stat)) return false;
    if (existing.unreadable !== expected.unreadable) return false;
    if (!expected.unreadable && !sameLockOwner(existing.owner, expected.owner)) return false;
  } else {
    if (existing.unreadable || !sameLockOwner(existing.owner, expected)) return false;
  }

  const beforeRetire = statLockFile(lockPath, fsImpl);
  if (!sameLockFile(beforeRetire, existing.stat)) return false;

  const retiredPath = retireLockFile(lockPath, fsImpl);
  if (!retiredPath) return false;

  removeLockFile(retiredPath, fsImpl);
  return true;
}

function cleanupStaleLock(lockPath, expected, lockOwner, processExistsFn, fsImpl = defaultFsImpl) {
  const cleanupPath = acquireCleanupGuard(lockPath, lockOwner, processExistsFn, fsImpl);
  if (!cleanupPath) return false;

  try {
    removeLockFileIfUnchanged(lockPath, expected, fsImpl);
    return true;
  } finally {
    removeLockFile(cleanupPath, fsImpl);
  }
}

function createLockHandle(lockPath, lockOwner, fsImpl = defaultFsImpl) {
  const ownerKey = getOwnerKey(lockPath, lockOwner);
  ownerHandleCounts.set(ownerKey, (ownerHandleCounts.get(ownerKey) ?? 0) + 1);

  let released = false;

  return {
    lockPath,
    release() {
      if (released) return;
      released = true;

      const remaining = (ownerHandleCounts.get(ownerKey) ?? 1) - 1;
      if (remaining > 0) {
        ownerHandleCounts.set(ownerKey, remaining);
        return;
      }

      ownerHandleCounts.delete(ownerKey);
      removeLockFileIfUnchanged(lockPath, lockOwner, fsImpl);
    },
  };
}

export async function acquireSingleInstanceLock({
  lockPath,
  pid = process.pid,
  processExistsFn = processExists,
  startedAt = Date.now(),
  cwd = process.cwd(),
  execPath = process.execPath,
  argv = process.argv.slice(1),
  fsImpl = defaultFsImpl,
} = {}) {
  const lockOwner = { pid, startedAt };
  const payload = JSON.stringify({ ...lockOwner, cwd, execPath, argv });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fsImpl.writeFileSync(lockPath, payload, { flag: "wx" });

      return createLockHandle(lockPath, lockOwner, fsImpl);
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;

      const existing = inspectLockFile(lockPath, fsImpl);
      if (!existing) {
        continue;
      }

      if (!existing.unreadable && sameLockOwner(existing.owner, lockOwner)) {
        return createLockHandle(lockPath, lockOwner, fsImpl);
      }

      if (!existing.unreadable && existing.owner?.pid && processExistsFn(existing.owner.pid)) {
        throw new Error(`Another oncall-bot process is already running (pid ${existing.owner.pid})`);
      }

      cleanupStaleLock(lockPath, existing, lockOwner, processExistsFn, fsImpl);
    }
  }

  throw new Error(`Failed to acquire single instance lock at ${lockPath}`);
}

export function getActiveBotProcess({
  lockPath,
  processExistsFn = processExists,
  fsImpl = defaultFsImpl,
} = {}) {
  const existing = readLockFile(lockPath, fsImpl);
  if (!Number.isInteger(existing?.pid) || existing.pid <= 0) {
    return null;
  }

  let isRunning = false;
  try {
    isRunning = processExistsFn(existing.pid);
  } catch {
    return null;
  }

  if (!isRunning) {
    return null;
  }

  return {
    id: `bot-${existing.pid}`,
    kind: "bot",
    source: "local",
    label: "oncall-bot",
    pid: existing.pid,
    startedAt: Number.isFinite(existing.startedAt) ? existing.startedAt : null,
    projectDir: existing.cwd || null,
    port: null,
    status: "running",
    execPath: existing.execPath || null,
    argv: Array.isArray(existing.argv) ? existing.argv : null,
  };
}
