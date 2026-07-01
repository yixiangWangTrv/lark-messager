import { upsertRecord } from "./lark-base-client.js";

export async function recordTrigger({ event, config, chatName, intent, analysis, threadId }) {
  const { app_token: appToken, table_id: tableId } = config.recording.lark_base;
  if (!appToken || !tableId) {
    process.stderr.write("[recording-service] Missing app_token or table_id, skipping record\n");
    return;
  }

  const identity = config.lark.reply_identity || "user";

  const messageLink = buildMessageLink(event);

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
  const messageLink = buildMessageLink(event);

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

function buildMessageLink(event) {
  const params = new URLSearchParams();
  if (event.chat_id) params.set("openChatId", event.chat_id);
  if (event.message_id) params.set("openMessageId", event.message_id);
  return `https://applink.larksuite.com/client/chat/open?${params.toString()}`;
}
