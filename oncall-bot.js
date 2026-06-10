#!/usr/bin/env node
// oncall-bot.js
import { resolve } from "node:path";
import { loadConfig } from "./lib/config.js";
import { EventListener } from "./lib/event-listener.js";
import { MessageFilter } from "./lib/message-filter.js";
import { ContextFetcher } from "./lib/context-fetcher.js";
import { OpenCodeClient } from "./lib/opencode-client.js";
import { ReplySender } from "./lib/reply-sender.js";
import { ChatQueue } from "./lib/queue.js";
import { detectIntent, buildIntentPrompt, buildSessionOptions } from "./lib/intent-router.js";
import { getProcessingNotice, shouldSendProcessingNotice } from "./lib/processing-notice.js";
import { acquireSingleInstanceLock } from "./lib/single-instance-lock.js";
import { AsyncAnalysis } from "./lib/async-analysis.js";
import { PendingJobs } from "./lib/pending-jobs.js";
import { DashboardServer } from "./lib/dashboard-server.js";
import { botEvents } from "./lib/bot-events.js";

// Parse args
const configPath = process.argv.includes("--config")
  ? process.argv[process.argv.indexOf("--config") + 1]
  : "oncall-bot.config.json";

// Load config
const config = loadConfig(configPath);
const log = (msg) => process.stderr.write(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${msg}\n`);

// Initialize components
const filter = new MessageFilter(config);
const contextFetcher = new ContextFetcher(config);
const opencode = new OpenCodeClient(config);
const replySender = new ReplySender(config);
const queue = new ChatQueue(config.concurrency);
const pendingJobs = new PendingJobs();
const asyncAnalysis = new AsyncAnalysis({ client: opencode, replySender, config });

// Startup checks
async function preflight() {
  log("Running preflight checks...");

  // Check opencode serve
  const healthy = await opencode.healthCheck();
  if (!healthy) {
    throw new Error(`opencode serve not reachable at ${config.opencode.base_url}`);
  }
  log(`✓ opencode serve reachable at ${config.opencode.base_url}`);

  // Check lark-cli auth for both identities
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  // Check bot identity (for event listening) — just verify lark-cli exists and can parse args
  try {
    await execFileAsync("lark-cli", ["event", "list"], {
      timeout: 15000,
    });
    log(`✓ lark-cli available (${config.lark.listen_identity} identity — listen)`);
  } catch (err) {
    throw new Error(`lark-cli not available: ${err.message}`);
  }

  // Check user identity (for replies and context fetching)
  if (config.lark.reply_identity !== config.lark.listen_identity) {
    try {
      await execFileAsync("lark-cli", ["contact", "+get-user", "--as", config.lark.reply_identity], {
        timeout: 10000,
      });
      log(`✓ lark-cli auth valid (${config.lark.reply_identity} identity — reply)`);
    } catch (err) {
      throw new Error(`lark-cli auth failed (--as ${config.lark.reply_identity}): ${err.message}`);
    }
  }
}

// Handle a triggered message
async function handleTrigger(event) {
  const chatId = event.chat_id;
  const messageId = event.message_id;
  const senderId = event.sender_id;

  log(`← trigger: ${senderId} in ${chatId} (${messageId})`);

  const result = queue.enqueue(chatId, async () => {
    // Dedup: skip if a job for this trigger is already running
    const jobKey = `${chatId}:${messageId}`;
    if (pendingJobs.get(jobKey)) {
      log(`  ⚠ duplicate trigger ignored (${jobKey})`);
      return;
    }

    try {
      // 1. Fetch context
      log(`  fetching ${config.context.message_count} messages context...`);
      const contextMessages = await contextFetcher.fetchContext(chatId, event.create_time);

      // 2. Detect intent
      const intent = detectIntent(event, contextMessages);
      log(`  intent: ${intent}`);

      // 3. Resolve chat name
      const chatName = await contextFetcher.getChatName(chatId);

      // 4. Build intent-aware prompt
      const prompt = buildIntentPrompt(intent, config.prompt, event, contextMessages);

      // 5. Build session options and find/create session
      const today = new Date().toISOString().slice(0, 10);
      const sessionOptions = buildSessionOptions({
        intent,
        chatId,
        chatName,
        today,
        triggerMessageId: messageId,
        triggerContent: event.content,
      });
      const sessionId = await opencode.findOrCreateSession(sessionOptions);
      log(`  session: "${sessionOptions.title}" (${sessionId})`);
      botEvents.emit("session:created", {
        sessionId,
        title: sessionOptions.title,
        chatName: chatName || sessionOptions.title.split("-")[0],
        intent,
        createdAt: new Date().toISOString(),
      });

      // 6. Send processing notice immediately
      if (shouldSendProcessingNotice(config)) {
        await replySender.sendReply(event, getProcessingNotice(config), { skipPrefix: true });
        log("  sent processing notice");
      }

      // 7. Register pending job (dedup protection)
      pendingJobs.register({ chatId, triggerMessageId: messageId, sessionId, submittedAt: Date.now(), userMessageId: null });

      // 8. Launch background analysis — detached from queue
      asyncAnalysis.run(event, sessionId, prompt)
        .then(() => {
          pendingJobs.complete(jobKey);
          log(`→ async analysis complete (${messageId})`);
        })
        .catch((err) => {
          pendingJobs.fail(jobKey, err);
          log(`✗ async analysis error: ${err.message}`);
        });

      log(`  background analysis started (${messageId})`);
    } catch (err) {
      log(`✗ error in trigger setup: ${err.message}`);
      try {
        await replySender.sendReply(event, `⚠️ Failed to start analysis: ${err.message}`);
      } catch {
        // best-effort
      }
    }
  });

  if (result === null) {
    log(`  ⚠ queue full for ${chatId}, dropping message ${messageId}`);
  }
}

// Main
async function main() {
  let instanceLock;

  try {
    instanceLock = await acquireSingleInstanceLock({
      lockPath: resolve(".oncall-bot.lock"),
    });
    await preflight();

    // Start dashboard
    if (config.dashboard.enabled) {
      const dashboard = new DashboardServer({ config, botEvents, configPath });
      await dashboard.start();
      log(`✓ dashboard running at http://localhost:${config.dashboard.port}`);
    }
  } catch (err) {
    instanceLock?.release();
    log(`✗ Preflight failed: ${err.message}`);
    process.exit(1);
  }

  const listener = new EventListener({
    identity: config.lark.listen_identity,
    onEvent: (event) => {
      if (filter.shouldTrigger(event)) {
        handleTrigger(event);
      }
    },
    onError: (err) => {
      instanceLock?.release();
      log(`✗ Event listener fatal: ${err.message}`);
      process.exit(1);
    },
    onReady: () => {
      log("✓ listening on im.message.receive_v1");
    },
  });

  listener.start();

  // Graceful shutdown
  const shutdown = () => {
    log("Shutting down...");
    listener.stop();
    instanceLock?.release();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
