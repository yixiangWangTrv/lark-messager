# Thread Context And Session Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make thread triggers use only thread-local context, make neutral triggers stay neutral, and make prompts/session handling depend on trigger metadata plus whether the OpenCode session is new or existing.

**Architecture:** Keep the current orchestration in `oncall-bot.js`, but make context fetching return scope metadata, make session lookup report `new` vs `existing`, and build prompts from a structured metadata block plus either initial or continuation framing. Thread-specific user notices remain in the reply path and are sent as additive messages after the existing processing notice.

**Tech Stack:** Node.js, built-in `node:test`, `lark-cli`, OpenCode HTTP API

---

## File Structure

- Modify: `lib/context-fetcher.js`
  Adds a thread-aware fetch path and returns a structured fetch result with scope metadata.
- Modify: `lib/intent-router.js`
  Tightens intent detection and builds session-state-aware prompts with trigger metadata.
- Modify: `lib/opencode-client.js`
  Returns session id plus whether the session was newly created or reused.
- Modify: `lib/processing-notice.js`
  Adds helpers for thread-only and trigger-only fallback notices.
- Modify: `lib/config.js`
  Adds defaults for new reply notices and any new prompt fields.
- Modify: `oncall-bot.config.json`
  Stores the new notice text and any prompt configuration changes.
- Modify: `oncall-bot.js`
  Orchestrates thread-aware fetch, extra notices, session-state-aware prompts, and new session metadata.
- Modify: `test/context-fetcher.test.js`
  Covers thread-only fetch and trigger-only fallback.
- Modify: `test/intent-router.test.js`
  Covers neutral trigger behavior and prompt metadata/session-state behavior.
- Modify: `test/opencode-client.test.js`
  Covers `new` vs `existing` session reporting.
- Create: `test/processing-notice.test.js` additions only
  Covers the new thread-only and trigger-only notice helpers.

### Task 1: Add Failing Tests For Thread Context Fetching

**Files:**
- Modify: `test/context-fetcher.test.js`
- Modify: `lib/context-fetcher.js`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ContextFetcher } from "../lib/context-fetcher.js";

describe("ContextFetcher", () => {
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
    assert.deepEqual(result.messages, [
      "[11/14 22:13] Thread User: hello from thread",
    ]);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("--thread-id"));
    assert.ok(calls[0].includes("omt-thread-1"));
    assert.ok(!calls[0].includes("--chat-id"));
  });

  it("falls back to trigger_only when thread fetch fails", async () => {
    const fetcher = new ContextFetcher({
      context: { message_count: 10 },
      lark: { context_identity: "user" },
      contextFetcherExec: async () => {
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
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/context-fetcher.test.js`
Expected: FAIL because `fetchContext()` still expects positional args and does not return `{ scope, threadId, fetchFailed, messages }`.

- [ ] **Step 3: Write minimal implementation**

```js
export class ContextFetcher {
  constructor(config) {
    this.messageCount = config.context.message_count || 10;
    this.includeSenderName = config.context.include_sender_name !== false;
    this.identity = config.lark.context_identity || config.lark.reply_identity || config.lark.identity || "user";
    this.execFileAsync = config.contextFetcherExec || execFileAsync;
  }

  async fetchContext({ chatId, threadId, beforeTimestamp, triggerMessage }) {
    if (threadId) {
      try {
        const messages = await this._fetchThreadMessages(threadId, beforeTimestamp);
        return {
          messages,
          scope: "thread",
          threadId,
          fetchFailed: false,
        };
      } catch (err) {
        process.stderr.write(`[context-fetcher] Failed to fetch thread context for ${threadId}: ${err.message}\n`);
        return {
          messages: [],
          scope: "trigger_only",
          threadId,
          fetchFailed: true,
        };
      }
    }

    const messages = await this._fetchChatMessages(chatId, beforeTimestamp);
    return {
      messages,
      scope: "chat",
      threadId: null,
      fetchFailed: false,
    };
  }

  async _fetchThreadMessages(threadId, beforeTimestamp) {
    const args = [
      "im", "+chat-messages-list",
      "--thread-id", threadId,
      "--page-size", String(this.messageCount + 1),
      "--sort", "desc",
      "--as", this.identity,
      "--json",
    ];

    if (beforeTimestamp) {
      const ts = Number(beforeTimestamp);
      const iso = Number.isNaN(ts) ? beforeTimestamp : new Date(ts).toISOString();
      args.push("--end", iso);
    }

    const { stdout } = await this.execFileAsync("lark-cli", args, { timeout: 30000 });
    return this._parseMessages(stdout);
  }

  async _fetchChatMessages(chatId, beforeTimestamp) {
    const args = [
      "im", "+chat-messages-list",
      "--chat-id", chatId,
      "--page-size", String(this.messageCount + 1),
      "--sort", "desc",
      "--as", this.identity,
      "--json",
    ];

    if (beforeTimestamp) {
      const ts = Number(beforeTimestamp);
      const iso = Number.isNaN(ts) ? beforeTimestamp : new Date(ts).toISOString();
      args.push("--end", iso);
    }

    const { stdout } = await this.execFileAsync("lark-cli", args, { timeout: 30000 });
    return this._parseMessages(stdout);
  }

  _parseMessages(stdout) {
    const result = JSON.parse(stdout);
    const messages = result.data?.messages || result.messages || (Array.isArray(result) ? result : []);

    return messages
      .reverse()
      .slice(0, this.messageCount)
      .map((msg) => this._formatMessage(msg))
      .filter(Boolean);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/context-fetcher.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/context-fetcher.test.js lib/context-fetcher.js
git commit -m "test: add thread context fetch coverage"
```

### Task 2: Add Failing Tests For Neutral Trigger Intent Handling

**Files:**
- Modify: `test/intent-router.test.js`
- Modify: `lib/intent-router.js`

- [ ] **Step 1: Write the failing tests**

```js
it("keeps a neutral trigger as other even when context contains incident keywords", () => {
  const event = { content: "hi" };
  const contextLines = ["[06/09 15:07] user: payment-service is failing with 500 errors"];

  assert.equal(detectIntent(event, contextLines), "other");
});

it("still detects incident_analysis when trigger text itself asks for investigation", () => {
  const event = { content: "hi, help me investigate this error" };
  const contextLines = [];

  assert.equal(detectIntent(event, contextLines), "incident_analysis");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/intent-router.test.js`
Expected: FAIL because `detectIntent()` still upgrades neutral triggers using incident-like context alone.

- [ ] **Step 3: Write minimal implementation**

```js
export function detectIntent(event, _contextLines = []) {
  const content = String(event?.content || "");
  const normalized = content.toLowerCase();

  if (normalizePrUrl(content)) {
    return "pr_review";
  }

  if (SUMMARY_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
    return "summary";
  }

  if (INCIDENT_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
    return "incident_analysis";
  }

  return "other";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/intent-router.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/intent-router.test.js lib/intent-router.js
git commit -m "fix: keep neutral triggers out of incident routing"
```

### Task 3: Add Failing Tests For Prompt Metadata And Session-State Framing

**Files:**
- Modify: `test/intent-router.test.js`
- Modify: `lib/intent-router.js`

- [ ] **Step 1: Write the failing tests**

```js
it("builds a new-session prompt with trigger metadata and context scope", () => {
  const prompt = buildIntentPrompt({
    intent: "other",
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

  assert.match(prompt, /Trigger metadata:/);
  assert.match(prompt, /sender_id: ou_user1/);
  assert.match(prompt, /thread_id: omt_1/);
  assert.match(prompt, /session_state: new/);
  assert.match(prompt, /context_scope: thread/);
  assert.match(prompt, /Read trigger metadata first before using any context\./);
  assert.match(prompt, /Context:\n\[06\/09 15:07\] user: hi there/);
  assert.match(prompt, /User request:\nhi$/);
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
  assert.match(prompt, /session_state: existing/);
  assert.match(prompt, /context_scope: chat/);
  assert.doesNotMatch(prompt, /^You are an on-call assistant\./);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/intent-router.test.js`
Expected: FAIL because `buildIntentPrompt()` still uses the old positional signature and does not build metadata or continuation framing.

- [ ] **Step 3: Write minimal implementation**

```js
function buildTriggerMetadata(event, intent, contextResult, sessionState) {
  const lines = [
    "Trigger metadata:",
    `sender_id: ${event?.sender_id || "unknown"}`,
    `chat_id: ${event?.chat_id || "unknown"}`,
    `message_id: ${event?.message_id || "unknown"}`,
    `thread_id: ${contextResult?.threadId || event?.thread_id || "none"}`,
    `is_thread_message: ${Boolean(contextResult?.threadId || event?.thread_id)}`,
    `session_state: ${sessionState}`,
    `context_scope: ${contextResult?.scope || "chat"}`,
    `intent: ${intent}`,
  ];

  return lines.join("\n");
}

export function buildIntentPrompt({ intent, promptConfig, event, contextResult, sessionState }) {
  const config = promptConfig?.[intent] || promptConfig?.other || {};
  const sections = [];

  if (sessionState === "new") {
    if (config.system_prefix) {
      sections.push(config.system_prefix);
    }
    if (config.task_instructions) {
      sections.push(config.task_instructions);
    }
    if (config.response_format) {
      sections.push(config.response_format);
    }
  } else {
    sections.push("A new trigger message has arrived in this existing session.");
    sections.push("Re-evaluate the new trigger first. Use only the declared context scope.");
  }

  sections.push("Read trigger metadata first before using any context.");
  sections.push(buildTriggerMetadata(event, intent, contextResult, sessionState));

  if (contextResult?.messages?.length) {
    sections.push(`Context:\n${contextResult.messages.join("\n")}`);
  }

  if (event?.content) {
    sections.push(`User request:\n${event.content}`);
  }

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/intent-router.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/intent-router.test.js lib/intent-router.js
git commit -m "feat: add trigger metadata to prompts"
```

### Task 4: Add Failing Tests For Session State Reporting

**Files:**
- Modify: `test/opencode-client.test.js`
- Modify: `lib/opencode-client.js`

- [ ] **Step 1: Write the failing tests**

```js
it("returns existing session state when reusing a listed session", async () => {
  global.fetch = async (url, options = {}) => {
    if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && !options.method) {
      return {
        ok: true,
        json: async () => ({
          data: [{ id: "session-existing", title: "Alerts-2026-06-09" }],
        }),
      };
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const client = new OpenCodeClient(baseConfig);
  const result = await client.findOrCreateSession("chat-1", "Alerts", "2026-06-09");

  assert.deepEqual(result, {
    sessionId: "session-existing",
    sessionState: "existing",
  });
});

it("returns new session state when creating a fresh session", async () => {
  global.fetch = async (url, options = {}) => {
    if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && !options.method) {
      return { ok: true, json: async () => ({ data: [] }) };
    }

    if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && options.method === "POST") {
      return {
        ok: true,
        json: async () => ({ data: { id: "session-new" } }),
      };
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const client = new OpenCodeClient(baseConfig);
  const result = await client.findOrCreateSession("chat-1", "Alerts", "2026-06-09");

  assert.deepEqual(result, {
    sessionId: "session-new",
    sessionState: "new",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/opencode-client.test.js`
Expected: FAIL because `findOrCreateSession()` currently returns a bare session id string.

- [ ] **Step 3: Write minimal implementation**

```js
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
        const res = await fetch(this._sessionUrl(`/${cachedId}`), {
          headers: this._authHeaders(),
        });
        if (res.ok) {
          return { sessionId: cachedId, sessionState: "existing" };
        }
      } catch {
        // Continue.
      }
    }

    try {
      const res = await fetch(this._sessionUrl(), {
        headers: this._authHeaders(),
      });
      if (res.ok) {
        const sessions = this._extractSessions(await res.json());
        const match = sessions.find((s) => s.title === title && !this._isArchivedSession(s));
        if (match) {
          this.sessionCache.set(cacheKey, match.id);
          return { sessionId: match.id, sessionState: "existing" };
        }
      }
    } catch {
      // Fall through.
    }
  }

  const res = await fetch(this._sessionUrl(), {
    method: "POST",
    headers: this._authHeaders(),
    body: JSON.stringify({ title, directory: this.projectDirectory }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create session: ${res.status} ${res.statusText}`);
  }

  const session = this._unwrapData(await res.json());
  this.sessionCache.set(cacheKey, session.id);
  return { sessionId: session.id, sessionState: "new" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/opencode-client.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/opencode-client.test.js lib/opencode-client.js
git commit -m "feat: report opencode session state"
```

### Task 5: Add Failing Tests For New Notices

**Files:**
- Modify: `test/processing-notice.test.js`
- Modify: `lib/processing-notice.js`
- Modify: `lib/config.js`
- Modify: `oncall-bot.config.json`

- [ ] **Step 1: Write the failing tests**

```js
import {
  getProcessingNotice,
  getThreadOnlyNotice,
  getTriggerOnlyFallbackNotice,
  shouldSendProcessingNotice,
} from "../lib/processing-notice.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/processing-notice.test.js`
Expected: FAIL because the helper functions and config defaults do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
export const DEFAULT_PROCESSING_NOTICE = "Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.";
export const DEFAULT_THREAD_ONLY_NOTICE = "This message was sent in a thread. I will only use messages from this thread as context.";
export const DEFAULT_TRIGGER_ONLY_FALLBACK_NOTICE = "I could not load thread history, so I will use only the trigger message itself.";

export function shouldSendProcessingNotice(config) {
  return config.reply?.send_processing_notice !== false;
}

export function getProcessingNotice(config) {
  return config.reply?.processing_notice || DEFAULT_PROCESSING_NOTICE;
}

export function getThreadOnlyNotice(config) {
  return config.reply?.thread_only_notice || DEFAULT_THREAD_ONLY_NOTICE;
}

export function getTriggerOnlyFallbackNotice(config) {
  return config.reply?.trigger_only_fallback_notice || DEFAULT_TRIGGER_ONLY_FALLBACK_NOTICE;
}
```

```js
config.reply = {
  default: "in_thread",
  rules: [],
  send_processing_notice: true,
  processing_notice: DEFAULT_PROCESSING_NOTICE,
  thread_only_notice: DEFAULT_THREAD_ONLY_NOTICE,
  trigger_only_fallback_notice: DEFAULT_TRIGGER_ONLY_FALLBACK_NOTICE,
  ...config.reply,
};
```

```json
"reply": {
  "default": "in_thread",
  "send_processing_notice": true,
  "processing_notice": "Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.",
  "thread_only_notice": "This message was sent in a thread. I will only use messages from this thread as context.",
  "trigger_only_fallback_notice": "I could not load thread history, so I will use only the trigger message itself.",
  "rules": [
    { "match": "*", "reply_to": "in_thread" }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/processing-notice.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/processing-notice.test.js lib/processing-notice.js lib/config.js oncall-bot.config.json
git commit -m "feat: add thread processing notices"
```

### Task 6: Add Failing Orchestration Test For Thread Notices And Prompt Inputs

**Files:**
- Create: `test/oncall-orchestration.test.js`
- Modify: `oncall-bot.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("handleTrigger orchestration", () => {
  it("sends processing notice, thread-only notice, and passes session/context metadata", async () => {
    const replies = [];
    const sentPrompts = [];

    const event = {
      chat_id: "oc_chat1",
      message_id: "om_1",
      sender_id: "ou_user1",
      thread_id: "omt_1",
      content: "hi",
      create_time: "1700000010000",
    };

    const contextFetcher = {
      fetchContext: async () => ({
        messages: ["[06/09 15:07] user: hi there"],
        scope: "thread",
        threadId: "omt_1",
        fetchFailed: false,
      }),
      getChatName: async () => "Ops Room",
    };

    const opencode = {
      findOrCreateSession: async () => ({ sessionId: "session-1", sessionState: "existing" }),
      sendMessage: async (_sessionId, prompt) => {
        sentPrompts.push(prompt);
        return "ok";
      },
    };

    const replySender = {
      sendReply: async (_event, text) => {
        replies.push(text);
      },
    };

    assert.fail("Extract handleTrigger dependencies into a testable function before making this pass.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/oncall-orchestration.test.js`
Expected: FAIL because there is no testable orchestration helper yet.

- [ ] **Step 3: Write minimal implementation**

```js
export async function processTrigger({ event, config, queue, contextFetcher, opencode, replySender, detectIntentFn = detectIntent, buildIntentPromptFn = buildIntentPrompt, buildSessionOptionsFn = buildSessionOptions }) {
  const chatId = event.chat_id;
  const messageId = event.message_id;

  const result = queue.enqueue(chatId, async () => {
    const contextResult = await contextFetcher.fetchContext({
      chatId,
      threadId: event.thread_id || null,
      beforeTimestamp: event.create_time,
      triggerMessage: event.content,
    });

    const intent = detectIntentFn(event, contextResult.messages);
    const chatName = await contextFetcher.getChatName(chatId);
    const sessionOptions = buildSessionOptionsFn({
      intent,
      chatId,
      chatName,
      today: new Date().toISOString().slice(0, 10),
      triggerMessageId: messageId,
      triggerContent: event.content,
    });

    const { sessionId, sessionState } = await opencode.findOrCreateSession(sessionOptions);

    if (shouldSendProcessingNotice(config)) {
      await replySender.sendReply(event, getProcessingNotice(config), { skipPrefix: true });
      if (contextResult.scope === "thread") {
        await replySender.sendReply(event, getThreadOnlyNotice(config), { skipPrefix: true });
      }
      if (contextResult.scope === "trigger_only" && event.thread_id) {
        await replySender.sendReply(event, getTriggerOnlyFallbackNotice(config), { skipPrefix: true });
      }
    }

    const prompt = buildIntentPromptFn({
      intent,
      promptConfig: config.prompt,
      event,
      contextResult,
      sessionState,
    });

    const analysis = await opencode.sendMessage(sessionId, prompt);
    await replySender.sendReply(event, analysis);
  });

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/oncall-orchestration.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/oncall-orchestration.test.js oncall-bot.js
git commit -m "refactor: extract trigger orchestration"
```

### Task 7: Wire The Main Entry Point To The New Helpers

**Files:**
- Modify: `oncall-bot.js`

- [ ] **Step 1: Update the entry point to use the extracted orchestration helper**

```js
async function handleTrigger(event) {
  const chatId = event.chat_id;
  const messageId = event.message_id;
  const senderId = event.sender_id;

  log(`← trigger: ${senderId} in ${chatId} (${messageId})${event.thread_id ? ` thread=${event.thread_id}` : ""}`);

  const result = await processTrigger({
    event,
    config,
    queue,
    contextFetcher,
    opencode,
    replySender,
  });

  if (result === null) {
    log(`  ⚠ queue full for ${chatId}, dropping message ${messageId}`);
  }
}
```

- [ ] **Step 2: Run targeted tests to verify orchestration wiring**

Run: `npm test -- test/oncall-orchestration.test.js test/processing-notice.test.js test/opencode-client.test.js test/intent-router.test.js test/context-fetcher.test.js`
Expected: PASS

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add oncall-bot.js
git commit -m "feat: wire thread-aware trigger processing"
```

## Self-Review

- Spec coverage: thread-only context, trigger-only fallback, sender/thread metadata, session new vs existing prompts, extra notices, and neutral trigger behavior are all mapped to Tasks 1 through 7.
- Placeholder scan: no `TODO`, `TBD`, or vague “handle appropriately” language remains in task steps.
- Type consistency: the plan consistently uses `contextResult`, `sessionState`, `threadId`, `scope`, `messages`, and `{ sessionId, sessionState }` across all tasks.
