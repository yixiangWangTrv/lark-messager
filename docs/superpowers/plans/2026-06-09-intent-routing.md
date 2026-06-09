# Intent Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route oncall-bot triggers into `summary`, `incident_analysis`, `pr_review`, or `other`, use intent-specific prompts, and keep non-incident work out of reused or archived sessions.

**Architecture:** Extract trigger classification and prompt/session policy into a small routing module, then make `oncall-bot.js` ask that module for `intent`, `prompt`, and session options before calling the OpenCode client. Keep incident-analysis reuse behavior, but force fresh sessions for summary and other, and only reuse PR review sessions when the same PR URL is detected.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing `lark-cli`, existing OpenCode/OpenChamber HTTP flow.

---

### Task 1: Add Intent Routing Tests First

**Files:**
- Create: `test/intent-router.test.js`

- [ ] **Step 1: Write the failing routing tests**

```js
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
    assert.doesNotMatch(prompt, /Use Datadog/);
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
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `node --test test/intent-router.test.js`
Expected: FAIL with `Cannot find module '../lib/intent-router.js'` or missing export failures.

- [ ] **Step 3: Commit the failing-test checkpoint after the first red run is understood**

```bash
git add test/intent-router.test.js
git commit -m "test: add intent routing coverage"
```

### Task 2: Implement Intent Routing Module

**Files:**
- Create: `lib/intent-router.js`
- Modify: `test/intent-router.test.js`

- [ ] **Step 1: Create the minimal routing module to satisfy the tests**

```js
// lib/intent-router.js
const PR_URL_RE = /https:\/\/github\.com\/[^\s]+\/pull\/\d+/i;
const SUMMARY_RE = /(总结|总结上面的对话|简短一些|summarize|summary|recap|tldr)/i;
const INCIDENT_RE = /(排查|分析|报错|异常|故障|issue|incident|error|timeout|失败)/i;
const PR_REVIEW_RE = /(review|code review|pull request|\bpr\b)/i;

export function detectIntent(event, contextMessages = []) {
  const content = String(event?.content || "");
  const context = contextMessages.join("\n");

  if (PR_URL_RE.test(content) || PR_REVIEW_RE.test(content)) {
    return "pr_review";
  }
  if (SUMMARY_RE.test(content)) {
    return "summary";
  }
  if (INCIDENT_RE.test(content) || INCIDENT_RE.test(context)) {
    return "incident_analysis";
  }
  return "other";
}

export function normalizePrUrl(content) {
  const match = String(content || "").match(PR_URL_RE);
  return match ? match[0] : null;
}

export function buildIntentPrompt(intent, promptConfig, event, contextMessages) {
  const prompt = promptConfig[intent];
  const contextBlock = contextMessages.length > 0
    ? contextMessages.join("\n")
    : "(no prior context available)";

  return `${prompt.system_prefix}

## Chat Context (recent ${contextMessages.length} messages)

${contextBlock}

## Trigger Message

${event.content}

## Your Task

${prompt.task_instructions}

${prompt.response_format}`;
}

export function buildSessionOptions({ intent, chatId, chatName, today, triggerMessageId, triggerContent }) {
  if (intent === "incident_analysis") {
    return {
      title: `${chatName}-incident-${today}`,
      cacheKey: `${intent}:${chatId}:${today}`,
      reuse: true,
    };
  }

  if (intent === "summary") {
    return {
      title: `${chatName}-summary-${today}`,
      cacheKey: `${intent}:${chatId}:${triggerMessageId}`,
      reuse: false,
    };
  }

  if (intent === "pr_review") {
    const prUrl = normalizePrUrl(triggerContent);
    return {
      title: `${chatName}-pr-review-${today}`,
      cacheKey: prUrl ? `${intent}:${chatId}:${prUrl}` : `${intent}:${chatId}:${triggerMessageId}`,
      reuse: Boolean(prUrl),
    };
  }

  return {
    title: `${chatName}-other-${today}`,
    cacheKey: `${intent}:${chatId}:${triggerMessageId}`,
    reuse: false,
  };
}
```

- [ ] **Step 2: Run the routing tests and confirm they pass**

Run: `node --test test/intent-router.test.js`
Expected: PASS

- [ ] **Step 3: Commit the routing module**

```bash
git add lib/intent-router.js test/intent-router.test.js
git commit -m "feat: add intent routing module"
```

### Task 3: Add Intent-Aware Prompt Configuration

**Files:**
- Modify: `oncall-bot.config.json`
- Modify: `lib/config.js`
- Test: `test/identity-split.test.js`

- [ ] **Step 1: Replace the single prompt block with intent-specific prompt blocks**

```json
"prompt": {
  "summary": {
    "system_prefix": "You summarize conversation context from this Lark chat.",
    "task_instructions": "Summarize the recent conversation relevant to the trigger request. Do not use Datadog, logs, metrics, traces, incidents, or production investigation.",
    "response_format": "Respond in Chinese unless the user asks otherwise. Keep it short and direct."
  },
  "incident_analysis": {
    "system_prefix": "You are an on-call assistant responsible for analyzing production issues.",
    "task_instructions": "1. Understand the problem from context\n2. Use Datadog tools to query relevant logs, metrics, and traces\n3. Provide root cause analysis and recommended next steps",
    "response_format": "Respond in English. Use bullet points for key findings. Include relevant links where available."
  },
  "pr_review": {
    "system_prefix": "You review PR requests coming from chat messages.",
    "task_instructions": "Review the PR request from the provided context. Focus on code-review findings, risks, missing checks, and next actions. Do not use Datadog unless the user explicitly asks about runtime or production impact.",
    "response_format": "Respond in English. Use bullets for findings and finish with clear next actions."
  },
  "other": {
    "system_prefix": "You answer the user's chat request using the provided chat context.",
    "task_instructions": "Answer the request directly from the chat context. Do not use Datadog unless the user explicitly asks for system investigation.",
    "response_format": "Respond in the same language as the user. Keep the answer concise."
  }
}
```

- [ ] **Step 2: Update config defaults so prompt shape is preserved when keys are missing**

```js
const defaultPromptConfig = {
  summary: {
    system_prefix: "You summarize conversation context from this Lark chat.",
    task_instructions: "Summarize the recent conversation relevant to the trigger request. Do not use Datadog, logs, metrics, traces, incidents, or production investigation.",
    response_format: "Respond in the same language as the user. Keep it short and direct.",
  },
  incident_analysis: {
    system_prefix: "You are an on-call assistant responsible for analyzing production issues.",
    task_instructions: "1. Understand the problem from context\n2. Use Datadog tools to query relevant logs, metrics, and traces\n3. Provide root cause analysis and recommended next steps",
    response_format: "Respond in English. Use bullet points for key findings. Include relevant links where available.",
  },
  pr_review: {
    system_prefix: "You review PR requests coming from chat messages.",
    task_instructions: "Review the PR request from the provided context. Focus on code-review findings, risks, missing checks, and next actions. Do not use Datadog unless the user explicitly asks about runtime or production impact.",
    response_format: "Respond in English. Use bullets for findings and finish with clear next actions.",
  },
  other: {
    system_prefix: "You answer the user's chat request using the provided chat context.",
    task_instructions: "Answer the request directly from the chat context. Do not use Datadog unless the user explicitly asks for system investigation.",
    response_format: "Respond in the same language as the user. Keep the answer concise.",
  },
};

config.prompt = {
  ...defaultPromptConfig,
  ...config.prompt,
  summary: { ...defaultPromptConfig.summary, ...config.prompt?.summary },
  incident_analysis: { ...defaultPromptConfig.incident_analysis, ...config.prompt?.incident_analysis },
  pr_review: { ...defaultPromptConfig.pr_review, ...config.prompt?.pr_review },
  other: { ...defaultPromptConfig.other, ...config.prompt?.other },
};
```

- [ ] **Step 3: Run config-related regression tests**

Run: `node --test test/identity-split.test.js`
Expected: PASS

- [ ] **Step 4: Commit the prompt configuration split**

```bash
git add oncall-bot.config.json lib/config.js test/identity-split.test.js
git commit -m "feat: split prompts by trigger intent"
```

### Task 4: Teach OpenCode Client About Reuse Policy and Archived Sessions

**Files:**
- Modify: `lib/opencode-client.js`
- Modify: `test/opencode-client.test.js`

- [ ] **Step 1: Add failing tests for session reuse policy and archived-session exclusion**

```js
it("does not reuse archived sessions", async () => {
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && !options.method) {
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: "archived-session", title: "Ops-summary-2026-06-09", archived: true },
          ],
        }),
      };
    }
    if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && options.method === "POST") {
      return { ok: true, json: async () => ({ data: { id: "fresh-session" } }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const client = new OpenCodeClient(baseConfig);
  const sessionId = await client.findOrCreateSession({
    title: "Ops-summary-2026-06-09",
    cacheKey: "summary:oc_chat1:om_99",
    reuse: true,
  });

  assert.equal(sessionId, "fresh-session");
});

it("creates a fresh session when reuse is false", async () => {
  let listCalled = false;
  global.fetch = async (url, options = {}) => {
    if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && !options.method) {
      listCalled = true;
    }
    if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && options.method === "POST") {
      return { ok: true, json: async () => ({ data: { id: "fresh-session" } }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const client = new OpenCodeClient(baseConfig);
  const sessionId = await client.findOrCreateSession({
    title: "Ops-other-2026-06-09",
    cacheKey: "other:oc_chat1:om_123",
    reuse: false,
  });

  assert.equal(sessionId, "fresh-session");
  assert.equal(listCalled, false);
});
```

- [ ] **Step 2: Run the client test file to verify it fails**

Run: `node --test test/opencode-client.test.js`
Expected: FAIL because `findOrCreateSession` does not yet accept options objects or archive filtering.

- [ ] **Step 3: Implement minimal reuse-policy support in the client**

```js
_isArchivedSession(session) {
  return session?.archived === true
    || session?.status === "archived"
    || session?.state === "archived";
}

async findOrCreateSession(input, chatName, today = new Date().toISOString().slice(0, 10)) {
  const options = typeof input === "object" && input !== null
    ? input
    : {
        title: this.sessionNameFormat
          .replace("{chat_name}", chatName || input)
          .replace("{date}", today),
        cacheKey: `${input}-${today}`,
        reuse: true,
      };

  const { title, cacheKey, reuse = true } = options;

  if (reuse) {
    const cachedId = this.sessionCache.get(cacheKey);
    if (cachedId) {
      try {
        const res = await fetch(this._sessionUrl(`/${cachedId}`), { headers: this._authHeaders() });
        if (res.ok) return cachedId;
      } catch {
      }
    }

    try {
      const res = await fetch(this._sessionUrl(), { headers: this._authHeaders() });
      if (res.ok) {
        const sessions = this._extractSessions(await res.json());
        const match = sessions.find((session) => session.title === title && !this._isArchivedSession(session));
        if (match) {
          this.sessionCache.set(cacheKey, match.id);
          return match.id;
        }
      }
    } catch {
    }
  }

  const res = await fetch(this._sessionUrl(), {
    method: "POST",
    headers: this._authHeaders(),
    body: JSON.stringify({ title, directory: this.projectDirectory }),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status} ${res.statusText}`);

  const session = this._unwrapData(await res.json());
  this.sessionCache.set(cacheKey, session.id);
  return session.id;
}
```

- [ ] **Step 4: Run the client tests to verify they pass**

Run: `node --test test/opencode-client.test.js`
Expected: PASS

- [ ] **Step 5: Commit the client reuse-policy change**

```bash
git add lib/opencode-client.js test/opencode-client.test.js
git commit -m "feat: add intent-aware session reuse rules"
```

### Task 5: Wire Intent Routing Into Main Orchestration

**Files:**
- Modify: `oncall-bot.js`
- Test: `test/intent-router.test.js`

- [ ] **Step 1: Import the routing helpers into the main entrypoint**

```js
import {
  detectIntent,
  buildIntentPrompt,
  buildSessionOptions,
} from "./lib/intent-router.js";
```

- [ ] **Step 2: Replace the old fixed prompt/session flow with intent-aware flow**

```js
      const intent = detectIntent(event, contextMessages);
      const prompt = buildIntentPrompt(intent, config.prompt, event, contextMessages);
      const today = new Date().toISOString().slice(0, 10);
      const sessionOptions = buildSessionOptions({
        intent,
        chatId,
        chatName,
        today,
        triggerMessageId: messageId,
        triggerContent: event.content,
      });

      const sessionId = await opencode.findOrCreateSession(sessionOptions);
      log(`  intent: ${intent}`);
      log(`  session: "${sessionOptions.title}" (${sessionId})`);
```

- [ ] **Step 3: Remove the old `buildPrompt` helper from `oncall-bot.js`**

```js
// Delete the old buildPrompt(event, contextMessages) function entirely.
```

- [ ] **Step 4: Run focused tests after wiring the main flow**

Run: `node --test test/intent-router.test.js test/opencode-client.test.js`
Expected: PASS

- [ ] **Step 5: Commit the main orchestration change**

```bash
git add oncall-bot.js lib/intent-router.js test/intent-router.test.js test/opencode-client.test.js
git commit -m "feat: route triggers by intent"
```

### Task 6: Full Regression Pass

**Files:**
- Modify: none
- Test: `test/queue.test.js`
- Test: `test/message-filter.test.js`
- Test: `test/context-fetcher.test.js`
- Test: `test/identity-split.test.js`
- Test: `test/opencode-client.test.js`
- Test: `test/intent-router.test.js`

- [ ] **Step 1: Run the full test suite**

Run: `node --test test/queue.test.js test/message-filter.test.js test/context-fetcher.test.js test/identity-split.test.js test/opencode-client.test.js test/intent-router.test.js`
Expected: PASS with 0 failures

- [ ] **Step 2: Manually verify behavior in the target chat**

Run:

```bash
node oncall-bot.js --config oncall-bot.config.json
```

Then send these four messages in the same test chat and verify the observed behavior:

- Summary:
  - `@Cyber Yixiang Wang 总结上面的对话，简短一些`
  - Expected: concise summary, no Datadog searching language
- Incident:
  - `@Cyber Yixiang Wang 帮我排查 payment-service 报错`
  - Expected: Datadog-style incident analysis
- PR review:
  - `@Cyber Yixiang Wang please review https://github.com/acme/api/pull/42`
  - Expected: PR-review output, no Datadog unless explicitly requested
- Other:
  - `@Cyber Yixiang Wang 把上面的内容翻译成英文`
  - Expected: direct answer from context, no Datadog

- [ ] **Step 3: Confirm session behavior in OpenChamber UI**

Open: `http://localhost:3000`

Expected:
- Incident requests reuse the same `*-incident-*` session for the day
- Summary requests create fresh `*-summary-*` sessions and do not reuse archived sessions
- PR review reuses only for the same PR URL
- Other requests create fresh `*-other-*` sessions
- New trigger work appears in the normal session list, not archived-only state

- [ ] **Step 4: Commit the verified final state**

```bash
git add .
git commit -m "test: verify intent routing end to end"
```
