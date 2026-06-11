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
        name: "  Notes  ",
        description: "  local file  ",
        source_type: "local_file",
        source: { path: `  ${file}  ` },
      });

      assert.equal(item.name, "Notes");
      assert.equal(item.description, "local file");
      assert.equal(item.source_type, "local_file");
      assert.equal(item.source.path, file);
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
      source: { url: "  https://github.com/acme/api  " },
    });

    assert.equal(item.content.mode, "reference_only");
    assert.equal(item.content.text, "");
    assert.equal(item.source.url, "https://github.com/acme/api");
  });

  it("creates a project_name item as reference_only", () => {
    const item = createKnowledgeBaseItem({
      name: "Project",
      description: "linked project",
      source_type: "project_name",
      source: { project_name: "  acme-api  " },
    });

    assert.equal(item.content.mode, "reference_only");
    assert.equal(item.content.text, "");
    assert.equal(item.source.project_name, "acme-api");
  });

  it("creates a lark_doc item as reference_only", () => {
    const item = createKnowledgeBaseItem({
      name: "Design Doc",
      description: "external doc",
      source_type: "lark_doc",
      source: { url: "  https://example.com/doc/123  " },
    });

    assert.equal(item.content.mode, "reference_only");
    assert.equal(item.content.text, "");
    assert.equal(item.source.url, "https://example.com/doc/123");
  });

  it("rejects unsupported source_type", () => {
    assert.throws(
      () =>
        createKnowledgeBaseItem({
          name: "Invalid",
          source_type: "unknown_type",
        }),
      /Unsupported knowledge base source_type: unknown_type/,
    );
  });

  it("rejects missing or blank name", () => {
    assert.throws(
      () =>
        createKnowledgeBaseItem({
          source_type: "free_text",
          content: { text: "some text" },
        }),
      /name is required/,
    );

    assert.throws(
      () =>
        createKnowledgeBaseItem({
          name: "   ",
          source_type: "free_text",
          content: { text: "some text" },
        }),
      /name is required/,
    );
  });

  it("rejects missing source.path for local_file", () => {
    assert.throws(
      () =>
        createKnowledgeBaseItem({
          name: "Notes",
          source_type: "local_file",
          source: { path: "   " },
        }),
      /source.path is required for local_file/,
    );
  });

  it("rejects missing source.url for github_url and lark_doc", () => {
    assert.throws(
      () =>
        createKnowledgeBaseItem({
          name: "Repo",
          source_type: "github_url",
          source: { url: "   " },
        }),
      /source.url is required for github_url/,
    );

    assert.throws(
      () =>
        createKnowledgeBaseItem({
          name: "Doc",
          source_type: "lark_doc",
          source: { url: "   " },
        }),
      /source.url is required for lark_doc/,
    );
  });

  it("rejects missing source.project_name", () => {
    assert.throws(
      () =>
        createKnowledgeBaseItem({
          name: "Project",
          source_type: "project_name",
          source: { project_name: "   " },
        }),
      /source.project_name is required for project_name/,
    );
  });

  it("rejects empty free_text content", () => {
    assert.throws(
      () =>
        createKnowledgeBaseItem({
          name: "Runbook",
          source_type: "free_text",
          content: { text: "   " },
        }),
      /body text is required for free_text/,
    );
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
      const staleItem = {
        ...item,
        updated_at: "2000-01-01T00:00:00.000Z",
      };
      const refreshed = refreshKnowledgeBaseItem(staleItem);

      assert.match(refreshed.content.text, /version two/);
      assert.notEqual(refreshed.updated_at, staleItem.updated_at);
      assert.ok(Date.parse(refreshed.updated_at) > Date.parse(staleItem.updated_at));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refreshes non-local-file item by only updating updated_at", () => {
    const item = createKnowledgeBaseItem({
      id: "runbook-id",
      name: "Runbook",
      description: "manual note",
      source_type: "free_text",
      content: { text: "keep this content" },
    });
    const staleItem = {
      ...item,
      updated_at: "2000-01-01T00:00:00.000Z",
    };

    const refreshed = refreshKnowledgeBaseItem(staleItem);

    assert.equal(refreshed.id, staleItem.id);
    assert.deepEqual(refreshed.content, staleItem.content);
    assert.notEqual(refreshed.updated_at, staleItem.updated_at);
    assert.ok(Date.parse(refreshed.updated_at) > Date.parse(staleItem.updated_at));
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
          source_summary: "inline note",
          source: {},
          content: { mode: "inline_text", text: "abc" },
          updated_at: "2026-06-11T00:00:00.000Z",
        },
        {
          id: "3",
          name: "Reference Item",
          enabled: true,
          source_type: "github_url",
          source_summary: "https://github.com/acme/api",
          source: { url: "https://github.com/acme/api" },
          content: { mode: "reference_only", text: "" },
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

    assert.equal(
      section,
      [
        "Knowledge base context:",
        "",
        "[1] Enabled Item",
        "description: desc",
        "source_type: free_text",
        "source_summary: inline note",
        "content:",
        "abc",
        "",
        "[2] Reference Item",
        "source_type: github_url",
        "source_summary: https://github.com/acme/api",
        "reference_only: true",
      ].join("\n"),
    );
    assert.doesNotMatch(section, /Disabled Item/);
  });

  it("returns empty string when global knowledge base is disabled", () => {
    const section = buildKnowledgeBasePromptSection({ enabled: false, items: [] });
    assert.equal(section, "");
  });

  it("appends [truncated] when inline text exceeds prompt limit", () => {
    const section = buildKnowledgeBasePromptSection({
      enabled: true,
      items: [
        {
          id: "1",
          name: "Long Item",
          description: "desc",
          enabled: true,
          source_type: "free_text",
          source: {},
          content: { mode: "inline_text", text: "a".repeat(2001) },
          updated_at: "2026-06-11T00:00:00.000Z",
        },
      ],
    });

    assert.match(section, /^Knowledge base context:\n\n\[1\] Long Item\n/m);
    assert.match(section, /\ncontent:\n/);
    assert.match(section, /\[truncated\]/);
  });

  it("renders multiline inline text under content", () => {
    const section = buildKnowledgeBasePromptSection({
      enabled: true,
      items: [
        {
          id: "1",
          name: "Runbook",
          enabled: true,
          source_type: "free_text",
          source: {},
          content: { mode: "inline_text", text: "line one\nline two" },
          updated_at: "2026-06-11T00:00:00.000Z",
        },
      ],
    });

    assert.equal(section, ["Knowledge base context:", "", "[1] Runbook", "source_type: free_text", "content:", "line one", "line two"].join("\n"));
  });

  it("returns empty string when global knowledge base is enabled with no enabled items", () => {
    const section = buildKnowledgeBasePromptSection({
      enabled: true,
      items: [
        {
          id: "1",
          name: "Disabled Item",
          description: "desc",
          enabled: false,
          source_type: "free_text",
          source: {},
          content: { mode: "inline_text", text: "abc" },
          updated_at: "2026-06-11T00:00:00.000Z",
        },
      ],
    });

    assert.equal(section, "");
  });
});
