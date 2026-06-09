import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processTrigger } from "../lib/trigger-orchestration.js";

const baseConfig = {
  reply: {
    send_processing_notice: true,
    processing_notice: "Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.",
    thread_only_notice: "This message was sent in a thread. I will only use messages from this thread as context.",
    trigger_only_fallback_notice: "I could not load thread history, so I will use only the trigger message itself.",
  },
  prompt: {
    other: {
      system_prefix: "You answer the user's chat request.",
      task_instructions: "Answer directly from context.",
      response_format: "Keep it concise.",
    },
  },
};

describe("handleTrigger orchestration", () => {
  it("sends processing notice, thread-only notice, and passes session/context metadata", async () => {
    const fixedToday = "2026-06-09";
    const replies = [];
    const sentPrompts = [];
    const steps = [];
    const queueCalls = [];
    const fetchCalls = [];
    const detectIntentCalls = [];
    const sessionOptionsCalls = [];
    const promptBuildCalls = [];

    const event = {
      chat_id: "oc_chat1",
      message_id: "om_1",
      sender_id: "ou_user1",
      thread_id: "omt_1",
      content: "hi",
      create_time: "1700000010000",
    };

    const contextFetcher = {
      fetchContext: async (input) => {
        steps.push("fetchContext");
        fetchCalls.push(input);
        return {
          messages: ["[06/09 15:07] user: hi there"],
          scope: "thread",
          threadId: "omt_1",
          fetchFailed: false,
        };
      },
      getChatName: async () => {
        steps.push("getChatName");
        return "Ops Room";
      },
    };

    const opencode = {
      findOrCreateSession: async () => {
        steps.push("findOrCreateSession");
        return { sessionId: "session-1", sessionState: "existing" };
      },
      sendMessage: async (_sessionId, prompt) => {
        steps.push("sendMessage");
        sentPrompts.push(prompt);
        return "ok";
      },
    };

    const replySender = {
      sendReply: async (_event, text, options) => {
        steps.push(`reply:${text}`);
        replies.push({ text, options });
      },
    };

    const queue = {
      enqueue(chatId, task) {
        queueCalls.push(chatId);
        return task();
      },
    };

    const detectIntentFn = (receivedEvent, messages) => {
      detectIntentCalls.push({ receivedEvent, messages });
      return "other";
    };

    const buildSessionOptionsFn = (options) => {
      sessionOptionsCalls.push(options);
      return {
        title: "Ops Room-other-2026-06-09",
        cacheKey: "other:oc_chat1:om_1",
        reuse: false,
      };
    };

    const buildIntentPromptFn = (options) => {
      promptBuildCalls.push(options);
      return "prompt for existing session";
    };

    await processTrigger({
      event,
      config: baseConfig,
      queue,
      contextFetcher,
      opencode,
      replySender,
      detectIntentFn,
      buildSessionOptionsFn,
      buildIntentPromptFn,
      getTodayFn: () => fixedToday,
    });

    assert.deepEqual(queueCalls, ["oc_chat1"]);
    assert.deepEqual(steps, [
      "reply:Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.",
      "reply:This message was sent in a thread. I will only use messages from this thread as context.",
      "fetchContext",
      "getChatName",
      "findOrCreateSession",
      "sendMessage",
      "reply:ok",
    ]);
    assert.deepEqual(fetchCalls, [{
      chatId: "oc_chat1",
      threadId: "omt_1",
      beforeTimestamp: "1700000010000",
      triggerMessage: "hi",
    }]);
    assert.deepEqual(detectIntentCalls, [{
      receivedEvent: event,
      messages: ["[06/09 15:07] user: hi there"],
    }]);
    assert.deepEqual(sessionOptionsCalls, [{
      intent: "other",
      chatId: "oc_chat1",
      chatName: "Ops Room",
      today: fixedToday,
      triggerMessageId: "om_1",
      triggerContent: "hi",
    }]);
    assert.deepEqual(promptBuildCalls, [{
      intent: "other",
      promptConfig: baseConfig.prompt,
      event,
      contextResult: {
        messages: ["[06/09 15:07] user: hi there"],
        scope: "thread",
        threadId: "omt_1",
        fetchFailed: false,
      },
      sessionState: "existing",
    }]);
    assert.deepEqual(sentPrompts, ["prompt for existing session"]);
    assert.deepEqual(replies, [
      {
        text: "Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.",
        options: { skipPrefix: true },
      },
      {
        text: "This message was sent in a thread. I will only use messages from this thread as context.",
        options: { skipPrefix: true },
      },
      {
        text: "ok",
        options: undefined,
      },
    ]);
  });

  it("sends the trigger-only fallback notice when thread history is unavailable", async () => {
    const fixedToday = "2026-06-09";
    const replies = [];
    const steps = [];

    const event = {
      chat_id: "oc_chat1",
      message_id: "om_2",
      sender_id: "ou_user1",
      thread_id: "omt_2",
      content: "help",
      create_time: "1700000010000",
    };

    const queue = {
      enqueue(_chatId, task) {
        return task();
      },
    };

    const contextFetcher = {
      fetchContext: async () => {
        steps.push("fetchContext");
        return {
          messages: [],
          scope: "trigger_only",
          threadId: "omt_2",
          fetchFailed: true,
        };
      },
      getChatName: async () => "Ops Room",
    };

    const opencode = {
      findOrCreateSession: async () => ({ sessionId: "session-2", sessionState: "new" }),
      sendMessage: async () => "fallback analysis",
    };

    const replySender = {
      sendReply: async (_event, text, options) => {
        steps.push(`reply:${text}`);
        replies.push({ text, options });
      },
    };

    await processTrigger({
      event,
      config: baseConfig,
      queue,
      contextFetcher,
      opencode,
      replySender,
      detectIntentFn: () => "other",
      buildSessionOptionsFn: () => ({ title: "t", cacheKey: "k", reuse: false }),
      buildIntentPromptFn: () => "prompt",
      getTodayFn: () => fixedToday,
    });

    assert.deepEqual(steps, [
      "reply:Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.",
      "reply:This message was sent in a thread. I will only use messages from this thread as context.",
      "fetchContext",
      "reply:I could not load thread history, so I will use only the trigger message itself.",
      "reply:fallback analysis",
    ]);

    assert.deepEqual(replies, [
      {
        text: "Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.",
        options: { skipPrefix: true },
      },
      {
        text: "This message was sent in a thread. I will only use messages from this thread as context.",
        options: { skipPrefix: true },
      },
      {
        text: "I could not load thread history, so I will use only the trigger message itself.",
        options: { skipPrefix: true },
      },
      {
        text: "fallback analysis",
        options: undefined,
      },
    ]);
  });
});
