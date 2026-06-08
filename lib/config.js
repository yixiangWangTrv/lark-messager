// lib/config.js
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_FIELDS = [
  "opencode.base_url",
];

export function loadConfig(configPath) {
  const fullPath = resolve(configPath);
  let raw;
  try {
    raw = readFileSync(fullPath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read config file: ${fullPath} — ${err.message}`);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in config file: ${err.message}`);
  }

  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    const value = field.split(".").reduce((obj, key) => obj?.[key], config);
    if (!value) {
      throw new Error(`Missing required config field: ${field}`);
    }
  }

  // Apply defaults
  config.context = { message_count: 10, include_sender_name: true, ...config.context };
  config.opencode = { username: "opencode", password: "", analysis_timeout_ms: 180000, ...config.opencode };
  config.concurrency = { max_per_chat: 1, queue_size: 5, ...config.concurrency };
  config.reply = { default: "in_thread", rules: [], ...config.reply };
  config.lark = { identity: "bot", watch_chat_ids: [], ...config.lark };
  config.lark.trigger = { bot_id: "", bot_name: "", user_ids: [], user_names: [], group_ids: [], group_names: [], ...config.lark.trigger };

  return config;
}
