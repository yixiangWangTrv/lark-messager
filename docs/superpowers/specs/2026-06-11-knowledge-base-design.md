# Knowledge Base Dashboard Design

**Date:** 2026-06-11
**Status:** Approved

## Overview

Add a global knowledge-base feature to the embedded oncall-bot dashboard. Users can maintain reusable reference items from local files, project names, GitHub links, Lark documents, and free-text notes. When the bot is triggered, enabled knowledge-base items are injected into the bot prompt as structured reference context.

This is a v1 implementation focused on local persistence and prompt injection, not full external content crawling.

## Scope

### Included in v1

- Global knowledge-base shared across all bot triggers
- Dashboard UI to create, edit, enable/disable, refresh, and delete items
- Support for 5 source types:
  - `local_file`
  - `project_name`
  - `github_url`
  - `lark_doc`
  - `free_text`
- Real content extraction for:
  - `local_file`
  - `free_text`
- Reference-only storage for:
  - `project_name`
  - `github_url`
  - `lark_doc`
- Prompt-time injection of enabled knowledge-base summaries into all bot requests
- Config persistence in `oncall-bot.config.json`

### Not included in v1

- Per-group binding
- Per-intent binding
- Manual per-request selection in UI
- Automatic GitHub content fetching
- Automatic Lark document content fetching
- Database or vector search
- Semantic retrieval or relevance ranking

## Constraints and Decisions

- The feature is local-first and single-user, matching the existing dashboard architecture.
- Knowledge-base data must be persisted in the bot config file, not in a separate DB.
- Only enabled items are injected into prompts.
- Injection format must be structured and summarized, not raw full-content dumping.
- The knowledge base is system/reference context, so it belongs in prompt construction, not chat context fetching.

## Data Model

Add a new top-level config block:

```json
{
  "knowledge_base": {
    "enabled": true,
    "items": [
      {
        "id": "kb_local_readme",
        "name": "Project README",
        "description": "Basic project usage and setup",
        "enabled": true,
        "source_type": "local_file",
        "source": {
          "path": "/Users/yixiang.wang/oncall-bot/README.md"
        },
        "content": {
          "mode": "inline_text",
          "text": "Extracted file text..."
        },
        "updated_at": "2026-06-11T12:00:00.000Z"
      },
      {
        "id": "kb_ops_notes",
        "name": "Ops Notes",
        "description": "Manual troubleshooting notes",
        "enabled": true,
        "source_type": "free_text",
        "source": {},
        "content": {
          "mode": "inline_text",
          "text": "If XX happens, first check YY..."
        },
        "updated_at": "2026-06-11T12:00:00.000Z"
      },
      {
        "id": "kb_repo_link",
        "name": "Core Repo",
        "description": "Main code repository reference",
        "enabled": true,
        "source_type": "github_url",
        "source": {
          "url": "https://github.com/org/repo"
        },
        "content": {
          "mode": "reference_only",
          "text": ""
        },
        "updated_at": "2026-06-11T12:00:00.000Z"
      }
    ]
  }
}
```

## Source Types

### `local_file`

- Input: `source.path`
- Behavior: read local file text at save time
- Content mode: `inline_text`

### `free_text`

- Input: user-entered text body
- Behavior: store directly
- Content mode: `inline_text`

### `project_name`

- Input: `source.project_name`
- Behavior: store as structured reference only
- Content mode: `reference_only`

### `github_url`

- Input: `source.url`
- Behavior: store as structured reference only
- Content mode: `reference_only`

### `lark_doc`

- Input: `source.url`
- Behavior: store as structured reference only
- Content mode: `reference_only`

## Dashboard UI

Add a new tab: `Knowledge Base`

Suggested tab order:

- Sessions
- Knowledge Base
- Distill
- Servers
- Prompts
- Settings

### Knowledge Base Panel Layout

#### 1. Create/Edit Form

Fields:

- `Name`
- `Description`
- `Source Type`
- Dynamic source input:
  - `local_file` → `path`
  - `project_name` → `project_name`
  - `github_url` → `url`
  - `lark_doc` → `url`
  - `free_text` → large text area

Actions:

- `Add to Knowledge Base`
- `Save Changes` (when editing)

#### 2. Item List

Each item shows:

- name
- description
- source type
- source summary
- content mode (`inline_text` / `reference_only`)
- updated time
- enabled toggle
- actions:
  - `Edit`
  - `Delete`
  - `Refresh Content` (local file only)

#### 3. Empty State

When no items exist:

```text
No knowledge base items yet. Add one above.
```

## API Design

### `GET /api/knowledge-base`

Returns:

```json
{
  "enabled": true,
  "items": []
}
```

### `PUT /api/knowledge-base`

Updates the global enabled flag.

Body:

```json
{
  "enabled": true
}
```

### `POST /api/knowledge-base/items`

Creates a new item.

### `PUT /api/knowledge-base/items/:id`

Updates an existing item.

### `DELETE /api/knowledge-base/items/:id`

Deletes an item.

### `POST /api/knowledge-base/items/:id/refresh`

Re-reads local file content for `local_file` items.

## Validation Rules

### Common

- `name` is required
- `source_type` must be one of the supported values
- `description` is optional
- `id` is generated server-side

### `local_file`

- `source.path` is required
- file must be readable
- extracted text may be empty only if the file itself is empty

### `free_text`

- text body is required

### `github_url` and `lark_doc`

- `source.url` is required
- basic URL validation only in v1

### `project_name`

- `source.project_name` is required

## Prompt Injection Design

The knowledge base is injected during prompt construction, not context fetching.

### Injection Point

Insert a new section inside `buildIntentPrompt()`:

- after trigger metadata
- before chat context

This keeps system/reference information separate from message history.

### Injection Format

```text
Knowledge base context:

[1] Project README
description: Basic project usage and setup
source_type: local_file
source_summary: /Users/yixiang.wang/oncall-bot/README.md
content:
<truncated text>

[2] Ops Notes
description: Manual troubleshooting notes
source_type: free_text
content:
<truncated text>

[3] Core Repo
description: Main code repository reference
source_type: github_url
source_summary: https://github.com/org/repo
reference_only: true
```

### Injection Rules

- only inject when `knowledge_base.enabled === true`
- only include items where `item.enabled === true`
- preserve item ordering from config

### Truncation Rules

- `inline_text` items: include truncated content only
- `reference_only` items: include metadata only
- each item should be capped to a safe length (v1 target: 1500-3000 chars)
- if truncation happens, append:

```text
[truncated]
```

## Module Boundaries

To avoid growing `dashboard-server.js` further, add a focused helper module:

### New file: `lib/knowledge-base.js`

Responsibilities:

- generate item ids
- validate item input
- normalize item shape
- read local file content
- refresh local file entries
- build prompt-ready knowledge-base summary text

### Existing file changes

- `lib/config.js`
  - add default `knowledge_base` block
- `lib/dashboard-server.js`
  - add CRUD + refresh endpoints
- `lib/intent-router.js`
  - inject knowledge-base summary into prompt
- `dashboard/index.html`
  - add `Knowledge Base` tab and UI

## Error Handling

### Dashboard/API

- invalid input → `400`
- missing item → `404`
- unreadable local file → `400` or `500` depending on failure mode

### Prompt Injection

- if the knowledge base is disabled or empty, inject nothing
- if one item is malformed, skip it only if safe normalization is possible
- if normalization fails during save/update, reject the API call instead of storing broken data

## Testing Strategy

### Unit tests

Add `test/knowledge-base.test.js` for:

- item normalization
- local file reading
- free-text storage
- reference-only item handling
- prompt summary building
- truncation behavior

### API tests

Extend dashboard server tests for:

- get knowledge-base config
- create/update/delete items
- refresh local file item

### Prompt tests

Extend intent-router tests for:

- injected knowledge-base section appears in prompt
- only enabled items are injected
- disabled global knowledge base does not inject

## Future Extensions

This v1 design intentionally leaves room for:

- per-group bindings
- per-intent bindings
- runtime selection
- GitHub content fetching
- Lark doc extraction
- summarization or semantic retrieval

The chosen data model does not need to change for those later additions.
