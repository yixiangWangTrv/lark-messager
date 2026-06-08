import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChatQueue } from "../lib/queue.js";

describe("ChatQueue", () => {
  it("processes tasks sequentially for same chat", async () => {
    const queue = new ChatQueue({ maxPerChat: 1, queueSize: 5 });
    const order = [];

    const task1 = queue.enqueue("chat1", async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push(1);
    });
    const task2 = queue.enqueue("chat1", async () => {
      order.push(2);
    });

    await Promise.all([task1, task2]);
    assert.deepEqual(order, [1, 2]);
  });

  it("processes tasks in parallel for different chats", async () => {
    const queue = new ChatQueue({ maxPerChat: 1, queueSize: 5 });
    const order = [];

    const task1 = queue.enqueue("chat1", async () => {
      await new Promise((r) => setTimeout(r, 50));
      order.push("a");
    });
    const task2 = queue.enqueue("chat2", async () => {
      order.push("b");
    });

    await Promise.all([task1, task2]);
    assert.deepEqual(order, ["b", "a"]);
  });

  it("rejects when queue is full", async () => {
    const queue = new ChatQueue({ maxPerChat: 1, queueSize: 2 });

    // Fill the queue: first task starts running, next 2 fill the queue
    queue.enqueue("chat1", () => new Promise((r) => setTimeout(r, 200)));
    queue.enqueue("chat1", () => new Promise((r) => setTimeout(r, 200)));
    queue.enqueue("chat1", () => new Promise((r) => setTimeout(r, 200)));

    // This one should be dropped
    const result = queue.enqueue("chat1", () => Promise.resolve());
    assert.equal(result, null);
  });
});
