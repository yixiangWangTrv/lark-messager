import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MessageFilter } from "../lib/message-filter.js";

const events = JSON.parse(readFileSync(new URL("./fixtures/sample-events.json", import.meta.url), "utf-8"));

describe("MessageFilter", () => {
  const config = {
    lark: {
      watch_chat_ids: [],
      trigger: {
        bot_id: "ou_bot1",
        bot_name: "OncallBot",
        user_ids: ["ou_sender1"],
        user_names: ["张三"],
        group_ids: ["ou_sender1", "ou_sender2"],
        group_names: ["李四"],
      },
    },
  };

  it("triggers on @bot mention in group text message", () => {
    const filter = new MessageFilter(config);
    assert.equal(filter.shouldTrigger(events[0]), true);
  });

  it("does NOT trigger on message without any mention", () => {
    const filter = new MessageFilter(config);
    assert.equal(filter.shouldTrigger(events[1]), false);
  });

  it("does NOT trigger on p2p messages", () => {
    const filter = new MessageFilter(config);
    assert.equal(filter.shouldTrigger(events[2]), false);
  });

  it("does NOT trigger on non-text message types", () => {
    const filter = new MessageFilter(config);
    assert.equal(filter.shouldTrigger(events[3]), false);
  });

  it("triggers when @group member is mentioned", () => {
    const filter = new MessageFilter(config);
    assert.equal(filter.shouldTrigger(events[4]), true);
  });

  it("does NOT trigger on unwatched chats when watch_chat_ids is set", () => {
    const restrictedFilter = new MessageFilter({
      lark: {
        watch_chat_ids: ["oc_chat99"],
        trigger: config.lark.trigger,
      },
    });
    assert.equal(restrictedFilter.shouldTrigger(events[0]), false);
  });

  it("deduplicates same message_id", () => {
    const filter = new MessageFilter(config);
    assert.equal(filter.shouldTrigger(events[0]), true);
    assert.equal(filter.shouldTrigger(events[0]), false); // second time
  });
});
