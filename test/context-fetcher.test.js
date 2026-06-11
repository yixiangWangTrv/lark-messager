import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContextFetcher } from "../lib/context-fetcher.js";

describe("ContextFetcher", () => {
  it("extracts text from Lark JSON text content", () => {
    const fetcher = new ContextFetcher({ context: {}, lark: {} });

    const text = fetcher._extractContent({
      msg_type: "text",
      body: {
        content: '{"text":"payment-service error rate is spiking"}',
      },
    });

    assert.equal(text, "payment-service error rate is spiking");
  });

  it("extracts plain text from post content blocks", () => {
    const fetcher = new ContextFetcher({ context: {}, lark: {} });

    const text = fetcher._extractContent({
      msg_type: "post",
      body: {
        content: JSON.stringify({
          zh_cn: {
            content: [
              [
                { tag: "text", text: "please analyze" },
                { tag: "at", user_id: "ou_xxx", user_name: "OncallBot" },
              ],
            ],
          },
        }),
      },
    });

    assert.equal(text, "please analyze @OncallBot");
  });

  it("fetches only thread messages when thread_id is present", async () => {
    const calls = [];
    const fetcher = new ContextFetcher({
      context: { message_count: 10 },
      lark: { context_identity: "user" },
      contextFetcherExec: async (_bin, args) => {
        calls.push(args);
        return {
          stdout: JSON.stringify({
            data: {
              messages: [
                {
                  create_time: "1700000000000",
                  sender: { name: "Thread User" },
                  msg_type: "text",
                  body: { content: '{"text":"hello from thread"}' },
                },
              ],
            },
          }),
        };
      },
    });

    const result = await fetcher.fetchContext({
      chatId: "oc_chat1",
      threadId: "omt-thread-1",
      beforeTimestamp: "1700000010000",
      triggerMessage: "hi",
    });

    assert.equal(result.scope, "thread");
    assert.equal(result.threadId, "omt-thread-1");
    assert.equal(result.fetchFailed, false);
    assert.equal(result.messages.length, 1);
    assert.match(
      result.messages[0],
      /^\[\d{2}\/\d{2} \d{2}:\d{2}\] Thread User: hello from thread$/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "im");
    assert.equal(calls[0][1], "+threads-messages-list");
    assert.ok(calls[0].includes("--thread"));
    assert.ok(calls[0].includes("omt-thread-1"));
    assert.ok(!calls[0].includes("--chat-id"));
    assert.ok(!calls[0].includes("--thread-id"));
  });

  it("falls back to trigger_only when thread fetch fails", async () => {
    const calls = [];
    const fetcher = new ContextFetcher({
      context: { message_count: 10 },
      lark: { context_identity: "user" },
      contextFetcherExec: async (_bin, args) => {
        calls.push(args);
        throw new Error("thread fetch failed");
      },
    });

    const result = await fetcher.fetchContext({
      chatId: "oc_chat1",
      threadId: "omt-thread-2",
      beforeTimestamp: "1700000010000",
      triggerMessage: "hi",
    });

    assert.equal(result.scope, "trigger_only");
    assert.equal(result.threadId, "omt-thread-2");
    assert.equal(result.fetchFailed, true);
    assert.deepEqual(result.messages, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "im");
    assert.equal(calls[0][1], "+threads-messages-list");
    assert.ok(calls[0].includes("--thread"));
    assert.ok(calls[0].includes("omt-thread-2"));
    assert.ok(!calls[0].includes("--chat-id"));
    assert.ok(!calls[0].includes("--thread-id"));
  });

  it("fetches chat messages for structured non-thread input", async () => {
    const calls = [];
    const fetcher = new ContextFetcher({
      context: { message_count: 10 },
      lark: { context_identity: "user" },
      contextFetcherExec: async (_bin, args) => {
        calls.push(args);
        return {
          stdout: JSON.stringify({
            data: {
              messages: [
                {
                  create_time: "1700000000000",
                  sender: { name: "Chat User" },
                  msg_type: "text",
                  body: { content: '{"text":"hello from chat"}' },
                },
              ],
            },
          }),
        };
      },
    });

    const result = await fetcher.fetchContext({
      chatId: "oc_chat1",
      beforeTimestamp: "1700000010000",
      triggerMessage: "hi",
    });

    assert.equal(result.scope, "chat");
    assert.equal(result.threadId, null);
    assert.equal(result.fetchFailed, false);
    assert.equal(result.messages.length, 1);
    assert.match(
      result.messages[0],
      /^\[\d{2}\/\d{2} \d{2}:\d{2}\] Chat User: hello from chat$/,
    );
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("--chat-id"));
    assert.ok(calls[0].includes("oc_chat1"));
    assert.ok(!calls[0].includes("--thread-id"));
  });

  it("resolves an om thread reference to the real thread_id via chat-messages-list before listing thread messages", async () => {
    const calls = [];
    const fetcher = new ContextFetcher({
      context: { message_count: 10 },
      lark: { context_identity: "user" },
      contextFetcherExec: async (_bin, args) => {
        calls.push(args);

        if (args[1] === "+chat-messages-list") {
          return {
            stdout: JSON.stringify({
              data: {
                messages: [
                  {
                    message_id: "om_root_1",
                    thread_id: "omt-real-1",
                    create_time: "1700000000000",
                    sender: { name: "Root User" },
                    msg_type: "text",
                    body: { content: '{"text":"root msg"}' },
                    thread_replies: [
                      {
                        message_id: "om_reply_in_thread",
                        thread_id: "omt-real-1",
                        create_time: "1700000005000",
                        sender: { name: "Thread User" },
                        msg_type: "text",
                        body: { content: '{"text":"reply in thread"}' },
                      },
                    ],
                  },
                ],
              },
            }),
          };
        }

        if (args[1] === "+threads-messages-list") {
          return {
            stdout: JSON.stringify({
              data: {
                messages: [
                  {
                    create_time: "1700000000000",
                    sender: { name: "Thread User" },
                    msg_type: "text",
                    body: { content: '{"text":"resolved thread message"}' },
                  },
                ],
              },
            }),
          };
        }

        return { stdout: "{}" };
      },
    });

    const result = await fetcher.fetchContext({
      chatId: "oc_chat1",
      threadId: "om_reply_in_thread",
      beforeTimestamp: "1700000010000",
      triggerMessage: "hi",
    });

    assert.equal(result.scope, "thread");
    assert.equal(result.threadId, "omt-real-1");
    assert.equal(result.fetchFailed, false);
    assert.ok(result.messages.length >= 1);
    // Root message should be included
    assert.ok(result.messages.some(m => m.includes("root msg") || m.includes("Root User")));
    assert.equal(calls.length, 2);
    assert.equal(calls[0][1], "+chat-messages-list");
    assert.ok(calls[0].includes("--chat-id"));
    assert.ok(calls[0].includes("oc_chat1"));
    assert.equal(calls[1][1], "+threads-messages-list");
    assert.ok(calls[1].includes("--thread"));
    assert.ok(calls[1].includes("omt-real-1"));
  });

  it("falls back to chat context when threadLookupMessageId does not resolve to a thread", async () => {
    const calls = [];
    const fetcher = new ContextFetcher({
      context: { message_count: 10, include_sender_name: true },
      lark: { context_identity: "user" },
      contextFetcherExec: async (_command, args) => {
        calls.push(args);

        if (args[1] === "+chat-messages-list") {
          return {
            stdout: JSON.stringify({
              data: {
                messages: [
                  {
                    message_id: "om_top_1",
                    create_time: "1700000000000",
                    sender: { name: "Top User" },
                    msg_type: "text",
                    body: { content: '{"text":"plain top-level message"}' },
                  },
                ],
              },
            }),
          };
        }

        throw new Error(`unexpected args: ${args.join(" ")}`);
      },
    });

    const result = await fetcher.fetchContext({
      chatId: "oc_chat1",
      threadId: null,
      threadLookupMessageId: "om_top_1",
      beforeTimestamp: "1700000010000",
      triggerMessage: "plain top-level message",
    });

    assert.equal(result.scope, "chat");
    assert.equal(result.threadId, null);
    assert.equal(result.fetchFailed, false);
    assert.ok(result.messages.some((m) => m.includes("plain top-level message")));
    assert.equal(calls.length, 2);
    assert.equal(calls[0][1], "+chat-messages-list");
    assert.equal(calls[1][1], "+chat-messages-list");
  });
});
