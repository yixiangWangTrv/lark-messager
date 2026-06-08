export class ChatQueue {
  constructor({ maxPerChat = 1, queueSize = 5 }) {
    this.maxPerChat = maxPerChat;
    this.queueSize = queueSize;
    this.queues = new Map(); // chatId -> { running: number, pending: Array }
  }

  enqueue(chatId, taskFn) {
    if (!this.queues.has(chatId)) {
      this.queues.set(chatId, { running: 0, pending: [] });
    }

    const chatQueue = this.queues.get(chatId);
    const totalPending = chatQueue.pending.length;

    if (totalPending >= this.queueSize) {
      return null; // Queue full, drop
    }

    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });

    chatQueue.pending.push({ taskFn, resolve, reject });
    this._processNext(chatId);

    return promise;
  }

  _processNext(chatId) {
    const chatQueue = this.queues.get(chatId);
    if (!chatQueue) return;
    if (chatQueue.running >= this.maxPerChat) return;
    if (chatQueue.pending.length === 0) {
      if (chatQueue.running === 0) this.queues.delete(chatId);
      return;
    }

    chatQueue.running++;
    const { taskFn, resolve, reject } = chatQueue.pending.shift();

    taskFn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        chatQueue.running--;
        this._processNext(chatId);
      });
  }
}
