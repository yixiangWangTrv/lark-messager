import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export class ServerManager {
  constructor() {
    this._servers = new Map();
  }

  list() {
    return [...this._servers.values()].map(({ process: _p, ...rest }) => rest);
  }

  start({ port, projectDir, command = "opencode", args = ["serve", "--port", String(port)] }) {
    const id = randomUUID().slice(0, 8);
    const proc = spawn(command, args, {
      cwd: projectDir,
      stdio: "ignore",
      detached: false,
    });

    const entry = {
      id,
      port,
      projectDir,
      pid: proc.pid,
      status: "starting",
      startedAt: new Date().toISOString(),
      process: proc,
      command,
      args,
    };

    proc.on("spawn", () => {
      if (entry.status === "starting") {
        entry.status = "running";
      }
    });

    proc.on("exit", (code) => {
      if (entry.status !== "stopped") {
        entry.status = code === 0 ? "stopped" : "crashed";
      }
    });

    proc.on("error", () => {
      if (entry.status !== "stopped") {
        entry.status = "crashed";
      }
    });

    this._servers.set(id, entry);
    return { id, port, projectDir, pid: proc.pid, status: entry.status, startedAt: entry.startedAt };
  }

  stop(id) {
    const entry = this._servers.get(id);
    if (!entry) return false;
    entry.status = "stopped";
    try {
      entry.process.kill("SIGTERM");
    } catch {
      // Already dead
    }
    return true;
  }

  restart(id) {
    const entry = this._servers.get(id);
    if (!entry) return null;
    const { port, projectDir, command, args } = entry;
    this.stop(id);
    return this.start({ port, projectDir, command, args });
  }

  stopAll() {
    for (const [id] of this._servers) {
      this.stop(id);
    }
  }
}
