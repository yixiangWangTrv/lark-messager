# Bot Process Dashboard Controls Design

## Goal

Make the running `oncall-bot` process visible in the dashboard `Servers` panel so the user can tell whether the bot is already running when startup fails with the single-instance-lock error.

Also allow the user to stop or restart that bot process directly from the dashboard.

## Problem

Today the dashboard shows `opencode serve` processes, but not the bot process itself.

When startup fails with:

```text
Another oncall-bot process is already running (pid <pid>)
```

the user gets a PID but has no first-class UI for:

- seeing that bot process in the dashboard
- stopping it safely
- restarting it using the same command that launched it

This makes the single-instance protection work technically, but leaves the process hard to manage operationally.

## Scope

In scope:

- expose the active `oncall-bot` process in the dashboard server list
- show enough metadata to distinguish bot vs opencode server rows
- add `Stop` and `Restart` actions for the bot row
- restart the bot by reusing its original launch command
- keep existing `opencode serve` controls working as they do today
- cover the new behavior with tests

Out of scope:

- general process supervision beyond this bot
- historical process tracking
- multiple bot processes at once
- remote host process management
- restart policies or crash-loop handling UI

## Recommended Approach

Use the single-instance lock file as the source of truth for the current bot process and extend it to store startup metadata.

The lock file already proves that one bot process is active. Extending that same file is the safest way to:

- identify the running bot process exactly
- avoid brittle `ps`-based command guessing
- capture the original launch command for reliable restart

This keeps the design minimal and avoids adding a separate supervisor layer.

## Data Model

### Lock File

Extend the lock payload to include the bot startup context:

- `pid`
- `startedAt`
- `cwd`
- `execPath`
- `argv`

Example:

```json
{
  "pid": 71371,
  "startedAt": 1718102400000,
  "cwd": "/Users/yixiang.wang/oncall-bot",
  "execPath": "/opt/homebrew/bin/node",
  "argv": [
    "/Users/yixiang.wang/oncall-bot/oncall-bot.js",
    "--config",
    "oncall-bot.config.json"
  ]
}
```

Notes:

- `execPath` is the executable that launched the current process.
- `argv` contains only the userland arguments after `execPath`.
- `cwd` is required so restart uses the same working directory.
- `startedAt` continues to support stale-lock validation.

## Dashboard Representation

The dashboard `/api/servers` response should include the bot process as a normal row alongside opencode servers.

The bot row should expose:

- `id`: `bot-<pid>`
- `kind`: `bot`
- `source`: `local`
- `status`: `running`
- `pid`
- `startedAt`
- `port`: `null`
- `projectDir`: lock-file `cwd`
- `label`: `oncall-bot`

This keeps the existing table structure mostly intact while giving the frontend enough information to render bot-specific labels and actions.

## Server API Design

### `GET /api/servers`

Continue returning managed and external opencode servers, but append the bot process row when a live lock-file process exists.

Behavior:

- if lock file exists and PID is alive, include the bot row
- if lock file is stale or unreadable, omit the bot row rather than showing misleading state

### `POST /api/servers/:id/stop`

Existing behavior stays the same for managed/external opencode rows.

For `id` values of the form `bot-<pid>`:

- verify the lock file still points to that same live bot process
- send `SIGTERM` to that PID
- return `{ ok: true }` on success

Failure behavior:

- `404` if the bot row no longer matches the lock file
- `500` if signaling fails

### `POST /api/servers/:id/restart`

Existing behavior stays the same for managed opencode rows.

For `id` values of the form `bot-<pid>`:

1. verify the lock file still points to that same live bot process
2. read `execPath`, `argv`, and `cwd` from the lock file
3. spawn a new detached process using the same command and cwd
4. after spawn succeeds, terminate the old process
5. return metadata for the newly started bot process

Important behavior:

- restart must only use lock-file metadata, never guessed commands
- if required launch metadata is missing, fail with a clear error instead of trying to improvise
- the old process should only terminate after the replacement process starts successfully

## Process Control Semantics

### Stop

`Stop` is a simple controlled shutdown:

- signal the bot process with `SIGTERM`
- rely on the normal process exit path to release the lock

This matches the current single-instance design.

### Restart

`Restart` is a replacement launch:

- spawn the replacement process first
- then terminate the current process

This avoids creating a gap where no bot process exists and reduces the chance of restart leaving the service down.

Because the lock is exclusive, the restart flow must ensure the replacement can acquire the lock. The simplest safe sequence is:

1. spawn replacement process with the same launch command
2. signal current process to exit
3. replacement process retries startup normally and acquires the lock once the old process exits

This means restart success in the API should mean “replacement process was launched successfully,” not “replacement has fully completed startup.”

## UI Design

### Servers Table

Keep a single unified table.

For bot rows:

- show a label like `oncall-bot` in the source or status area
- show `-` for port
- show PID and status normally
- show `Stop` and `Restart` buttons

For opencode rows:

- keep current behavior unchanged

### Button Behavior

Bot row actions:

- `Stop`: existing confirmation flow is acceptable
- `Restart`: trigger a restart request, then refresh the server list

The UI should clearly distinguish bot rows from opencode rows so the user knows they are controlling the bot itself.

## Error Handling

If restart cannot be performed safely, return explicit errors such as:

- `bot process metadata missing from lock file`
- `bot process no longer matches active lock`
- `failed to spawn replacement bot process`

Do not fall back to `ps` scanning or guessed launch commands.

If the dashboard sees a stale lock file, it should not display a fake bot row.

## Testing

### Single Instance Lock Tests

Add coverage that the lock payload stores:

- `cwd`
- `execPath`
- `argv`

### Dashboard Server Tests

Add coverage for:

- `/api/servers` includes a bot row when a live lock exists
- bot stop route signals the correct PID
- bot restart route spawns a replacement using stored metadata
- bot restart fails clearly when lock metadata is incomplete

Use injected/mocked process control functions rather than real self-restart behavior in tests.

### Frontend Verification

Manual check:

1. start the bot normally
2. open dashboard `Servers`
3. verify `oncall-bot` appears as its own row
4. click `Restart` and verify a new bot process appears
5. click `Stop` and verify the bot row disappears after refresh

## Risks

### Restart Race

The replacement process may start before the old lock is released.

Mitigation:

- rely on the current process exiting promptly after successful replacement spawn
- keep the restart logic conservative and transparent about what success means

### Broken Launch Metadata

If metadata is absent or malformed, restart cannot be trusted.

Mitigation:

- fail closed
- never guess commands

### Process Identity Drift

If the PID from the dashboard row no longer matches the active lock file, stop/restart could target the wrong process.

Mitigation:

- always re-check lock contents before bot process actions

## Implementation Notes

- prefer small focused helpers rather than embedding bot-process logic into the generic opencode server manager
- keep `ServerManager` scoped to opencode child processes unless a tiny extension is clearly cleaner
- reading the bot process should likely live near the single-instance-lock code, because that file is the source of truth

## Success Criteria

The feature is done when:

- a running `oncall-bot` is visible in dashboard `Servers`
- the row clearly identifies it as the bot process
- the user can stop it from the dashboard
- the user can restart it from the dashboard using the same launch command
- tests cover the lock metadata and dashboard control paths
