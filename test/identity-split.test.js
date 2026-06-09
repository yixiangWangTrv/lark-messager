import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContextFetcher } from "../lib/context-fetcher.js";
import { ReplySender } from "../lib/reply-sender.js";
import { loadConfig } from "../lib/config.js";

describe("identity split", () => {
  it("uses context identity for fetching and bot identity for replies", () => {
    const config = {
      context: {},
      reply: {},
      lark: {
        listen_identity: "bot",
        context_identity: "user",
        reply_identity: "bot",
      },
    };

    const contextFetcher = new ContextFetcher(config);
    const replySender = new ReplySender(config);

    assert.equal(contextFetcher.identity, "user");
    assert.equal(replySender.identity, "bot");
  });

  it("loads config defaults with separate context identity", () => {
    const config = loadConfig("/Users/yixiang.wang/oncall-bot/oncall-bot.config.json");

    assert.equal(config.lark.listen_identity, "bot");
    assert.equal(config.lark.context_identity, "user");
    assert.equal(config.lark.reply_identity, "bot");
  });
});
