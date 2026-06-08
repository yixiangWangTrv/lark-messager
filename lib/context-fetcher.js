// lib/context-fetcher.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class ContextFetcher {
  constructor(config) {
    this.messageCount = config.context.message_count || 10;
    this.includeSenderName = config.context.include_sender_name !== false;
    this.identity = config.lark.identity || "bot";
  }

  async fetchContext(chatId, beforeTimestamp) {
    try {
      const args = [
        "im", "+chat-messages-list",
        "--chat-id", chatId,
        "--page-size", String(this.messageCount + 1),
        "--sort", "desc",
        "--as", this.identity,
        "--json",
      ];

      if (beforeTimestamp) {
        args.push("--end-time", beforeTimestamp);
      }

      const { stdout } = await execFileAsync("lark-cli", args, {
        timeout: 30000,
      });

      const result = JSON.parse(stdout);
      const messages = Array.isArray(result) ? result : (result.items || result.messages || []);

      return messages
        .reverse()
        .slice(0, this.messageCount)
        .map((msg) => this._formatMessage(msg))
        .filter(Boolean);
    } catch (err) {
      process.stderr.write(`[context-fetcher] Failed to fetch context for ${chatId}: ${err.message}\n`);
      return [];
    }
  }

  async getChatName(chatId) {
    try {
      const { stdout } = await execFileAsync("lark-cli", [
        "im", "chats", "get",
        "--chat-id", chatId,
        "--as", this.identity,
        "--json",
      ], { timeout: 10000 });

      const result = JSON.parse(stdout);
      return result.name || result.chat_name || chatId;
    } catch {
      return chatId;
    }
  }

  _formatMessage(msg) {
    const time = this._formatTime(msg.create_time);
    const sender = msg.sender_name || msg.sender_id || "unknown";
    const content = this._extractContent(msg);

    if (!content) return null;
    return `[${time}] ${sender}: ${content}`;
  }

  _formatTime(timestamp) {
    if (!timestamp) return "??:??";
    const ms = Number(timestamp);
    if (isNaN(ms)) return "??:??";
    const d = new Date(ms);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  _extractContent(msg) {
    const type = msg.msg_type || msg.message_type;
    const body = msg.body?.content || msg.content || "";

    switch (type) {
      case "text":
      case "post":
        return body;
      case "image":
        return "[image]";
      case "file":
        return `[file: ${msg.file_name || "unknown"}]`;
      case "audio":
        return "[audio]";
      case "video":
        return "[video]";
      case "interactive":
        return "[card message]";
      default:
        return `[${type || "unknown"} message]`;
    }
  }
}
