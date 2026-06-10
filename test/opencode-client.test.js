import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OpenCodeClient } from "../lib/opencode-client.js";

const baseConfig = {
  opencode: {
    base_url: "http://localhost:4096",
    username: "opencode",
    password: "",
    analysis_timeout_ms: 50,
    session_name_format: "{chat_name}-{date}",
    project_directory: "/tmp/project",
  },
};

describe("OpenCodeClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = undefined;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns existing session state when reusing a listed session", async () => {
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url, options });

      if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject") {
        if (!options.method) {
          return {
            ok: true,
            json: async () => ({
              data: [
                {
                  id: "session-existing",
                  title: "Alerts-2026-06-09",
                  cwd: "/tmp/project",
                },
              ],
            }),
          };
        }
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const client = new OpenCodeClient(baseConfig);
    const result = await client.findOrCreateSession("chat-1", "Alerts", "2026-06-09");

    assert.deepEqual(result, {
      sessionId: "session-existing",
      sessionState: "existing",
    });
    assert.equal(requests.length, 1);
  });

  it("returns existing session state when reusing a cached session", async () => {
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url, options });

      if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && !options.method) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: "session-existing", title: "Alerts-2026-06-09" }],
          }),
        };
      }

      if (url === "http://localhost:4096/session/session-existing?directory=%2Ftmp%2Fproject") {
        return {
          ok: true,
          json: async () => ({ data: { id: "session-existing" } }),
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const client = new OpenCodeClient(baseConfig);
    const firstResult = await client.findOrCreateSession("chat-1", "Alerts", "2026-06-09");
    const secondResult = await client.findOrCreateSession("chat-1", "Alerts", "2026-06-09");

    assert.deepEqual(firstResult, {
      sessionId: "session-existing",
      sessionState: "existing",
    });
    assert.deepEqual(secondResult, {
      sessionId: "session-existing",
      sessionState: "existing",
    });
    assert.equal(requests.length, 2);
  });

  it("returns new session state when creating a fresh session", async () => {
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url, options });

      if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && !options.method) {
        return { ok: true, json: async () => ({ data: [] }) };
      }

      if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && options.method === "POST") {
        return {
          ok: true,
          json: async () => ({ data: { id: "session-new" } }),
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const client = new OpenCodeClient(baseConfig);
    const result = await client.findOrCreateSession("chat-1", "Alerts", "2026-06-09");

    assert.deepEqual(result, {
      sessionId: "session-new",
      sessionState: "new",
    });
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[1].options.body), {
      title: "Alerts-2026-06-09",
      directory: "/tmp/project",
    });
  });

  it("does not reuse archived sessions", async () => {
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url, options });

      if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && !options.method) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: "archived-session", title: "Ops-summary-2026-06-09", archived: true },
            ],
          }),
        };
      }

      if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && options.method === "POST") {
        return {
          ok: true,
          json: async () => ({ data: { id: "fresh-session" } }),
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const client = new OpenCodeClient(baseConfig);
    const result = await client.findOrCreateSession({
      title: "Ops-summary-2026-06-09",
      cacheKey: "summary:oc_chat1:om_99",
      reuse: true,
    });

    assert.deepEqual(result, {
      sessionId: "fresh-session",
      sessionState: "new",
    });
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[1].options.body), {
      title: "Ops-summary-2026-06-09",
      directory: "/tmp/project",
    });
  });

  it("creates a fresh session when reuse is false", async () => {
    let listCalled = false;
    global.fetch = async (url, options = {}) => {
      if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && !options.method) {
        listCalled = true;
        return { ok: true, json: async () => ({ data: [] }) };
      }

      if (url === "http://localhost:4096/session?directory=%2Ftmp%2Fproject" && options.method === "POST") {
        return {
          ok: true,
          json: async () => ({ data: { id: "fresh-session" } }),
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    const client = new OpenCodeClient(baseConfig);
    const result = await client.findOrCreateSession({
      title: "Ops-other-2026-06-09",
      cacheKey: "other:oc_chat1:om_123",
      reuse: false,
    });

    assert.deepEqual(result, {
      sessionId: "fresh-session",
      sessionState: "new",
    });
    assert.equal(listCalled, false);
  });

  it("extracts assistant text from wrapped message response", async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: {
          parts: [
            { type: "text", text: "Root cause found" },
            { type: "text", text: "Check downstream latency" },
          ],
        },
      }),
    });

    const client = new OpenCodeClient(baseConfig);
    const text = await client.sendMessage("session-1", "analyze this");

    assert.equal(text, "Root cause found\nCheck downstream latency");
  });

  it("turns AbortError into a readable timeout message", async () => {
    global.fetch = async (_url, options = {}) => new Promise((_, reject) => {
      options.signal?.addEventListener("abort", () => {
        const err = new Error("This operation was aborted");
        err.name = "AbortError";
        reject(err);
      }, { once: true });
    });

    const client = new OpenCodeClient(baseConfig);

    await assert.rejects(
      () => client.sendMessage("session-1", "analyze this"),
      /timed out after 50ms/
    );
  });

  it("submitMessage returns tracking object with sessionId and submittedAt", async () => {
    let capturedBody = null;
    global.fetch = async (url, options = {}) => {
      capturedBody = JSON.parse(options.body || "{}");
      return {
        ok: true,
        json: async () => ({
          data: {
            info: { id: "msg_user_001", role: "user" },
            parts: [],
          },
        }),
      };
    };

    const client = new OpenCodeClient(baseConfig);
    const before = Date.now();
    const tracking = await client.submitMessage("session-1", "hello");
    const after = Date.now();

    assert.equal(tracking.sessionId, "session-1");
    assert.ok(tracking.submittedAt >= before && tracking.submittedAt <= after);
    assert.equal(tracking.userMessageId, "msg_user_001");
    assert.deepEqual(capturedBody.parts, [{ type: "text", text: "hello" }]);
  });

  it("submitMessage sets userMessageId to null when response has no message id", async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ data: { parts: [] } }),
    });

    const client = new OpenCodeClient(baseConfig);
    const tracking = await client.submitMessage("session-1", "hello");

    assert.equal(tracking.userMessageId, null);
  });

  it("listMessages returns parsed message array", async () => {
    const messages = [
      { info: { id: "msg_u1", role: "user" }, parts: [] },
      { info: { id: "msg_a1", role: "assistant", time: { completed: 12345 } }, parts: [{ type: "text", text: "hi" }] },
    ];
    global.fetch = async () => ({
      ok: true,
      json: async () => messages,
    });

    const client = new OpenCodeClient(baseConfig);
    const result = await client.listMessages("session-1");

    assert.equal(result.length, 2);
    assert.equal(result[0].info.role, "user");
    assert.equal(result[1].info.role, "assistant");
  });

  it("listMessages returns empty array on non-ok response", async () => {
    global.fetch = async () => ({ ok: false, status: 404 });

    const client = new OpenCodeClient(baseConfig);
    const result = await client.listMessages("session-1");

    assert.deepEqual(result, []);
  });
});
