# OpenCode Async Submit And Polling Design

## Goal

Make `oncall-bot` resilient to OpenCode approval pauses by decoupling message submission from final-result delivery.

The bot should be able to:

1. submit work to OpenCode quickly
2. release the chat handler instead of blocking on one long HTTP request
3. keep checking for the final assistant reply
4. post the final answer back to Lark when it is ready

This design targets a first implementation based on HTTP polling against the raw OpenCode API on port `4096`.

## Current Problem

Today the bot calls `POST /session/{id}/message` through `OpenCodeClient.sendMessage()` and waits for one synchronous response.

That creates three operational problems:

1. approval pauses are treated like request hangs
2. the per-chat queue stays occupied for the full analysis duration
3. eventual timeout is reported as failure even when OpenCode is simply waiting for user approval

The recent timeout increase and processing notice reduce the pain, but they do not solve the root problem.

## Confirmed API Facts

The current local environment confirms the following:

1. raw OpenCode is reachable on `http://localhost:4096`
2. `GET /session` returns active sessions
3. `GET /session/{id}` returns session metadata
4. `GET /session/{id}/message` returns the session message timeline
5. each message entry includes `info`, `parts`, and message timing metadata
6. the wrapper health response reports `realtime.sse.v1`, but the first version should not depend on undocumented realtime endpoints
7. `POST /session/{id}/message` **blocks until the assistant finishes** — it does not return a quick ack
8. while POST is in-flight, `GET /session/{id}/message` already reflects the in-progress assistant message with partial parts

### Message state machine observed in GET

| tool `state.status` | `info.finish` | `info.time.completed` | Meaning |
|---------------------|---------------|-----------------------|---------|
| `pending`           | `null`        | `null`                | model just queued the tool call |
| `running`           | `null`        | `null`                | tool executing or waiting for approval |
| `completed`         | `null`        | `null`                | tool done, model still running |
| `completed`         | `"stop"` or `"tool-calls"` | set | full message done |

**Key finding:** when opencode is blocked on tool approval, the last tool part stays at `state.status === "running"` indefinitely and `info.time.completed` remains `null`. This is detectable via polling.

### POST return timing

Because `POST /session/{id}/message` blocks until completion, the async architecture must:

1. fire the POST in a background task detached from the chat queue
2. simultaneously poll `GET /session/{id}/message` from a separate loop
3. use the polling loop to detect tool-stuck state and deliver the final reply

This is enough to design a polling-based result retriever and a tool-stuck notifier.

## Scope

In scope:

- asynchronous submission for bot-triggered work (POST fired in background, queue released immediately)
- background polling for final assistant output via `GET /session/{id}/message`
- tool-stuck detection: when the last tool part stays `running` beyond a threshold, send a Lark notice
- final reply delivery back to Lark
- timeout and failure handling for long-running or approval-blocked tasks
- in-memory deduplication of pending jobs within one process

Out of scope for V1:

- SSE or websocket result streaming
- persistent recovery of pending jobs across process restarts
- cancellation API integration
- approval-state detection from realtime events

## Design Principles

1. Prefer documented and already observed APIs over speculative ones.
2. Treat submission and result retrieval as separate concerns.
3. Keep queue occupancy short.
4. Avoid duplicated final replies for the same trigger.
5. Preserve the current user-visible session behavior.

## Proposed Flow

### 1. Trigger Intake

`oncall-bot.js` keeps the current trigger pipeline for:

- fetch context
- detect intent
- resolve chat name
- build prompt
- find or create session

After that, behavior changes.

### 2. Immediate User Feedback

Before or immediately after submission, the bot posts the existing English processing notice:

`Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.`

This remains the user-facing acknowledgement that the task entered the async pipeline.

### 3. Async Submission

Replace the current monolithic `sendMessage()` usage with a submission-oriented client method:

- `submitMessage(sessionId, prompt)`

Responsibilities:

- send `POST /session/{id}/message`
- capture submission timestamp locally
- return a tracking object for later polling

Tracking object shape:

```js
{
  sessionId,
  submittedAt,
  requestStartedAt,
  requestCompletedAt,
  userMessageId: null | string,
}
```

`userMessageId` is optional because we do not yet know whether the submit response exposes it in all cases.

### 4. Background Polling

After submission, the bot starts a background wait routine instead of awaiting the final assistant text inline.

New client methods:

- `listMessages(sessionId)`
- `waitForAssistantReply(tracking, options)`

Polling source:

- `GET /session/{id}/message`

Polling selection rules:

1. only consider `role === "assistant"`
2. only consider messages created at or after the tracked submission window
3. if `userMessageId` is known, prefer assistant messages where `parentID === userMessageId`
4. if `userMessageId` is unknown, fall back to the first assistant message created after `submittedAt`

Completion rules:

An assistant message is considered complete when at least one of these is true:

1. `info.time.completed` exists
2. `info.finish` is `"stop"` or `"tool-calls"`
3. text parts are present and the message no longer changes across one additional poll

Rule 3 is a defensive fallback in case terminal metadata varies by provider.

### 4a. Tool-Stuck Detection

While polling, the bot also checks whether opencode is blocked waiting for tool approval.

Detection condition (all must be true):

1. an assistant message exists with `info.time.completed === null`
2. the last `tool` part has `state.status === "running"`
3. the tool part has been `running` for at least `tool_stuck_threshold_ms` (default `8000`)
4. the stuck notice has not been sent yet for this job

When detected, post a single Lark notice to the original thread (no bot prefix):

> `OpenCode is waiting for tool approval. Please check the OpenCode window and approve if needed.`

After sending, set a flag so this notice fires at most once per job. Continue polling — the job is not failed.

### 5. Final Reply Delivery

When polling detects a completed assistant message:

1. extract the final text from `parts`
2. send the final reply to Lark using existing `ReplySender`
3. clear the in-memory pending job entry

### 6. Failure Delivery

If polling times out or result extraction fails, the bot posts a failure notice back to the original thread.

Suggested timeout failure copy:

`Still waiting for OpenCode to finish. It may be blocked on approval or still processing.`

Suggested generic retrieval failure copy:

`OpenCode accepted the request, but the bot could not retrieve the final reply.`

## Queue Behavior Change

The queue should protect only the front half of the workflow:

- context fetch
- prompt construction
- session selection
- submission
- processing notice

The queue should not remain occupied during result polling.

That means `handleTrigger()` should enqueue only the submission stage, then detach the background waiter.

Expected impact:

- approval pauses no longer block the chat queue for minutes
- later messages in the same chat can be accepted sooner

## Pending Job Tracking

V1 should add an in-memory pending-job registry.

Suggested key:

- `${chatId}:${triggerMessageId}`

Tracked fields:

```js
{
  key,
  chatId,
  triggerMessageId,
  sessionId,
  submittedAt,
  userMessageId,
  startedAt,
  status,
}
```

Purpose:

- avoid duplicate polling loops for the same trigger
- support logging and future observability

V1 accepts that process restart loses this registry.

## Configuration

Add new OpenCode async settings:

```json
{
  "opencode": {
    "submit_timeout_ms": 30000,
    "poll_interval_ms": 3000,
    "poll_timeout_ms": 1800000,
    "tool_stuck_threshold_ms": 8000
  }
}
```

Definitions:

- `submit_timeout_ms`: max time allowed for the submit call itself
- `poll_interval_ms`: delay between message-list polls
- `poll_timeout_ms`: total time allowed for background waiting
- `tool_stuck_threshold_ms`: how long a tool must stay `running` before the stuck notice fires

Existing `analysis_timeout_ms` should remain temporarily for backward compatibility during migration, then be retired after the async path is fully adopted.

## Code Changes

### `lib/opencode-client.js`

Add:

- `submitMessage()`
- `listMessages()`
- `waitForAssistantReply()`
- helper(s) for message matching and terminal-state detection

Keep:

- `findOrCreateSession()`
- auth and base URL handling

### `oncall-bot.js`

Change orchestration so the main queued path stops after successful submission and launch of the background waiter.

### `lib/reply-sender.js`

No major behavior change required beyond current support for prefixless notices.

### New module: `lib/pending-jobs.js`

Responsibilities:

- register pending jobs
- reject duplicate registrations
- mark success/failure
- remove completed jobs

### Optional new module: `lib/async-analysis.js`

Responsibilities:

- coordinate submit + poll + final reply
- keep `oncall-bot.js` small

## Edge Cases

### Submit Returns Only After Full Completion

This is the most important unknown.

If `POST /session/{id}/message` blocks until the assistant finishes, polling cannot begin early enough to help. In that case V1 must pivot to one of these:

1. find a different message-creation endpoint that returns quickly
2. use a realtime endpoint that emits job progress without waiting for HTTP completion
3. spawn submission into its own detached background worker so queue occupancy is still reduced, even if the submit call itself blocks

The design therefore depends on an explicit exploration step to determine submit return timing.

### Multiple Concurrent Messages In One Session

If the same session receives overlapping requests, matching by timestamp alone can be ambiguous.

Mitigation order:

1. use `parentID` when available
2. otherwise use submission time window
3. keep reuse policy conservative for session types that should not overlap heavily

### Partial Assistant Output

Polling should not publish partial output. Only completed or stable terminal messages should be returned.

### Poll Endpoint Growth

`GET /session/{id}/message` returns the whole session timeline. Long-lived sessions will make each poll heavier.

This is acceptable for V1 because:

- incident sessions are scoped by chat and day
- poll frequency is low
- correctness matters more than optimal payload size in the first implementation

If needed later, move to SSE or provider-side cursors.

## Testing

Required tests:

1. `submitMessage()` returns tracking metadata without requiring final assistant text
2. `listMessages()` parses the timeline correctly
3. `waitForAssistantReply()` finds the right assistant message by `parentID`
4. fallback matching by timestamp works when `parentID` is absent
5. tool-stuck detection fires the notice after `tool_stuck_threshold_ms` when last tool is `running`
6. tool-stuck notice fires at most once per job even across multiple polls
7. polling times out with a readable error
8. queue is released after submission, not after final result
9. duplicate pending jobs for the same trigger are ignored or rejected deterministically

## Recommended Implementation Order

1. Explore and document `POST /session/{id}/message` return timing
2. Add client-level tests for message listing and polling helpers
3. Implement pending-job registry
4. Implement submit + poll orchestration module
5. Rewire `oncall-bot.js` to use async orchestration
6. Run full regression tests

## Recommendation

Proceed with HTTP polling as the first async architecture.

It is the lowest-risk path because it relies only on endpoints that are already observed in the current environment. Keep the waiting logic behind one abstraction so the project can switch to SSE later without changing `oncall-bot.js` again.
