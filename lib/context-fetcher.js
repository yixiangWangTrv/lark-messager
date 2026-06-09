// lib/context-fetcher.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class ContextFetcher {
  constructor(config) {
    this.messageCount = config.context.message_count || 10;
    this.includeSenderName = config.context.include_sender_name !== false;
    this.identity = config.lark.context_identity || config.lark.reply_identity || config.lark.identity || "user";
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
        // --end expects ISO 8601 format
        const ts = Number(beforeTimestamp);
        const iso = isNaN(ts) ? beforeTimestamp : new Date(ts).toISOString();
        args.push("--end", iso);
      }

      const { stdout } = await execFileAsync("lark-cli", args, {
        timeout: 30000,
      });

      const result = JSON.parse(stdout);
      // Response: { ok: true, data: { messages: [...] } } or just an array
      const messages = result.data?.messages || result.messages || (Array.isArray(result) ? result : []);

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
        "--params", JSON.stringify({ chat_id: chatId }),
        "--as", this.identity,
        "--json",
      ], { timeout: 10000 });

      const result = JSON.parse(stdout);
      // Response shape: { code: 0, data: { name: "...", i18n_names: {...} } }
      const data = result.data || result;
      return data.name || data.i18n_names?.en_us || chatId;
    } catch {
      return chatId;
    }
  }

  _formatMessage(msg) {
    const time = this._formatTime(msg.create_time);
    const sender = msg.sender?.name || msg.sender_name || msg.sender_id || "unknown";
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
        return this._extractTextContent(body);
      case "post":
        return this._extractPostContent(body);
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

  _extractTextContent(body) {
    if (typeof body !== "string") return "";

    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.text === "string") {
        return parsed.text;
      }
    } catch {
      // Body is already plain text.
    }

    return body;
  }

  _extractPostContent(body) {
    if (typeof body !== "string") return "";

    try {
      const parsed = JSON.parse(body);
      const locale = parsed.zh_cn || parsed.en_us || Object.values(parsed)[0];
      const lines = Array.isArray(locale?.content) ? locale.content : [];

      return lines
        .map((line) => line.map((segment) => {
          if (segment.tag === "text") return segment.text || "";
          if (segment.tag === "at") return `@${segment.user_name || segment.name || "unknown"}`;
          if (segment.tag === "a") return segment.text || segment.href || "";
          return "";
        }).join(" ").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
    } catch {
      return body;
    }
  }
}
