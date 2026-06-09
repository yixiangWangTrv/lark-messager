#!/usr/bin/env node
// oncall-bot.js
import { loadConfig } from "./lib/config.js";
import { EventListener } from "./lib/event-listener.js";
import { MessageFilter } from "./lib/message-filter.js";
import { ContextFetcher } from "./lib/context-fetcher.js";
import { OpenCodeClient } from "./lib/opencode-client.js";
import { ReplySender } from "./lib/reply-sender.js";
import { ChatQueue } from "./lib/queue.js";

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
    try {
      // 1. Fetch context
      log(`  fetching ${config.context.message_count} messages context...`);
      const contextMessages = await contextFetcher.fetchContext(chatId, event.create_time);

      // 2. Resolve chat name
      const chatName = await contextFetcher.getChatName(chatId);

      // 3. Build prompt
      const prompt = buildPrompt(event, contextMessages);

      // 4. Find or create session
      const sessionId = await opencode.findOrCreateSession(chatId, chatName);
      const today = new Date().toISOString().slice(0, 10);
      const sessionTitle = config.opencode.session_name_format
        .replace("{chat_name}", chatName)
        .replace("{date}", today);
      log(`  session: "${sessionTitle}" (${sessionId ? "found" : "new"})`);

      // 5. Send to opencode
      log(`  sending to opencode...`);
      const startTime = Date.now();
      const analysis = await opencode.sendMessage(sessionId, prompt);
      log(`  opencode replied (${Math.round((Date.now() - startTime) / 1000)}s)`);

      // 6. Reply
      await replySender.sendReply(event, analysis);
      log(`→ replied (${messageId})`);
    } catch (err) {
      log(`✗ error: ${err.message}`);
      // Try to notify the chat about the failure
      try {
        await replySender.sendReply(event, `⚠️ Analysis failed: ${err.message}`);
      } catch {
        // Couldn't even send error reply
      }
    }
  });

  if (result === null) {
    log(`  ⚠ queue full for ${chatId}, dropping message ${messageId}`);
  }
}

function buildPrompt(event, contextMessages) {
  const { system_prefix, task_instructions, response_format } = config.prompt;
  const contextBlock = contextMessages.length > 0
    ? contextMessages.join("\n")
    : "(no prior context available)";

  return `${system_prefix}

## Chat Context (recent ${contextMessages.length} messages)

${contextBlock}

## Trigger Message

${event.content}

## Your Task

${task_instructions}

${response_format}`;
}

// Main
async function main() {
  try {
    await preflight();
  } catch (err) {
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
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
