export const DEFAULT_PROCESSING_NOTICE = "Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.";
export const DEFAULT_THREAD_ONLY_NOTICE = "This message was sent in a thread. I will only use messages from this thread as context.";
export const DEFAULT_TRIGGER_ONLY_FALLBACK_NOTICE = "I could not load thread history, so I will use only the trigger message itself.";

export function shouldSendProcessingNotice(config) {
  return config.reply?.send_processing_notice !== false;
}

export function getProcessingNotice(config) {
  return config.reply?.processing_notice || DEFAULT_PROCESSING_NOTICE;
}

export function getThreadOnlyNotice(config) {
  return config.reply?.thread_only_notice || DEFAULT_THREAD_ONLY_NOTICE;
}

export function getTriggerOnlyFallbackNotice(config) {
  return config.reply?.trigger_only_fallback_notice || DEFAULT_TRIGGER_ONLY_FALLBACK_NOTICE;
}
