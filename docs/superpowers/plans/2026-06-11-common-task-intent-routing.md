# Common Task Intent Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fallback `other` intent with `common_task`, make routing keywords editable in the dashboard, and update prompt defaults and UI labels to `Common Task`.

**Architecture:** Keep the existing fixed four-intent model, but rename the fallback intent everywhere and move keyword routing rules into a new config-backed `intent_routing` block. Update the dashboard to edit both prompt content and routing keywords while preserving the existing config-save and prompt-save patterns.

**Tech Stack:** Node.js, vanilla JavaScript, embedded HTTP dashboard, Node test runner, JSON config persistence

---

## File Structure

- Modify: `lib/config.js`
  Responsibility: define default prompt config, default routing config, and normalized config shape for `common_task` and `intent_routing`.
- Modify: `lib/intent-router.js`
  Responsibility: detect intent using config-backed routing keywords, fallback to `common_task`, build prompts from `prompt.common_task`, and generate renamed session titles/cache keys.
- Modify: `lib/trigger-orchestration.js`
  Responsibility: pass routing config into intent detection so routing can read user-edited keywords.
- Modify: `lib/dashboard-server.js`
  Responsibility: expose and persist `intent_routing`, `prompt.common_task`, and `pua.intents.common_task` through dashboard APIs.
- Modify: `dashboard/index.html`
  Responsibility: rename UI labels to initial caps, update Prompt Editor intent keys, replace read-only keyword card with editable routing controls, and save routing changes.
- Modify: `oncall-bot.config.json`
  Responsibility: update the example/local config to use `common_task` and include `intent_routing` defaults.
- Modify: `test/intent-router.test.js`
  Responsibility: verify renamed fallback intent, config-backed routing behavior, and session naming.
- Modify: `test/oncall-orchestration.test.js`
  Responsibility: verify orchestration passes `intent_routing` into detection and uses `common_task` names in downstream calls.
- Modify: `test/dashboard-server.test.js`
  Responsibility: verify dashboard prompt/config/PUA/routing APIs persist the new keys.
- Modify: `test/identity-split.test.js`
  Responsibility: verify config defaults normalize to `prompt.common_task` instead of `prompt.other`.

### Task 1: Rename Config Defaults To `common_task`

**Files:**
- Modify: `lib/config.js`
- Modify: `test/identity-split.test.js`

- [ ] **Step 1: Write the failing config-default test**

Add or update the defaults assertion in `test/identity-split.test.js` so it expects `config.prompt.common_task` and `config.pua.intents.common_task`, and explicitly rejects `config.prompt.other`.

```javascript
assert.deepEqual(config.prompt.common_task, defaults.prompt.common_task);
assert.equal(Object.hasOwn(config.prompt, "other"), false);
assert.equal(config.pua.intents.common_task, defaults.pua.intents.common_task);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/identity-split.test.js`
Expected: FAIL because defaults still expose `other` instead of `common_task`.

- [ ] **Step 3: Write minimal config implementation**

Update `lib/config.js` to:

- rename `defaultPromptConfig.other` to `defaultPromptConfig.common_task`
- add `defaultIntentRoutingConfig`
- normalize `config.prompt.common_task`
- normalize `config.intent_routing`
- rename `pua.intents.other` default to `pua.intents.common_task`

Code shape to add near the existing prompt defaults:

```javascript
const defaultIntentRoutingConfig = {
  summary: {
    keywords: ["summary", "summarize", "summarise", "总结", "总结上面", "总结上面的对话"],
  },
  incident_analysis: {
    keywords: ["incident", "error", "failure", "failing", "broken", "debug", "investigate", "排查", "报错", "故障", "异常"],
  },
  pr_review: {
    keywords: [],
    use_github_pr_url: true,
  },
};
```

And normalize like:

```javascript
config.intent_routing = {
  ...defaultIntentRoutingConfig,
  ...config.intent_routing,
  summary: { ...defaultIntentRoutingConfig.summary, ...config.intent_routing?.summary },
  incident_analysis: { ...defaultIntentRoutingConfig.incident_analysis, ...config.intent_routing?.incident_analysis },
  pr_review: { ...defaultIntentRoutingConfig.pr_review, ...config.intent_routing?.pr_review },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/identity-split.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/config.js test/identity-split.test.js
git commit -m "refactor: rename other config to common task"
```

### Task 2: Switch Intent Router To Config-Backed `common_task`

**Files:**
- Modify: `lib/intent-router.js`
- Modify: `test/intent-router.test.js`

- [ ] **Step 1: Write the failing router tests**

Update `test/intent-router.test.js` so it:

- expects generic fallback to return `common_task`
- expects prompt building for fallback to use `common_task`
- expects session naming to use `common-task` and `common_task`
- adds a config-backed keyword case by calling `detectIntent(event, contextLines, routingConfig)`

Example test additions:

```javascript
const routingConfig = {
  summary: { keywords: ["tl;dr"] },
  incident_analysis: { keywords: ["sev1"] },
  pr_review: { keywords: ["review pr"], use_github_pr_url: true },
};

assert.equal(detectIntent({ content: "tl;dr this" }, [], routingConfig), "summary");
assert.equal(detectIntent({ content: "translate this" }, []), "common_task");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/intent-router.test.js`
Expected: FAIL because `detectIntent()` still returns `other`, ignores routing config, and builds `other` session names.

- [ ] **Step 3: Write minimal router implementation**

Update `lib/intent-router.js` to:

- replace hardcoded keyword arrays with default routing constants that mirror `lib/config.js`
- change `detectIntent(event, _contextLines = [])` to `detectIntent(event, _contextLines = [], routingConfig = DEFAULT_INTENT_ROUTING)`
- read summary, incident, and optional PR keywords from `routingConfig`
- keep GitHub PR URL detection first when `use_github_pr_url !== false`
- fallback to `common_task`
- switch prompt fallback from `.other` to `.common_task`
- rename session titles and cache keys for the fallback intent

Implementation shape:

```javascript
const config = resolvedPromptConfig?.[intent] || resolvedPromptConfig?.common_task || {};

if (summaryKeywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
  return "summary";
}

return "common_task";
```

And for session naming:

```javascript
title: `${chatName}-common-task-${today}`,
cacheKey: `${intent}:${chatId}:${triggerMessageId}`,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/intent-router.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/intent-router.js test/intent-router.test.js
git commit -m "refactor: route fallback intent as common task"
```

### Task 3: Pass Routing Config Through Trigger Orchestration

**Files:**
- Modify: `lib/trigger-orchestration.js`
- Modify: `test/oncall-orchestration.test.js`

- [ ] **Step 1: Write the failing orchestration test**

Update the first orchestration assertion in `test/oncall-orchestration.test.js` so the `detectIntentFn` spy receives a third argument, `baseConfig.intent_routing`, and expects downstream intent/session/prompt values to use `common_task`.

Example assertion updates:

```javascript
assert.deepEqual(detectIntentCalls, [{
  receivedEvent: event,
  messages: ["[06/09 15:07] user: hi there"],
  routingConfig: baseConfig.intent_routing,
}]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/oncall-orchestration.test.js`
Expected: FAIL because `processTrigger()` only passes two arguments to `detectIntentFn` and tests still reference `other`.

- [ ] **Step 3: Write minimal orchestration implementation**

Update `lib/trigger-orchestration.js` so intent detection becomes:

```javascript
const intent = detectIntentFn(event, contextResult.messages, config.intent_routing);
```

Then update the test fixtures in `test/oncall-orchestration.test.js` to define:

```javascript
intent_routing: {
  summary: { keywords: [] },
  incident_analysis: { keywords: [] },
  pr_review: { keywords: [], use_github_pr_url: true },
},
prompt: {
  common_task: {
    system_prefix: "You are an AI assistant.",
    task_instructions: "Use the trigger message as the primary task instruction.",
    response_format: "Keep the reply direct and useful.",
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/oncall-orchestration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/trigger-orchestration.js test/oncall-orchestration.test.js
git commit -m "refactor: pass intent routing config through orchestration"
```

### Task 4: Persist `common_task` And Routing Config In Dashboard APIs

**Files:**
- Modify: `lib/dashboard-server.js`
- Modify: `test/dashboard-server.test.js`

- [ ] **Step 1: Write the failing dashboard API tests**

In `test/dashboard-server.test.js`:

- rename the fixture prompt key from `other` to `common_task`
- add `intent_routing` to the fixture config
- extend `GET /api/prompts` or `GET /api/config` assertions to expect `common_task` and `intent_routing`
- add a save test for `PUT /api/config` or `PUT /api/prompts` that persists `pua.intents.common_task`

Example assertion:

```javascript
assert.equal(data.common_task.system_prefix, "common");
assert.deepEqual(config.intent_routing.summary.keywords, ["summary"]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL because fixture and assertions no longer match the current `other`-based API state.

- [ ] **Step 3: Write minimal dashboard-server implementation**

Update `lib/dashboard-server.js` to:

- read `this._config.prompt.common_task` instead of `other` where fallback language detection is needed
- keep `GET /api/config` returning the whole config, now including `intent_routing`
- keep `PUT /api/config` deep-merging nested routing config objects correctly
- keep `PUT /api/prompts` writing `common_task`
- keep `PUT /api/pua-mode` writing `common_task`

For deep merge, extend `_handlePutConfig()` so nested child objects like `intent_routing.summary` are merged instead of overwritten shallowly.

Implementation shape:

```javascript
for (const [nestedKey, nestedVal] of Object.entries(val)) {
  if (nestedVal && typeof nestedVal === "object" && !Array.isArray(nestedVal) && this._config[key]?.[nestedKey] && typeof this._config[key][nestedKey] === "object") {
    Object.assign(this._config[key][nestedKey], nestedVal);
  } else {
    this._config[key][nestedKey] = nestedVal;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard-server.js test/dashboard-server.test.js
git commit -m "feat: persist common task routing config in dashboard"
```

### Task 5: Update Dashboard UI Labels And Prompt Editor Keys

**Files:**
- Modify: `dashboard/index.html`

- [ ] **Step 1: Write the failing UI snapshot-style test target**

There is no browser test suite here, so use an assertion-based file check by adding or updating a dashboard-server test that fetches `/` and expects the HTML to contain `Common Task`, not `other`, in the Prompt Editor and PUA sections.

Example test snippet for `test/dashboard-server.test.js`:

```javascript
const res = await fetch(`${baseUrl}/`);
const html = await res.text();
assert.match(html, />Common Task</);
assert.doesNotMatch(html, />other</);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL because the current HTML still renders `other`.

- [ ] **Step 3: Write minimal dashboard UI implementation**

Update `dashboard/index.html` to:

- change Prompt Editor button labels to `Summary`, `Incident Analysis`, `PR Review`, `Common Task`
- change the Prompt Editor fallback button `data-intent` from `other` to `common_task`
- rename PUA card ids and labels from `Other` to `Common Task`
- update JS state access from `prompts.other` and `pua.intents.other` to `common_task`

Concrete replacements to make:

```html
<div class="intent-btn" data-intent="common_task">Common Task</div>
```

```javascript
["puaCommonTask","cardPuaCommonTask"]
document.getElementById("puaCommonTask").checked = !!pua.intents?.common_task;
common_task: document.getElementById("puaCommonTask").checked,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html test/dashboard-server.test.js
git commit -m "feat: rename dashboard intent labels to common task"
```

### Task 6: Replace Read-Only Routing Keywords With Editable Controls

**Files:**
- Modify: `dashboard/index.html`
- Modify: `test/dashboard-server.test.js`

- [ ] **Step 1: Write the failing routing-save test**

Add a dashboard test that:

- calls `PUT /api/config` with a partial `intent_routing` update
- then fetches `GET /api/config`
- asserts the edited keywords persisted

Example test body:

```javascript
await fetch(`${baseUrl}/api/config`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    intent_routing: {
      summary: { keywords: ["tl;dr", "digest"] },
      pr_review: { keywords: ["please review"], use_github_pr_url: true },
    },
  }),
});
```

Then assert:

```javascript
assert.deepEqual(updated.intent_routing.summary.keywords, ["tl;dr", "digest"]);
assert.deepEqual(updated.intent_routing.pr_review.keywords, ["please review"]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-server.test.js`
Expected: FAIL if nested routing config is overwritten incorrectly or missing from fixtures.

- [ ] **Step 3: Write minimal dashboard routing editor implementation**

In `dashboard/index.html`:

- replace the static keyword card with textareas for summary, incident, and PR keywords
- add a checkbox for `Use GitHub PR URL Pattern`
- load these fields from `/api/config`
- save them through `PUT /api/config`
- parse textarea content as one keyword per line using:

```javascript
function parseKeywordLines(value){
  return value.split("\n").map(v => v.trim()).filter(Boolean);
}
```

And save using:

```javascript
await api("/api/config", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    intent_routing: {
      summary: { keywords: parseKeywordLines(document.getElementById("summaryKeywords").value) },
      incident_analysis: { keywords: parseKeywordLines(document.getElementById("incidentKeywords").value) },
      pr_review: {
        keywords: parseKeywordLines(document.getElementById("prKeywords").value),
        use_github_pr_url: document.getElementById("prUrlToggle").checked,
      },
    },
  }),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-server.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/index.html test/dashboard-server.test.js
git commit -m "feat: add editable intent routing keywords"
```

### Task 7: Update Local Config Fixture And Full Verification

**Files:**
- Modify: `oncall-bot.config.json`

- [ ] **Step 1: Update the local config file**

Replace the old fallback sections in `oncall-bot.config.json` with the new keys.

Set the prompt block to:

```json
"common_task": {
  "system_prefix": "You are an AI assistant. Use any available tools when they help complete the task. Follow the trigger message to decide what to do and how to reply.",
  "task_instructions": "Use the trigger message as the primary task instruction. Review the provided context messages, filter for the parts relevant to the trigger, and use them as supporting evidence when they are related. Answer directly, and take action when the request requires action.",
  "response_format": "Respond in English."
}
```

Add:

```json
"intent_routing": {
  "summary": { "keywords": ["summary", "summarize", "summarise", "总结", "总结上面", "总结上面的对话"] },
  "incident_analysis": { "keywords": ["incident", "error", "failure", "failing", "broken", "debug", "investigate", "排查", "报错", "故障", "异常"] },
  "pr_review": { "keywords": [], "use_github_pr_url": true }
}
```

And rename:

```json
"common_task": true
```

inside `pua.intents`.

- [ ] **Step 2: Run focused verification**

Run: `node --test test/identity-split.test.js test/intent-router.test.js test/oncall-orchestration.test.js test/dashboard-server.test.js`
Expected: PASS.

- [ ] **Step 3: Run broader verification**

Run: `node --test`
Expected: PASS, or if unrelated failures exist, document exactly which tests are unrelated to this change before proceeding.

- [ ] **Step 4: Commit**

```bash
git add oncall-bot.config.json
git commit -m "chore: update config defaults for common task routing"
```

## Self-Review

- Spec coverage check:
  - `common_task` rename: Tasks 1, 2, 3, 4, 5, 7
  - editable routing config: Tasks 1, 4, 6, 7
  - Prompt Editor and PUA relabeling: Tasks 4 and 5
  - prompt wording and fallback behavior: Tasks 1, 2, 7
  - tests for routing/session naming/dashboard persistence: Tasks 2, 3, 4, 5, 6, 7
- Placeholder scan: no `TODO`, `TBD`, or implicit “write tests” placeholders remain.
- Type consistency check:
  - final intent key is consistently `common_task`
  - routing config key is consistently `intent_routing`
  - PR toggle is consistently `use_github_pr_url`

Plan complete and saved to `docs/superpowers/plans/2026-06-11-common-task-intent-routing.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
