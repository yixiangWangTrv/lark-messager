import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code !== "ESRCH";
  }
}

function readLockFile(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, "utf-8"));
  } catch {
    return null;
  }
}

function removeLockFile(lockPath) {
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    // Ignore lock cleanup failures.
    return false;
  }
}

function sameLockOwner(existing, expected) {
  if (!expected) return false;
  return existing?.pid === expected.pid && existing?.startedAt === expected.startedAt;
}

function removeLockFileIfUnchanged(lockPath, expected) {
  const existing = readLockFile(lockPath);
  if (!sameLockOwner(existing, expected)) return false;

  return removeLockFile(lockPath);
}

export async function acquireSingleInstanceLock({
  lockPath,
  pid = process.pid,
  processExistsFn = processExists,
  startedAt = Date.now(),
  cwd = process.cwd(),
  execPath = process.execPath,
  argv = process.argv.slice(1),
} = {}) {
  const lockOwner = { pid, startedAt };
  const payload = JSON.stringify({ ...lockOwner, cwd, execPath, argv });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, payload, { flag: "wx" });

      return {
        lockPath,
        release() {
          removeLockFileIfUnchanged(lockPath, lockOwner);
        },
      };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;

      const existing = readLockFile(lockPath);
      if (existing?.pid && !sameLockOwner(existing, lockOwner) && processExistsFn(existing.pid)) {
        throw new Error(`Another oncall-bot process is already running (pid ${existing.pid})`);
      }

      if (!removeLockFileIfUnchanged(lockPath, existing)) {
        continue;
      }
    }
  }

  throw new Error(`Failed to acquire single instance lock at ${lockPath}`);
}
