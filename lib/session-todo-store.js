import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export class SessionTodoStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  listBySession(parentSessionId) {
    const data = this._readAll();
    return Object.hasOwn(data, parentSessionId) ? data[parentSessionId] : [];
  }

  create({ parentSessionId, title, description = "", todoSessionId }) {
    const data = this._readAll();
    const todo = {
      id: `todo_${randomUUID()}`,
      parentSessionId,
      title,
      description,
      status: "open",
      todoSessionId,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    if (!Object.hasOwn(data, parentSessionId)) {
      data[parentSessionId] = [];
    }

    data[parentSessionId].push(todo);
    this._writeAll(data);
    return todo;
  }

  complete(todoId) {
    const data = this._readAll();
    for (const todos of Object.values(data)) {
      const todo = todos.find((item) => item.id === todoId);
      if (todo) {
        if (todo.status === "completed") {
          return todo;
        }

        todo.status = "completed";
        todo.completedAt = new Date().toISOString();
        this._writeAll(data);
        return todo;
      }
    }

    return null;
  }

  hasTodoSession(todoSessionId) {
    const data = this._readAll();
    return Object.values(data).some((todos) => todos.some((todo) => todo.todoSessionId === todoSessionId));
  }

  _readAll() {
    if (!existsSync(this.filePath)) return Object.create(null);

    const raw = readFileSync(this.filePath, "utf-8").trim();
    if (!raw) return Object.create(null);

    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Invalid session todo storage JSON: expected an object whose values are arrays");
      }

      for (const todos of Object.values(data)) {
        if (!Array.isArray(todos)) {
          throw new Error("Invalid session todo storage JSON: expected an object whose values are arrays");
        }
      }

      return Object.assign(Object.create(null), data);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Invalid session todo storage JSON:")) {
        throw error;
      }

      throw new Error("Invalid session todo storage JSON");
    }
  }

  _writeAll(data) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }
}
