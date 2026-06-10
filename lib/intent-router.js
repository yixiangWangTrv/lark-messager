const PR_URL_PATTERN = /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i;

const SUMMARY_KEYWORDS = [
  "summary",
  "summarize",
  "summarise",
  "总结",
  "总结上面",
  "总结上面的对话",
];

const INCIDENT_KEYWORDS = [
  "incident",
  "error",
  "failure",
  "failing",
  "broken",
  "debug",
  "investigate",
  "排查",
  "报错",
  "故障",
  "异常",
];

export function normalizePrUrl(input = "") {
  const match = String(input).match(PR_URL_PATTERN);
  if (!match) return null;

  return match[0].replace(/[.,!?]+$/, "");
}

export function detectIntent(event, _contextLines = []) {
  const content = String(event?.content || "");
  const normalized = content.toLowerCase();

  if (normalizePrUrl(content)) {
    return "pr_review";
  }

  if (SUMMARY_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
    return "summary";
  }

  if (INCIDENT_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
    return "incident_analysis";
  }

  return "other";
}

function buildTriggerMetadata(event, intent, contextResult, sessionState) {
  const threadId = contextResult?.threadId || event?.thread_id || null;
  const isThreadMessage = Boolean(threadId);
  const metadataLines = [
    "Trigger metadata:",
    `sender_id: ${event?.sender_id || "unknown"}`,
    `chat_id: ${event?.chat_id || "unknown"}`,
    `message_id: ${event?.message_id || "unknown"}`,
    `is_thread_message: ${isThreadMessage}`,
    `session_state: ${sessionState || "new"}`,
    `context_scope: ${contextResult?.scope || "chat"}`,
    `intent: ${intent}`,
  ];

  if (threadId) {
    metadataLines.splice(4, 0, `thread_id: ${threadId}`);
  }

  return metadataLines.join("\n");
}

function normalizePromptArgs(intentOrOptions, promptConfig, event, contextLines = []) {
  if (typeof intentOrOptions === "object" && intentOrOptions !== null) {
    return {
      intent: intentOrOptions.intent,
      promptConfig: intentOrOptions.promptConfig,
      event: intentOrOptions.event,
      contextResult: intentOrOptions.contextResult || {
        messages: [],
        scope: "chat",
        threadId: null,
        fetchFailed: false,
      },
      sessionState: intentOrOptions.sessionState || "new",
    };
  }

  return {
    intent: intentOrOptions,
    promptConfig,
    event,
    contextResult: {
      messages: contextLines,
      scope: event?.thread_id ? "thread" : "chat",
      threadId: event?.thread_id || null,
      fetchFailed: false,
    },
    sessionState: "new",
  };
}

export function buildIntentPrompt(intentOrOptions, promptConfig, event, contextLines = []) {
  const {
    intent,
    promptConfig: resolvedPromptConfig,
    event: resolvedEvent,
    contextResult,
    sessionState,
  } = normalizePromptArgs(intentOrOptions, promptConfig, event, contextLines);
  const config = resolvedPromptConfig?.[intent] || resolvedPromptConfig?.other || {};
  const sections = [];

  if (sessionState === "new") {
    if (config.system_prefix) {
      sections.push(config.system_prefix);
    }

    if (config.task_instructions) {
      sections.push(config.task_instructions);
    }

    if (config.response_format) {
      sections.push(config.response_format);
    }

    sections.push("Read trigger metadata first before using any context. Use only the declared context scope.");

    if ((contextResult?.scope || "chat") === "thread") {
      sections.push("This trigger came from a thread. Use only thread context. Do not use main-chat context.");
    }
  } else {
    sections.push("A new trigger message has arrived in this existing session.");
    sections.push("Re-evaluate the new trigger first. Use only the declared context scope.");
    sections.push("Read trigger metadata first before using any context.");

    if (config.response_format) {
      sections.push(config.response_format);
    }
  }
  sections.push(buildTriggerMetadata(resolvedEvent, intent, contextResult, sessionState));

  if (contextResult?.messages?.length > 0) {
    sections.push(`Context:\n${contextResult.messages.join("\n")}`);
  }

  if (resolvedEvent?.content) {
    sections.push(`User request:\n${resolvedEvent.content}`);
  }

  return sections.join("\n\n");
}

export function buildSessionOptions({
  intent,
  chatId,
  chatName,
  today,
  triggerMessageId,
  triggerContent,
  threadId,
}) {
  if (intent === "incident_analysis") {
    return {
      title: `${chatName}-incident-${today}`,
      cacheKey: `${intent}:${chatId}:${today}`,
      reuse: true,
    };
  }

  if (intent === "summary") {
    return {
      title: `${chatName}-summary-${today}`,
      cacheKey: `${intent}:${chatId}:${triggerMessageId}`,
      reuse: false,
    };
  }

  if (intent === "pr_review") {
    const prUrl = normalizePrUrl(triggerContent);
    return {
      title: `${chatName}-pr-review-${today}`,
      cacheKey: prUrl
        ? `${intent}:${chatId}:${prUrl}`
        : `${intent}:${chatId}:${triggerMessageId}`,
      reuse: Boolean(prUrl),
    };
  }

  // For "other" intent: reuse session when messages belong to the same thread
  if (threadId) {
    const shortThread = String(threadId).slice(-8);
    return {
      title: `${chatName}-other-${today}-${shortThread}`,
      cacheKey: `${intent}:${chatId}:${threadId}`,
      reuse: true,
    };
  }

  return {
    title: `${chatName}-other-${today}`,
    cacheKey: `${intent}:${chatId}:${triggerMessageId}`,
    reuse: false,
  };
}
