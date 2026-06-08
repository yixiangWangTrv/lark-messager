export class MessageFilter {
  constructor(config) {
    this.watchChatIds = config.lark.watch_chat_ids || [];
    this.trigger = config.lark.trigger;
    this.seen = new Set();
  }

  shouldTrigger(event) {
    // Only group messages
    if (event.chat_type !== "group") return false;

    // Only text and post
    if (event.message_type !== "text" && event.message_type !== "post") return false;

    // Watch list filter
    if (this.watchChatIds.length > 0 && !this.watchChatIds.includes(event.chat_id)) return false;

    // Deduplication
    if (this.seen.has(event.message_id)) return false;

    // Check mention triggers
    const content = event.content || "";
    const triggered = this._hasMentionTrigger(content);

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

  _hasMentionTrigger(content) {
    // Check @bot name
    if (this.trigger.bot_name && content.includes(`@${this.trigger.bot_name}`)) {
      return true;
    }

    // Check @user names
    for (const name of this.trigger.user_names || []) {
      if (content.includes(`@${name}`)) return true;
    }

    // Check @group member names
    for (const name of this.trigger.group_names || []) {
      if (content.includes(`@${name}`)) return true;
    }

    return false;
  }
}
