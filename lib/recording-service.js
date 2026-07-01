import { upsertRecord } from "./lark-base-client.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function recordTrigger({ event, config, chatName, intent, analysis, threadId }) {
  const { app_token: appToken, table_id: tableId } = config.recording.lark_base;
  if (!appToken || !tableId) {
    process.stderr.write("[recording-service] Missing app_token or table_id, skipping record\n");
    return;
  }

  const identity = config.lark.reply_identity || "user";

  const messageLink = await buildMessageLink(event, identity);

  const messageSummary = (event.content || "").slice(0, 500);

  const aiReply = (analysis || "").slice(0, 2000);

  await upsertRecord({
    identity,
    appToken,
    tableId,
    fields: {
      groupName: chatName || event.chat_id || "",
      createdAt: formatEventTime(event),
      messageSummary,
      messageLink,
      threadId: threadId || event.thread_id || "",
      messageType: intent || event.message_type || "",
      aiReply,
      status: "Not Started",
    },
  });
}

export async function recordMessageOnly({ event, config, chatName, mode }) {
  const { app_token: appToken, table_id: tableId } = config.recording.lark_base;
  if (!appToken || !tableId) {
    process.stderr.write("[recording-service] Missing app_token or table_id, skipping record\n");
    return;
  }

  const identity = config.lark.reply_identity || "user";
  const threadId = event.thread_id || "";
  const messageLink = await buildMessageLink(event, identity);

  await upsertRecord({
    identity,
    appToken,
    tableId,
    fields: {
      groupName: chatName || event.chat_id || "",
      createdAt: formatEventTime(event),
      messageSummary: (event.content || "").slice(0, 500),
      messageLink,
      threadId,
      messageType: mode || event.message_type || "",
      aiReply: "",
      status: "Not Started",
    },
  });
}

function formatEventTime(event) {
  const raw = Number(event.create_time);
  const date = Number.isFinite(raw) && raw > 0
    ? new Date(raw)
    : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function buildMessageLink(event, identity) {
  const resolved = await resolveMessageAppLink(event, identity);
  if (resolved) return resolved;

  const params = new URLSearchParams();
  if (event.thread_id) {
    if (event.chat_id) params.set("open_chat_id", event.chat_id);
    params.set("open_thread_id", event.thread_id);
    return `https://applink.larksuite.com/client/thread/open?${params.toString()}`;
  }

  if (event.chat_id) params.set("openChatId", event.chat_id);
  if (event.message_id) params.set("openMessageId", event.message_id);
  return `https://applink.larksuite.com/client/chat/open?${params.toString()}`;
}

async function resolveMessageAppLink(event, identity) {
  if (event.message_app_link) return event.message_app_link;
  if (!event.message_id) return "";

  try {
    const { stdout } = await execFileAsync("lark-cli", [
      "im", "+messages-mget",
      "--message-ids", event.message_id,
      "--as", identity,
      "--json",
    ], { timeout: 30000 });
    const result = JSON.parse(stdout);
    const messages = result.data?.messages || result.messages || [];
    const candidates = messages.flatMap((message) => [message, ...(message.thread_replies || [])]);
    const best = findBestMessageLinkCandidate(candidates, event);
    return best?.message_app_link || "";
  } catch (err) {
    process.stderr.write(`[recording-service] Failed to resolve message app link: ${err.message}\n`);
    return "";
  }
}

function findBestMessageLinkCandidate(candidates, event) {
  if (!candidates.length) return null;
  const content = normalizeText(event.content);
  const threadPosition = event.thread_message_position || event.thread_position;
  const messagePosition = event.message_position;

  return candidates.find((msg) => msg.message_id === event.message_id && normalizeText(msg.content) === content)
    || candidates.find((msg) => threadPosition && String(msg.thread_message_position) === String(threadPosition))
    || candidates.find((msg) => messagePosition && String(msg.message_position) === String(messagePosition))
    || candidates.find((msg) => content && normalizeText(msg.content) === content)
    || candidates.find((msg) => msg.message_id === event.message_id)
    || candidates[0];
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
