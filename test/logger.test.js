import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../lib/logger.js";

describe("createLogger", () => {
  it("writes each log line to stderr and an on-disk log file", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "oncall-bot-logger-"));
    const logFilePath = join(tempRoot, "data", "oncall-bot.log");
    const stderrChunks = [];

    try {
      const logger = createLogger({
        logFilePath,
        stderr: {
          write(chunk) {
            stderrChunks.push(String(chunk));
          },
        },
        nowFn: () => ({
          toLocaleTimeString() {
            return "18:35:00";
          },
        }),
      });

      logger("hello logger");

      assert.equal(stderrChunks.length, 1);
      assert.match(stderrChunks[0], /\[18:35:00\] hello logger\n$/);

      const fileContent = readFileSync(logFilePath, "utf-8");
      assert.match(fileContent, /\[18:35:00\] hello logger\n$/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
