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
  common_task: {
    system_prefix: "You answer the user's chat request.",
    task_instructions: "Answer directly from context. No Datadog unless explicitly asked.",
    response_format: "Keep it concise.",
  },
};

const routingConfig = {
  summary: {
    keywords: ["summary", "summarize", "summarise", "总结", "总结上面", "总结上面的对话"],
  },
  incident_analysis: {
    keywords: ["incident", "error", "failure", "failing", "broken", "debug", "investigate", "排查", "报错", "故障", "异常"],
  },
  pr_review: {
    keywords: ["review pr", "code review"],
    use_github_pr_url: true,
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

  it("does not use recent incident context alone for vague follow-ups", () => {
    const event = { content: "can you take a look?" };
    const contextLines = ["[06/09 15:07] user: payment-service is failing with 500 errors"];

    assert.equal(detectIntent(event, contextLines), "common_task");
  });

  it("keeps a neutral trigger as common_task even when context contains incident keywords", () => {
    const event = { content: "hi" };
    const contextLines = ["[06/09 15:07] user: payment-service is failing with 500 errors"];

    assert.equal(detectIntent(event, contextLines), "common_task");
  });

  it("still detects incident_analysis when trigger text itself asks for investigation", () => {
    const event = { content: "hi, help me investigate this error" };
    const contextLines = [];

    assert.equal(detectIntent(event, contextLines), "incident_analysis");
  });

  it("falls back to common_task for generic requests", () => {
    const event = { content: "把上面的内容翻译成英文" };

    assert.equal(detectIntent(event, []), "common_task");
  });

  it("uses config-backed routing keywords from the third detectIntent argument", () => {
    const event = { content: "please triage this flaky rollout" };
    const customRoutingConfig = {
      ...routingConfig,
      incident_analysis: {
        keywords: ["rollout", "triage"],
      },
    };

    assert.equal(detectIntent(event, [], customRoutingConfig), "incident_analysis");
  });

  it("optionally detects pr_review from configured keywords", () => {
    const event = { content: "please do a code review for this change" };

    assert.equal(detectIntent(event, [], routingConfig), "pr_review");
  });

  it("prioritizes configured pr_review keywords over incident keywords when both match", () => {
    const event = { content: "please do a code review of this error handling change" };

    assert.equal(detectIntent(event, [], routingConfig), "pr_review");
  });

  it("builds a summary prompt without Datadog instructions", () => {
    const prompt = buildIntentPrompt({
      intent: "summary",
      promptConfig,
      event: {
        content: "总结上面的对话",
        sender_id: "ou_summary",
        chat_id: "oc_summary",
        message_id: "om_summary",
      },
      contextResult: {
        messages: ["[06/09 15:07] Yixiang: hello"],
        scope: "chat",
        threadId: null,
        fetchFailed: false,
      },
      sessionState: "new",
    });

    assert.match(prompt, /Summarize only/);
    assert.match(prompt, /Do not use Datadog/);
    assert.doesNotMatch(prompt, /Use Datadog to investigate incidents/);
    assert.match(prompt, /Read trigger metadata first before using any context\./);
  });

  it("builds a new-session prompt with trigger metadata and context scope", () => {
    const prompt = buildIntentPrompt({
      intent: "common_task",
      promptConfig,
      event: {
        content: "hi",
        sender_id: "ou_user1",
        chat_id: "oc_chat1",
        message_id: "om_1",
        thread_id: "omt_1",
      },
      contextResult: {
        messages: ["[06/09 15:07] user: hi there"],
        scope: "thread",
        threadId: "omt_1",
        fetchFailed: false,
      },
      sessionState: "new",
    });

    assert.match(prompt, /^You answer the user's chat request\./);
    assert.match(prompt, /Answer directly from context\. No Datadog unless explicitly asked\./);
    assert.match(prompt, /Keep it concise\./);
    assert.match(prompt, /Do not trigger deployments, restarts, service starts, GitHub Actions\/workflow runs, CI\/CD pipelines, AWS deployments/);
    assert.match(prompt, /Read trigger metadata first before using any context\. Use only the declared context scope\./);
    assert.match(prompt, /This trigger came from a thread\. Use only thread context\. Do not use main-chat context\./);
    assert.match(prompt, /Trigger metadata:/);
    assert.match(prompt, /sender_id: ou_user1/);
    assert.match(prompt, /chat_id: oc_chat1/);
    assert.match(prompt, /message_id: om_1/);
    assert.match(prompt, /thread_id: omt_1/);
    assert.match(prompt, /is_thread_message: true/);
    assert.match(prompt, /session_state: new/);
    assert.match(prompt, /context_scope: thread/);
    assert.match(prompt, /intent: common_task/);
    assert.match(prompt, /Context:\n\[06\/09 15:07\] user: hi there/);
    assert.match(prompt, /User request:\nhi$/);
  });

  it("builds a common_task prompt from the fallback prompt config", () => {
    const prompt = buildIntentPrompt({
      intent: "common_task",
      promptConfig,
      event: {
        content: "translate this",
        sender_id: "ou_common",
        chat_id: "oc_common",
        message_id: "om_common",
      },
      contextResult: {
        messages: ["[06/09 15:10] user: 把上面的内容翻译成英文"],
        scope: "chat",
        threadId: null,
        fetchFailed: false,
      },
      sessionState: "new",
    });

    assert.match(prompt, /^You answer the user's chat request\./);
    assert.match(prompt, /Answer directly from context\. No Datadog unless explicitly asked\./);
    assert.match(prompt, /Keep it concise\./);
    assert.doesNotMatch(prompt, /Use Datadog to investigate incidents\./);
  });

  it("builds an existing-session continuation prompt without the full initial framing", () => {
    const prompt = buildIntentPrompt({
      intent: "incident_analysis",
      promptConfig,
      event: {
        content: "please investigate this",
        sender_id: "ou_user2",
        chat_id: "oc_chat1",
        message_id: "om_2",
      },
      contextResult: {
        messages: ["[06/09 15:07] user: service is failing"],
        scope: "chat",
        threadId: null,
        fetchFailed: false,
      },
      sessionState: "existing",
    });

    assert.match(prompt, /A new trigger message has arrived in this existing session\./);
    assert.match(prompt, /Do not trigger deployments, restarts, service starts, GitHub Actions\/workflow runs, CI\/CD pipelines, AWS deployments/);
    assert.match(prompt, /Re-evaluate the new trigger first\. Use only the declared context scope\./);
    assert.match(prompt, /Read trigger metadata first before using any context\./);
    assert.match(prompt, /sender_id: ou_user2/);
    assert.match(prompt, /chat_id: oc_chat1/);
    assert.match(prompt, /message_id: om_2/);
    assert.doesNotMatch(prompt, /thread_id:/);
    assert.match(prompt, /is_thread_message: false/);
    assert.match(prompt, /session_state: existing/);
    assert.match(prompt, /context_scope: chat/);
    assert.match(prompt, /intent: incident_analysis/);
    assert.match(prompt, /Context:\n\[06\/09 15:07\] user: service is failing/);
    assert.match(prompt, /User request:\nplease investigate this$/);
    assert.doesNotMatch(prompt, /^You are an on-call assistant\./);
    assert.doesNotMatch(prompt, /Use Datadog to investigate incidents\./);
  });

  it("injects knowledge base context before chat context", () => {
    const prompt = buildIntentPrompt({
      intent: "common_task",
      promptConfig,
      event: {
        content: "answer with the docs",
        sender_id: "ou_user3",
        chat_id: "oc_chat2",
        message_id: "om_3",
      },
      contextResult: {
        messages: ["[06/09 15:08] user: what does the runbook say?"],
        scope: "chat",
        threadId: null,
        fetchFailed: false,
      },
      knowledgeBase: {
        enabled: true,
        items: [
          {
            id: "kb_1",
            enabled: true,
            name: "Runbook",
            description: "Primary incident steps",
            source_type: "free_text",
            source: {},
            content: {
              mode: "inline_text",
              text: "Step 1: page the owner.",
            },
          },
        ],
      },
      sessionState: "new",
    });

    const metadataIndex = prompt.indexOf("Trigger metadata:");
    const knowledgeBaseIndex = prompt.indexOf("Knowledge base context:");
    const contextIndex = prompt.indexOf("Context:\n[06/09 15:08] user: what does the runbook say?");

    assert.notEqual(metadataIndex, -1);
    assert.notEqual(knowledgeBaseIndex, -1);
    assert.notEqual(contextIndex, -1);
    assert.ok(metadataIndex < knowledgeBaseIndex);
    assert.ok(knowledgeBaseIndex < contextIndex);
  });

  it("injects nothing when knowledge base is disabled", () => {
    const prompt = buildIntentPrompt({
      intent: "common_task",
      promptConfig,
      event: {
        content: "answer directly",
        sender_id: "ou_user4",
        chat_id: "oc_chat2",
        message_id: "om_4",
      },
      contextResult: {
        messages: ["[06/09 15:09] user: please help"],
        scope: "chat",
        threadId: null,
        fetchFailed: false,
      },
      knowledgeBase: {
        enabled: false,
        items: [
          {
            id: "kb_2",
            enabled: true,
            name: "Disabled runbook",
            source_type: "free_text",
            source: {},
            content: {
              mode: "inline_text",
              text: "This should not appear.",
            },
          },
        ],
      },
      sessionState: "new",
    });

    assert.doesNotMatch(prompt, /Knowledge base context:/);
    assert.doesNotMatch(prompt, /This should not appear\./);
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

  it("reuses session for same thread when threadId is provided (common_task intent)", () => {
    const options = buildSessionOptions({
      intent: "common_task",
      chatId: "oc_chat1",
      chatName: "Ops Room",
      today: "2026-06-09",
      triggerMessageId: "om_200",
      triggerContent: "follow-up question",
      threadId: "omt_thread_abc",
    });

    assert.deepEqual(options, {
      title: "Ops Room-common-task-2026-06-09-read_abc",
      cacheKey: "common_task:oc_chat1:omt_thread_abc",
      reuse: true,
    });
  });

  it("creates fresh session when no threadId (common_task intent, top-level message)", () => {
    const options = buildSessionOptions({
      intent: "common_task",
      chatId: "oc_chat1",
      chatName: "Ops Room",
      today: "2026-06-09",
      triggerMessageId: "om_300",
      triggerContent: "random question",
      threadId: null,
    });

    assert.deepEqual(options, {
      title: "Ops Room-common-task-2026-06-09",
      cacheKey: "common_task:oc_chat1:om_300",
      reuse: false,
    });
  });
});
