export const DEFAULT_PROCESSING_NOTICE = "Processing your request now. If OpenCode requires approval, the final reply may take a bit longer.";

export function shouldSendProcessingNotice(config) {
  return config.reply?.send_processing_notice !== false;
}

export function getProcessingNotice(config) {
  return config.reply?.processing_notice || DEFAULT_PROCESSING_NOTICE;
}
