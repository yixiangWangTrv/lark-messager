import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionTodoStore } from "../lib/session-todo-store.js";

describe("SessionTodoStore", () => {
  let dir;
  let filePath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-todo-store-"));
    filePath = join(dir, "session-todos.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list for a session with no todos", () => {
    const store = new SessionTodoStore(filePath);
    assert.deepEqual(store.listBySession("session-1"), []);
  });

  it("creates and persists a todo under a parent session", () => {
    const store = new SessionTodoStore(filePath);
    const todo = store.create({
      parentSessionId: "session-1",
      title: "Investigate spike",
      description: "Check queue growth",
      todoSessionId: "todo-session-1",
    });

    assert.equal(todo.parentSessionId, "session-1");
    assert.equal(todo.status, "open");
    assert.equal(todo.todoSessionId, "todo-session-1");
    assert.equal(store.listBySession("session-1").length, 1);
  });

  it("marks an existing todo as completed", () => {
    const store = new SessionTodoStore(filePath);
    const todo = store.create({
      parentSessionId: "session-1",
      title: "Investigate spike",
      description: "",
      todoSessionId: "todo-session-1",
    });

    const updated = store.complete(todo.id);
    assert.equal(updated.status, "completed");
    assert.ok(updated.completedAt);
  });

  it("keeps the original completedAt when complete is called repeatedly", () => {
    const store = new SessionTodoStore(filePath);
    const todo = store.create({
      parentSessionId: "session-1",
      title: "Investigate spike",
      description: "",
      todoSessionId: "todo-session-1",
    });

    const RealDate = Date;
    const timestamps = [
      "2024-01-01T00:00:00.000Z",
      "2024-01-01T00:00:01.000Z",
    ];

    globalThis.Date = class extends RealDate {
      constructor(value) {
        super(value ?? timestamps.shift());
      }

      static now() {
        return new RealDate(timestamps[0] ?? "2024-01-01T00:00:01.000Z").valueOf();
      }
    };

    let firstUpdate;
    let secondUpdate;
    try {
      firstUpdate = store.complete(todo.id);
      secondUpdate = store.complete(todo.id);
    } finally {
      globalThis.Date = RealDate;
    }

    assert.equal(firstUpdate.status, "completed");
    assert.equal(secondUpdate.status, "completed");
    assert.equal(secondUpdate.completedAt, firstUpdate.completedAt);
  });

  it("stores and reads todos for a __proto__ parent session id", () => {
    const store = new SessionTodoStore(filePath);

    const todo = store.create({
      parentSessionId: "__proto__",
      title: "Investigate spike",
      description: "Check queue growth",
      todoSessionId: "todo-session-1",
    });

    assert.deepEqual(store.listBySession("__proto__"), [todo]);
  });

  it("persists todos across a fresh store instance", () => {
    const store = new SessionTodoStore(filePath);
    const created = store.create({
      parentSessionId: "session-1",
      title: "Investigate spike",
      description: "Check queue growth",
      todoSessionId: "todo-session-1",
    });

    const reloadedStore = new SessionTodoStore(filePath);
    assert.deepEqual(reloadedStore.listBySession("session-1"), [created]);
    assert.equal(reloadedStore.hasTodoSession("todo-session-1"), true);
    assert.equal(reloadedStore.hasTodoSession("todo-session-missing"), false);
  });

  it("throws a clear error when the storage file contains invalid JSON", () => {
    writeFileSync(filePath, "{not-json");
    const store = new SessionTodoStore(filePath);
    assert.throws(() => store.listBySession("session-1"), /Invalid session todo storage JSON/);
  });

  it("throws a clear error when the storage file contains a valid but corrupted JSON shape", () => {
    writeFileSync(filePath, JSON.stringify([{"session-1": []}]));
    const store = new SessionTodoStore(filePath);

    assert.throws(
      () => store.listBySession("session-1"),
      /Invalid session todo storage JSON: expected an object whose values are arrays/
    );
  });

  it("throws a clear error when a session entry is not an array", () => {
    writeFileSync(filePath, JSON.stringify({ "session-1": { id: "todo-1" } }));
    const store = new SessionTodoStore(filePath);

    assert.throws(
      () => store.listBySession("session-1"),
      /Invalid session todo storage JSON: expected an object whose values are arrays/
    );
  });
});
