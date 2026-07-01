import { buildKnowledgeBasePromptSection } from "./knowledge-base.js";

const PR_URL_PATTERN = /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i;

const DISTILL_PATTERN = /^\/(?:distill-([^\s]+)|用([^\s]+?)(?:风格)?(?:回复|说))\s*([\s\S]*)/;

const DEFAULT_INTENT_ROUTING = {
  summary: {
    keywords: ["summary", "summarize", "summarise", "总结", "总结上面", "总结上面的对话"],
  },
  incident_analysis: {
    keywords: ["incident", "error", "failure", "failing", "broken", "debug", "investigate", "排查", "报错", "故障", "异常"],
  },
  pr_review: {
    keywords: [],
    use_github_pr_url: true,
  },
};

function includesAnyKeyword(normalized, keywords = []) {
  return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
}

export function normalizePrUrl(input = "") {
  const match = String(input).match(PR_URL_PATTERN);
  if (!match) return null;

  return match[0].replace(/[.,!?]+$/, "");
}

/**
 * Parse distill-style command from message content.
 * Matches: /distill-xiaoming xxx or /用小明风格回复 xxx or /用小明说 xxx
 * Returns { slug, message } or null.
 */
export function parseDistillCommand(content) {
  const match = String(content || "").match(DISTILL_PATTERN);
  if (!match) return null;
  const slug = match[1] || match[2]; // group 1 = distill-xxx, group 2 = 用xxx
  const message = (match[3] || "").trim();
  return { slug, message };
}

export function detectIntent(event, _contextLines = [], routingConfig = DEFAULT_INTENT_ROUTING) {
  const content = String(event?.content || "");
  const normalized = content.toLowerCase();
  const resolvedRoutingConfig = {
    ...DEFAULT_INTENT_ROUTING,
    ...routingConfig,
    summary: {
      ...DEFAULT_INTENT_ROUTING.summary,
      ...routingConfig?.summary,
    },
    incident_analysis: {
      ...DEFAULT_INTENT_ROUTING.incident_analysis,
      ...routingConfig?.incident_analysis,
    },
    pr_review: {
      ...DEFAULT_INTENT_ROUTING.pr_review,
      ...routingConfig?.pr_review,
    },
  };

  // Check for distill-style command first
  const distillMatch = content.match(DISTILL_PATTERN);
  if (distillMatch && (distillMatch[1] || distillMatch[2])) {
    return "distill_style";
  }

  if (resolvedRoutingConfig.pr_review.use_github_pr_url && normalizePrUrl(content)) {
    return "pr_review";
  }

  if (includesAnyKeyword(normalized, resolvedRoutingConfig.summary.keywords)) {
    return "summary";
  }

  if (includesAnyKeyword(normalized, resolvedRoutingConfig.pr_review.keywords)) {
    return "pr_review";
  }

  if (includesAnyKeyword(normalized, resolvedRoutingConfig.incident_analysis.keywords)) {
    return "incident_analysis";
  }

  return "common_task";
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
      puaConfig: intentOrOptions.puaConfig || null,
      knowledgeBase: intentOrOptions.knowledgeBase,
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
    puaConfig: null,
    knowledgeBase: undefined,
  };
}

const PUA_SKILL_INSTRUCTION = `[MANDATORY] Before starting this task, you MUST load and strictly follow the "pua" skill. This is not optional.
After loading the pua skill, your behavior must comply with all its protocols: the three red lines (close the loop with evidence, fact-driven verification, exhaust all approaches), pressure escalation (L0-L4), proactive initiative (3.75 standard), and the iceberg rule (fix one bug, check for the pattern).
Do not give up. Do not blame the environment without verification. Do not claim completion without running verification commands and showing output evidence. Exhaust every possible solution before reporting failure.`;

const OPERATIONAL_SAFETY_INSTRUCTION = `Operational safety: Do not trigger deployments, restarts, service starts, GitHub Actions/workflow runs, CI/CD pipelines, AWS deployments, or any equivalent production/infrastructure-changing operation. You may inspect configuration, code, logs, metrics, traces, existing workflow status, and deployment history. If the user asks for a prohibited operation, refuse that action and provide safe read-only guidance instead.`;

export function buildIntentPrompt(intentOrOptions, promptConfig, event, contextLines = []) {
  const {
    intent,
    promptConfig: resolvedPromptConfig,
    event: resolvedEvent,
    contextResult,
    sessionState,
    puaConfig,
    knowledgeBase,
  } = normalizePromptArgs(intentOrOptions, promptConfig, event, contextLines);
  const config = resolvedPromptConfig?.[intent] || resolvedPromptConfig?.common_task || {};
  const sections = [];

  // Inject PUA skill instruction if enabled for this intent
  const puaEnabled = puaConfig?.enabled && puaConfig?.intents?.[intent];
  if (puaEnabled) {
    sections.push(PUA_SKILL_INSTRUCTION);
  }

  if (sessionState === "new") {
    if (config.system_prefix) {
      sections.push(config.system_prefix);
    }

    sections.push(OPERATIONAL_SAFETY_INSTRUCTION);

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
    sections.push(OPERATIONAL_SAFETY_INSTRUCTION);
    sections.push("Re-evaluate the new trigger first. Use only the declared context scope.");
    sections.push("Read trigger metadata first before using any context.");

    if (config.response_format) {
      sections.push(config.response_format);
    }
  }
  sections.push(buildTriggerMetadata(resolvedEvent, intent, contextResult, sessionState));

  const knowledgeBaseSection = buildKnowledgeBasePromptSection(knowledgeBase);
  if (knowledgeBaseSection) {
    sections.push(knowledgeBaseSection);
  }

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

  // For common_task intent: reuse session when messages belong to the same thread
  if (threadId) {
    const shortThread = String(threadId).slice(-8);
    return {
      title: `${chatName}-common-task-${today}-${shortThread}`,
      cacheKey: `${intent}:${chatId}:${threadId}`,
      reuse: true,
    };
  }

  return {
    title: `${chatName}-common-task-${today}`,
    cacheKey: `${intent}:${chatId}:${triggerMessageId}`,
    reuse: false,
  };
}
