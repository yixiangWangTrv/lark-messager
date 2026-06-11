import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextFetcher } from "../lib/context-fetcher.js";
import { ReplySender } from "../lib/reply-sender.js";
import { loadConfig } from "../lib/config.js";

function writeTempConfig(config) {
  const tempDir = mkdtempSync(join(tmpdir(), "oncall-bot-config-"));
  const tempConfigPath = join(tempDir, "config.json");
  writeFileSync(tempConfigPath, JSON.stringify(config));
  return tempConfigPath;
}

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

  it("loads split-identity defaults from a minimal config fixture", () => {
    const config = loadConfig(writeTempConfig({
      opencode: { base_url: "http://localhost:3000" },
    }));

    assert.equal(config.lark.listen_identity, "bot");
    assert.equal(config.lark.context_identity, "user");
    assert.equal(config.lark.reply_identity, "bot");
    assert.equal(config.opencode.project_directory, process.cwd());
    assert.equal(config.opencode.analysis_timeout_ms, 600000);
  });

  it("defaults async polling config fields when not specified", () => {
    const config = loadConfig(writeTempConfig({
      opencode: { base_url: "http://localhost:3000" },
    }));

    assert.equal(config.opencode.submit_timeout_ms, 30000);
    assert.equal(config.opencode.poll_interval_ms, 3000);
    assert.equal(config.opencode.poll_timeout_ms, 1800000);
    assert.equal(config.opencode.tool_stuck_threshold_ms, 8000);
  });

  it("merges prompt defaults with partial prompt overrides", () => {
    const defaults = loadConfig(writeTempConfig({
      opencode: { base_url: "http://localhost:3000" },
    }));
    const config = loadConfig(writeTempConfig({
      opencode: { base_url: "http://localhost:3000" },
      prompt: {
        summary: {
          response_format: "Respond with a custom summary format.",
        },
      },
    }));

    assert.equal(config.prompt.summary.system_prefix, defaults.prompt.summary.system_prefix);
    assert.equal(config.prompt.summary.task_instructions, defaults.prompt.summary.task_instructions);
    assert.equal(config.prompt.summary.response_format, "Respond with a custom summary format.");
    assert.deepEqual(config.prompt.incident_analysis, defaults.prompt.incident_analysis);
    assert.deepEqual(config.prompt.pr_review, defaults.prompt.pr_review);
    assert.deepEqual(config.prompt.common_task, defaults.prompt.common_task);
    assert.equal(config.prompt.other, undefined);
    assert.equal(config.pua.intents.common_task, defaults.pua.intents.common_task);
  });

  it("preserves legacy lark.identity as a fallback for split identities", () => {
    const config = loadConfig(writeTempConfig({
      opencode: { base_url: "http://localhost:3000" },
      lark: { identity: "bot" },
    }));

    assert.equal(config.lark.identity, "bot");
    assert.equal(config.lark.listen_identity, "bot");
    assert.equal(config.lark.context_identity, "bot");
    assert.equal(config.lark.reply_identity, "bot");
  });

  it("can send replies without the default prefix", async () => {
    const calls = [];
    const replySender = new ReplySender({
      reply: {
        execFileAsync: async (file, args, options) => {
          calls.push({ file, args, options });
          return { stdout: "", stderr: "" };
        },
      },
      lark: { reply_identity: "bot" },
    });

    await replySender.sendReply(
      { message_id: "om_123", chat_id: "oc_456", content: "help" },
      "Processing your request now.",
      { skipPrefix: true }
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [
      "im", "+messages-reply",
      "--message-id", "om_123",
      "--markdown", "Processing your request now.",
      "--as", "bot",
    ]);
  });

  it("does not retry a reply after a timeout because the first send may already have succeeded", async () => {
    const calls = [];
    const timeoutError = new Error("Command timed out after 30000ms");
    timeoutError.code = "ETIMEDOUT";

    const replySender = new ReplySender({
      reply: {
        execFileAsync: async (file, args, options) => {
          calls.push({ file, args, options });
          throw timeoutError;
        },
      },
      lark: { reply_identity: "bot" },
    });

    await replySender.sendReply(
      { message_id: "om_456", chat_id: "oc_456", content: "help" },
      "final result"
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [
      "im", "+messages-reply",
      "--message-id", "om_456",
      "--markdown", "🤖 **[AI-Assisted Reply]**\n\nfinal result",
      "--as", "bot",
    ]);
  });
});
