export class MessageFilter {
  constructor(config) {
    this.watchChatIds = config.lark.watch_chat_ids || [];
    this.trigger = config.lark.trigger;
    this.triggerModes = config.lark.trigger_modes;
    this.seen = new Set();
  }

  shouldTrigger(event) {
    // Chat type filter
    const isPrivate = event.chat_type === "p2p";
    if (isPrivate) {
      if (!this.triggerModes.allow_private) return false;
    } else if (event.chat_type !== "group") {
      return false;
    }

    // Only text and post
    if (event.message_type !== "text" && event.message_type !== "post") return false;

    // Watch list filter (only for group chats)
    if (!isPrivate && this.watchChatIds.length > 0 && !this.watchChatIds.includes(event.chat_id)) return false;

    // Deduplication
    if (this.seen.has(event.message_id)) return false;

    // Private chats don't require mention — trigger directly
    // Group chats need to pass trigger mode checks
    const content = event.content || "";
    const triggerResult = isPrivate
      ? { triggered: true, mode: "allow_private", replyIdentity: null }
      : this._checkTriggerModes(content, event);

    if (triggerResult.triggered) {
      this.seen.add(event.message_id);
      // Keep seen set bounded (prevent memory leak)
      if (this.seen.size > 10000) {
        const entries = [...this.seen];
        this.seen = new Set(entries.slice(entries.length - 5000));
      }
    }

    return triggerResult.triggered;
  }

  getTriggerMetadata(event) {
    const content = event.content || "";
    const isPrivate = event.chat_type === "p2p";
    if (isPrivate) return { triggered: true, mode: "allow_private", replyIdentity: null };
    return this._checkTriggerModes(content, event);
  }

  _checkTriggerModes(content, event) {
    const modes = this.triggerModes;

    // Mode: all_messages — trigger on every group message
    if (modes.all_messages) {
      return { triggered: true, mode: "all_messages", replyIdentity: null };
    }

    // Mode: mention_bot — trigger when @bot is mentioned
    if (modes.mention_bot) {
      if (this.trigger.bot_name && content.includes(`@${this.trigger.bot_name}`)) {
        return { triggered: true, mode: "mention_bot", replyIdentity: null };
      }
    }

    // Mode: mention_owner — trigger when @owner (user_names) is mentioned
    if (modes.mention_owner) {
      for (const name of this.trigger.user_names || []) {
        if (content.includes(`@${name}`)) {
          // Check group filter
          const groupFilter = modes.mention_owner_group_filter || { mode: "none", group_ids: [] };
          if (groupFilter.mode === "whitelist" && groupFilter.group_ids.length > 0) {
            if (!groupFilter.group_ids.includes(event.chat_id)) {
              return { triggered: false, replyIdentity: null };
            }
          }
          if (groupFilter.mode === "blacklist" && groupFilter.group_ids.length > 0) {
            if (groupFilter.group_ids.includes(event.chat_id)) {
              return { triggered: false, replyIdentity: null };
            }
          }
          return {
            triggered: true,
            mode: "mention_owner",
            replyIdentity: modes.mention_owner_reply_identity || "bot",
          };
        }
      }
    }

    // Legacy: also check group_names (always active if configured)
    for (const name of this.trigger.group_names || []) {
      if (content.includes(`@${name}`)) return { triggered: true, mode: "legacy_group_names", replyIdentity: null };
    }

    return { triggered: false, mode: null, replyIdentity: null };
  }
}
