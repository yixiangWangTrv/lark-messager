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
    const triggered = isPrivate || this._checkTriggerModes(content);

    if (triggered) {
      this.seen.add(event.message_id);
      // Keep seen set bounded (prevent memory leak)
      if (this.seen.size > 10000) {
        const entries = [...this.seen];
        this.seen = new Set(entries.slice(entries.length - 5000));
      }
    }

    return triggered;
  }

  _checkTriggerModes(content) {
    const modes = this.triggerModes;

    // Mode: all_messages — trigger on every group message
    if (modes.all_messages) {
      return true;
    }

    // Mode: mention_bot — trigger when @bot is mentioned
    if (modes.mention_bot) {
      if (this.trigger.bot_name && content.includes(`@${this.trigger.bot_name}`)) {
        return true;
      }
    }

    // Mode: mention_owner — trigger when @owner (user_names) is mentioned
    if (modes.mention_owner) {
      for (const name of this.trigger.user_names || []) {
        if (content.includes(`@${name}`)) return true;
      }
    }

    // Legacy: also check group_names (always active if configured)
    for (const name of this.trigger.group_names || []) {
      if (content.includes(`@${name}`)) return true;
    }

    return false;
  }
}
