# Thread Context And Session Prompt Design

## Goal

Fix `oncall-bot` so simple trigger messages are not over-interpreted as incident investigation requests, especially when they are sent inside a thread.

The bot should:

1. Use only thread-local context for thread messages.
2. Tell the AI who sent the trigger and which thread it belongs to.
3. Make the AI decide from trigger metadata whether context is needed and which scope is allowed.
4. Avoid re-sending the full initial prompt when reusing an existing OpenCode session.

## Problems To Fix

1. Context is always fetched at chat scope, so thread messages are polluted by unrelated main-chat history.
2. Intent detection can upgrade a harmless trigger like `hi` into `incident_analysis` based on old context alone.
3. The AI prompt does not clearly state sender, thread id, context scope, or whether the session is new or existing.
4. Existing sessions receive the same initial framing as new sessions, which causes stale task framing to bleed into new triggers.
5. Users are not explicitly told that thread messages will use only thread context.

## Desired Behavior

### Thread Context Scope

If an incoming event includes `thread_id`:

- Fetch only messages that belong to that `thread_id`.
- Do not read main-chat history.
- If thread context cannot be fetched, do not fall back to main-chat history.
- Instead, continue with `trigger_only` context using only the trigger message itself.

If an incoming event does not include `thread_id`:

- Continue using the existing chat-level recent-message context fetch.

### Processing Notices

For every trigger, first send the existing processing notice:

`Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.`

If the trigger is a thread message, send one more English notice immediately after it:

`This message was sent in a thread. I will only use messages from this thread as context.`

If the trigger is a thread message but thread history could not be fetched, send one additional English notice:

`I could not load thread history, so I will use only the trigger message itself.`

These notices should be additive and sent after the existing processing notice.

## Trigger Metadata Model

Every prompt sent to OpenCode should begin with a structured trigger metadata section.

Required fields:

- `sender_id`
- `chat_id`
- `message_id`
- `thread_id` when present
- `is_thread_message`
- `session_state` with value `new` or `existing`
- `context_scope` with value `thread`, `chat`, or `trigger_only`
- `intent`

This metadata becomes the primary input for deciding how to respond.

## Prompt Strategy

### Shared Rule

All prompts must instruct the AI to evaluate the trigger metadata first before using any context.

The AI must:

1. Read trigger metadata first.
2. Decide whether extra context is needed.
3. Use only the declared `context_scope`.
4. Refuse to assume any context outside the declared scope.

### New Session Prompt

If the OpenCode session is newly created, send the full initial prompt.

The initial prompt must include:

- intent-specific system framing
- the shared instruction to inspect trigger metadata first
- the declared context scope restrictions
- the allowed context block
- the trigger message

For thread messages, the prompt must explicitly say that only thread context may be used.

### Existing Session Prompt

If the OpenCode session already exists, do not send the full initial prompt again.

Instead send a continuation-style prompt that says, in effect:

- a new trigger message has arrived
- re-evaluate the new trigger first
- use only the newly declared context scope
- do not assume previous session context is still relevant unless it matches the new trigger

This prevents old investigation framing from dominating a new lightweight trigger.

## Intent Detection Rules

Intent detection should become more conservative.

### Priority

1. `pr_review`
2. `summary`
3. `incident_analysis`
4. `other`

### Detection Source Of Truth

The trigger message itself is the primary source of truth.

Changes:

- `incident_analysis` must not be selected only because recent context contains incident-like words.
- A benign trigger like `hi`, `hello`, or other generic chat text must remain `other` unless the trigger text itself indicates investigation work.
- Context may support interpretation, but it must not override a neutral trigger into `incident_analysis`.

This is the main protection against over-diagnosing simple messages.

## Session Strategy

Existing reuse behavior by intent stays mostly intact, but prompt behavior becomes session-state-aware.

### `incident_analysis`

- Reuse is still allowed by chat and date.
- Existing reused session must receive the continuation-style prompt, not the full initial prompt.

### `summary`

- Force a fresh session.

### `pr_review`

- Reuse only when the same PR URL is referenced.
- If reused, use the continuation-style prompt.

### `other`

- Force a fresh session.

## Context Fetch Result Model

Context fetching should return both message lines and scope metadata.

Suggested result shape:

- `messages`: formatted context lines
- `scope`: `thread`, `chat`, or `trigger_only`
- `threadId`: nullable
- `fetchFailed`: boolean

This avoids reconstructing scope logic in multiple places.

## Code Changes

### `oncall-bot.js`

- Detect whether the event is a thread message.
- Use thread-aware context fetching.
- Send the existing processing notice first.
- For thread messages, send the thread-only English notice.
- If thread fetch fails, send the trigger-only fallback notice.
- Pass session state, trigger metadata, and context scope into prompt building.

### `lib/context-fetcher.js`

- Add thread-aware fetch support.
- Expose a single API that returns formatted messages plus scope metadata.
- For thread fetch failure, return `trigger_only` with no main-chat fallback.
- Keep current chat-level fetch for non-thread triggers.

### `lib/opencode-client.js`

- Extend session lookup/creation to report whether the returned session is newly created or reused.
- Preserve existing reuse logic and archived-session exclusion behavior.

### `lib/intent-router.js`

- Tighten `detectIntent()` so neutral trigger text stays neutral.
- Build two prompt variants: one for new sessions and one for existing sessions.
- Always include trigger metadata before context and trigger body.
- Make prompt wording emphasize context-scope restrictions.

### `lib/reply-sender.js`

- No routing change is required.
- Existing reply path can be reused for additional notices.

### `config`

- Add configurable notice text for:
  - thread-only context notice
  - trigger-only fallback notice
- Add prompt template fields for session-state-aware instructions if needed.

## Testing

Required tests:

1. Thread context fetch uses only thread messages.
2. Thread fetch failure results in `trigger_only` scope.
3. Thread fetch failure does not fall back to chat-level context.
4. Neutral trigger text like `hi` remains `other` even when surrounding context contains incident keywords.
5. Prompt metadata includes sender and thread id.
6. New session prompt uses full initial framing.
7. Existing session prompt uses continuation framing instead of the full initial prompt.
8. Thread messages send the extra thread-only notice.
9. Thread fetch failure sends the extra trigger-only fallback notice.

## Recommended Implementation Order

1. Add failing intent tests for neutral triggers.
2. Add failing context-fetch tests for thread-only and trigger-only fallback behavior.
3. Implement thread-aware context fetch.
4. Implement conservative intent detection.
5. Add failing prompt-construction tests for metadata and session state.
6. Implement prompt changes.
7. Add failing orchestration tests for extra notices.
8. Implement notice sending and session-state handling.

## Scope Boundaries

This change does not include:

- model-based intent classification
- cross-thread context merging
- fallback from thread context to main-chat context
- changes to reply target routing
- changes to archived-session policy beyond current exclusion behavior
