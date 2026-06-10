// lib/pending-jobs.js
export class PendingJobs {
  constructor() {
    this._jobs = new Map();
  }

  register({ chatId, triggerMessageId, sessionId, submittedAt, userMessageId }) {
    const key = `${chatId}:${triggerMessageId}`;
    if (this._jobs.has(key)) return null;

    const job = {
      key,
      chatId,
      triggerMessageId,
      sessionId,
      submittedAt,
      userMessageId,
      startedAt: Date.now(),
      status: "pending",
      stuckNoticeSent: false,
    };
    this._jobs.set(key, job);
    return job;
  }

  get(key) {
    return this._jobs.get(key);
  }

  complete(key) {
    this._jobs.delete(key);
  }

  fail(key, _err) {
    this._jobs.delete(key);
  }

  markStuckNoticeSent(key) {
    const job = this._jobs.get(key);
    if (job) job.stuckNoticeSent = true;
  }
}
