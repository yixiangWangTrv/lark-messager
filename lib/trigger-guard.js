export class TriggerGuard {
  constructor({ ttlMs = 5 * 60 * 1000, nowFn = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.nowFn = nowFn;
    this.inFlight = new Set();
    this.completed = new Map();
  }

  tryStart(key) {
    if (!key) return true;

    this._evictExpired();

    if (this.inFlight.has(key)) return false;
    if (this.completed.has(key)) return false;

    this.inFlight.add(key);
    return true;
  }

  markSuccess(key) {
    if (!key) return;

    this.inFlight.delete(key);
    this.completed.set(key, this.nowFn() + this.ttlMs);
  }

  markFailure(key) {
    if (!key) return;

    this.inFlight.delete(key);
  }

  _evictExpired() {
    const now = this.nowFn();

    for (const [key, expiresAt] of this.completed.entries()) {
      if (expiresAt <= now) {
        this.completed.delete(key);
      }
    }
  }
}
