import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

const ALLOWED_STATUSES = new Set(["open", "in_progress", "blocked", "completed"]);

export class TodoStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  list() {
    const data = this._readAll();
    return [...data.todos].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  }

  get(todoId) {
    const data = this._readAll();
    return data.todos.find((todo) => todo.id === todoId) || null;
  }

  create({ sourceSessionId, sourceSessionTitle, title, description = "" }) {
    const data = this._readAll();
    const now = new Date().toISOString();
    const todo = {
      id: `todo_${randomUUID()}`,
      sourceSessionId,
      sourceSessionTitle,
      title,
      description,
      status: "open",
      chatSessionId: null,
      comments: [],
      createdAt: now,
      updatedAt: now,
    };

    data.todos.push(todo);
    this._writeAll(data);
    return todo;
  }

  update(todoId, fields) {
    const data = this._readAll();
    const todo = data.todos.find((item) => item.id === todoId);
    if (!todo) return null;

    if (Object.hasOwn(fields, "title")) todo.title = fields.title;
    if (Object.hasOwn(fields, "description")) todo.description = fields.description;
    if (Object.hasOwn(fields, "status")) {
      if (!ALLOWED_STATUSES.has(fields.status)) {
        throw new Error("invalid todo status");
      }
      todo.status = fields.status;
    }

    todo.updatedAt = new Date().toISOString();
    this._writeAll(data);
    return todo;
  }

  addComment(todoId, content) {
    const data = this._readAll();
    const todo = data.todos.find((item) => item.id === todoId);
    if (!todo) return null;

    const comment = {
      id: `comment_${randomUUID()}`,
      content,
      createdAt: new Date().toISOString(),
    };

    todo.comments.push(comment);
    todo.updatedAt = new Date().toISOString();
    this._writeAll(data);
    return comment;
  }

  setChatSessionId(todoId, chatSessionId) {
    const data = this._readAll();
    const todo = data.todos.find((item) => item.id === todoId);
    if (!todo) return null;

    todo.chatSessionId = chatSessionId;
    todo.updatedAt = new Date().toISOString();
    this._writeAll(data);
    return todo;
  }

  delete(todoId) {
    const data = this._readAll();
    const index = data.todos.findIndex((item) => item.id === todoId);
    if (index === -1) return null;

    const [removed] = data.todos.splice(index, 1);
    this._writeAll(data);
    return removed;
  }

  _readAll() {
    if (!existsSync(this.filePath)) return { todos: [] };

    const raw = readFileSync(this.filePath, "utf-8").trim();
    if (!raw) return { todos: [] };

    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.todos)) {
        throw new Error("Invalid todo storage JSON: expected an object with a todos array");
      }

      return { todos: [...data.todos] };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid todo storage JSON:")) {
        throw error;
      }

      throw new Error("Invalid todo storage JSON");
    }
  }

  _writeAll(data) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }
}
