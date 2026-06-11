import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createLogger({
  logFilePath = "data/oncall-bot.log",
  stderr = process.stderr,
  nowFn = () => new Date(),
} = {}) {
  mkdirSync(dirname(logFilePath), { recursive: true });

  return function log(message) {
    const line = `[${nowFn().toLocaleTimeString("zh-CN", { hour12: false })}] ${message}\n`;
    stderr.write(line);
    appendFileSync(logFilePath, line, "utf-8");
  };
}
