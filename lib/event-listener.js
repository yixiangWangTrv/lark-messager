// lib/event-listener.js
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class EventListener {
  constructor({ identity = "bot", onEvent, onError, onReady }) {
    this.identity = identity;
    this.onEvent = onEvent;
    this.onError = onError;
    this.onReady = onReady;
    this.proc = null;
    this.restartCount = 0;
    this.maxRestarts = 3;
    this.restartDelay = 5000;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this._spawn();
  }

  stop() {
    this.stopped = true;
    if (this.proc) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
  }

  _spawn() {
    if (this.stopped) return;

    const args = ["event", "consume", "im.message.receive_v1", "--as", this.identity];
    this.proc = spawn("lark-cli", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Keep stdin open (required by lark-cli event consume)
    // Do NOT close stdin or it will exit immediately

    // Watch stderr for ready marker
    const stderrRl = createInterface({ input: this.proc.stderr });
    stderrRl.on("line", (line) => {
      if (line.includes("[event] ready")) {
        this.restartCount = 0; // Reset on successful start
        if (this.onReady) this.onReady();
      }
      // Log other stderr lines for debugging
      if (!line.includes("[event] ready")) {
        process.stderr.write(`[lark-cli] ${line}\n`);
      }
    });

    // Read NDJSON from stdout
    const stdoutRl = createInterface({ input: this.proc.stdout });
    stdoutRl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        this.onEvent(event);
      } catch (err) {
        process.stderr.write(`[event-listener] Failed to parse: ${line.slice(0, 100)}\n`);
      }
    });

    this.proc.on("exit", (code, signal) => {
      if (this.stopped) return;

      process.stderr.write(`[event-listener] Process exited: code=${code} signal=${signal}\n`);

      if (this.restartCount < this.maxRestarts) {
        this.restartCount++;
        process.stderr.write(`[event-listener] Restarting in ${this.restartDelay}ms (attempt ${this.restartCount}/${this.maxRestarts})\n`);
        setTimeout(() => this._spawn(), this.restartDelay);
      } else {
        const err = new Error(`lark-cli event consume failed after ${this.maxRestarts} restart attempts`);
        if (this.onError) this.onError(err);
      }
    });

    this.proc.on("error", (err) => {
      process.stderr.write(`[event-listener] Spawn error: ${err.message}\n`);
      if (this.onError) this.onError(err);
    });
  }
}
