# Session Todo Design

## Goal

Add a lightweight todo feature to the dashboard session detail view.

From an existing session, the user can create a todo that:
- is persisted on the server in a local file
- creates a dedicated OpenCode analysis session for that todo
- remains attached to the parent session
- can later be marked as completed

This feature is intentionally minimal. It supports multiple todos per parent session, but does not support editing, deleting, reopening, or nested subtasks.

## Scope

In scope:
- show todos inside the current session detail panel
- add a todo from the current session
- create a new OpenCode session for todo analysis
- persist todos in a local JSON file on disk
- mark a todo as completed

Out of scope:
- editing todo text
- deleting todos
- reopening completed todos
- syncing todos across multiple bot instances
- assigning todos to users
- due dates, priorities, tags, comments, or subtasks

## User Flow

1. User opens a session detail in the Sessions tab.
2. The dashboard loads both session messages and todos for that session.
3. User enters a todo title and optional description.
4. User clicks Add Todo.
5. The server creates a dedicated OpenCode session for analyzing that task.
6. The server persists the todo locally and returns the created todo object.
7. The dashboard renders the new todo under the current parent session.
8. Later, the user can click Complete to mark the todo done.

## Data Model

Todos are stored by parent session id.

Each todo record contains:
- `id`: unique todo id
- `parentSessionId`: the dashboard session where the todo was created
- `title`: short task title
- `description`: optional longer text
- `status`: `open` or `completed`
- `todoSessionId`: the dedicated OpenCode session created for this todo
- `createdAt`: ISO timestamp
- `completedAt`: ISO timestamp or `null`

Example file structure:

```json
{
  "session_parent_1": [
    {
      "id": "todo_abc123",
      "parentSessionId": "session_parent_1",
      "title": "Investigate timeout spike",
      "description": "Check whether upstream latency or queue growth caused the incident.",
      "status": "open",
      "todoSessionId": "session_todo_456",
      "createdAt": "2026-06-11T03:00:00.000Z",
      "completedAt": null
    }
  ]
}
```

## Storage

Todos are stored in a dedicated server-side JSON file, separate from config.

Recommended path:
- `data/session-todos.json`

Rationale:
- runtime data should not be mixed into `oncall-bot.config.json`
- file storage is enough for the current single-machine usage
- restart persistence is required, browser-only storage is not acceptable

Behavior:
- if the file does not exist, create it on first write
- if the file is empty, treat it as `{}`
- if the file is invalid JSON, return a clear API error and do not overwrite it silently

## Session Creation Strategy

Adding a todo creates a new OpenCode session immediately.

The new session should:
- be created against the currently bound OpenCode server
- reuse the same project directory as the bot's OpenCode client
- use a readable title derived from the parent session and todo title

Recommended title format:
- `TODO {parentTitle} - {todoTitle}`

This todo session is separate from the parent session. It is meant for focused follow-up analysis, not for continuing the original thread.

## Dashboard UI

Add a new Todos section inside the existing session detail panel.

### Add Todo Form

Fields:
- title, required
- description, optional

Controls:
- `Add Todo` button

Behavior:
- disable the button while the request is in flight
- show inline error if creation fails
- clear the form after success

### Todo List

For each todo, show:
- title
- description if present
- status badge
- created timestamp
- link or button to open the dedicated todo session
- `Complete` button only for open todos

Completed todos remain visible in the list.

## API Design

### `GET /api/sessions/:id/todos`

Returns the todo list for the parent session.

Response:
- array of todo objects

### `POST /api/sessions/:id/todos`

Creates a todo under the parent session and creates a dedicated OpenCode session.

Request body:
- `title`: string, required
- `description`: string, optional

Response:
- created todo object

Failure behavior:
- if title is missing, return 400
- if OpenCode session creation fails, return 500 and do not persist the todo
- if file write fails, return 500

### `POST /api/todos/:todoId/complete`

Marks an existing todo as completed.

Response:
- updated todo object

Failure behavior:
- if todo id does not exist, return 404

## Server Structure

Add a small storage module for todo persistence rather than embedding file logic directly into dashboard route handlers.

Recommended module responsibilities:
- load all todo data from file
- list todos by parent session id
- create todo
- mark todo completed
- validate file contents and surface clear errors

Keep route handlers thin. The dashboard server should orchestrate HTTP and call storage plus OpenCode client methods.

## Error Handling

Creation should be atomic from the user's perspective.

Rules:
- if OpenCode session creation fails, no todo record is saved
- if storage fails after session creation, return an error; the orphaned OpenCode session may remain, which is acceptable for this minimal version
- if local file parsing fails, return a clear message indicating the todo storage file is invalid

## Testing

### Storage Tests

Cover:
- list todos for a session
- create todo
- mark todo completed
- invalid JSON file returns a clear error

### Dashboard/API Tests

Cover:
- `GET /api/sessions/:id/todos`
- `POST /api/sessions/:id/todos`
- `POST /api/todos/:todoId/complete`
- todo is not persisted when OpenCode session creation fails

### Frontend Verification

Manual verification is sufficient for the first version:
- open a session detail
- add a todo
- verify it appears immediately
- verify it persists after refresh
- verify Complete updates status and persists after refresh

## Notes

This design intentionally keeps the todo model simple and local.
If the feature grows later, the natural next steps would be edit/delete support, richer metadata, and cross-instance storage. None of that is required for this version.
