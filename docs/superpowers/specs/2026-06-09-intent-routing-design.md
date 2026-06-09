# Oncall Bot Intent Routing Design

## Goal

Make `oncall-bot` route incoming chat triggers by user intent instead of sending every request through the production-incident analysis flow.

This design also prevents new trigger sessions from ending up in an archived-only workflow. New active work should stay in normal visible sessions.

## Problems To Fix

1. Every trigger is currently wrapped in the same on-call / Datadog prompt.
2. Summary requests are incorrectly treated as production investigation requests.
3. PR review requests risk being polluted by prior incident-analysis context.
4. Session reuse is too coarse because it is keyed only by chat and date.
5. Newly triggered work should not land in an archived-only state.

## Intent Model

The bot will classify each trigger into one of four intents:

- `summary`
- `incident_analysis`
- `pr_review`
- `other`

### Priority

Intent detection will use this precedence order:

1. `pr_review`
2. `summary`
3. `incident_analysis`
4. `other`

This avoids PR review and summary prompts being swallowed by generic analysis rules.

### Detection Rules

`pr_review`
- Trigger text contains review-oriented phrases such as `review`, `code review`, `PR`, `pull request`
- Or trigger text contains a GitHub PR URL matching `/pull/<number>`

`summary`
- Trigger text contains phrases such as `总结`, `总结上面的对话`, `简短一些`, `summarize`, `summary`, `recap`, `tldr`

`incident_analysis`
- Trigger text contains phrases such as `排查`, `分析`, `报错`, `异常`, `故障`, `issue`, `incident`, `error`, `timeout`, `失败`
- Or recent context strongly indicates service failure / production debugging discussion

`other`
- Fallback bucket for everything else

Rules stay intentionally simple and local. No model-based classification is needed in V1.

## Prompt Strategy

The config will define separate prompt templates per intent.

### `summary`

- Summarize recent chat context only
- Do not use Datadog
- Do not investigate logs, metrics, traces, incidents, or production systems
- Keep the response concise

### `incident_analysis`

- Preserve the current Datadog-enabled on-call workflow
- Understand the issue from context
- Query logs, metrics, and traces where useful
- Return root cause and next steps

### `pr_review`

- Review the PR request from chat context
- Focus on code-review output, risks, missing checks, and next actions
- Do not use Datadog unless the user explicitly asks about runtime / production impact

### `other`

- Answer the user request directly from chat context
- Do not use Datadog unless explicitly requested

## Session Strategy

Session reuse will depend on intent.

### `incident_analysis`

Reuse is allowed.

Key:
- `incident:{chatId}:{date}`

Title:
- `{chat_name}-incident-{date}`

### `summary`

Do not reuse prior sessions.

Reason:
- Summary requests should be based only on freshly fetched chat context
- Reusing prior sessions causes prompt drift and stale reasoning contamination

Title:
- `{chat_name}-summary-{date}`

Creation behavior:
- Force a fresh session for each trigger

### `pr_review`

Reuse only when the same PR is clearly referenced.

Key:
- With PR URL: `pr_review:{chatId}:{normalizedPrUrl}`
- Without PR URL: force fresh session

Title:
- `{chat_name}-pr-review-{date}`

### `other`

Do not reuse prior sessions.

Reason:
- Generic chat tasks should not inherit prior incident or PR-review state

Title:
- `{chat_name}-other-{date}`

Creation behavior:
- Force a fresh session for each trigger

## Session Visibility / Archive Requirement

New trigger sessions must remain in normal active session listings.

The implementation must not intentionally place new trigger work into archived-only state, archived storage, or any workflow that hides the session from the normal OpenChamber project session list.

Practical rule:
- Create ordinary sessions only
- Do not call archive-related APIs
- Do not reuse archived sessions when selecting target sessions for new trigger work

If an archived session exists with a matching title, it must not be selected as the destination for new trigger processing.

## Code Changes

### `oncall-bot.js`

- Add `detectIntent(event, contextMessages)`
- Build prompt from `config.prompt[intent]`
- Pass intent-aware session options to the OpenCode client

### `lib/opencode-client.js`

- Support explicit session title
- Support explicit cache key
- Support `reuse: true|false`
- When reusing, ignore archived sessions

### `oncall-bot.config.json`

- Replace single `prompt` block with intent-specific prompt blocks
- Optionally add configurable keywords for summary / analysis / review

## Testing

Required tests:

1. Intent classification tests
- summary
- incident analysis
- PR review
- other

2. Prompt selection tests
- summary prompt excludes Datadog guidance
- incident prompt includes Datadog guidance
- PR review prompt excludes Datadog by default

3. Session strategy tests
- incident sessions reuse by chat/date
- summary sessions do not reuse
- PR review reuses only when same PR URL is present
- other sessions do not reuse
- archived sessions are not reused for new trigger work

## Recommended Implementation Order

1. Add intent detection tests
2. Implement intent detection
3. Add prompt-selection tests
4. Implement prompt routing
5. Add session-strategy tests
6. Implement intent-aware session reuse / fresh-session rules
7. Add archive-exclusion tests and behavior
