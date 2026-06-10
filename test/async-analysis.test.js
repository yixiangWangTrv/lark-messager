import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AsyncAnalysis } from "../lib/async-analysis.js";

// Helper: build a minimal assistant message object
function assistantMsg({ completed = null, finish = null, toolStatus = null, text = null } = {}) {
  const parts = [];
  if (toolStatus) parts.push({ type: "tool", state: { status: toolStatus } });
  if (text) parts.push({ type: "text", text });
  return {
    info: {
      role: "assistant",
      time: { completed },
      finish,
      parentID: "msg_user_001",
    },
    parts,
  };
}

describe("AsyncAnalysis", () => {
  it("submits using the resolved sessionId string rather than a session result object", async () => {
    const submitCalls = [];
    const replies = [];
    const client = {
      submitMessage: async (sessionId, _prompt) => {
        submitCalls.push(sessionId);
        return { sessionId, submittedAt: Date.now() - 100, userMessageId: "msg_user_001" };
      },
      listMessages: async () => [
        assistantMsg({ completed: Date.now(), finish: "stop", text: "done!" }),
      ],
    };
    const replySender = {
      sendReply: async (_event, text, opts) => { replies.push({ text, opts }); },
    };

    const analysis = new AsyncAnalysis({ client, replySender, config: {
      opencode: { poll_interval_ms: 10, poll_timeout_ms: 5000, tool_stuck_threshold_ms: 9999 },
      reply: {},
    }});

    await analysis.run(
      { chat_id: "c1", message_id: "m1" },
      { sessionId: "ses_123", sessionState: "new" },
      "analyze this",
    );

    assert.deepEqual(submitCalls, ["ses_123"]);
    assert.equal(replies.length, 1);
    assert.ok(replies[0].text.includes("done!"));
  });

  it("delivers final reply when assistant message completes", async () => {
    const replies = [];
    const client = {
      submitMessage: async () => ({ sessionId: "s1", submittedAt: Date.now() - 100, userMessageId: "msg_user_001" }),
      listMessages: async () => [
        assistantMsg({ completed: Date.now(), finish: "stop", text: "done!" }),
      ],
    };
    const replySender = {
      sendReply: async (event, text, opts) => { replies.push({ text, opts }); },
    };

    const analysis = new AsyncAnalysis({ client, replySender, config: {
      opencode: { poll_interval_ms: 10, poll_timeout_ms: 5000, tool_stuck_threshold_ms: 9999 },
      reply: {},
    }});

    const event = { chat_id: "c1", message_id: "m1" };
    await analysis.run(event, "s1", "analyze this");

    assert.equal(replies.length, 1);
    assert.ok(replies[0].text.includes("done!"));
    assert.ok(!replies[0].opts?.skipPrefix);
  });

  it("sends tool-stuck notice once when tool stays running beyond threshold", async () => {
    const replies = [];
    let callCount = 0;

    const client = {
      submitMessage: async () => ({ sessionId: "s1", submittedAt: Date.now() - 100, userMessageId: "msg_user_001" }),
      listMessages: async () => {
        callCount++;
        if (callCount < 4) {
          // simulate tool stuck
          return [assistantMsg({ toolStatus: "running" })];
        }
        // complete on 4th call
        return [assistantMsg({ completed: Date.now(), finish: "stop", text: "finally done" })];
      },
    };
    const replySender = {
      sendReply: async (event, text, opts) => { replies.push({ text, opts }); },
    };

    const analysis = new AsyncAnalysis({ client, replySender, config: {
      opencode: { poll_interval_ms: 10, poll_timeout_ms: 5000, tool_stuck_threshold_ms: 15 },
      reply: {},
    }});

    const event = { chat_id: "c1", message_id: "m1" };
    await analysis.run(event, "s1", "analyze this");

    const stuckReplies = replies.filter(r => r.text.includes("approval"));
    const finalReplies = replies.filter(r => r.text.includes("finally done"));

    assert.equal(stuckReplies.length, 1);
    assert.equal(stuckReplies[0].opts?.skipPrefix, true);
    assert.equal(finalReplies.length, 1);
  });

  it("sends timeout failure notice when poll_timeout_ms exceeded", async () => {
    const replies = [];
    const client = {
      submitMessage: async () => ({ sessionId: "s1", submittedAt: Date.now() - 100, userMessageId: null }),
      listMessages: async () => [],
    };
    const replySender = {
      sendReply: async (event, text, opts) => { replies.push({ text, opts }); },
    };

    const analysis = new AsyncAnalysis({ client, replySender, config: {
      opencode: { poll_interval_ms: 10, poll_timeout_ms: 50, tool_stuck_threshold_ms: 9999 },
      reply: {},
    }});

    const event = { chat_id: "c1", message_id: "m1" };
    await analysis.run(event, "s1", "analyze this");

    assert.equal(replies.length, 1);
    assert.ok(replies[0].text.includes("Still waiting") || replies[0].text.includes("timed out"));
    assert.equal(replies[0].opts?.skipPrefix, true);
  });

  it("does not send duplicate stuck notices", async () => {
    const replies = [];
    let callCount = 0;

    const client = {
      submitMessage: async () => ({ sessionId: "s1", submittedAt: Date.now() - 100, userMessageId: null }),
      listMessages: async () => {
        callCount++;
        if (callCount < 8) return [assistantMsg({ toolStatus: "running" })];
        return [assistantMsg({ completed: Date.now(), finish: "stop", text: "done" })];
      },
    };
    const replySender = {
      sendReply: async (event, text, opts) => { replies.push({ text, opts }); },
    };

    const analysis = new AsyncAnalysis({ client, replySender, config: {
      opencode: { poll_interval_ms: 10, poll_timeout_ms: 5000, tool_stuck_threshold_ms: 15 },
      reply: {},
    }});

    await analysis.run({ chat_id: "c1", message_id: "m1" }, "s1", "analyze this");

    const stuckReplies = replies.filter(r => r.text.includes("approval"));
    assert.equal(stuckReplies.length, 1);
  });

  it("fallback matching ignores candidates with no timestamp and returns latest if none match", async () => {
    const submittedAt = Date.now();
    const replies = [];

    const client = {
      submitMessage: async () => ({ sessionId: "s1", submittedAt, userMessageId: null }),
      listMessages: async () => [
        // Old message with no timestamp — should NOT match
        {
          info: { role: "assistant", time: {}, finish: "stop", parentID: null },
          parts: [{ type: "text", text: "stale answer" }],
        },
        // New message created after submission — should match
        {
          info: { role: "assistant", time: { created: submittedAt + 100, completed: submittedAt + 200 }, finish: "stop", parentID: null },
          parts: [{ type: "text", text: "fresh answer" }],
        },
      ],
    };
    const replySender = {
      sendReply: async (event, text, opts) => { replies.push({ text, opts }); },
    };

    const analysis = new AsyncAnalysis({ client, replySender, config: {
      opencode: { poll_interval_ms: 10, poll_timeout_ms: 5000, tool_stuck_threshold_ms: 9999 },
      reply: {},
    }});

    await analysis.run({ chat_id: "c1", message_id: "m1" }, "s1", "analyze this");

    assert.equal(replies.length, 1);
    assert.ok(replies[0].text.includes("fresh answer"), `Expected "fresh answer" but got: ${replies[0].text}`);
  });
});
