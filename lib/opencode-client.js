// lib/opencode-client.js
export class OpenCodeClient {
  constructor(config) {
    this.baseUrl = config.opencode.base_url.replace(/\/$/, "");
    this.username = config.opencode.username || "opencode";
    this.password = config.opencode.password || "";
    this.timeoutMs = config.opencode.analysis_timeout_ms || 180000;
    this.sessionNameFormat = config.opencode.session_name_format || "{chat_name}-{date}";
    this.sessionCache = new Map(); // cacheKey -> sessionId
  }

  _authHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (this.password) {
      const token = Buffer.from(`${this.username}:${this.password}`).toString("base64");
      headers["Authorization"] = `Basic ${token}`;
    }
    return headers;
  }

  async healthCheck() {
    try {
      const res = await fetch(`${this.baseUrl}/global/health`, {
        headers: this._authHeaders(),
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data.healthy === true;
    } catch {
      return false;
    }
  }

  async findOrCreateSession(chatId, chatName) {
    const today = new Date().toISOString().slice(0, 10);
    const targetTitle = this.sessionNameFormat
      .replace("{chat_name}", chatName || chatId)
      .replace("{date}", today);

    const cacheKey = `${chatId}-${today}`;

    // Check cache first
    const cachedId = this.sessionCache.get(cacheKey);
    if (cachedId) {
      try {
        const res = await fetch(`${this.baseUrl}/session/${cachedId}`, {
          headers: this._authHeaders(),
        });
        if (res.ok) return cachedId;
      } catch {
        // Cache invalid, continue
      }
    }

    // List sessions and find matching title
    try {
      const res = await fetch(`${this.baseUrl}/session`, {
        headers: this._authHeaders(),
      });
      if (res.ok) {
        const sessions = await res.json();
        const match = sessions.find((s) => s.title === targetTitle);
        if (match) {
          this.sessionCache.set(cacheKey, match.id);
          return match.id;
        }
      }
    } catch {
      // Fall through to create
    }

    // Create new session
    const res = await fetch(`${this.baseUrl}/session`, {
      method: "POST",
      headers: this._authHeaders(),
      body: JSON.stringify({ title: targetTitle }),
    });

    if (!res.ok) {
      throw new Error(`Failed to create session: ${res.status} ${res.statusText}`);
    }

    const session = await res.json();
    this.sessionCache.set(cacheKey, session.id);
    return session.id;
  }

  async sendMessage(sessionId, prompt) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
        method: "POST",
        headers: this._authHeaders(),
        body: JSON.stringify({
          parts: [{ type: "text", text: prompt }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenCode API error: ${res.status} — ${body.slice(0, 200)}`);
      }

      const data = await res.json();
      return this._extractReplyText(data);
    } finally {
      clearTimeout(timeout);
    }
  }

  _extractReplyText(response) {
    // response shape: { info: Message, parts: Part[] }
    const parts = response.parts || [];
    const textParts = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text || p.content || "");
    return textParts.join("\n").trim() || "[No response from analysis]";
  }
}
