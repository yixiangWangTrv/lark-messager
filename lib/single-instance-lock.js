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
  } catch {
    // Ignore lock cleanup failures.
  }
}

export async function acquireSingleInstanceLock({
  lockPath,
  pid = process.pid,
  processExistsFn = processExists,
  startedAt = Date.now(),
} = {}) {
  const payload = JSON.stringify({ pid, startedAt });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, payload, { flag: "wx" });

      return {
        lockPath,
        release() {
          const existing = readLockFile(lockPath);
          if (existing?.pid && existing.pid !== pid) return;
          removeLockFile(lockPath);
        },
      };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;

      const existing = readLockFile(lockPath);
      if (existing?.pid && existing.pid !== pid && processExistsFn(existing.pid)) {
        throw new Error(`Another oncall-bot process is already running (pid ${existing.pid})`);
      }

      removeLockFile(lockPath);
    }
  }

  throw new Error(`Failed to acquire single instance lock at ${lockPath}`);
}
