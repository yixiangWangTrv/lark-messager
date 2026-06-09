import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.js";
import {
  getProcessingNotice,
  getThreadOnlyNotice,
  getTriggerOnlyFallbackNotice,
  shouldSendProcessingNotice,
} from "../lib/processing-notice.js";

describe("processing notice", () => {
  it("uses the English default processing notice", () => {
    const config = loadConfig(fileURLToPath(new URL("../oncall-bot.config.json", import.meta.url)));

    assert.equal(
      getProcessingNotice(config),
      "Processing your request now. If OpenCode requires approval, the final reply may take a bit longer."
    );
    assert.equal(shouldSendProcessingNotice(config), true);
  });

  it("allows disabling the processing notice", () => {
    assert.equal(shouldSendProcessingNotice({ reply: { send_processing_notice: false } }), false);
  });

  it("uses the default thread-only notice", () => {
    const config = loadConfig(fileURLToPath(new URL("../oncall-bot.config.json", import.meta.url)));

    assert.equal(
      getThreadOnlyNotice(config),
      "This message was sent in a thread. I will only use messages from this thread as context."
    );
  });

  it("uses the default trigger-only fallback notice", () => {
    const config = loadConfig(fileURLToPath(new URL("../oncall-bot.config.json", import.meta.url)));

    assert.equal(
      getTriggerOnlyFallbackNotice(config),
      "I could not load thread history, so I will use only the trigger message itself."
    );
  });
});
