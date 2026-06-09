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
  const contextText = _contextLines.join("\n").toLowerCase();

  if (normalizePrUrl(content)) {
    return "pr_review";
  }

  if (SUMMARY_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
    return "summary";
  }

  if (INCIDENT_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
    return "incident_analysis";
  }

  if (
    contextText &&
    INCIDENT_KEYWORDS.some((keyword) => contextText.includes(keyword.toLowerCase()))
  ) {
    return "incident_analysis";
  }

  return "other";
}

export function buildIntentPrompt(intent, promptConfig, event, contextLines = []) {
  const config = promptConfig?.[intent] || promptConfig?.other || {};
  const sections = [];

  if (config.system_prefix) {
    sections.push(config.system_prefix);
  }

  if (config.task_instructions) {
    sections.push(config.task_instructions);
  }

  if (config.response_format) {
    sections.push(config.response_format);
  }

  if (contextLines.length > 0) {
    sections.push(`Context:\n${contextLines.join("\n")}`);
  }

  if (event?.content) {
    sections.push(`User request:\n${event.content}`);
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

  return {
    title: `${chatName}-other-${today}`,
    cacheKey: `${intent}:${chatId}:${triggerMessageId}`,
    reuse: false,
  };
}
