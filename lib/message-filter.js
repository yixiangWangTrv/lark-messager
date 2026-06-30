export class MessageFilter {
  constructor(config) {
    this.config = config;
    this.watchChatIds = config.lark.watch_chat_ids || [];
    this.trigger = config.lark.trigger;
    this.triggerModes = config.lark.trigger_modes;
    this.seen = new Set();
    this.recordSeen = new Set();
  }

  _passesBaseFilters(event) {
    const isPrivate = event.chat_type === "p2p";
    if (!isPrivate && event.chat_type !== "group") return false;
    if (event.message_type !== "text" && event.message_type !== "post") return false;
    if (!isPrivate && this.watchChatIds.length > 0 && !this.watchChatIds.includes(event.chat_id)) return false;
    return true;
  }

  _remember(set, messageId) {
    set.add(messageId);
    if (set.size > 10000) {
      const entries = [...set];
      set.clear();
      for (const entry of entries.slice(entries.length - 5000)) set.add(entry);
    }
  }

  shouldTrigger(event) {
    // Chat type filter
    const isPrivate = event.chat_type === "p2p";
    if (!this._passesBaseFilters(event)) return false;
    if (isPrivate) {
      if (!this.triggerModes.allow_private) return false;
    }

    // Deduplication
    if (this.seen.has(event.message_id)) return false;

    // Private chats don't require mention — trigger directly
    // Group chats need to pass trigger mode checks
    const content = event.content || "";
    const triggerResult = isPrivate
      ? { triggered: true, mode: "allow_private", replyIdentity: null }
      : this._checkTriggerModes(content, event);

    if (triggerResult.triggered) {
      this._remember(this.seen, event.message_id);
    }

    return triggerResult.triggered;
  }

  shouldRecord(event) {
    if (this.recordSeen.has(event.message_id)) return false;
    const meta = this.getRecordingMetadata(event);
    if (meta.shouldRecord) {
      this._remember(this.recordSeen, event.message_id);
      return true;
    }
    return false;
  }

  getTriggerMetadata(event) {
    if (!this._passesBaseFilters(event)) return { triggered: false, mode: null, replyIdentity: null };
    const content = event.content || "";
    const isPrivate = event.chat_type === "p2p";
    if (isPrivate) return { triggered: true, mode: "allow_private", replyIdentity: null };
    return this._checkTriggerModes(content, event);
  }

  getRecordingMetadata(event) {
    if (!this.config.recording?.enabled || !this._passesBaseFilters(event)) {
      return { shouldRecord: false, mode: null };
    }

    const modes = this.config.recording.modes || {};
    const content = event.content || "";
    const isPrivate = event.chat_type === "p2p";

    if (isPrivate) {
      return { shouldRecord: modes.allow_private !== false, mode: "allow_private" };
    }

    if (modes.mention_bot !== false && this.trigger.bot_name && content.includes(`@${this.trigger.bot_name}`)) {
      return { shouldRecord: true, mode: "mention_bot" };
    }

    if (modes.mention_owner !== false) {
      for (const name of this.trigger.user_names || []) {
        if (content.includes(`@${name}`) && this._passesOwnerGroupFilter(event)) {
          return { shouldRecord: true, mode: "mention_owner" };
        }
      }
    }

    if (modes.legacy_group_names !== false) {
      for (const name of this.trigger.group_names || []) {
        if (content.includes(`@${name}`)) return { shouldRecord: true, mode: "legacy_group_names" };
      }
    }

    if (modes.all_messages !== false) {
      return { shouldRecord: true, mode: "all_messages" };
    }

    return { shouldRecord: false, mode: null };
  }

  _passesOwnerGroupFilter(event) {
    const groupFilter = this.triggerModes.mention_owner_group_filter || { mode: "none", group_ids: [] };
    if (groupFilter.mode === "whitelist" && groupFilter.group_ids.length > 0) {
      return groupFilter.group_ids.includes(event.chat_id);
    }
    if (groupFilter.mode === "blacklist" && groupFilter.group_ids.length > 0) {
      return !groupFilter.group_ids.includes(event.chat_id);
    }
    return true;
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
          if (!this._passesOwnerGroupFilter(event)) {
            return { triggered: false, mode: null, replyIdentity: null };
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
