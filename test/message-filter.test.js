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
      trigger_modes: {
        mention_bot: true,
        mention_owner: true,
        all_messages: false,
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
        trigger_modes: config.lark.trigger_modes,
      },
    });
    assert.equal(restrictedFilter.shouldTrigger(events[0]), false);
  });

  it("deduplicates same message_id", () => {
    const filter = new MessageFilter(config);
    assert.equal(filter.shouldTrigger(events[0]), true);
    assert.equal(filter.shouldTrigger(events[0]), false); // second time
  });

  // New trigger_modes tests
  describe("trigger_modes", () => {
    it("does NOT trigger @bot when mention_bot is disabled", () => {
      const filter = new MessageFilter({
        lark: {
          watch_chat_ids: [],
          trigger: config.lark.trigger,
          trigger_modes: { mention_bot: false, mention_owner: true, all_messages: false },
        },
      });
      assert.equal(filter.shouldTrigger(events[0]), false); // @OncallBot
    });

    it("does NOT trigger @owner when mention_owner is disabled", () => {
      const filter = new MessageFilter({
        lark: {
          watch_chat_ids: [],
          trigger: { ...config.lark.trigger, group_names: [] },
          trigger_modes: { mention_bot: false, mention_owner: false, all_messages: false },
        },
      });
      // events[4] mentions @张三 (user_name) and @李四 (group_name)
      // With mention_owner disabled and group_names empty, @张三 should not trigger
      const event = { ...events[4], content: "@张三 看下这个问题", message_id: "om_unique1" };
      assert.equal(filter.shouldTrigger(event), false);
    });

    it("triggers ALL messages when all_messages mode is enabled", () => {
      const filter = new MessageFilter({
        lark: {
          watch_chat_ids: [],
          trigger: config.lark.trigger,
          trigger_modes: { mention_bot: false, mention_owner: false, all_messages: true },
        },
      });
      // events[1] has no mention at all — "这个问题我看看"
      assert.equal(filter.shouldTrigger(events[1]), true);
    });

    it("does NOT trigger when all modes are disabled", () => {
      const filter = new MessageFilter({
        lark: {
          watch_chat_ids: [],
          trigger: { ...config.lark.trigger, group_names: [] },
          trigger_modes: { mention_bot: false, mention_owner: false, all_messages: false },
        },
      });
      assert.equal(filter.shouldTrigger(events[0]), false); // @OncallBot
      const noMention = { ...events[1], message_id: "om_unique2" };
      assert.equal(filter.shouldTrigger(noMention), false); // plain msg
    });

    it("triggers @bot even when mention_owner is disabled", () => {
      const filter = new MessageFilter({
        lark: {
          watch_chat_ids: [],
          trigger: config.lark.trigger,
          trigger_modes: { mention_bot: true, mention_owner: false, all_messages: false },
        },
      });
      assert.equal(filter.shouldTrigger(events[0]), true); // @OncallBot
    });
  });
});
