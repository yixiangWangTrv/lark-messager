# Global Session Todo Design

## Goal

Upgrade the dashboard todo feature from a session-detail-only helper into a global todo workflow.

The new behavior should let the user:
- click `Add Todo` from the right side of any real-time session row
- draft a todo with manual input or a one-click summary flow
- save the todo permanently into a global todo list rendered below the real-time sessions area
- update todo status through a dropdown
- add comments to a todo
- delete a todo
- open a dedicated todo chat session on demand, creating it lazily only when the user clicks chat

This replaces the earlier minimal design where todos lived inside the selected session detail and immediately created a child session.

## Scope

In scope:
- add `Add Todo` action per session row
- add a global todos section below the real-time sessions card
- create todo drafts by launching a temporary summary session
- let the summary draft suggest both todo title and description
- let the user confirm or edit the suggested values before saving
- persist todos independently of session detail state
- support todo statuses `open`, `in_progress`, `blocked`, and `completed`
- support todo comments
- support todo deletion
- lazily create a dedicated todo chat session when the user clicks chat
- reuse the existing todo chat session if one already exists

Out of scope:
- nested todos or subtasks
- assigning todos to users
- due dates, priorities, labels, or reminders
- deleting the associated chat session when deleting a todo
- syncing data across multiple bot instances
- comment editing or deletion
- browser-only persistence

## Product Model

The new design separates three concepts that were previously collapsed together:

1. Source session
   - the real-time session row from which the user starts todo creation
   - this is stored as metadata on the todo

2. Draft summary session
   - a temporary OpenCode session used only by `One-click Summary`
   - generates a suggested todo title and description
   - does not become the todo's permanent chat session

3. Todo chat session
   - the dedicated permanent OpenCode session for following up on that todo
   - created lazily only when the user clicks `Chat`
   - reused on subsequent clicks

This split keeps the UI clean and prevents abandoned summaries from creating permanent todo sessions.

## User Flow

### Create Todo

1. The user sees `Add Todo` on the right side of each real-time session row.
2. The user clicks `Add Todo` for a session.
3. The dashboard opens an add-todo dialog bound to that source session.
4. The user can type a title and description manually.
5. Optionally, the user clicks `One-click Summary`.
6. The server launches a temporary summary session using the selected source session as context.
7. The summary flow returns a suggested title and suggested description.
8. The dialog fills those values back into the form.
9. The user confirms or edits the values.
10. The user clicks `Create Todo`.
11. The server persists a permanent todo record without creating a chat session yet.
12. The new todo appears in the global todo section below the real-time sessions card.

### Open Todo Chat

1. The user clicks `Chat` on a todo card.
2. If `chatSessionId` already exists, the dashboard opens that session immediately.
3. If `chatSessionId` is missing, the server creates a new todo chat session.
4. The session title is generated from the todo title plus todo id to prevent collisions.
5. The server persists the new `chatSessionId` onto the todo.
6. The dashboard opens the new chat session.

### Comment And Status Updates

1. The user changes the todo status from a dropdown.
2. The server persists the new status.
3. If the todo already has a chat session, the server may also append a status update message into that session.
4. The user adds a comment inline on the todo card.
5. The server persists the comment locally.
6. If the todo already has a chat session, the comment is also written into that session.
7. If the todo does not have a chat session yet, the comment remains local only and does not force session creation.

### Delete Todo

1. The user clicks `Delete` on a todo.
2. The dashboard asks for confirmation.
3. The server deletes the todo record.
4. If a chat session existed, it is left untouched.
5. The todo disappears from the global list.

## Dashboard UI

## Sessions Table

Modify the real-time sessions table as follows:
- add an `Actions` column on the right
- add an `Add Todo` button in each session row
- keep row click behavior for opening session detail, but make the add-todo action independent so it does not require opening detail first

## Add Todo Dialog

Open a dialog or lightweight overlay when the user clicks `Add Todo`.

Required content:
- source session title
- todo title input
- todo description textarea
- `One-click Summary` button
- `Create Todo` button
- `Cancel` button
- inline status / error message area

Behavior:
- the dialog is always tied to one source session
- `One-click Summary` disables itself while running
- the summary response fills both title and description fields
- the user can still edit either field after summary completes
- creating a todo does not create a permanent chat session
- closing the dialog discards any unsaved draft values on the client side

## Global Todos Section

Add a second card below the real-time sessions card.

Recommended heading:
- `Todos`

Each todo item should show:
- title
- description
- source session title
- status dropdown
- created or updated timestamp
- `Chat` button
- `Delete` button
- existing comments
- add-comment input and submit button

Completed todos remain visible.

The list should be global, not filtered to the currently opened session detail.

## Session Detail Panel

Keep the current session detail panel for viewing session messages.

Remove todo creation and todo list rendering from inside session detail because that interaction model conflicts with the new global todo design.

## Data Model

Use an independent todo store rather than grouping todos by parent session id.

Suggested storage shape:

```json
{
  "todos": [
    {
      "id": "todo_abc123",
      "sourceSessionId": "session_1",
      "sourceSessionTitle": "Robot Test-other-2026-06-11-3495402b",
      "title": "Investigate alert burst",
      "description": "Check the upstream spike pattern and summarize likely causes.",
      "status": "open",
      "chatSessionId": null,
      "comments": [
        {
          "id": "comment_1",
          "content": "Need to compare this with the previous spike.",
          "createdAt": "2026-06-11T09:00:00.000Z"
        }
      ],
      "createdAt": "2026-06-11T08:58:00.000Z",
      "updatedAt": "2026-06-11T09:00:00.000Z"
    }
  ]
}
```

Each todo contains:
- `id`
- `sourceSessionId`
- `sourceSessionTitle`
- `title`
- `description`
- `status`
- `chatSessionId`
- `comments`
- `createdAt`
- `updatedAt`

Each comment contains:
- `id`
- `content`
- `createdAt`

No separate draft summary record needs to be persisted. Draft summary output can remain request-scoped.

## Storage

Recommended path:
- `data/todos.json`

Behavior:
- if the file does not exist, create it on first write
- if the file is empty, treat it as `{ "todos": [] }`
- if the file is invalid JSON, return a clear API error and do not overwrite the file silently
- validate that the top-level object contains a `todos` array

Rationale:
- todos are now global dashboard workflow data rather than config
- file-backed storage is sufficient for current single-machine use
- using a top-level object instead of a bare array leaves room for future metadata

## Todo Naming And Session Naming

Todo titles should remain user-facing and readable.

Permanent todo chat session titles must avoid collisions.

Recommended format:
- `{todoTitle} {todoId}`

Example:
- `Investigate alert burst todo_abc123`

This guarantees uniqueness without exposing source session naming complexity in the UI.

The one-click summary should also suggest both:
- todo title
- todo description

Those suggestions are just defaults that the user may override before saving.

## API Design

### `POST /api/sessions/:id/todo-draft`

Creates a temporary summary session for the given source session and returns draft values.

Response:
- `suggestedTitle`
- `suggestedDescription`
- `draftSessionId`

Failure behavior:
- return `404` if the source session does not exist
- return `500` if temporary summary session creation or summarization fails
- do not persist a permanent todo record on failure

### `POST /api/todos`

Creates a permanent todo record.

Request body:
- `sourceSessionId`: string, required
- `title`: string, required
- `description`: string, optional

Response:
- created todo object

Behavior:
- persist `sourceSessionTitle` from the current session registry at creation time
- set `status` to `open`
- set `chatSessionId` to `null`

### `GET /api/todos`

Returns the global todo list.

Behavior:
- default sort should be newest updated first

### `PATCH /api/todos/:id`

Updates todo fields.

Supported mutable fields:
- `title`
- `description`
- `status`

Allowed status values:
- `open`
- `in_progress`
- `blocked`
- `completed`

Failure behavior:
- return `404` if the todo does not exist
- return `400` for invalid field values

### `POST /api/todos/:id/comments`

Adds a new todo comment.

Request body:
- `content`: string, required

Response:
- created comment, or updated todo object if that is more convenient for the UI

Behavior:
- persist the comment locally first
- if the todo already has `chatSessionId`, also append the comment into the linked chat session
- if there is no chat session yet, do not create one automatically

### `DELETE /api/todos/:id`

Deletes the todo record.

Behavior:
- remove the todo from persistent storage
- do not delete any linked chat session

### `POST /api/todos/:id/chat-session`

Gets or creates the permanent todo chat session.

Response:
- `todoId`
- `chatSessionId`
- `created`: boolean

Behavior:
- if the todo already has a chat session, return it with `created: false`
- otherwise create the session, persist its id, and return `created: true`

## Server Responsibilities

The server should now orchestrate four separate responsibilities:

1. session registry
   - track active real-time sessions shown in the dashboard

2. draft summary flow
   - create temporary summary sessions and return suggested todo fields

3. todo persistence
   - own CRUD operations for global todos and comments

4. lazy chat session linkage
   - create and reuse permanent todo chat sessions when requested

Keep the route handlers thin and push file-backed todo logic into a dedicated store module.

## Comment And Session Synchronization Rules

Comments and status changes have both local todo meaning and optional chat-session meaning.

Rules:
- local todo persistence always happens first
- if `chatSessionId` exists, mirror the comment into the todo chat session
- if `chatSessionId` does not exist, do not auto-create it for comments or status changes
- if mirroring into the chat session fails after local persistence, return a clear error and keep the local update; this is acceptable for the current version

This preserves the user's todo history even if session integration is temporarily unavailable.

## Error Handling

### Draft Summary

- if temporary summary session creation fails, no permanent todo is created
- if summarization fails, return an error and let the user continue entering fields manually

### Permanent Todo Creation

- if validation fails, return `400`
- if storage write fails, return `500`
- since permanent chat session creation is lazy, todo creation has no dependency on OpenCode session creation

### Lazy Chat Session Creation

- if the todo does not exist, return `404`
- if chat session creation fails, return `500` and keep `chatSessionId` as `null`

### Deletion

- deleting a todo must not fail just because a linked chat session still exists

## Testing

### Store Tests

Cover:
- list all todos
- create todo
- update title, description, and status
- add comment
- delete todo
- invalid JSON or invalid top-level shape returns a clear error

### Dashboard/API Tests

Cover:
- `POST /api/sessions/:id/todo-draft`
- `POST /api/todos`
- `GET /api/todos`
- `PATCH /api/todos/:id`
- `POST /api/todos/:id/comments`
- `DELETE /api/todos/:id`
- `POST /api/todos/:id/chat-session`
- chat session reuse when `chatSessionId` already exists
- comment mirroring to chat session when linked
- no session auto-creation when adding a comment without `chatSessionId`

### Frontend Verification

Manual verification should cover:
- `Add Todo` appears on the right side of every session row
- clicking it opens a dialog bound to that session
- `One-click Summary` fills both title and description
- the user can edit suggested values before creating the todo
- created todos appear in the global todos section below real-time sessions
- status dropdown persists correctly for all four statuses
- comments persist and render correctly
- first `Chat` click creates a session
- later `Chat` clicks reuse the existing session
- deleting a todo removes it from the list without deleting the session detail history

## Migration Notes

The repository currently contains a minimal session-scoped todo implementation.

This new design supersedes that model.

Implementation should:
- replace the old session-scoped storage format with the new global todo format
- remove session-detail todo creation UI
- remove immediate todo child session creation on todo save
- keep session detail itself for message viewing

No backward-compatibility layer is required unless preserving existing `data/session-todos.json` data becomes an explicit product requirement.

## Summary

This design changes todos from session-local helper records into global workflow items.

The key decisions are:
- add todo from the session row, not from session detail
- render todos in a dedicated global section below real-time sessions
- use a temporary summary session for `One-click Summary`
- persist permanent todos without creating a permanent chat session yet
- lazily create the permanent chat session only when the user clicks `Chat`
- use `todo title + todo id` for permanent session naming
- support status changes, comments, and deletion without coupling those actions to immediate session creation
