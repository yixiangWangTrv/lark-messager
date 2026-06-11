# oncall-bot

Lark on-call bot powered by OpenCode, with local dashboard controls, configurable prompt routing, knowledge base support, and style distillation tools.

If this project helps you, please give it a GitHub star🥺. 

**Languages:** [English](#english) | [中文](#中文) | [Bahasa Indonesia](#bahasa-indonesia)

## English

### Overview

`oncall-bot` is a Node.js bot that listens to Lark chat events, gathers the relevant chat context, routes the request by intent, sends the task to OpenCode, and posts the result back to the conversation. It also ships with a local dashboard for runtime controls and configuration editing.

### Features

- Listen to Lark message events with configurable trigger modes.
- Fetch recent chat or thread context before sending work to OpenCode.
- Route requests into summary, incident analysis, PR review, or general task flows.
- Reuse or create OpenCode sessions automatically.
- Show a local dashboard for sessions, prompts, trigger modes, PUA mode, server binding, knowledge base items, and style distillation.
- Support a lightweight knowledge base configuration stored in `oncall-bot.config.json`.
- Support style distillation profiles and active style switching.
- Global todo workflow: create todos from any session row, one-click AI summary for title and description, status tracking (open/in_progress/blocked/completed), comments with optional chat-session mirroring, and lazy-created dedicated todo chat sessions.

### Architecture

The main runtime starts from `oncall-bot.js`. Incoming Lark events pass through the message filter, context fetcher, trigger orchestration, and reply sender. Intent routing and prompt construction happen before the request is submitted to OpenCode.

The dashboard server in `lib/dashboard-server.js` exposes local HTTP endpoints for configuration, sessions, knowledge base management, server controls, and style distillation workflows.

### Requirements

- Node.js 18 or later
- `lark-cli` installed and authenticated for the identities used by the bot
- `opencode` installed and available in `PATH`
- A reachable OpenCode server, or permission to let the bot auto-start one locally

### Quick Start

Install dependencies:

```sh
npm install
```

Review and update the config file:

```sh
cp oncall-bot.config.json oncall-bot.config.local.json
```

Before starting the bot, update these fields in your copied config file:

- `lark.trigger.bot_name`: set this to your bot's current display name in Lark. The `mention_bot` trigger mode matches `@<bot_name>` from message text, so leaving the sample name in place will prevent triggers from firing for your bot.
- `opencode.project_directory`: set this to the absolute path of your local project directory. The bot uses this path when it auto-starts `opencode serve`.

Example:

```json
{
  "lark": {
    "trigger": {
      "bot_name": "Another Yixiang Wang"
    }
  },
  "opencode": {
    "project_directory": "/absolute/path/to/oncall-bot"
  }
}
```

Start the bot:

```sh
npm start
```

Run tests:

```sh
npm test
```

If you want to point at a different config file:

```sh
node oncall-bot.js --config oncall-bot.config.local.json
```

### Configuration

The bot is configured through `oncall-bot.config.json`. The main top-level sections are:

- `lark`: identities, watched chats, trigger rules, and trigger modes
- `context`: how much chat history to fetch
- `opencode`: base URL, credentials, timeouts, and session naming
- `reply`: reply mode and processing notices
- `concurrency`: per-chat queue controls
- `dashboard`: local dashboard port and language
- `knowledge_base`: optional local knowledge items
- `prompt`: prompt templates by intent
- `pua`: PUA-mode enablement by intent

### Dashboard

When `dashboard.enabled` is `true`, the bot starts a local dashboard server and prints its URL during startup. The dashboard currently supports:

- viewing live sessions
- inspecting session messages
- editing prompts and trigger modes
- updating PUA mode settings
- managing knowledge base items
- managing or binding OpenCode server processes
- running style distillation workflows and choosing an active style
- creating and managing global todos with one-click AI summary, status updates, comments, and lazy chat sessions

### Testing

Run the full test suite with:

```sh
npm test
```

The repository uses Node's built-in test runner and keeps tests under `test/`.

### Contributing

Use this workflow for contributions:

1. Sync your local `master` branch.
2. Create a new branch from `master`.
3. Make your changes and commit them on that branch.
4. Push the branch to `origin`.
5. Open a pull request targeting `master`.

Example:

```sh
git checkout master
git pull origin master
git checkout -b feat/my-change
```

### License

This project is licensed under the MIT License. See `LICENSE` for the full text.

### Contact

- `yixiang.wang@traveloka.com`
- `943161618@qq.com`
- `+86 18856978931`

### Project Structure

- `oncall-bot.js`: runtime entrypoint
- `oncall-bot.config.json`: local bot configuration
- `lib/`: main runtime modules
- `dashboard/`: dashboard frontend assets
- `test/`: automated tests
- `docs/superpowers/`: design specs and implementation plans

## 中文

如果这个项目对你有帮助，欢迎给仓库点个 Star。（其实是求你了🥺，我是互联网乞丐）

### 概述

`oncall-bot` 是一个基于 Node.js 的 Lark 值班机器人。它会监听 Lark 消息事件，抓取相关上下文，按意图路由请求，把任务发送给 OpenCode，再把结果回发到聊天中。项目同时提供一个本地 dashboard 用于运行时控制和配置编辑。

### 功能

- 监听 Lark 消息事件，并支持可配置的触发模式。
- 在请求发送到 OpenCode 之前抓取最近的群聊或线程上下文。
- 将请求路由到总结、故障分析、PR Review 或通用任务流程。
- 自动复用或创建 OpenCode 会话。
- 提供本地 dashboard，用于查看会话、编辑 prompts、调整 trigger modes、切换 PUA 模式、管理知识库、绑定 OpenCode 服务以及使用风格蒸馏能力。
- 支持在 `oncall-bot.config.json` 中维护轻量级 knowledge base 配置。
- 支持风格蒸馏档案和当前风格切换。
- 全局 Todo 工作流：从任意会话行创建 todo，一键 AI 总结生成标题和描述，支持状态跟踪（open/in_progress/blocked/completed）、评论（可同步到 chat session）以及按需懒创建专属 todo chat session。

### 架构

主程序入口是 `oncall-bot.js`。进入系统的 Lark 事件会依次经过消息过滤、上下文抓取、触发编排和回复发送。意图识别与 prompt 构建会在请求提交给 OpenCode 之前完成。

`lib/dashboard-server.js` 中的 dashboard 服务暴露了本地 HTTP 接口，用于管理配置、会话、knowledge base、服务进程和风格蒸馏工作流。

### 环境要求

- Node.js 18 或更高版本
- 已安装并完成认证的 `lark-cli`
- 已安装且可在 `PATH` 中找到的 `opencode`
- 一个可访问的 OpenCode 服务，或者允许机器人在本地自动拉起服务

### 快速开始

安装依赖：

```sh
npm install
```

检查并更新配置文件：

```sh
cp oncall-bot.config.json oncall-bot.config.local.json
```

在启动机器人之前，请先修改复制出来的配置文件中的这两个字段：

- `lark.trigger.bot_name`：改成你当前机器人在 Lark 里的显示名称。`mention_bot` 触发模式会按消息里的 `@<bot_name>` 文本匹配，如果保留示例名称，别人 `@` 你的机器人时不会触发。
- `opencode.project_directory`：改成你本地项目目录的绝对路径。机器人在自动拉起 `opencode serve` 时会使用这个路径。

示例：

```json
{
  "lark": {
    "trigger": {
      "bot_name": "Another Yixiang Wang"
    }
  },
  "opencode": {
    "project_directory": "/absolute/path/to/oncall-bot"
  }
}
```

启动机器人：

```sh
npm start
```

运行测试：

```sh
npm test
```

如果你想指定其他配置文件：

```sh
node oncall-bot.js --config oncall-bot.config.local.json
```

### 配置

机器人通过 `oncall-bot.config.json` 配置，主要包含这些顶层字段：

- `lark`：身份、监听群、触发规则和触发模式
- `context`：上下文抓取范围
- `opencode`：服务地址、认证信息、超时和会话命名
- `reply`：回复方式和处理中提示
- `concurrency`：单群队列限制
- `dashboard`：本地 dashboard 端口和语言
- `knowledge_base`：可选的本地知识条目
- `prompt`：按意图划分的 prompt 模板
- `pua`：按意图启用的 PUA 模式

### Dashboard

当 `dashboard.enabled` 为 `true` 时，机器人会在启动时拉起本地 dashboard，并输出访问地址。当前 dashboard 支持：

- 查看实时会话
- 查看会话消息
- 编辑 prompts 和 trigger modes
- 更新 PUA 模式配置
- 管理 knowledge base 条目
- 管理或绑定 OpenCode 服务进程
- 运行风格蒸馏流程并切换当前激活风格
- 创建和管理全局 Todo：一键 AI 总结、状态更新、评论、按需创建 chat session

### 测试

使用下面的命令运行完整测试集：

```sh
npm test
```

项目使用 Node 内置测试运行器，测试文件位于 `test/` 目录。

### 贡献

贡献代码时请遵循下面的流程：

1. 先同步本地 `master` 分支。
2. 基于 `master` 创建新的开发分支。
3. 在该分支上完成修改并提交。
4. 将分支推送到 `origin`。
5. 创建一个目标分支为 `master` 的 PR。

示例：

```sh
git checkout master
git pull origin master
git checkout -b feat/my-change
```

### 许可证

本项目使用 MIT License，完整内容见根目录下的 `LICENSE` 文件。

### 联系方式

- `yixiang.wang@traveloka.com`
- `943161618@qq.com`
- `+86 18856978931`

### 项目结构

- `oncall-bot.js`：运行入口
- `oncall-bot.config.json`：本地配置文件
- `lib/`：主要运行时模块
- `dashboard/`：dashboard 前端资源
- `test/`：自动化测试
- `docs/superpowers/`：设计文档和实现计划

## Bahasa Indonesia

Kalau project ini membantu, mohon bantu beri GitHub star.

### Ringkasan

`oncall-bot` adalah bot on-call berbasis Node.js untuk Lark. Bot ini mendengarkan event pesan Lark, mengambil konteks percakapan yang relevan, merutekan permintaan berdasarkan intent, mengirim tugas ke OpenCode, lalu mengirim hasilnya kembali ke chat. Proyek ini juga menyediakan dashboard lokal untuk kontrol runtime dan pengeditan konfigurasi.

### Fitur

- Mendengarkan event pesan Lark dengan mode trigger yang dapat dikonfigurasi.
- Mengambil konteks chat atau thread terbaru sebelum mengirim pekerjaan ke OpenCode.
- Merutekan permintaan ke alur ringkasan, analisis insiden, PR review, atau tugas umum.
- Menggunakan ulang atau membuat sesi OpenCode secara otomatis.
- Menyediakan dashboard lokal untuk sesi, prompt, trigger modes, mode PUA, knowledge base, binding server OpenCode, dan distilasi gaya.
- Mendukung konfigurasi knowledge base ringan di `oncall-bot.config.json`.
- Mendukung profil distilasi gaya dan pergantian gaya aktif.
- Workflow todo global: buat todo dari baris sesi mana saja, ringkasan AI satu klik untuk judul dan deskripsi, pelacakan status (open/in_progress/blocked/completed), komentar dengan sinkronisasi opsional ke chat session, dan pembuatan chat session todo khusus secara lazy.

### Arsitektur

Runtime utama dimulai dari `oncall-bot.js`. Event dari Lark melewati filter pesan, pengambil konteks, orkestrasi trigger, dan pengirim balasan. Routing intent dan penyusunan prompt dilakukan sebelum permintaan dikirim ke OpenCode.

Server dashboard di `lib/dashboard-server.js` menyediakan endpoint HTTP lokal untuk konfigurasi, sesi, knowledge base, kontrol server, dan alur kerja distilasi gaya.

### Persyaratan

- Node.js 18 atau lebih baru
- `lark-cli` terpasang dan sudah terautentikasi untuk identitas yang digunakan bot
- `opencode` terpasang dan tersedia di `PATH`
- Server OpenCode yang dapat dijangkau, atau izin agar bot menyalakannya secara lokal

### Mulai Cepat

Pasang dependensi:

```sh
npm install
```

Tinjau dan ubah file konfigurasi:

```sh
cp oncall-bot.config.json oncall-bot.config.local.json
```

Sebelum menjalankan bot, ubah dua field ini di file konfigurasi salinan Anda:

- `lark.trigger.bot_name`: isi dengan nama tampilan bot Anda saat ini di Lark. Mode trigger `mention_bot` mencocokkan teks `@<bot_name>` dari pesan, jadi jika nama contoh dibiarkan, mention ke bot Anda tidak akan memicu bot.
- `opencode.project_directory`: isi dengan path absolut ke direktori project lokal Anda. Bot memakai path ini saat auto-start `opencode serve`.

Contoh:

```json
{
  "lark": {
    "trigger": {
      "bot_name": "Another Yixiang Wang"
    }
  },
  "opencode": {
    "project_directory": "/absolute/path/to/oncall-bot"
  }
}
```

Jalankan bot:

```sh
npm start
```

Jalankan test:

```sh
npm test
```

Jika ingin memakai file konfigurasi lain:

```sh
node oncall-bot.js --config oncall-bot.config.local.json
```

### Konfigurasi

Bot dikonfigurasi melalui `oncall-bot.config.json`. Bagian top-level utamanya adalah:

- `lark`: identitas, chat yang dipantau, aturan trigger, dan mode trigger
- `context`: jumlah konteks percakapan yang diambil
- `opencode`: base URL, kredensial, timeout, dan penamaan sesi
- `reply`: mode balasan dan notifikasi proses
- `concurrency`: kontrol antrean per chat
- `dashboard`: port dashboard lokal dan bahasa
- `knowledge_base`: item knowledge base opsional
- `prompt`: template prompt per intent
- `pua`: pengaktifan mode PUA per intent

### Dashboard

Saat `dashboard.enabled` bernilai `true`, bot akan menjalankan dashboard lokal dan mencetak URL-nya saat startup. Dashboard saat ini mendukung:

- melihat sesi aktif
- memeriksa pesan dalam sesi
- mengedit prompt dan trigger modes
- memperbarui pengaturan mode PUA
- mengelola item knowledge base
- mengelola atau melakukan binding ke proses server OpenCode
- menjalankan workflow distilasi gaya dan memilih gaya aktif
- membuat dan mengelola todo global dengan ringkasan AI satu klik, update status, komentar, dan lazy chat session

### Testing

Jalankan seluruh test suite dengan:

```sh
npm test
```

Repositori ini menggunakan test runner bawaan Node, dan file test berada di direktori `test/`.

### Contributing

Gunakan alur berikut saat berkontribusi:

1. Sinkronkan branch lokal `master`.
2. Buat branch baru dari `master`.
3. Lakukan perubahan dan commit di branch tersebut.
4. Push branch ke `origin`.
5. Buka pull request dengan target `master`.

Contoh:

```sh
git checkout master
git pull origin master
git checkout -b feat/my-change
```

### License

Proyek ini menggunakan MIT License. Lihat file `LICENSE` untuk teks lengkapnya.

### Contact

- `yixiang.wang@traveloka.com`
- `943161618@qq.com`
- `+86 18856978931`

### Project Structure

- `oncall-bot.js`: entrypoint runtime
- `oncall-bot.config.json`: file konfigurasi lokal
- `lib/`: modul runtime utama
- `dashboard/`: aset frontend dashboard
- `test/`: test otomatis
- `docs/superpowers/`: spesifikasi desain dan rencana implementasi

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=yixiangWangTrv/oncall-bot&type=Date)](https://www.star-history.com/#yixiangWangTrv/oncall-bot&Date)
