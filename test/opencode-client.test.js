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

  it("creates sessions with directory and reuses wrapped list results", async () => {
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
    const sessionId = await client.findOrCreateSession("chat-1", "Alerts", "2026-06-09");

    assert.equal(sessionId, "session-existing");
    assert.equal(requests.length, 1);
  });

  it("sends directory when creating a new session", async () => {
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
    const sessionId = await client.findOrCreateSession("chat-1", "Alerts", "2026-06-09");

    assert.equal(sessionId, "session-new");
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[1].options.body), {
      title: "Alerts-2026-06-09",
      directory: "/tmp/project",
    });
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
});
