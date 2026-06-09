import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeSessionResult } from "../lib/session-result.js";

describe("normalizeSessionResult", () => {
  it("preserves object session results for callers", () => {
    assert.deepEqual(
      normalizeSessionResult({ sessionId: "session-123", sessionState: "new" }),
      {
        sessionId: "session-123",
        sessionState: "new",
      }
    );
  });

  it("converts legacy string session results into existing state", () => {
    assert.deepEqual(normalizeSessionResult("session-123"), {
      sessionId: "session-123",
      sessionState: "existing",
    });
  });
});
