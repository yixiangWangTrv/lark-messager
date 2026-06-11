// lib/config.js
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_PROCESSING_NOTICE,
  DEFAULT_THREAD_ONLY_NOTICE,
  DEFAULT_TRIGGER_ONLY_FALLBACK_NOTICE,
} from "./processing-notice.js";

const REQUIRED_FIELDS = [
  "opencode.base_url",
];

const defaultPromptConfig = {
  summary: {
    system_prefix: "You summarize conversation context from this Lark chat.",
    task_instructions: "Summarize the recent conversation relevant to the trigger request. Do not use Datadog, logs, metrics, traces, incidents, or production investigation.",
    response_format: "Respond in the same language as the user. Keep it short and direct.",
  },
  incident_analysis: {
    system_prefix: "You are an on-call assistant responsible for analyzing production issues.",
    task_instructions: "1. Understand the problem from context\n2. Use Datadog tools to query relevant logs, metrics, and traces\n3. Provide root cause analysis and recommended next steps",
    response_format: "Respond in English. Use bullet points for key findings. Include relevant links where available.",
  },
  pr_review: {
    system_prefix: "You review PR requests coming from chat messages.",
    task_instructions: "Review the PR request from the provided context. Focus on code-review findings, risks, missing checks, and next actions. Do not use Datadog unless the user explicitly asks about runtime or production impact.",
    response_format: "Respond in English. Use bullets for findings and finish with clear next actions.",
  },
  common_task: {
    system_prefix: "You answer the user's chat request using the provided chat context.",
    task_instructions: "Use the trigger message as the primary task instruction. You have access to ALL opencode skills and tools — including Datadog (logs, traces, metrics, monitors, dashboards), Lark/Feishu integrations, code search, web fetch, and any other available capabilities. Use whatever tools and skills are appropriate to fulfill the user's request. Review the provided context messages, filter for the parts relevant to the trigger, and use them as supporting evidence when they are related. Answer directly, and take action when the request requires action.",
    response_format: "Respond in the same language as the user. Keep the answer concise.",
  },
};

const defaultIntentRoutingConfig = {
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

export function loadConfig(configPath) {
  const fullPath = resolve(configPath);
  let raw;
  try {
    raw = readFileSync(fullPath, "utf-8");
  } catch (err) {
    throw new Error(`Cannot read config file: ${fullPath} — ${err.message}`);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in config file: ${err.message}`);
  }

  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    const value = field.split(".").reduce((obj, key) => obj?.[key], config);
    if (!value) {
      throw new Error(`Missing required config field: ${field}`);
    }
  }

  // Apply defaults
  config.context = { message_count: 10, include_sender_name: true, ...config.context };
  config.opencode = {
    username: "opencode",
    password: "",
    analysis_timeout_ms: 600000,
    submit_timeout_ms: 30000,
    poll_interval_ms: 3000,
    poll_timeout_ms: 1800000,
    tool_stuck_threshold_ms: 8000,
    project_directory: process.cwd(),
    ...config.opencode,
  };
  config.concurrency = { max_per_chat: 1, queue_size: 5, ...config.concurrency };
  config.dashboard = { port: 8015, enabled: true, ...config.dashboard };
  config.knowledge_base = { enabled: true, items: [], ...config.knowledge_base };
  config.reply = {
    default: "in_thread",
    rules: [],
    send_processing_notice: true,
    processing_notice: DEFAULT_PROCESSING_NOTICE,
    thread_only_notice: DEFAULT_THREAD_ONLY_NOTICE,
    trigger_only_fallback_notice: DEFAULT_TRIGGER_ONLY_FALLBACK_NOTICE,
    ...config.reply,
  };
  const legacyLarkIdentity = config.lark?.identity;
  config.lark = {
    listen_identity: legacyLarkIdentity || "bot",
    context_identity: legacyLarkIdentity || "user",
    reply_identity: legacyLarkIdentity || "bot",
    watch_chat_ids: [],
    ...config.lark,
  };
  config.lark.trigger = { bot_id: "", bot_name: "", user_ids: [], user_names: [], group_ids: [], group_names: [], ...config.lark.trigger };
  config.lark.trigger_modes = {
    mention_bot: true,
    mention_owner: true,
    all_messages: false,
    ...config.lark.trigger_modes,
  };
  config.prompt = {
    ...defaultPromptConfig,
    ...config.prompt,
    summary: { ...defaultPromptConfig.summary, ...config.prompt?.summary },
    incident_analysis: { ...defaultPromptConfig.incident_analysis, ...config.prompt?.incident_analysis },
    pr_review: { ...defaultPromptConfig.pr_review, ...config.prompt?.pr_review },
    common_task: { ...defaultPromptConfig.common_task, ...config.prompt?.common_task },
  };
  config.intent_routing = {
    ...defaultIntentRoutingConfig,
    ...config.intent_routing,
    summary: { ...defaultIntentRoutingConfig.summary, ...config.intent_routing?.summary },
    incident_analysis: { ...defaultIntentRoutingConfig.incident_analysis, ...config.intent_routing?.incident_analysis },
    pr_review: { ...defaultIntentRoutingConfig.pr_review, ...config.intent_routing?.pr_review },
  };
  config.pua = {
    enabled: false,
    intents: {
      summary: false,
      incident_analysis: false,
      pr_review: false,
      common_task: false,
    },
    ...config.pua,
    intents: {
      summary: false,
      incident_analysis: false,
      pr_review: false,
      common_task: false,
      ...config.pua?.intents,
    },
  };

  return config;
}
