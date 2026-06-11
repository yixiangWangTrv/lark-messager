import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore } from "../lib/todo-store.js";

describe("TodoStore", () => {
  let dir;
  let filePath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "todo-store-"));
    filePath = join(dir, "todos.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list when the file does not exist", () => {
    const store = new TodoStore(filePath);
    assert.deepEqual(store.list(), []);
  });

  it("creates and persists a global todo", () => {
    const store = new TodoStore(filePath);
    const todo = store.create({
      sourceSessionId: "session-1",
      sourceSessionTitle: "Robot Test-other-2026-06-11-3495402b",
      title: "Investigate alert burst",
      description: "Check the upstream spike pattern.",
    });

    assert.equal(todo.sourceSessionId, "session-1");
    assert.equal(todo.sourceSessionTitle, "Robot Test-other-2026-06-11-3495402b");
    assert.equal(todo.status, "open");
    assert.equal(todo.chatSessionId, null);
    assert.deepEqual(todo.comments, []);
    assert.equal(store.list().length, 1);
  });

  it("updates title, description, and status", () => {
    const store = new TodoStore(filePath);
    const todo = store.create({
      sourceSessionId: "session-1",
      sourceSessionTitle: "Session 1",
      title: "Investigate alert burst",
      description: "Check the upstream spike pattern.",
    });

    const updated = store.update(todo.id, {
      title: "Investigate alert burst deeply",
      description: "Compare with the previous spike.",
      status: "blocked",
    });

    assert.equal(updated.title, "Investigate alert burst deeply");
    assert.equal(updated.description, "Compare with the previous spike.");
    assert.equal(updated.status, "blocked");
    assert.ok(updated.updatedAt);
  });

  it("adds a comment to a todo", () => {
    const store = new TodoStore(filePath);
    const todo = store.create({
      sourceSessionId: "session-1",
      sourceSessionTitle: "Session 1",
      title: "Investigate alert burst",
      description: "",
    });

    const comment = store.addComment(todo.id, "Need to compare queue growth.");

    assert.equal(comment.content, "Need to compare queue growth.");
    assert.equal(store.get(todo.id).comments.length, 1);
  });

  it("stores and reuses a chat session id", () => {
    const store = new TodoStore(filePath);
    const todo = store.create({
      sourceSessionId: "session-1",
      sourceSessionTitle: "Session 1",
      title: "Investigate alert burst",
      description: "",
    });

    const linked = store.setChatSessionId(todo.id, "todo-chat-1");

    assert.equal(linked.chatSessionId, "todo-chat-1");
    assert.equal(store.get(todo.id).chatSessionId, "todo-chat-1");
  });

  it("deletes a todo", () => {
    const store = new TodoStore(filePath);
    const todo = store.create({
      sourceSessionId: "session-1",
      sourceSessionTitle: "Session 1",
      title: "Investigate alert burst",
      description: "",
    });

    const removed = store.delete(todo.id);

    assert.equal(removed.id, todo.id);
    assert.deepEqual(store.list(), []);
  });

  it("throws a clear error when the storage file contains invalid JSON", () => {
    writeFileSync(filePath, "{not-json");
    const store = new TodoStore(filePath);

    assert.throws(() => store.list(), /Invalid todo storage JSON/);
  });

  it("throws a clear error when the storage file does not contain a todos array", () => {
    writeFileSync(filePath, JSON.stringify({ wrong: [] }));
    const store = new TodoStore(filePath);

    assert.throws(
      () => store.list(),
      /Invalid todo storage JSON: expected an object with a todos array/
    );
  });
});
