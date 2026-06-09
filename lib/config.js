// lib/config.js
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  other: {
    system_prefix: "You answer the user's chat request using the provided chat context.",
    task_instructions: "Answer the request directly from the chat context. Do not use Datadog unless the user explicitly asks for system investigation.",
    response_format: "Respond in the same language as the user. Keep the answer concise.",
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
    project_directory: process.cwd(),
    ...config.opencode,
  };
  config.concurrency = { max_per_chat: 1, queue_size: 5, ...config.concurrency };
  config.reply = {
    default: "in_thread",
    rules: [],
    send_processing_notice: true,
    processing_notice: "Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.",
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
  config.prompt = {
    ...defaultPromptConfig,
    ...config.prompt,
    summary: { ...defaultPromptConfig.summary, ...config.prompt?.summary },
    incident_analysis: { ...defaultPromptConfig.incident_analysis, ...config.prompt?.incident_analysis },
    pr_review: { ...defaultPromptConfig.pr_review, ...config.prompt?.pr_review },
    other: { ...defaultPromptConfig.other, ...config.prompt?.other },
  };

  return config;
}
