import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectIntent,
  buildIntentPrompt,
  buildSessionOptions,
} from "../lib/intent-router.js";

const promptConfig = {
  summary: {
    system_prefix: "You summarize conversation context.",
    task_instructions: "Summarize only. Do not use Datadog.",
    response_format: "Respond briefly.",
  },
  incident_analysis: {
    system_prefix: "You are an on-call assistant.",
    task_instructions: "Use Datadog to investigate incidents.",
    response_format: "Respond in English.",
  },
  pr_review: {
    system_prefix: "You review pull requests from chat requests.",
    task_instructions: "Review the PR. Do not use Datadog unless explicitly requested.",
    response_format: "List risks and next actions.",
  },
  other: {
    system_prefix: "You answer the user's chat request.",
    task_instructions: "Answer directly from context. No Datadog unless explicitly asked.",
    response_format: "Keep it concise.",
  },
};

describe("intent routing", () => {
  it("detects pr_review before incident keywords when PR URL exists", () => {
    const event = {
      content: "Please review this PR https://github.com/acme/api/pull/42 and check risks",
    };

    assert.equal(detectIntent(event, []), "pr_review");
  });

  it("detects summary intent from summary keywords", () => {
    const event = { content: "总结上面的对话，简短一些" };

    assert.equal(detectIntent(event, []), "summary");
  });

  it("detects incident_analysis from failure language", () => {
    const event = { content: "帮我排查 payment-service 报错" };

    assert.equal(detectIntent(event, []), "incident_analysis");
  });

  it("uses recent incident context as a weak signal for vague follow-ups", () => {
    const event = { content: "can you take a look?" };
    const contextLines = ["[06/09 15:07] user: payment-service is failing with 500 errors"];

    assert.equal(detectIntent(event, contextLines), "incident_analysis");
  });

  it("falls back to other for generic requests", () => {
    const event = { content: "把上面的内容翻译成英文" };

    assert.equal(detectIntent(event, []), "other");
  });

  it("builds a summary prompt without Datadog instructions", () => {
    const prompt = buildIntentPrompt(
      "summary",
      promptConfig,
      { content: "总结上面的对话" },
      ["[06/09 15:07] Yixiang: hello"],
    );

    assert.match(prompt, /Summarize only/);
    assert.match(prompt, /Do not use Datadog/);
    assert.doesNotMatch(prompt, /Use Datadog to investigate incidents/);
  });

  it("builds prompt sections with config, context, and trigger message", () => {
    const prompt = buildIntentPrompt(
      "incident_analysis",
      promptConfig,
      { content: "please investigate this" },
      ["[06/09 15:07] user: payment-service is failing"],
    );

    assert.match(prompt, /^You are an on-call assistant\./);
    assert.match(prompt, /Use Datadog to investigate incidents\./);
    assert.match(prompt, /Respond in English\./);
    assert.match(prompt, /Context:\n\[06\/09 15:07\] user: payment-service is failing/);
    assert.match(prompt, /User request:\nplease investigate this$/);
  });

  it("builds incident session options that reuse by chat and day", () => {
    const options = buildSessionOptions({
      intent: "incident_analysis",
      chatId: "oc_chat1",
      chatName: "Ops Room",
      today: "2026-06-09",
      triggerMessageId: "om_1",
      triggerContent: "排查报错",
    });

    assert.deepEqual(options, {
      title: "Ops Room-incident-2026-06-09",
      cacheKey: "incident_analysis:oc_chat1:2026-06-09",
      reuse: true,
    });
  });

  it("builds summary session options that always create a fresh session", () => {
    const options = buildSessionOptions({
      intent: "summary",
      chatId: "oc_chat1",
      chatName: "Ops Room",
      today: "2026-06-09",
      triggerMessageId: "om_99",
      triggerContent: "总结",
    });

    assert.deepEqual(options, {
      title: "Ops Room-summary-2026-06-09",
      cacheKey: "summary:oc_chat1:om_99",
      reuse: false,
    });
  });

  it("reuses pr review sessions only when the same PR URL exists", () => {
    const options = buildSessionOptions({
      intent: "pr_review",
      chatId: "oc_chat1",
      chatName: "Ops Room",
      today: "2026-06-09",
      triggerMessageId: "om_77",
      triggerContent: "review https://github.com/acme/api/pull/42",
    });

    assert.deepEqual(options, {
      title: "Ops Room-pr-review-2026-06-09",
      cacheKey: "pr_review:oc_chat1:https://github.com/acme/api/pull/42",
      reuse: true,
    });
  });
});
