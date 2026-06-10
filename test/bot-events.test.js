import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { botEvents } from "../lib/bot-events.js";

describe("botEvents", () => {
  it("is an EventEmitter singleton", () => {
    assert.equal(typeof botEvents.on, "function");
    assert.equal(typeof botEvents.emit, "function");
  });

  it("emits and receives session:created", (t, done) => {
    const payload = { sessionId: "s1", title: "test", chatName: "chat", intent: "other" };
    botEvents.once("session:created", (data) => {
      assert.deepEqual(data, payload);
      done();
    });
    botEvents.emit("session:created", payload);
  });
});
