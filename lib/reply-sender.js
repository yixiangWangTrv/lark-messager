// lib/reply-sender.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class ReplySender {
  constructor(config) {
    this.identity = config.lark.reply_identity || config.lark.identity || "user";
    this.defaultReply = config.reply.default || "in_thread";
    this.rules = config.reply.rules || [];
    this.prefix = config.reply.prefix ?? "🤖 **[AI-Assisted Reply]**\n\n";
    this.execFileAsync = config.reply.execFileAsync || execFileAsync;
  }

  async sendReply(event, analysisResult, options = {}) {
    const targets = this._resolveTargets(event);
    const errors = [];
    const text = options.skipPrefix ? analysisResult : this.prefix + analysisResult;

    for (const target of targets) {
      try {
        await this._sendToTarget(target, event, text);
      } catch (err) {
        if (!this._shouldRetry(err)) {
          errors.push(`${target}: ${err.message}`);
          continue;
        }

        try {
          await this._sendToTarget(target, event, text);
        } catch (retryErr) {
          errors.push(`${target}: ${retryErr.message}`);
        }
      }
    }

    if (errors.length > 0) {
      process.stderr.write(`[reply-sender] Errors: ${errors.join("; ")}\n`);
    }
  }

  _resolveTargets(event) {
    for (const rule of this.rules) {
      if (this._matchesRule(rule, event)) {
        const targets = Array.isArray(rule.reply_to) ? rule.reply_to : [rule.reply_to];
        return targets;
      }
    }
    return [this.defaultReply];
  }

  _matchesRule(rule, event) {
    if (rule.match === "*") return true;
    const content = (event.content || "").toLowerCase();
    const pattern = rule.match.replace(/\*/g, "").toLowerCase();
    return content.includes(pattern);
  }

  _shouldRetry(err) {
    const message = String(err?.message || "");

    if (err?.code === "ETIMEDOUT") return false;
    if (/timed out/i.test(message)) return false;

    return true;
  }

  async _sendToTarget(target, event, text) {
    if (target === "in_thread") {
      await this._replyInThread(event.message_id, text);
    } else if (target === "in_chat") {
      await this._sendToChat(event.chat_id, text);
    } else if (target.startsWith("dm:")) {
      const userId = target.slice(3);
      await this._sendDm(userId, text);
    } else {
      process.stderr.write(`[reply-sender] Unknown target: ${target}\n`);
    }
  }

  async _replyInThread(messageId, text) {
    const args = [
      "im", "+messages-reply",
      "--message-id", messageId,
      "--markdown", text,
      "--as", this.identity,
    ];

    await this.execFileAsync("lark-cli", args, { timeout: 30000 });
  }

  async _sendToChat(chatId, text) {
    const args = [
      "im", "+messages-send",
      "--chat-id", chatId,
      "--markdown", text,
      "--as", this.identity,
    ];

    await this.execFileAsync("lark-cli", args, { timeout: 30000 });
  }

  async _sendDm(userId, text) {
    const args = [
      "im", "+messages-send",
      "--user-id", userId,
      "--markdown", text,
      "--as", this.identity,
    ];

    await this.execFileAsync("lark-cli", args, { timeout: 30000 });
  }
}
