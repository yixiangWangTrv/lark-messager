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
import { detectIntent } from "./lib/intent-router.js";
import { getProcessingNotice } from "./lib/processing-notice.js";
import { acquireSingleInstanceLock } from "./lib/single-instance-lock.js";
import { TriggerGuard } from "./lib/trigger-guard.js";
import { processTrigger } from "./lib/trigger-orchestration.js";
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
const triggerGuard = new TriggerGuard();

// Startup checks
async function preflight() {
  log("Running preflight checks...");

  // Check opencode serve
  const healthy = await opencode.healthCheck();
  if (!healthy) {
    throw new Error(`opencode serve not reachable at ${config.opencode.base_url} (configured in opencode.base_url)`);
  }
  log(`✓ opencode serve reachable at ${config.opencode.base_url} (change via dashboard or config file)`);

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

  log(`← trigger: ${senderId} in ${chatId} (${messageId})${event.thread_id ? ` thread=${event.thread_id}` : ""}`);

  const startTime = Date.now();
  try {
    const result = await processTrigger({
      event,
      config,
      queue,
      triggerGuard,
      contextFetcher,
      opencode: {
        ...opencode,
        async findOrCreateSession(sessionOptions) {
          const sessionResult = await opencode.findOrCreateSession(sessionOptions);
          log(`  session: "${sessionOptions.title}" (${sessionResult.sessionId}, ${sessionResult.sessionState})`);
          botEvents.emit("session:created", {
            sessionId: sessionResult.sessionId,
            title: sessionOptions.title,
            chatName: sessionOptions.title.split("-")[0],
            intent: "other",
            createdAt: new Date().toISOString(),
          });
          return sessionResult;
        },
        async sendMessage(sessionId, prompt) {
          log("  sending to opencode...");
          const analysis = await opencode.sendMessage(sessionId, prompt);
          log(`  opencode replied (${Math.round((Date.now() - startTime) / 1000)}s)`);
          return analysis;
        },
      },
      replySender: {
        ...replySender,
        async sendReply(replyEvent, text, options) {
          await replySender.sendReply(replyEvent, text, options);
          if (text === getProcessingNotice(config)) {
            log("  sent processing notice");
          }
        },
      },
      detectIntentFn(receivedEvent, contextMessages) {
        const intent = detectIntent(receivedEvent, contextMessages);
        log(`  intent: ${intent}`);
        return intent;
      },
    });

    if (result === null) {
      log(`  ⚠ queue full for ${chatId}, dropping message ${messageId}`);
      return;
    }

    log(`→ replied (${messageId})`);
  } catch (err) {
    log(`✗ error: ${err.message}`);
    try {
      await replySender.sendReply(event, `⚠️ Analysis failed: ${err.message}`);
    } catch {
      // best-effort
    }
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
      log(`\x1b[31m✓ dashboard running at http://localhost:${config.dashboard.port} ← open in browser\x1b[0m`);
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
