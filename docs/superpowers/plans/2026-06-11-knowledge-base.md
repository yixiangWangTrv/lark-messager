# Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global knowledge-base feature to the dashboard so users can manage reusable reference items and automatically inject enabled items into bot prompts.

**Architecture:** Store knowledge-base items in `oncall-bot.config.json` under a new top-level `knowledge_base` block. Add a focused helper module `lib/knowledge-base.js` for normalization, validation, local-file loading, refresh, and prompt summary generation. Expose CRUD APIs from `lib/dashboard-server.js` and inject the formatted summary in `lib/intent-router.js` during prompt construction.

**Tech Stack:** Node.js ESM, built-in `fs`, existing dashboard HTML/vanilla JS, built-in `node:test`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/knowledge-base.js` | Create | Knowledge-base item normalization, validation, file loading, summary building |
| `test/knowledge-base.test.js` | Create | Unit tests for knowledge-base helper behavior |
| `lib/config.js` | Modify | Add default `knowledge_base` config |
| `lib/dashboard-server.js` | Modify | Add knowledge-base CRUD + refresh APIs |
| `test/dashboard-server.test.js` | Modify | Add API coverage for knowledge-base routes |
| `lib/intent-router.js` | Modify | Inject knowledge-base summary into prompt |
| `test/intent-router.test.js` | Modify | Add prompt injection coverage |
| `dashboard/index.html` | Modify | Add Knowledge Base tab, form, list, and CRUD interactions |
| `oncall-bot.config.json` | Modify | Add empty default `knowledge_base` block |

---

### Task 1: Add Knowledge Base Helper Module

**Files:**
- Create: `lib/knowledge-base.js`
- Create: `test/knowledge-base.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/knowledge-base.test.js`:

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createKnowledgeBaseItem,
  refreshKnowledgeBaseItem,
  buildKnowledgeBasePromptSection,
} from "../lib/knowledge-base.js";

describe("knowledge-base helper", () => {
  it("creates a local_file item with inline_text content", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-"));
    const file = join(dir, "notes.txt");
    writeFileSync(file, "hello knowledge base");

    const item = createKnowledgeBaseItem({
      name: "Notes",
      description: "local file",
      source_type: "local_file",
      source: { path: file },
    });

    assert.equal(item.name, "Notes");
    assert.equal(item.source_type, "local_file");
    assert.equal(item.content.mode, "inline_text");
    assert.match(item.content.text, /hello knowledge base/);

    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a free_text item with inline_text content", () => {
    const item = createKnowledgeBaseItem({
      name: "Runbook",
      description: "manual note",
      source_type: "free_text",
      content: { text: "check service logs first" },
    });

    assert.equal(item.content.mode, "inline_text");
    assert.equal(item.content.text, "check service logs first");
  });

  it("creates a github_url item as reference_only", () => {
    const item = createKnowledgeBaseItem({
      name: "Repo",
      description: "core repo",
      source_type: "github_url",
      source: { url: "https://github.com/acme/api" },
    });

    assert.equal(item.content.mode, "reference_only");
    assert.equal(item.source.url, "https://github.com/acme/api");
  });

  it("refreshes local_file item from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-refresh-"));
    const file = join(dir, "notes.txt");
    writeFileSync(file, "version one");

    const item = createKnowledgeBaseItem({
      name: "Notes",
      description: "local file",
      source_type: "local_file",
      source: { path: file },
    });

    writeFileSync(file, "version two");
    const refreshed = refreshKnowledgeBaseItem(item);
    assert.match(refreshed.content.text, /version two/);

    rmSync(dir, { recursive: true, force: true });
  });

  it("builds prompt section from enabled items only", () => {
    const section = buildKnowledgeBasePromptSection({
      enabled: true,
      items: [
        {
          id: "1",
          name: "Enabled Item",
          description: "desc",
          enabled: true,
          source_type: "free_text",
          source: {},
          content: { mode: "inline_text", text: "abc" },
          updated_at: "2026-06-11T00:00:00.000Z",
        },
        {
          id: "2",
          name: "Disabled Item",
          description: "desc",
          enabled: false,
          source_type: "free_text",
          source: {},
          content: { mode: "inline_text", text: "should not appear" },
          updated_at: "2026-06-11T00:00:00.000Z",
        },
      ],
    });

    assert.match(section, /Knowledge base context:/);
    assert.match(section, /Enabled Item/);
    assert.doesNotMatch(section, /Disabled Item/);
  });

  it("returns empty string when global knowledge base is disabled", () => {
    const section = buildKnowledgeBasePromptSection({ enabled: false, items: [] });
    assert.equal(section, "");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/knowledge-base.test.js`

Expected: FAIL with module not found for `../lib/knowledge-base.js`

- [ ] **Step 3: Write the minimal implementation**

Create `lib/knowledge-base.js`:

```javascript
import { readFileSync } from "node:fs";

const SOURCE_TYPES = new Set([
  "local_file",
  "project_name",
  "github_url",
  "lark_doc",
  "free_text",
]);

function generateId(name = "item") {
  return `kb_${String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}_${Date.now()}`;
}

function assertValidSourceType(sourceType) {
  if (!SOURCE_TYPES.has(sourceType)) {
    throw new Error(`Unsupported source_type: ${sourceType}`);
  }
}

function readLocalFile(path) {
  return readFileSync(path, "utf-8");
}

function normalizeInlineContent(text = "") {
  return {
    mode: "inline_text",
    text: String(text),
  };
}

function normalizeReferenceContent() {
  return {
    mode: "reference_only",
    text: "",
  };
}

export function createKnowledgeBaseItem(input) {
  const name = String(input?.name || "").trim();
  const description = String(input?.description || "").trim();
  const sourceType = input?.source_type;

  if (!name) throw new Error("name is required");
  assertValidSourceType(sourceType);

  const now = new Date().toISOString();

  if (sourceType === "local_file") {
    const path = String(input?.source?.path || "").trim();
    if (!path) throw new Error("source.path is required for local_file");
    return {
      id: input?.id || generateId(name),
      name,
      description,
      enabled: input?.enabled !== false,
      source_type: sourceType,
      source: { path },
      content: normalizeInlineContent(readLocalFile(path)),
      updated_at: now,
    };
  }

  if (sourceType === "free_text") {
    const text = String(input?.content?.text || input?.text || "");
    if (!text.trim()) throw new Error("free_text content is required");
    return {
      id: input?.id || generateId(name),
      name,
      description,
      enabled: input?.enabled !== false,
      source_type: sourceType,
      source: {},
      content: normalizeInlineContent(text),
      updated_at: now,
    };
  }

  if (sourceType === "project_name") {
    const projectName = String(input?.source?.project_name || "").trim();
    if (!projectName) throw new Error("source.project_name is required for project_name");
    return {
      id: input?.id || generateId(name),
      name,
      description,
      enabled: input?.enabled !== false,
      source_type: sourceType,
      source: { project_name: projectName },
      content: normalizeReferenceContent(),
      updated_at: now,
    };
  }

  const url = String(input?.source?.url || "").trim();
  if (!url) throw new Error("source.url is required for url-based items");

  return {
    id: input?.id || generateId(name),
    name,
    description,
    enabled: input?.enabled !== false,
    source_type: sourceType,
    source: { url },
    content: normalizeReferenceContent(),
    updated_at: now,
  };
}

export function refreshKnowledgeBaseItem(item) {
  if (item?.source_type !== "local_file") {
    return {
      ...item,
      updated_at: new Date().toISOString(),
    };
  }

  return {
    ...item,
    content: normalizeInlineContent(readLocalFile(item.source.path)),
    updated_at: new Date().toISOString(),
  };
}

function truncateText(text, maxLength = 2000) {
  const value = String(text || "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n[truncated]`;
}

function summarizeSource(item) {
  if (item.source_type === "local_file") return item.source?.path || "";
  if (item.source_type === "project_name") return item.source?.project_name || "";
  if (item.source_type === "github_url" || item.source_type === "lark_doc") return item.source?.url || "";
  return "";
}

export function buildKnowledgeBasePromptSection(knowledgeBase) {
  if (!knowledgeBase?.enabled) return "";

  const enabledItems = (knowledgeBase.items || []).filter((item) => item?.enabled);
  if (enabledItems.length === 0) return "";

  const lines = ["Knowledge base context:", ""];

  enabledItems.forEach((item, index) => {
    lines.push(`[${index + 1}] ${item.name}`);
    if (item.description) lines.push(`description: ${item.description}`);
    lines.push(`source_type: ${item.source_type}`);

    const sourceSummary = summarizeSource(item);
    if (sourceSummary) lines.push(`source_summary: ${sourceSummary}`);

    if (item.content?.mode === "inline_text") {
      lines.push("content:");
      lines.push(truncateText(item.content.text));
    } else {
      lines.push("reference_only: true");
    }

    lines.push("");
  });

  return lines.join("\n").trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/knowledge-base.test.js`

Expected: PASS with 6 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge-base.js test/knowledge-base.test.js
git commit -m "feat: add knowledge base helper module"
```

---

### Task 2: Add Config Defaults for Knowledge Base

**Files:**
- Modify: `lib/config.js`
- Modify: `oncall-bot.config.json`
- Test: `test/integration-dashboard.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/integration-dashboard.test.js`:

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { loadConfig } from "../lib/config.js";

describe("config knowledge_base defaults", () => {
  it("applies knowledge_base defaults when field is missing", () => {
    const path = "/tmp/test-kb-config.json";
    writeFileSync(path, JSON.stringify({ opencode: { base_url: "http://localhost:3000" } }));

    const config = loadConfig(path);
    assert.deepEqual(config.knowledge_base, {
      enabled: true,
      items: [],
    });

    unlinkSync(path);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/integration-dashboard.test.js`

Expected: FAIL because `config.knowledge_base` is undefined

- [ ] **Step 3: Add the minimal config implementation**

Update `lib/config.js` by inserting after the dashboard defaults line:

```javascript
  config.knowledge_base = { enabled: true, items: [], ...config.knowledge_base };
```

Update `oncall-bot.config.json` by adding a new top-level block after `dashboard`:

```json
  "knowledge_base": {
    "enabled": true,
    "items": []
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/integration-dashboard.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/config.js oncall-bot.config.json test/integration-dashboard.test.js
git commit -m "feat: add knowledge base config defaults"
```

---

### Task 3: Add Knowledge Base CRUD APIs

**Files:**
- Modify: `lib/dashboard-server.js`
- Modify: `test/dashboard-server.test.js`
- Read: `lib/knowledge-base.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/dashboard-server.test.js`:

```javascript
  it("GET /api/knowledge-base returns global knowledge-base config", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.enabled, true);
    assert.ok(Array.isArray(data.items));
  });

  it("POST /api/knowledge-base/items creates a free_text item", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Runbook",
        description: "ops note",
        source_type: "free_text",
        content: { text: "check the logs first" },
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.name, "Runbook");
    assert.equal(data.source_type, "free_text");
    assert.equal(data.content.mode, "inline_text");
  });

  it("PUT /api/knowledge-base updates global enabled flag", async () => {
    const res = await fetch(`${baseUrl}/api/knowledge-base`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.enabled, false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-server.test.js`

Expected: FAIL with 404 for `/api/knowledge-base`

- [ ] **Step 3: Add the minimal API implementation**

Modify `lib/dashboard-server.js`:

Add import near the top:

```javascript
import {
  createKnowledgeBaseItem,
  refreshKnowledgeBaseItem,
} from "./knowledge-base.js";
```

Add route handling inside `_handleRequest` before the generic 404:

```javascript
    if (path === "/api/knowledge-base" && req.method === "GET") {
      return this._jsonResponse(res, this._config.knowledge_base || { enabled: true, items: [] });
    }
    if (path === "/api/knowledge-base" && req.method === "PUT") {
      return this._handlePutKnowledgeBase(req, res);
    }
    if (path === "/api/knowledge-base/items" && req.method === "POST") {
      return this._handlePostKnowledgeBaseItem(req, res);
    }
```

Add dynamic routes near the existing dynamic route section:

```javascript
    const kbMatch = path.match(/^\/api\/knowledge-base\/items\/([^/]+)(?:\/(refresh))?$/);
    if (kbMatch) {
      const id = kbMatch[1];
      const action = kbMatch[2];
      if (req.method === "PUT" && !action) {
        return this._handlePutKnowledgeBaseItem(id, req, res);
      }
      if (req.method === "DELETE" && !action) {
        return this._handleDeleteKnowledgeBaseItem(id, res);
      }
      if (req.method === "POST" && action === "refresh") {
        return this._handleRefreshKnowledgeBaseItem(id, res);
      }
    }
```

Add handler methods inside the class:

```javascript
  async _handlePutKnowledgeBase(req, res) {
    try {
      const body = await this._readBody(req);
      this._config.knowledge_base = this._config.knowledge_base || { enabled: true, items: [] };
      if (typeof body.enabled === "boolean") {
        this._config.knowledge_base.enabled = body.enabled;
      }
      this._saveConfig();
      this._jsonResponse(res, this._config.knowledge_base);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePostKnowledgeBaseItem(req, res) {
    try {
      const body = await this._readBody(req);
      this._config.knowledge_base = this._config.knowledge_base || { enabled: true, items: [] };
      const item = createKnowledgeBaseItem(body);
      this._config.knowledge_base.items.push(item);
      this._saveConfig();
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(item));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePutKnowledgeBaseItem(id, req, res) {
    try {
      const body = await this._readBody(req);
      const list = this._config.knowledge_base?.items || [];
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "knowledge-base item not found" }));
        return;
      }
      const updated = createKnowledgeBaseItem({ ...list[index], ...body, id });
      list[index] = updated;
      this._saveConfig();
      this._jsonResponse(res, updated);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  _handleDeleteKnowledgeBaseItem(id, res) {
    const items = this._config.knowledge_base?.items || [];
    const before = items.length;
    this._config.knowledge_base.items = items.filter((item) => item.id !== id);
    if (this._config.knowledge_base.items.length === before) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "knowledge-base item not found" }));
      return;
    }
    this._saveConfig();
    this._jsonResponse(res, { ok: true });
  }

  _handleRefreshKnowledgeBaseItem(id, res) {
    try {
      const items = this._config.knowledge_base?.items || [];
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "knowledge-base item not found" }));
        return;
      }
      items[index] = refreshKnowledgeBaseItem(items[index]);
      this._saveConfig();
      this._jsonResponse(res, items[index]);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-server.test.js`

Expected: PASS with new knowledge-base route tests included

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard-server.js test/dashboard-server.test.js
git commit -m "feat: add knowledge base dashboard APIs"
```

---

### Task 4: Inject Knowledge Base into Prompt Construction

**Files:**
- Modify: `lib/intent-router.js`
- Modify: `test/intent-router.test.js`
- Read: `lib/knowledge-base.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/intent-router.test.js`:

```javascript
  it("injects knowledge base context before chat context", () => {
    const prompt = buildIntentPrompt({
      intent: "other",
      promptConfig,
      event: {
        content: "help me",
        sender_id: "ou_user1",
        chat_id: "oc_chat1",
        message_id: "om_kb_1",
      },
      contextResult: {
        messages: ["[06/11 10:00] user: app is slow"],
        scope: "chat",
        threadId: null,
        fetchFailed: false,
      },
      sessionState: "new",
      knowledgeBase: {
        enabled: true,
        items: [
          {
            id: "kb_1",
            name: "Runbook",
            description: "ops guidance",
            enabled: true,
            source_type: "free_text",
            source: {},
            content: { mode: "inline_text", text: "restart worker first" },
            updated_at: "2026-06-11T00:00:00.000Z",
          },
        ],
      },
    });

    assert.match(prompt, /Knowledge base context:/);
    assert.match(prompt, /Runbook/);
    assert.match(prompt, /restart worker first/);
    assert.ok(prompt.indexOf("Knowledge base context:") < prompt.indexOf("Context:\n[06/11 10:00] user: app is slow"));
  });

  it("does not inject knowledge base when disabled", () => {
    const prompt = buildIntentPrompt({
      intent: "other",
      promptConfig,
      event: {
        content: "help me",
        sender_id: "ou_user1",
        chat_id: "oc_chat1",
        message_id: "om_kb_2",
      },
      contextResult: {
        messages: [],
        scope: "chat",
        threadId: null,
        fetchFailed: false,
      },
      sessionState: "new",
      knowledgeBase: { enabled: false, items: [] },
    });

    assert.doesNotMatch(prompt, /Knowledge base context:/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/intent-router.test.js`

Expected: FAIL because `knowledgeBase` is ignored today

- [ ] **Step 3: Add the minimal prompt integration**

Modify `lib/intent-router.js`.

Add import near the top:

```javascript
import { buildKnowledgeBasePromptSection } from "./knowledge-base.js";
```

Update `normalizePromptArgs()` so it accepts `knowledgeBase` from object-style input:

```javascript
      knowledgeBase: intentOrOptions.knowledgeBase || null,
```

And in the fallback branch:

```javascript
    knowledgeBase: null,
```

Destructure `knowledgeBase` inside `buildIntentPrompt()`:

```javascript
    knowledgeBase,
```

Then inject the summary after trigger metadata and before chat context:

```javascript
  sections.push(buildTriggerMetadata(resolvedEvent, intent, contextResult, sessionState));

  const knowledgeBaseSection = buildKnowledgeBasePromptSection(knowledgeBase);
  if (knowledgeBaseSection) {
    sections.push(knowledgeBaseSection);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/intent-router.test.js`

Expected: PASS with new tests included

- [ ] **Step 5: Commit**

```bash
git add lib/intent-router.js test/intent-router.test.js
git commit -m "feat: inject knowledge base into bot prompts"
```

---

### Task 5: Wire Knowledge Base Through Trigger Orchestration

**Files:**
- Modify: `lib/trigger-orchestration.js`
- Test: `test/oncall-orchestration.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/oncall-orchestration.test.js`:

```javascript
  it("passes knowledge base config into buildIntentPrompt", async () => {
    let capturedKnowledgeBase = null;

    await processTrigger({
      event: {
        chat_id: "oc_chat1",
        message_id: "om_1",
        sender_id: "ou_1",
        content: "hi",
        create_time: String(Date.now()),
      },
      config: {
        knowledge_base: {
          enabled: true,
          items: [{ id: "kb_1", name: "Note", enabled: true, source_type: "free_text", source: {}, content: { mode: "inline_text", text: "hello" } }],
        },
        prompt: { other: { system_prefix: "A", task_instructions: "B", response_format: "C" } },
        reply: { send_processing_notice: false },
      },
      queue: { enqueue: (_chatId, fn) => fn() },
      triggerGuard: { tryStart: () => true, markSuccess: () => {}, markFailure: () => {} },
      contextFetcher: {
        fetchContext: async () => ({ messages: [], scope: "chat", threadId: null, fetchFailed: false }),
        getChatName: async () => "Ops Room",
      },
      opencode: {
        findOrCreateSession: async () => ({ sessionId: "s1", sessionState: "new" }),
        sendMessage: async () => "ok",
      },
      replySender: { sendReply: async () => {} },
      detectIntentFn: () => "other",
      buildIntentPromptFn: (args) => {
        capturedKnowledgeBase = args.knowledgeBase;
        return "prompt";
      },
      buildSessionOptionsFn: () => ({ title: "x", cacheKey: "y", reuse: false }),
      getTodayFn: () => "2026-06-11",
    });

    assert.equal(capturedKnowledgeBase.enabled, true);
    assert.equal(capturedKnowledgeBase.items[0].name, "Note");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/oncall-orchestration.test.js`

Expected: FAIL because `knowledgeBase` is not passed today

- [ ] **Step 3: Add the minimal orchestration change**

Modify `lib/trigger-orchestration.js` and pass `knowledgeBase: config.knowledge_base` into `buildIntentPromptFn(...)`:

```javascript
    const prompt = buildIntentPromptFn({
      intent,
      promptConfig: config.prompt,
      event,
      contextResult,
      sessionState,
      knowledgeBase: config.knowledge_base,
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/oncall-orchestration.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/trigger-orchestration.js test/oncall-orchestration.test.js
git commit -m "feat: pass knowledge base through trigger orchestration"
```

---

### Task 6: Add Knowledge Base Dashboard UI

**Files:**
- Modify: `dashboard/index.html`
- Test: `test/dashboard-server.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/dashboard-server.test.js`:

```javascript
  it("GET / contains Knowledge Base tab", async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    assert.ok(html.includes("Knowledge Base"));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-server.test.js`

Expected: FAIL because the tab does not exist yet

- [ ] **Step 3: Implement the minimal UI**

Modify `dashboard/index.html`.

Add a new tab after `Sessions`:

```html
  <div class="tab" data-tab="knowledge-base">Knowledge Base</div>
```

Add a new panel near the other panels:

```html
  <div class="panel" id="panel-knowledge-base">
    <div class="card">
      <h3>Knowledge Base</h3>
      <div class="form-row">
        <label>Name:</label>
        <input type="text" id="kbName" placeholder="Item name" style="flex:1">
      </div>
      <div class="form-row">
        <label>Description:</label>
        <input type="text" id="kbDescription" placeholder="Description" style="flex:1">
      </div>
      <div class="form-row">
        <label>Source Type:</label>
        <select id="kbSourceType" onchange="renderKnowledgeBaseSourceFields()">
          <option value="local_file">Local File</option>
          <option value="project_name">Project Name</option>
          <option value="github_url">GitHub URL</option>
          <option value="lark_doc">Lark Doc</option>
          <option value="free_text">Free Text</option>
        </select>
      </div>
      <div id="kbDynamicFields"></div>
      <div class="form-row">
        <button onclick="createKnowledgeBaseItem()">Add to Knowledge Base</button>
      </div>
    </div>

    <div class="card">
      <h3>Knowledge Base Items</h3>
      <div class="form-row">
        <label>Global Enabled:</label>
        <input type="checkbox" id="kbGlobalEnabled" onchange="toggleKnowledgeBaseEnabled()">
      </div>
      <div id="knowledgeBaseContent">
        <p class="empty">No knowledge base items yet. Add one above.</p>
      </div>
    </div>
  </div>
```

Add JS helpers near the bottom of the file:

```javascript
let knowledgeBaseState = { enabled: true, items: [] };

function renderKnowledgeBaseSourceFields(editingItem = null) {
  const type = document.getElementById("kbSourceType").value;
  const root = document.getElementById("kbDynamicFields");
  const item = editingItem || {};

  if (type === "local_file") {
    root.innerHTML = `<div class="form-row"><label>Path:</label><input type="text" id="kbPath" placeholder="/path/to/file" style="flex:1" value="${esc(item.source?.path || "")}"></div>`;
    return;
  }
  if (type === "project_name") {
    root.innerHTML = `<div class="form-row"><label>Project:</label><input type="text" id="kbProjectName" placeholder="project name" style="flex:1" value="${esc(item.source?.project_name || "")}"></div>`;
    return;
  }
  if (type === "github_url" || type === "lark_doc") {
    root.innerHTML = `<div class="form-row"><label>URL:</label><input type="text" id="kbUrl" placeholder="https://..." style="flex:1" value="${esc(item.source?.url || "")}"></div>`;
    return;
  }
  root.innerHTML = `<div class="field-group"><label>Text</label><textarea id="kbText">${esc(item.content?.text || "")}</textarea></div>`;
}

async function loadKnowledgeBase() {
  try {
    knowledgeBaseState = await api("/api/knowledge-base");
    document.getElementById("kbGlobalEnabled").checked = !!knowledgeBaseState.enabled;
    renderKnowledgeBaseItems();
    renderKnowledgeBaseSourceFields();
  } catch (e) {
    console.error("knowledge-base", e);
  }
}

function renderKnowledgeBaseItems() {
  const root = document.getElementById("knowledgeBaseContent");
  const items = knowledgeBaseState.items || [];
  if (items.length === 0) {
    root.innerHTML = '<p class="empty">No knowledge base items yet. Add one above.</p>';
    return;
  }

  root.innerHTML = items.map((item) => `
    <div class="card" style="margin-bottom:12px">
      <div class="form-row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-weight:600">${esc(item.name)}</div>
          <div class="note">${esc(item.description || "")}</div>
          <div class="note">type: ${esc(item.source_type)} | mode: ${esc(item.content?.mode || "")}</div>
        </div>
        <div class="form-row">
          <label style="min-width:auto">Enabled</label>
          <input type="checkbox" ${item.enabled ? "checked" : ""} onchange="toggleKnowledgeBaseItem('${esc(item.id)}', this.checked)">
          ${item.source_type === "local_file" ? `<button class="secondary" onclick="refreshKnowledgeBaseItem('${esc(item.id)}')">Refresh Content</button>` : ""}
          <button class="danger" onclick="deleteKnowledgeBaseItem('${esc(item.id)}')">Delete</button>
        </div>
      </div>
    </div>
  `).join("");
}

async function createKnowledgeBaseItem() {
  const sourceType = document.getElementById("kbSourceType").value;
  const body = {
    name: document.getElementById("kbName").value,
    description: document.getElementById("kbDescription").value,
    source_type: sourceType,
  };

  if (sourceType === "local_file") body.source = { path: document.getElementById("kbPath").value };
  if (sourceType === "project_name") body.source = { project_name: document.getElementById("kbProjectName").value };
  if (sourceType === "github_url" || sourceType === "lark_doc") body.source = { url: document.getElementById("kbUrl").value };
  if (sourceType === "free_text") body.content = { text: document.getElementById("kbText").value };

  try {
    await api("/api/knowledge-base/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    document.getElementById("kbName").value = "";
    document.getElementById("kbDescription").value = "";
    renderKnowledgeBaseSourceFields();
    await loadKnowledgeBase();
  } catch (e) {
    alert(`Failed to create knowledge-base item: ${e.message}`);
  }
}

async function toggleKnowledgeBaseEnabled() {
  await api("/api/knowledge-base", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: document.getElementById("kbGlobalEnabled").checked }),
  });
  await loadKnowledgeBase();
}

async function toggleKnowledgeBaseItem(id, enabled) {
  const item = (knowledgeBaseState.items || []).find((entry) => entry.id === id);
  if (!item) return;
  await api(`/api/knowledge-base/items/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...item, enabled }),
  });
  await loadKnowledgeBase();
}

async function refreshKnowledgeBaseItem(id) {
  await api(`/api/knowledge-base/items/${id}/refresh`, { method: "POST" });
  await loadKnowledgeBase();
}

async function deleteKnowledgeBaseItem(id) {
  await api(`/api/knowledge-base/items/${id}`, { method: "DELETE" });
  await loadKnowledgeBase();
}
```

And call `loadKnowledgeBase();` inside `init()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-server.test.js`

Expected: PASS with the new HTML structure test

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html test/dashboard-server.test.js
git commit -m "feat: add knowledge base dashboard tab"
```

---

### Task 7: Run Full Verification

**Files:**
- Verify all touched files from Tasks 1-6

- [ ] **Step 1: Run targeted knowledge-base tests**

Run: `node --test test/knowledge-base.test.js test/dashboard-server.test.js test/intent-router.test.js test/oncall-orchestration.test.js test/integration-dashboard.test.js`

Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run: `node --test test/`

Expected: all tests pass with 0 failures

- [ ] **Step 3: Manual smoke check**

Run:

```bash
node oncall-bot.js
```

Verify:

- startup completes
- dashboard opens at `http://localhost:8015`
- `Knowledge Base` tab is visible
- creating a `free_text` item succeeds
- creating a `local_file` item succeeds when path is valid
- toggling global enabled off removes knowledge-base prompt injection on subsequent triggers

- [ ] **Step 4: Commit final verification state**

```bash
git add -A
git commit -m "chore: verify knowledge base dashboard integration"
```
