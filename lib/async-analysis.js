// lib/async-analysis.js

const STUCK_NOTICE = "OpenCode is waiting for tool approval. Please check the OpenCode window and approve if needed.";
const TIMEOUT_NOTICE = "Still waiting for OpenCode to finish. It may be blocked on approval or still processing.";
const RETRIEVAL_FAILURE = "OpenCode accepted the request, but the bot could not retrieve the final reply.";

export class AsyncAnalysis {
  constructor({ client, replySender, config }) {
    this.client = client;
    this.replySender = replySender;
    this.pollIntervalMs = config.opencode.poll_interval_ms ?? 3000;
    this.pollTimeoutMs = config.opencode.poll_timeout_ms ?? 1800000;
    this.toolStuckThresholdMs = config.opencode.tool_stuck_threshold_ms ?? 8000;
  }

  async run(event, sessionId, prompt) {
    const resolvedSessionId = typeof sessionId === "object" && sessionId !== null
      ? sessionId.sessionId
      : sessionId;

    let tracking;
    try {
      tracking = await this.client.submitMessage(resolvedSessionId, prompt);
    } catch (err) {
      await this._sendNotice(event, `OpenCode submit failed: ${err.message}`);
      return;
    }

    await this._poll(event, tracking);
  }

  async _poll(event, tracking) {
    const deadline = Date.now() + this.pollTimeoutMs;
    let stuckNoticeSent = false;
    let toolRunningFirstSeenAt = null;

    while (Date.now() < deadline) {
      const messages = await this.client.listMessages(tracking.sessionId);
      const assistant = this._findAssistant(messages, tracking);

      if (assistant) {
        // Check completion
        if (this._isComplete(assistant)) {
          const text = this._extractText(assistant);
          if (text) {
            await this.replySender.sendReply(event, text);
          } else {
            await this._sendNotice(event, RETRIEVAL_FAILURE);
          }
          return;
        }

        // Check tool-stuck
        if (!stuckNoticeSent) {
          const lastTool = this._lastToolPart(assistant);
          if (lastTool?.state?.status === "running") {
            if (!toolRunningFirstSeenAt) toolRunningFirstSeenAt = Date.now();
            if (Date.now() - toolRunningFirstSeenAt >= this.toolStuckThresholdMs) {
              await this._sendNotice(event, STUCK_NOTICE);
              stuckNoticeSent = true;
            }
          } else {
            toolRunningFirstSeenAt = null;
          }
        }
      }

      await new Promise(r => setTimeout(r, this.pollIntervalMs));
    }

    await this._sendNotice(event, TIMEOUT_NOTICE);
  }

  _findAssistant(messages, tracking) {
    const candidates = messages.filter(m => m?.info?.role === "assistant");
    if (candidates.length === 0) return null;

    // Prefer by parentID match
    if (tracking.userMessageId) {
      const match = candidates.find(m => m.info.parentID === tracking.userMessageId);
      if (match) return match;
    }

    // Fall back to first assistant message created after submission
    return candidates.find(m => {
      const created = m.info?.time?.created;
      return created != null && created >= tracking.submittedAt;
    }) ?? candidates[candidates.length - 1];
  }

  _isComplete(msg) {
    if (msg.info?.time?.completed) return true;
    const finish = msg.info?.finish;
    if (finish === "stop" || finish === "tool-calls") return true;
    return false;
  }

  _extractText(msg) {
    const parts = msg.parts || [];
    return parts
      .filter(p => p.type === "text")
      .map(p => p.text || p.content || "")
      .join("\n")
      .trim() || null;
  }

  _lastToolPart(msg) {
    const parts = msg.parts || [];
    const toolParts = parts.filter(p => p.type === "tool");
    return toolParts[toolParts.length - 1] ?? null;
  }

  async _sendNotice(event, text) {
    try {
      await this.replySender.sendReply(event, text, { skipPrefix: true });
    } catch {
      // best-effort
    }
  }
}
