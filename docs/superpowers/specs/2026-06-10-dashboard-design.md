# Oncall-Bot Dashboard Design

**Date:** 2026-06-10
**Status:** Approved

## Overview

Embed a management dashboard (web UI) into the oncall-bot process. The dashboard provides real-time session monitoring, opencode server process management, prompt configuration editing, and language/port settings — all from a single browser tab at `http://localhost:8015`.

## Constraints

- Personal local tool — no auth, no multi-user concurrency
- Pure HTML + vanilla JS — no build step, no framework
- Embedded in the oncall-bot process (方案 B)
- Config changes persist to `oncall-bot.config.json`
- opencode server processes managed via `child_process.spawn`

## Architecture

```
oncall-bot.js (主进程)
  ├── EventListener (飞书消息监听，现有)
  ├── DashboardServer (新增，嵌入 HTTP server)
  │     ├── GET /            → 单页 HTML 界面
  │     ├── GET /api/status  → bot 运行状态
  │     ├── GET /api/sessions → 当前活跃 session 列表
  │     ├── GET /api/config  → 当前配置
  │     ├── PUT /api/config  → 修改配置并写回文件
  │     ├── GET /api/prompts → 各 intent 的 prompt 配置
  │     ├── PUT /api/prompts → 修改 prompt 并写回文件
  │     ├── GET /api/servers → 已启动的 opencode server 列表
  │     ├── POST /api/servers       → 启动新的 opencode server
  │     ├── DELETE /api/servers/:id  → 停止指定 server
  │     ├── POST /api/servers/:id/restart → 重启
  │     ├── POST /api/servers/:id/bind    → 绑定为当前使用的 server
  │     └── SSE /api/events  → Server-Sent Events 推送实时事件
  └── 现有 handleTrigger / queue / filter 等逻辑不变
```

## File Structure

```
oncall-bot/
├── lib/
│   ├── dashboard-server.js   # HTTP server + REST API + SSE
│   ├── server-manager.js     # opencode serve 进程管理
│   └── bot-events.js         # EventEmitter 事件总线（单例）
├── dashboard/
│   └── index.html            # 单页界面（内联 CSS + JS）
├── oncall-bot.js             # 修改：启动时初始化 DashboardServer
└── oncall-bot.config.json    # 新增 dashboard 字段
```

## Config Changes

New top-level field in `oncall-bot.config.json`:

```json
{
  "dashboard": {
    "port": 8015,
    "enabled": true
  }
}
```

## Frontend Layout

### Top Status Bar
- Bot running status indicator (green/red dot)
- Dashboard port display
- Currently bound opencode server address

### Tab 1: Sessions (Real-time Monitor)
- Table: session name, trigger chat name, intent type, created time, status
- New sessions appear at top via SSE with highlight animation
- Expandable for session detail

### Tab 2: OpenCode Servers (Process Management)
- List of managed servers: port, PID, status, started time
- Actions: start new (port + project directory input), stop, restart
- "Bind" button: set a server as the bot's active target
- Custom port input

### Tab 3: Prompt Configuration
- Left: intent type list (summary / incident_analysis / pr_review / other)
- Right: editable textareas for `system_prefix`, `task_instructions`, `response_format`
- Save button persists to config file
- Top area: read-only display of intent routing logic (keyword lists)

### Tab 4: Settings
- Reply language: 中文 / English / Bahasa Indonesia / 精灵语 (Elvish)
- Dashboard port (requires bot restart to take effect)
- Default opencode server port

### Language Switch Logic

Language setting injects into each intent's `response_format`:
- 中文 → `"Respond in Chinese."`
- English → `"Respond in English."`
- 印尼语 → `"Respond in Bahasa Indonesia."`
- 精灵语 → `"Respond in Elvish (Sindarin style, Tolkien)."`

## Data Flow

### Session Real-time Push

```
Bot handleTrigger()
  → session created → botEvents.emit("session:created", {...})
  → DashboardServer listens → SSE push to frontend
  → Frontend EventSource receives → updates table
```

SSE event format:
```json
{
  "type": "session_created",
  "data": {
    "sessionId": "abc123",
    "title": "tera-oncall-incident-2026-06-10",
    "chatName": "TERA On-call",
    "intent": "incident_analysis",
    "createdAt": "2026-06-10T14:30:00Z"
  }
}
```

### OpenCode Server Process Management

```
POST /api/servers {port, projectDir}
  → spawn("opencode", ["serve", "--port", port], {cwd: projectDir})
  → Store in Map<id, {process, port, pid, status, startedAt}>
  → Return server info

POST /api/servers/:id/bind
  → Update config.opencode.base_url = "http://localhost:{port}"
  → Write config to file
  → All subsequent bot requests use new server
```

### Config Read/Write

```
PUT /api/config or PUT /api/prompts
  → Validate → Update in-memory config → Atomic write to file
  → Return updated config
```

Atomic write: write to `.tmp` file first, then `rename()` over original.

### Internal Event Bus

```javascript
// bot-events.js
import { EventEmitter } from "node:events";
export const botEvents = new EventEmitter();

// In handleTrigger:
botEvents.emit("session:created", { sessionId, title, chatName, intent });

// In DashboardServer:
botEvents.on("session:created", (data) => {
  sseClients.forEach(client => client.write(`data: ${JSON.stringify(data)}\n\n`));
});
```

## Startup

```javascript
// In oncall-bot.js main():
import { DashboardServer } from "./lib/dashboard-server.js";
import { botEvents } from "./lib/bot-events.js";

const dashboard = new DashboardServer({ config, botEvents });
dashboard.start(); // non-blocking
```

Console output:
```
[14:30:00] ✓ opencode serve reachable at http://localhost:3000
[14:30:00] ✓ dashboard running at http://localhost:8015
[14:30:00] ✓ listening on im.message.receive_v1
```

## Shutdown Behavior

- `SIGINT`/`SIGTERM` → close dashboard server + kill all managed opencode serve processes
- Managed opencode serve crashes → status set to `crashed`, visible in frontend
- Graceful: close SSE connections, drain pending writes

## Non-Goals

- No authentication or access control
- No HTTPS
- No database — config file is the single source of truth
- No multi-bot management — one bot process per dashboard
- Dashboard does not replace CLI for initial setup
