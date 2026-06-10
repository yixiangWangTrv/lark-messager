import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PendingJobs } from "../lib/pending-jobs.js";

describe("PendingJobs", () => {
  it("registers a new job and returns it", () => {
    const jobs = new PendingJobs();
    const job = jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1000, userMessageId: null });

    assert.equal(job.key, "c1:m1");
    assert.equal(job.status, "pending");
    assert.equal(job.stuckNoticeSent, false);
  });

  it("returns null when registering duplicate key", () => {
    const jobs = new PendingJobs();
    jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1000, userMessageId: null });
    const dup = jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1001, userMessageId: null });

    assert.equal(dup, null);
  });

  it("complete marks job done and removes it", () => {
    const jobs = new PendingJobs();
    jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1000, userMessageId: null });
    jobs.complete("c1:m1");

    assert.equal(jobs.get("c1:m1"), undefined);
  });

  it("fail marks job failed and removes it", () => {
    const jobs = new PendingJobs();
    jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1000, userMessageId: null });
    jobs.fail("c1:m1", new Error("oops"));

    assert.equal(jobs.get("c1:m1"), undefined);
  });

  it("markStuckNoticeSent sets stuckNoticeSent to true", () => {
    const jobs = new PendingJobs();
    const job = jobs.register({ chatId: "c1", triggerMessageId: "m1", sessionId: "s1", submittedAt: 1000, userMessageId: null });
    jobs.markStuckNoticeSent("c1:m1");

    assert.equal(job.stuckNoticeSent, true);
  });
});
