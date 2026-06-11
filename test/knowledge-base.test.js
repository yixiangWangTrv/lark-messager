import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildKnowledgeBasePromptSection,
  createKnowledgeBaseItem,
  refreshKnowledgeBaseItem,
} from "../lib/knowledge-base.js";

describe("knowledge-base helper", () => {
  it("creates a local_file item with inline_text content", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-"));
    const file = join(dir, "notes.txt");
    writeFileSync(file, "hello knowledge base");

    try {
      const item = createKnowledgeBaseItem({
        name: "Notes",
        description: "local file",
        source_type: "local_file",
        source: { path: file },
      });

      assert.equal(item.name, "Notes");
      assert.equal(item.source_type, "local_file");
      assert.equal(item.content.mode, "inline_text");
      assert.match(item.content.text, /hello knowledge base/);
      assert.equal(item.enabled, true);
      assert.ok(item.id);
      assert.match(item.updated_at, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates a free_text item with inline_text content", () => {
    const item = createKnowledgeBaseItem({
      name: "Runbook",
      description: "manual note",
      source_type: "free_text",
      content: { text: "check service logs first" },
    });

    assert.equal(item.content.mode, "inline_text");
    assert.equal(item.content.text, "check service logs first");
  });

  it("creates a github_url item as reference_only", () => {
    const item = createKnowledgeBaseItem({
      name: "Repo",
      description: "core repo",
      source_type: "github_url",
      source: { url: "https://github.com/acme/api" },
    });

    assert.equal(item.content.mode, "reference_only");
    assert.equal(item.content.text, "");
    assert.equal(item.source.url, "https://github.com/acme/api");
  });

  it("refreshes local_file item from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-refresh-"));
    const file = join(dir, "notes.txt");
    writeFileSync(file, "version one");

    try {
      const item = createKnowledgeBaseItem({
        name: "Notes",
        description: "local file",
        source_type: "local_file",
        source: { path: file },
      });

      writeFileSync(file, "version two");
      const refreshed = refreshKnowledgeBaseItem(item);

      assert.match(refreshed.content.text, /version two/);
      assert.notEqual(refreshed.updated_at, item.updated_at);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds prompt section from enabled items only", () => {
    const section = buildKnowledgeBasePromptSection({
      enabled: true,
      items: [
        {
          id: "1",
          name: "Enabled Item",
          description: "desc",
          enabled: true,
          source_type: "free_text",
          source: {},
          content: { mode: "inline_text", text: "abc" },
          updated_at: "2026-06-11T00:00:00.000Z",
        },
        {
          id: "2",
          name: "Disabled Item",
          description: "desc",
          enabled: false,
          source_type: "free_text",
          source: {},
          content: { mode: "inline_text", text: "should not appear" },
          updated_at: "2026-06-11T00:00:00.000Z",
        },
      ],
    });

    assert.match(section, /Knowledge base context:/);
    assert.match(section, /Enabled Item/);
    assert.doesNotMatch(section, /Disabled Item/);
  });

  it("returns empty string when global knowledge base is disabled", () => {
    const section = buildKnowledgeBasePromptSection({ enabled: false, items: [] });
    assert.equal(section, "");
  });
});
