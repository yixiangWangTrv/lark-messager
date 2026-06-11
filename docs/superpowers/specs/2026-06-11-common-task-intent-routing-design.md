# Common Task Intent And Routing Design

## Goal

Replace the existing `other` intent with `common_task` across the project, make the Prompt Editor show `Common Task` as the fallback task type, and turn `Intent Routing Keywords` from a read-only explanation into editable configuration.

The `Common Task` default prompt should explicitly tell the assistant that:

- it is an AI assistant
- it may use any available tools when useful
- it should follow the trigger message to decide what work to do and how to reply
- it should inspect provided context messages, filter for the parts relevant to the trigger, and use them when they support the trigger request

## Scope

In scope:

- rename the fallback intent key and value from `other` to `common_task`
- update prompt configuration, PUA configuration, routing fallback, session naming, and dashboard labels accordingly
- keep the four existing intent types: `summary`, `incident_analysis`, `pr_review`, `common_task`
- show intent labels in the dashboard with initial capitals, including `Common Task`
- add editable routing-keyword configuration for routed intents in the dashboard
- move routing keywords out of hardcoded constants into config-backed defaults
- keep `common_task` as the fallback intent rather than a keyword-matched intent
- update tests to cover the new naming and config-backed routing behavior

Out of scope:

- backward compatibility for legacy `other` config keys
- dynamic creation or deletion of intent types
- changing the existing PR URL detection rule into a regex editor
- redesigning dashboard layout beyond the fields needed for this change

## Constraints

- No compatibility layer: after this change the app reads and writes `common_task` only
- Existing top-level intents remain fixed at four
- `common_task` is always the fallback and should not depend on keywords
- Dashboard remains plain HTML plus vanilla JavaScript
- Config continues to persist to `oncall-bot.config.json`

## Recommended Approach

Keep the current fixed-intent architecture, but rename the fallback intent end to end and introduce a separate `intent_routing` config block for editable keywords.

This keeps the change aligned with the current code structure while still making routing behavior user-editable in the dashboard. It avoids the much larger refactor of making the entire intent model data-driven.

## Data Model

### Prompt Config

Rename:

- `prompt.other` -> `prompt.common_task`
- `pua.intents.other` -> `pua.intents.common_task`

The prompt config shape stays the same:

```json
"prompt": {
  "summary": {
    "system_prefix": "...",
    "task_instructions": "...",
    "response_format": "..."
  },
  "incident_analysis": { "...": "..." },
  "pr_review": { "...": "..." },
  "common_task": {
    "system_prefix": "You are an AI assistant. Use any available tools when they help complete the task. Follow the trigger message to decide what to do and how to reply.",
    "task_instructions": "Use the trigger message as the primary task instruction. Review the provided context messages, filter for the parts relevant to the trigger, and use them as supporting evidence when they are related. Answer directly, and take action when the request requires action.",
    "response_format": "Respond in the same language as the user unless the trigger explicitly asks for another language. Keep the reply direct and useful."
  }
}
```

### Intent Routing Config

Add a new top-level config block:

```json
"intent_routing": {
  "summary": {
    "keywords": [
      "summary",
      "summarize",
      "summarise",
      "总结",
      "总结上面",
      "总结上面的对话"
    ]
  },
  "incident_analysis": {
    "keywords": [
      "incident",
      "error",
      "failure",
      "failing",
      "broken",
      "debug",
      "investigate",
      "排查",
      "报错",
      "故障",
      "异常"
    ]
  },
  "pr_review": {
    "keywords": [],
    "use_github_pr_url": true
  }
}
```

Notes:

- `common_task` does not appear in `intent_routing`; it is selected only as the fallback
- `pr_review` keeps URL-based detection even when its keyword list is empty
- default values live in `lib/config.js` so the app still works when this block is omitted from user config

## Routing Behavior

Intent detection should continue to follow the existing priority order:

1. distill-style command
2. PR review detection
3. summary keyword match
4. incident-analysis keyword match
5. fallback to `common_task`

Behavior details:

- PR detection still recognizes GitHub PR URLs first
- optional `pr_review.keywords` can supplement URL detection
- context lines still must not force a neutral trigger into an investigation intent
- any unmatched request becomes `common_task`

## Session Naming And Cache Keys

Replace `other` naming with `common-task` in human-readable titles and `common_task` in cache keys.

Examples:

- title: `Ops Room-common-task-2026-06-11`
- title for thread reuse: `Ops Room-common-task-2026-06-11-<thread-suffix>`
- cache key: `common_task:<chatId>:<messageId>`

This keeps titles readable while aligning identifiers with the renamed intent.

## Prompt Construction

Prompt construction should read `prompt.common_task` as the fallback prompt config instead of `prompt.other`.

For new sessions, the `Common Task` prompt should instruct the assistant to:

- behave as an AI assistant
- use any available tools when useful
- treat the trigger message as the primary task instruction
- read trigger metadata first
- filter provided context messages to only what is relevant to the trigger
- use relevant context as supporting evidence rather than as equal-priority instructions

Existing prompt-building behavior for trigger metadata, knowledge base injection, and context rendering stays unchanged.

## Dashboard UI

### Prompt Editor

Keep the four fixed prompt types, but show capitalized labels:

- `Summary`
- `Incident Analysis`
- `PR Review`
- `Common Task`

Underlying values remain:

- `summary`
- `incident_analysis`
- `pr_review`
- `common_task`

The Prompt Editor still exposes the same three editable fields for each intent:

- `system_prefix`
- `task_instructions`
- `response_format`

### Intent Routing Keywords

Replace the current read-only keyword explanation card with editable routing controls.

Recommended fields:

- `Summary Keywords`
- `Incident Analysis Keywords`
- `PR Review Keywords`
- `Use GitHub PR URL Pattern` toggle

Each keyword field may be implemented as multi-line text input, with one keyword per line. This is simpler than comma parsing and matches the dashboard's existing textarea pattern.

`Common Task` should not get a keywords field because it is fallback-only.

### PUA Panel

Rename the PUA toggle label from `other` to `Common Task` and persist it using `pua.intents.common_task`.

## Dashboard API

The dashboard config API should expose and persist the new routing block along with the renamed prompt and PUA keys.

Required behavior:

- `GET /api/config` includes `intent_routing`
- config save flow writes back `prompt.common_task`
- config save flow writes back `pua.intents.common_task`
- routing keyword save flow writes back `intent_routing`

Save behavior can remain atomic through the existing temporary-file-then-rename flow.

The dashboard may either:

- reuse the existing config save endpoint for routing changes, or
- add a dedicated routing-save handler

Either is acceptable as long as prompt edits and routing edits persist reliably and the frontend state stays consistent after save.

## Files Expected To Change

Primary code paths:

- `lib/config.js`
- `lib/intent-router.js`
- `lib/dashboard-server.js`
- `dashboard/index.html`
- `oncall-bot.config.json`

Test coverage likely needed in:

- `test/intent-router.test.js`
- `test/dashboard-server.test.js`
- `test/oncall-orchestration.test.js`
- `test/identity-split.test.js`
- any tests asserting session titles, cache keys, prompt keys, or PUA intent names

## Testing Strategy

### Intent Router Tests

Update and add tests for:

- fallback intent becomes `common_task`
- same-thread session reuse works for `common_task`
- top-level `common_task` sessions use the new title and cache-key naming
- summary and incident keywords are read from config-backed routing settings
- neutral triggers remain `common_task` even when context includes incident words
- PR URL detection still resolves to `pr_review`

### Prompt Tests

Update tests for:

- `buildIntentPrompt()` fallback prompt uses `prompt.common_task`
- generated prompt includes the new default `Common Task` wording where defaults are asserted

### Dashboard Tests

Update or add coverage for:

- Prompt Editor data uses `common_task`
- dashboard config responses include `intent_routing`
- saving config persists `prompt.common_task`
- saving config persists `pua.intents.common_task`
- routing keywords are editable and persist to config

## Migration Impact

This is a hard cutover.

After the change:

- existing configs must use `common_task`
- existing `other` fields are no longer read
- existing tests and fixtures must be updated in the same change set

This is acceptable because the requested implementation explicitly does not require backward compatibility.

## Non-Goals

- support both `other` and `common_task` at the same time
- expose custom regex editing for routing
- make intent ordering user-configurable
- infer routing rules from prompt text
- remove `summary`, `incident_analysis`, or `pr_review` from the product
