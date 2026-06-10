import { detectIntent, buildIntentPrompt, buildSessionOptions, parseDistillCommand } from "./intent-router.js";
import {
  getProcessingNotice,
  getThreadOnlyNotice,
  getTriggerOnlyFallbackNotice,
  shouldSendProcessingNotice,
} from "./processing-notice.js";
import { normalizeSessionResult } from "./session-result.js";
import { generateStyledReply, getDistilled, listDistilled } from "./distill.js";

export async function processTrigger({
  event,
  config,
  queue,
  triggerGuard,
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
  const candidateThreadId = event.thread_id || messageId || null;
  const isThreadMessage = Boolean(candidateThreadId);
  const triggerKey = messageId || `${chatId}:${event.create_time || event.content || "unknown"}`;

  if (triggerGuard && !triggerGuard.tryStart(triggerKey)) {
    return null;
  }

  const queuedTask = queue.enqueue(chatId, async () => {
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
        threadId: candidateThreadId,
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

    // Handle distill_style intent directly without normal OpenCode flow
    if (intent === "distill_style") {
      const parsed = parseDistillCommand(event.content);
      if (parsed) {
        // Try to find the distilled profile by slug or name
        const allProfiles = listDistilled();
        const profile = getDistilled(parsed.slug)
          || allProfiles.find((p) => p.name === parsed.slug || p.slug === parsed.slug);

        if (!profile) {
          const available = allProfiles.map((p) => p.name).join(", ") || "none";
          await replySender.sendReply(event, `未找到风格"${parsed.slug}"。可用风格: ${available}`);
          return;
        }

        const userMessage = parsed.message || contextResult.messages?.slice(-1)[0] || "你好";
        const reply = await generateStyledReply({
          slug: profile.slug,
          userMessage,
          openCodeClient: opencode,
        });
        await replySender.sendReply(event, reply);
        return;
      }
    }

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
      threadId: contextResult?.threadId || null,
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
      puaConfig: config.pua,
    });

    const analysis = await opencode.sendMessage(sessionId, prompt);
    await replySender.sendReply(event, analysis);
  });

  if (queuedTask === null) {
    triggerGuard?.markFailure(triggerKey);
    return null;
  }

  try {
    const result = await queuedTask;
    triggerGuard?.markSuccess(triggerKey);
    return result;
  } catch (err) {
    triggerGuard?.markFailure(triggerKey);
    throw err;
  }
}
