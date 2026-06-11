import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const INLINE_TEXT_PROMPT_LIMIT = 2000;
const SUPPORTED_SOURCE_TYPES = new Set([
  "local_file",
  "project_name",
  "github_url",
  "lark_doc",
  "free_text",
]);

export function createKnowledgeBaseItem(input) {
  const sourceType = validateSourceType(input?.source_type);
  const updated_at = new Date().toISOString();
  const source = normalizeSource(input?.source);
  const item = {
    ...input,
    id: input?.id || randomUUID(),
    enabled: input?.enabled !== false,
    updated_at,
    name: requireTrimmedField(input?.name, "name is required"),
    description: trimOptionalString(input?.description),
    source_type: sourceType,
    source,
  };

  item.content = buildContent(item, input);
  item.source_summary = deriveSourceSummary(item);

  return item;
}

export function refreshKnowledgeBaseItem(item) {
  const refreshed = {
    ...item,
    updated_at: new Date().toISOString(),
  };

  if (refreshed.source_type === "local_file") {
    refreshed.content = {
      mode: "inline_text",
      text: readLocalFileText(refreshed.source?.path),
    };
  }

  refreshed.source_summary = deriveSourceSummary(refreshed);

  return refreshed;
}

export function buildKnowledgeBasePromptSection(knowledgeBase) {
  if (!knowledgeBase?.enabled) return "";

  const enabledItems = (knowledgeBase.items || []).filter((item) => item?.enabled !== false);
  if (enabledItems.length === 0) return "";

  const lines = ["Knowledge base context:", ""];

  for (const [index, item] of enabledItems.entries()) {
    lines.push(`[${index + 1}] ${item.name || item.id || "Unnamed item"}`);

    if (item.description) {
      lines.push(`description: ${item.description}`);
    }

    lines.push(`source_type: ${item.source_type}`);

    const sourceSummary = deriveSourceSummary(item);
    if (sourceSummary) {
      lines.push(`source_summary: ${sourceSummary}`);
    }

    if (item.content?.mode === "reference_only") {
      lines.push("reference_only: true");
    } else if (item.content?.mode === "inline_text") {
      const { text, truncated } = truncateText(item.content.text || "", INLINE_TEXT_PROMPT_LIMIT);
      lines.push("content:");

      for (const line of text.split(/\r?\n/)) {
        lines.push(line);
      }

      if (truncated) {
        lines.push("[truncated]");
      }
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function validateSourceType(sourceType) {
  if (!SUPPORTED_SOURCE_TYPES.has(sourceType)) {
    throw new Error(`Unsupported knowledge base source_type: ${sourceType}`);
  }

  return sourceType;
}

function buildContent(item, input) {
  switch (item.source_type) {
    case "local_file":
      return {
        mode: "inline_text",
        text: readLocalFileText(item.source?.path),
      };
    case "free_text":
      return {
        mode: "inline_text",
        text: readFreeText(input),
      };
    case "project_name":
      requireTrimmedField(item.source?.project_name, "source.project_name is required for project_name");
      return emptyReferenceContent();
    case "github_url":
    case "lark_doc":
      requireTrimmedField(item.source?.url, `source.url is required for ${item.source_type}`);
      return emptyReferenceContent();
    default:
      throw new Error(`Unsupported knowledge base source_type: ${item.source_type}`);
  }
}

function emptyReferenceContent() {
  return {
    mode: "reference_only",
    text: "",
  };
}

function readLocalFileText(filePath) {
  return readFileSync(requireTrimmedField(filePath, "source.path is required for local_file"), "utf8");
}

function readFreeText(input) {
  const text = input?.content?.text ?? input?.body ?? input?.text;
  requireTrimmedField(text, "body text is required for free_text");
  return text;
}

function deriveSourceSummary(item) {
  const source = normalizeSource(item?.source);

  switch (item?.source_type) {
    case "local_file":
      return source.path || undefined;
    case "project_name":
      return source.project_name || undefined;
    case "github_url":
    case "lark_doc":
      return source.url || undefined;
    default:
      return undefined;
  }
}

function normalizeSource(source) {
  return {
    ...(source || {}),
    path: trimOptionalString(source?.path),
    url: trimOptionalString(source?.url),
    project_name: trimOptionalString(source?.project_name),
  };
}

function trimOptionalString(value) {
  return typeof value === "string" ? value.trim() : value;
}

function requireTrimmedField(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }

  return value.trim();
}

function truncateText(text, limit) {
  if (text.length <= limit) {
    return { text, truncated: false };
  }

  return {
    text: text.slice(0, limit),
    truncated: true,
  };
}
