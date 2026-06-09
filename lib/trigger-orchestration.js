import { detectIntent, buildIntentPrompt, buildSessionOptions } from "./intent-router.js";
import {
  getProcessingNotice,
  getThreadOnlyNotice,
  getTriggerOnlyFallbackNotice,
  shouldSendProcessingNotice,
} from "./processing-notice.js";
import { normalizeSessionResult } from "./session-result.js";

export async function processTrigger({
  event,
  config,
  queue,
  contextFetcher,
  opencode,
  replySender,
  detectIntentFn = detectIntent,
  buildIntentPromptFn = buildIntentPrompt,
  buildSessionOptionsFn = buildSessionOptions,
  getTodayFn = () => new Date().toISOString().slice(0, 10),
}) {
  const chatId = event.chat_id;
  const messageId = event.message_id;
  const isThreadMessage = Boolean(event.thread_id);

  return queue.enqueue(chatId, async () => {
    let contextResult = null;

    if (shouldSendProcessingNotice(config)) {
      await replySender.sendReply(event, getProcessingNotice(config), { skipPrefix: true });

      if (isThreadMessage) {
        await replySender.sendReply(event, getThreadOnlyNotice(config), { skipPrefix: true });
      }
    }

    try {
      contextResult = await contextFetcher.fetchContext({
        chatId,
        threadId: event.thread_id || null,
        beforeTimestamp: event.create_time,
        triggerMessage: event.content,
      });
    } catch (err) {
      if (shouldSendProcessingNotice(config) && isThreadMessage) {
        await replySender.sendReply(event, getTriggerOnlyFallbackNotice(config), { skipPrefix: true });
      }
      throw err;
    }

    const intent = detectIntentFn(event, contextResult.messages);

    if (shouldSendProcessingNotice(config) && contextResult.scope === "trigger_only" && isThreadMessage) {
      await replySender.sendReply(event, getTriggerOnlyFallbackNotice(config), { skipPrefix: true });
    }

    const chatName = await contextFetcher.getChatName(chatId);
    const sessionOptions = buildSessionOptionsFn({
      intent,
      chatId,
      chatName,
      today: getTodayFn(),
      triggerMessageId: messageId,
      triggerContent: event.content,
    });
    const { sessionId, sessionState } = normalizeSessionResult(
      await opencode.findOrCreateSession(sessionOptions)
    );

    const prompt = buildIntentPromptFn({
      intent,
      promptConfig: config.prompt,
      event,
      contextResult,
      sessionState,
    });

    const analysis = await opencode.sendMessage(sessionId, prompt);
    await replySender.sendReply(event, analysis);
  });
}
