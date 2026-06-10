# Async Submit and Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single blocking `sendMessage()` call with background submission + polling, so the chat queue is released quickly and tool-stuck approval waits are surfaced to users in real time.

**Architecture:** Fire `POST /session/{id}/message` in a detached background task to free the queue immediately. A parallel polling loop calls `GET /session/{id}/message` every few seconds, detects tool-stuck state and completion, and posts the final reply (or a stuck notice) back to Lark. An in-memory `PendingJobs` registry prevents duplicate polling loops.

**Tech Stack:** Node.js ESM, `node:test`, no new runtime dependencies.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/opencode-client.js` | modify | add `submitMessage()`, `listMessages()`, pure helpers |
| `lib/pending-jobs.js` | create | in-memory job registry |
| `lib/async-analysis.js` | create | orchestrate submit + poll + reply |
| `lib/config.js` | modify | add async config defaults |
| `oncall-bot.config.json` | modify | add async config keys |
| `oncall-bot.js` | modify | use async path; queue covers only submission |
| `test/opencode-client.test.js` | modify | tests for new client methods |
| `test/pending-jobs.test.js` | create | tests for job registry |
| `test/async-analysis.test.js` | create | tests for orchestration |

---

### Task 1: Add new config defaults

**Files:**
- Modify: `lib/config.js`
- Modify: `oncall-bot.config.json`

- [ ] **Step 1: Write the failing config test**

Add to `test/identity-split.test.js` inside the existing `describe("identity split")` block:

```js
it("sets async opencode config defaults", () => {
  const config = loadConfig(writeTempConfig({
    opencode: { base_url: "http://localhost:3000" },
  }));

  assert.equal(config.opencode.submit_timeout_ms, 30000);
  assert.equal(config.opencode.poll_interval_ms, 3000);
  assert.equal(config.opencode.poll_timeout_ms, 1800000);
  assert.equal(config.opencode.tool_stuck_threshold_ms, 8000);
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/identity-split.test.js
```

Expected: FAIL — `config.opencode.submit_timeout_ms` is `undefined`.

- [ ] **Step 3: Add defaults to `lib/config.js`**

Find the `config.opencode = {` block and add four new fields:

```js
config.opencode = {
  username: "opencode",
  password: "",
  analysis_timeout_ms: 600000,
  submit_timeout_ms: 30000,
  poll_interval_ms: 3000,
  poll_timeout_ms: 1800000,
  tool_stuck_threshold_ms: 8000,
  project_directory: process.cwd(),
  ...config.opencode,
};
```

- [ ] **Step 4: Add keys to `oncall-bot.config.json`**

Inside the `"opencode"` object add:

```json
"submit_timeout_ms": 30000,
"poll_interval_ms": 3000,
"poll_timeout_ms": 1800000,
"tool_stuck_threshold_ms": 8000
```

- [ ] **Step 5: Run tests and confirm pass**

```bash
node --test test/identity-split.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/config.js oncall-bot.config.json test/identity-split.test.js
git commit -m "feat: add async opencode config defaults"
```

---

### Task 2: Add `submitMessage()` and `listMessages()` to OpenCodeClient

**Files:**
- Modify: `lib/opencode-client.js`
- Modify: `test/opencode-client.test.js`

- [ ] **Step 1: Write failing tests**

Append to `test/opencode-client.test.js` inside the existing `describe("OpenCodeClient")` block:

```js
it("submitMessage returns tracking object with sessionId and submittedAt", async () => {
  let capturedBody = null;
  global.fetch = async (url, options = {}) => {
    capturedBody = JSON.parse(options.body || "{}");
    return {
      ok: true,
      json: async () => ({
        data: {
          info: { id: "msg_user_001", role: "user" },
          parts: [],
        },
      }),
    };
  };

  const client = new OpenCodeClient(baseConfig);
  const before = Date.now();
  const tracking = await client.submitMessage("session-1", "hello");
  const after = Date.now();

  assert.equal(tracking.sessionId, "session-1");
  assert.ok(tracking.submittedAt >= before && tracking.submittedAt <= after);
  assert.equal(tracking.userMessageId, "msg_user_001");
  assert.deepEqual(capturedBody.parts, [{ type: "text", text: "hello" }]);
});

it("submitMessage sets userMessageId to null when response has no message id", async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ data: { parts: [] } }),
  });

  const client = new OpenCodeClient(baseConfig);
  const tracking = await client.submitMessage("session-1", "hello");

  assert.equal(tracking.userMessageId, null);
});

it("listMessages returns parsed message array", async () => {
  const messages = [
    { info: { id: "msg_u1", role: "user" }, parts: [] },
    { info: { id: "msg_a1", role: "assistant", time: { completed: 12345 } }, parts: [{ type: "text", text: "hi" }] },
  ];
  global.fetch = async () => ({
    ok: true,
    json: async () => messages,
  });

  const client = new OpenCodeClient(baseConfig);
  const result = await client.listMessages("session-1");

  assert.equal(result.length, 2);
  assert.equal(result[0].info.role, "user");
  assert.equal(result[1].info.role, "assistant");
});

it("listMessages returns empty array on non-ok response", async () => {
  global.fetch = async () => ({ ok: false, status: 404 });

  const client = new OpenCodeClient(baseConfig);
  const result = await client.listMessages("session-1");

  assert.deepEqual(result, []);
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/opencode-client.test.js
```

Expected: FAIL — `client.submitMessage is not a function`.

- [ ] **Step 3: Implement `submitMessage()` and `listMessages()` in `lib/opencode-client.js`**

Add after the existing `sendMessage()` method:

```js
async submitMessage(sessionId, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

  try {
    const res = await fetch(this._sessionUrl(`/${sessionId}/message`), {
      method: "POST",
      headers: this._authHeaders(),
      body: JSON.stringify({
        directory: this.projectDirectory,
        parts: [{ type: "text", text: prompt }],
      }),
      signal: controller.signal,
    });

    const submittedAt = Date.now();

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenCode submit error: ${res.status} — ${body.slice(0, 200)}`);
    }

    const data = this._unwrapData(await res.json());
    const userMessageId = data?.info?.id ?? null;

    return { sessionId, submittedAt, userMessageId };
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`OpenCode submit timed out after ${this.timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async listMessages(sessionId) {
  try {
    const res = await fetch(this._sessionUrl(`/${sessionId}/message`), {
      headers: this._authHeaders(),
    });
    if (!res.ok) return [];
    const raw = await res.json();
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests and confirm pass**

```bash
node --test test/opencode-client.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/opencode-client.js test/opencode-client.test.js
git commit -m "feat: add submitMessage and listMessages to OpenCodeClient"
```

---

### Task 3: Build `PendingJobs` registry

**Files:**
- Create: `lib/pending-jobs.js`
- Create: `test/pending-jobs.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/pending-jobs.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PendingJobs } from "../lib/pending-jobs.js";

describe("PendingJobs", () => {
  it("registers a new job and returns it", () => {
    const jobs = new PendingJobs();
    const job = jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1000, userMessageId: null });

    assert.equal(job.key, "c1:m1");
    assert.equal(job.status, "pending");
    assert.equal(job.stuckNoticeSent, false);
  });

  it("returns null when registering duplicate key", () => {
    const jobs = new PendingJobs();
    jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1000, userMessageId: null });
    const dup = jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1001, userMessageId: null });

    assert.equal(dup, null);
  });

  it("complete marks job done and removes it", () => {
    const jobs = new PendingJobs();
    jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1000, userMessageId: null });
    jobs.complete("c1:m1");

    assert.equal(jobs.get("c1:m1"), undefined);
  });

  it("fail marks job failed and removes it", () => {
    const jobs = new PendingJobs();
    jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1000, userMessageId: null });
    jobs.fail("c1:m1", new Error("oops"));

    assert.equal(jobs.get("c1:m1"), undefined);
  });

  it("markStuckNoticeSent sets stuckNoticeSent to true", () => {
    const jobs = new PendingJobs();
    const job = jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1000, userMessageId: null });
    jobs.markStuckNoticeSent("c1:m1");

    assert.equal(job.stuckNoticeSent, true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/pending-jobs.test.js
```

Expected: FAIL — `Cannot find module '../lib/pending-jobs.js'`.

- [ ] **Step 3: Implement `lib/pending-jobs.js`**

Create `lib/pending-jobs.js`:

```js
// lib/pending-jobs.js
export class PendingJobs {
  constructor() {
    this._jobs = new Map();
  }

  register({ chatId, triggerMessageId, sessionId, submittedAt, userMessageId }) {
    const key = `${chatId}:${triggerMessageId}`;
    if (this._jobs.has(key)) return null;

    const job = {
      key,
      chatId,
      triggerMessageId,
      sessionId,
      submittedAt,
      userMessageId,
      startedAt: Date.now(),
      status: "pending",
      stuckNoticeSent: false,
    };
    this._jobs.set(key, job);
    return job;
  }

  get(key) {
    return this._jobs.get(key);
  }

  complete(key) {
    this._jobs.delete(key);
  }

  fail(key, _err) {
    this._jobs.delete(key);
  }

  markStuckNoticeSent(key) {
    const job = this._jobs.get(key);
    if (job) job.stuckNoticeSent = true;
  }
}
```

- [ ] **Step 4: Run tests and confirm pass**

```bash
node --test test/pending-jobs.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/pending-jobs.js test/pending-jobs.test.js
git commit -m "feat: add PendingJobs registry"
```

---

### Task 4: Build `AsyncAnalysis` orchestrator

**Files:**
- Create: `lib/async-analysis.js`
- Create: `test/async-analysis.test.js`

This module coordinates: fire submit in background → poll for result → detect tool-stuck → deliver final reply.

- [ ] **Step 1: Write failing tests**

Create `test/async-analysis.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AsyncAnalysis } from "../lib/async-analysis.js";

// Helper: build a minimal assistant message object
function assistantMsg({ completed = null, finish = null, toolStatus = null, text = null } = {}) {
  const parts = [];
  if (toolStatus) parts.push({ type: "tool", state: { status: toolStatus } });
  if (text) parts.push({ type: "text", text });
  return {
    info: {
      role: "assistant",
      time: { completed },
      finish,
      parentID: "msg_user_001",
    },
    parts,
  };
}

describe("AsyncAnalysis", () => {
  it("delivers final reply when assistant message completes", async () => {
    const replies = [];
    const client = {
      submitMessage: async () => ({ sessionId: "s1", submittedAt: Date.now() - 100, userMessageId: "msg_user_001" }),
      listMessages: async () => [
        assistantMsg({ completed: Date.now(), finish: "stop", text: "done!" }),
      ],
    };
    const replySender = {
      sendReply: async (event, text, opts) => { replies.push({ text, opts }); },
    };

    const analysis = new AsyncAnalysis({ client, replySender, config: {
      opencode: { poll_interval_ms: 10, poll_timeout_ms: 5000, tool_stuck_threshold_ms: 9999 },
      reply: {},
    }});

    const event = { chat_id: "c1", message_id: "m1" };
    await analysis.run(event, "s1", "analyze this");

    assert.equal(replies.length, 1);
    assert.ok(replies[0].text.includes("done!"));
    assert.ok(!replies[0].opts?.skipPrefix);
  });

  it("sends tool-stuck notice once when tool stays running beyond threshold", async () => {
    const replies = [];
    let callCount = 0;

    const client = {
      submitMessage: async () => ({ sessionId: "s1", submittedAt: Date.now() - 100, userMessageId: "msg_user_001" }),
      listMessages: async () => {
        callCount++;
        if (callCount < 4) {
          // simulate tool stuck
          return [assistantMsg({ toolStatus: "running" })];
        }
        // complete on 4th call
        return [assistantMsg({ completed: Date.now(), finish: "stop", text: "finally done" })];
      },
    };
    const replySender = {
      sendReply: async (event, text, opts) => { replies.push({ text, opts }); },
    };

    const analysis = new AsyncAnalysis({ client, replySender, config: {
      opencode: { poll_interval_ms: 10, poll_timeout_ms: 5000, tool_stuck_threshold_ms: 15 },
      reply: {},
    }});

    const event = { chat_id: "c1", message_id: "m1" };
    await analysis.run(event, "s1", "analyze this");

    const stuckReplies = replies.filter(r => r.text.includes("approval"));
    const finalReplies = replies.filter(r => r.text.includes("finally done"));

    assert.equal(stuckReplies.length, 1);
    assert.equal(stuckReplies[0].opts?.skipPrefix, true);
    assert.equal(finalReplies.length, 1);
  });

  it("sends timeout failure notice when poll_timeout_ms exceeded", async () => {
    const replies = [];
    const client = {
      submitMessage: async () => ({ sessionId: "s1", submittedAt: Date.now() - 100, userMessageId: null }),
      listMessages: async () => [],
    };
    const replySender = {
      sendReply: async (event, text, opts) => { replies.push({ text, opts }); },
    };

    const analysis = new AsyncAnalysis({ client, replySender, config: {
      opencode: { poll_interval_ms: 10, poll_timeout_ms: 50, tool_stuck_threshold_ms: 9999 },
      reply: {},
    }});

    const event = { chat_id: "c1", message_id: "m1" };
    await analysis.run(event, "s1", "analyze this");

    assert.equal(replies.length, 1);
    assert.ok(replies[0].text.includes("Still waiting") || replies[0].text.includes("timed out"));
    assert.equal(replies[0].opts?.skipPrefix, true);
  });

  it("does not send duplicate stuck notices", async () => {
    const replies = [];
    let callCount = 0;

    const client = {
      submitMessage: async () => ({ sessionId: "s1", submittedAt: Date.now() - 100, userMessageId: null }),
      listMessages: async () => {
        callCount++;
        if (callCount < 8) return [assistantMsg({ toolStatus: "running" })];
        return [assistantMsg({ completed: Date.now(), finish: "stop", text: "done" })];
      },
    };
    const replySender = {
      sendReply: async (event, text, opts) => { replies.push({ text, opts }); },
    };

    const analysis = new AsyncAnalysis({ client, replySender, config: {
      opencode: { poll_interval_ms: 10, poll_timeout_ms: 5000, tool_stuck_threshold_ms: 15 },
      reply: {},
    }});

    await analysis.run({ chat_id: "c1", message_id: "m1" }, "s1", "analyze this");

    const stuckReplies = replies.filter(r => r.text.includes("approval"));
    assert.equal(stuckReplies.length, 1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
node --test test/async-analysis.test.js
```

Expected: FAIL — `Cannot find module '../lib/async-analysis.js'`.

- [ ] **Step 3: Implement `lib/async-analysis.js`**

Create `lib/async-analysis.js`:

```js
// lib/async-analysis.js

const STUCK_NOTICE = "OpenCode is waiting for tool approval. Please check the OpenCode window and approve if needed.";
const TIMEOUT_NOTICE = "Still waiting for OpenCode to finish. It may be blocked on approval or still processing.";
const RETRIEVAL_FAILURE = "OpenCode accepted the request, but the bot could not retrieve the final reply.";

export class AsyncAnalysis {
  constructor({ client, replySender, config }) {
    this.client = client;
    this.replySender = replySender;
    this.pollIntervalMs = config.opencode.poll_interval_ms ?? 3000;
    this.pollTimeoutMs = config.opencode.poll_timeout_ms ?? 1800000;
    this.toolStuckThresholdMs = config.opencode.tool_stuck_threshold_ms ?? 8000;
  }

  async run(event, sessionId, prompt) {
    let tracking;
    try {
      tracking = await this.client.submitMessage(sessionId, prompt);
    } catch (err) {
      await this._sendNotice(event, `OpenCode submit failed: ${err.message}`);
      return;
    }

    await this._poll(event, tracking);
  }

  async _poll(event, tracking) {
    const deadline = Date.now() + this.pollTimeoutMs;
    let stuckNoticeSent = false;
    let toolRunningFirstSeenAt = null;

    while (Date.now() < deadline) {
      const messages = await this.client.listMessages(tracking.sessionId);
      const assistant = this._findAssistant(messages, tracking);

      if (assistant) {
        // Check completion
        if (this._isComplete(assistant)) {
          const text = this._extractText(assistant);
          if (text) {
            await this.replySender.sendReply(event, text);
          } else {
            await this._sendNotice(event, RETRIEVAL_FAILURE);
          }
          return;
        }

        // Check tool-stuck
        if (!stuckNoticeSent) {
          const lastTool = this._lastToolPart(assistant);
          if (lastTool?.state?.status === "running") {
            if (!toolRunningFirstSeenAt) toolRunningFirstSeenAt = Date.now();
            if (Date.now() - toolRunningFirstSeenAt >= this.toolStuckThresholdMs) {
              await this._sendNotice(event, STUCK_NOTICE);
              stuckNoticeSent = true;
            }
          } else {
            toolRunningFirstSeenAt = null;
          }
        }
      }

      await new Promise(r => setTimeout(r, this.pollIntervalMs));
    }

    await this._sendNotice(event, TIMEOUT_NOTICE);
  }

  _findAssistant(messages, tracking) {
    const candidates = messages.filter(m => m?.info?.role === "assistant");
    if (candidates.length === 0) return null;

    // Prefer by parentID match
    if (tracking.userMessageId) {
      const match = candidates.find(m => m.info.parentID === tracking.userMessageId);
      if (match) return match;
    }

    // Fall back to first assistant message created after submission
    return candidates.find(m => {
      const created = m.info?.time?.created;
      return !created || created >= tracking.submittedAt;
    }) ?? candidates[candidates.length - 1];
  }

  _isComplete(msg) {
    if (msg.info?.time?.completed) return true;
    const finish = msg.info?.finish;
    if (finish === "stop" || finish === "tool-calls") return true;
    return false;
  }

  _extractText(msg) {
    const parts = msg.parts || [];
    return parts
      .filter(p => p.type === "text")
      .map(p => p.text || p.content || "")
      .join("\n")
      .trim() || null;
  }

  _lastToolPart(msg) {
    const parts = msg.parts || [];
    const toolParts = parts.filter(p => p.type === "tool");
    return toolParts[toolParts.length - 1] ?? null;
  }

  async _sendNotice(event, text) {
    try {
      await this.replySender.sendReply(event, text, { skipPrefix: true });
    } catch {
      // best-effort
    }
  }
}
```

- [ ] **Step 4: Run tests and confirm pass**

```bash
node --test test/async-analysis.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/async-analysis.js test/async-analysis.test.js
git commit -m "feat: add AsyncAnalysis orchestrator with tool-stuck detection"
```

---

### Task 5: Wire async path into `oncall-bot.js`

**Files:**
- Modify: `oncall-bot.js`

The queue should cover only the front half (context → submit → processing notice). The background poll runs detached.

- [ ] **Step 1: Read current `oncall-bot.js` `handleTrigger` to confirm shape before editing**

```bash
node --test test/
```

Expected: all existing tests still pass — baseline before wiring.

- [ ] **Step 2: Update imports and instantiate new objects in `oncall-bot.js`**

Add imports at the top (after existing imports):

```js
import { AsyncAnalysis } from "./lib/async-analysis.js";
import { PendingJobs } from "./lib/pending-jobs.js";
```

After `const queue = new ChatQueue(config.concurrency);`, add:

```js
const pendingJobs = new PendingJobs();
```

After `const opencode = new OpenCodeClient(config);`, add:

```js
const asyncAnalysis = new AsyncAnalysis({ client: opencode, replySender, config });
```

- [ ] **Step 3: Replace `handleTrigger` body**

Replace the entire `handleTrigger` function with:

```js
async function handleTrigger(event) {
  const chatId = event.chat_id;
  const messageId = event.message_id;
  const senderId = event.sender_id;

  log(`← trigger: ${senderId} in ${chatId} (${messageId})`);

  const result = queue.enqueue(chatId, async () => {
    // Dedup: skip if a job for this trigger is already running
    const jobKey = `${chatId}:${messageId}`;
    if (pendingJobs.get(jobKey)) {
      log(`  ⚠ duplicate trigger ignored (${jobKey})`);
      return;
    }

    try {
      // 1. Fetch context
      log(`  fetching ${config.context.message_count} messages context...`);
      const contextMessages = await contextFetcher.fetchContext(chatId, event.create_time);

      // 2. Detect intent
      const intent = detectIntent(event, contextMessages);
      log(`  intent: ${intent}`);

      // 3. Resolve chat name
      const chatName = await contextFetcher.getChatName(chatId);

      // 4. Build intent-aware prompt
      const prompt = buildIntentPrompt(intent, config.prompt, event, contextMessages);

      // 5. Build session options and find/create session
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
      log(`  session: "${sessionOptions.title}" (${sessionId})`);

      // 6. Send processing notice immediately
      if (shouldSendProcessingNotice(config)) {
        await replySender.sendReply(event, getProcessingNotice(config), { skipPrefix: true });
        log("  sent processing notice");
      }

      // 7. Register pending job (best-effort dedup across rapid re-triggers)
      pendingJobs.register({ chatId, triggerMessageId: messageId, sessionId, submittedAt: Date.now(), userMessageId: null });

      // 8. Launch background analysis — detached from queue
      asyncAnalysis.run(event, sessionId, prompt)
        .then(() => {
          pendingJobs.complete(jobKey);
          log(`→ async analysis complete (${messageId})`);
        })
        .catch((err) => {
          pendingJobs.fail(jobKey, err);
          log(`✗ async analysis error: ${err.message}`);
        });

      log(`  background analysis started (${messageId})`);
    } catch (err) {
      log(`✗ error in trigger setup: ${err.message}`);
      try {
        await replySender.sendReply(event, `⚠️ Failed to start analysis: ${err.message}`);
      } catch {
        // best-effort
      }
    }
  });

  if (result === null) {
    log(`  ⚠ queue full for ${chatId}, dropping message ${messageId}`);
  }
}
```

- [ ] **Step 4: Run full test suite**

```bash
node --test test/
```

Expected: all pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add oncall-bot.js
git commit -m "feat: wire async submit and polling into oncall-bot"
```

---

### Task 6: Full regression and smoke test

**Files:**
- none — verification only

- [ ] **Step 1: Run full test suite**

```bash
node --test test/
```

Expected: all pass, output ends with `# fail 0`.

- [ ] **Step 2: Verify `oncall-bot.js` starts cleanly (without sending real messages)**

```bash
node oncall-bot.js --config oncall-bot.config.json 2>&1 &
sleep 3
kill %1
```

Expected: logs show preflight checks passing, no crash.

- [ ] **Step 3: Commit updated spec**

```bash
git add docs/superpowers/specs/2026-06-09-opencode-async-submit-polling-design.md
git commit -m "docs: update async spec with tool-stuck detection and POST blocking findings"
```

- [ ] **Step 4: Final commit tag**

```bash
git log --oneline -8
```

Confirm the chain looks like:

```
docs: update async spec with tool-stuck detection and POST blocking findings
feat: wire async submit and polling into oncall-bot
feat: add AsyncAnalysis orchestrator with tool-stuck detection
feat: add PendingJobs registry
feat: add submitMessage and listMessages to OpenCodeClient
feat: add async opencode config defaults
docs: add async submit and polling design
fix: handle approval delays more gracefully
```
