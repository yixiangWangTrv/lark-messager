// lib/opencode-client.js
export class OpenCodeClient {
  constructor(config) {
    this.config = config;
    this.baseUrl = config.opencode.base_url.replace(/\/$/, "");
    this.username = config.opencode.username || "opencode";
    this.password = config.opencode.password || "";
    this.timeoutMs = config.opencode.analysis_timeout_ms || 180000;
    this.submitTimeoutMs = config.opencode.submit_timeout_ms || 30000;
    this.sessionNameFormat = config.opencode.session_name_format || "{chat_name}-{date}";
    this.projectDirectory = config.opencode.project_directory || process.cwd();
    this.apiPrefix = "";
    this.sessionCache = new Map(); // cacheKey -> sessionId
    this.onConnectionError = config.opencode.on_connection_error || null;
  }

  updateConnection({ baseUrl, password, projectDirectory }) {
    if (baseUrl) {
      this.baseUrl = baseUrl.replace(/\/$/, "");
      if (this.config?.opencode) this.config.opencode.base_url = this.baseUrl;
    }
    if (password !== undefined) {
      this.password = password;
      if (this.config?.opencode) this.config.opencode.password = password;
    }
    if (projectDirectory) {
      this.projectDirectory = projectDirectory;
      if (this.config?.opencode) this.config.opencode.project_directory = projectDirectory;
      this.sessionCache.clear();
    }
    this.apiPrefix = "";
  }

  async _withConnectionRetry(operation) {
    try {
      return await operation();
    } catch (err) {
      if (err?.name === "AbortError" || !this.onConnectionError) {
        throw err;
      }

      const message = String(err?.message || "");
      if (!message.includes("fetch failed")) {
        throw err;
      }

      const recovered = await this.onConnectionError(err, this);
      if (!recovered) {
        throw err;
      }
      return await operation();
    }
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
    const candidates = [
      { path: "/api/opencode/health", apiPrefix: "/api" },
      { path: "/global/health", apiPrefix: "" },
      { path: "/health", apiPrefix: "" },
    ];

    for (const candidate of candidates) {
      try {
        const res = await fetch(`${this.baseUrl}${candidate.path}`, {
          headers: this._authHeaders(),
        });
        if (!res.ok) continue;
        const data = await res.json().catch(() => ({}));
        if (data.healthy === true || candidate.path === "/health") {
          this.apiPrefix = candidate.apiPrefix;
          return true;
        }
      } catch {
        // Try next health endpoint.
      }
    }

    return false;
  }

  _sessionUrl(path = "", directory = this.projectDirectory) {
    const url = new URL(`${this.baseUrl}${this.apiPrefix}/session${path}`);
    if (directory) {
      url.searchParams.set("directory", directory);
    }
    return url.toString();
  }

  _unwrapData(payload) {
    return payload && typeof payload === "object" && "data" in payload
      ? payload.data
      : payload;
  }

  _extractSessions(payload) {
    const data = this._unwrapData(payload);
    return Array.isArray(data) ? data : [];
  }

  _isArchivedSession(session) {
    return session?.archived === true
      || session?.status === "archived"
      || session?.state === "archived";
  }

  async findOrCreateSession(input, chatName, today = new Date().toISOString().slice(0, 10)) {
    // Support both legacy (chatId, chatName, today) and new ({ title, cacheKey, reuse }) signatures
    const options = typeof input === "object" && input !== null
      ? input
      : {
          title: this.sessionNameFormat
            .replace("{chat_name}", chatName || input)
            .replace("{date}", today),
          cacheKey: `${input}-${today}`,
          reuse: true,
        };

    const { title, cacheKey, reuse = true } = options;

    return await this._withConnectionRetry(async () => {
      if (reuse) {
        // Check cache first
        const cachedId = this.sessionCache.get(cacheKey);
        if (cachedId) {
          try {
            const res = await fetch(this._sessionUrl(`/${cachedId}`), {
              headers: this._authHeaders(),
            });
            if (res.ok) {
              return {
                sessionId: cachedId,
                sessionState: "existing",
              };
            }
          } catch {
            // Cache invalid, continue
          }
        }

        // List sessions and find matching title, skipping archived sessions
        try {
          const res = await fetch(this._sessionUrl(), {
            headers: this._authHeaders(),
          });
          if (res.ok) {
            const sessions = this._extractSessions(await res.json());
            const match = sessions.find((s) => s.title === title && !this._isArchivedSession(s));
            if (match) {
              this.sessionCache.set(cacheKey, match.id);
              return {
                sessionId: match.id,
                sessionState: "existing",
              };
            }
          }
        } catch {
          // Fall through to create
        }
      }

      // Create new session
      const res = await fetch(this._sessionUrl(), {
        method: "POST",
        headers: this._authHeaders(),
        body: JSON.stringify({
          title,
          directory: this.projectDirectory,
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to create session: ${res.status} ${res.statusText}`);
      }

      const session = this._unwrapData(await res.json());
      this.sessionCache.set(cacheKey, session.id);
      return {
        sessionId: session.id,
        sessionState: "new",
      };
    });
  }

  async sendMessage(sessionId, prompt) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this._withConnectionRetry(() => fetch(this._sessionUrl(`/${sessionId}/message`), {
        method: "POST",
        headers: this._authHeaders(),
        body: JSON.stringify({
          directory: this.projectDirectory,
          parts: [{ type: "text", text: prompt }],
        }),
        signal: controller.signal,
      }));

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenCode API error: ${res.status} — ${body.slice(0, 200)}`);
      }

      const data = this._unwrapData(await res.json());
      return this._extractReplyText(data);
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(`OpenCode analysis timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async submitMessage(sessionId, prompt) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.submitTimeoutMs);

    try {
      const res = await this._withConnectionRetry(() => fetch(this._sessionUrl(`/${sessionId}/message`), {
        method: "POST",
        headers: this._authHeaders(),
        body: JSON.stringify({
          directory: this.projectDirectory,
          parts: [{ type: "text", text: prompt }],
        }),
        signal: controller.signal,
      }));

      const submittedAt = Date.now();

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenCode submit error: ${res.status} — ${body.slice(0, 200)}`);
      }

      const data = this._unwrapData(await res.json());
      const userMessageId = data?.info?.id ?? null;

      return { sessionId, submittedAt, userMessageId };
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error(`OpenCode submit timed out after ${this.submitTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async listMessages(sessionId) {
    try {
      const res = await fetch(this._sessionUrl(`/${sessionId}/message`), {
        headers: this._authHeaders(),
      });
      if (!res.ok) return [];
      const raw = await res.json();
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
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
