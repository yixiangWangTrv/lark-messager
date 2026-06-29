import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const STATUS_OPTIONS = [
  { name: "未开启" },
  { name: "阻塞" },
  { name: "处理中" },
  { name: "无需处理" },
  { name: "完成" },
];

function parseCliJson(stdout, action) {
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(`${action} returned invalid JSON: ${stdout}`);
  }
}

function requireCliOk(result, stdout, action) {
  if (result.ok === false) {
    throw new Error(`${action} failed: ${stdout}`);
  }
}

function extractExistingTableId(text) {
  const match = String(text || "").match(/existing table [^(]*\((tbl[A-Za-z0-9]+)\)/);
  return match?.[1] || null;
}

export function parseBaseUrl(url) {
  const text = String(url || "").trim();
  if (!text) return { appToken: "", tableId: "" };

  const appToken = text.match(/(?:base|bitable)\/([A-Za-z0-9]+)/)?.[1]
    || text.match(/(?:app_token|base_token)=([A-Za-z0-9]+)/)?.[1]
    || "";
  const tableId = text.match(/(?:table|tbl)=?(tbl[A-Za-z0-9]+)/)?.[1]
    || text.match(/[?&]table_id=(tbl[A-Za-z0-9]+)/)?.[1]
    || text.match(/\b(tbl[A-Za-z0-9]+)\b/)?.[1]
    || "";

  return { appToken, tableId };
}

export async function createBase({ identity, name }) {
  const fields = JSON.stringify([
    { name: "群名", type: "text" },
    { name: "消息总结", type: "text" },
    { name: "消息链接", type: "text" },
    { name: "Thread ID", type: "text" },
    { name: "消息类型", type: "text" },
    { name: "AI初步回复", type: "text" },
    { name: "状态", type: "select", options: STATUS_OPTIONS },
  ]);

  const { stdout } = await execFileAsync("lark-cli", [
    "base", "+base-create",
    "--name", name,
    "--table-name", "Records",
    "--fields", fields,
    "--as", identity,
    "--json",
  ], { timeout: 30000 });

  const result = parseCliJson(stdout, "Create base");
  requireCliOk(result, stdout, "Create base");
  const appToken = result.data?.app_token
    || result.data?.base_token
    || result.data?.base?.app_token
    || result.data?.base?.base_token;
  if (!appToken) {
    throw new Error(`Create base succeeded but no base token was found: ${stdout}`);
  }

  const tableId = result.data?.table?.table_id
    || result.data?.table_id
    || result.data?.base?.default_table_id
    || result.data?.default_table_id;
  const url = result.data?.url || result.data?.base?.url || "";
  return { appToken, tableId, url };
}

export async function getBase({ identity, appToken }) {
  const { stdout } = await execFileAsync("lark-cli", [
    "base", "+base-get",
    "--base-token", appToken,
    "--as", identity,
    "--json",
  ], { timeout: 30000 });

  const result = parseCliJson(stdout, "Get base");
  requireCliOk(result, stdout, "Get base");
  return result.data?.base || result.data || {};
}

export async function createTable({ identity, appToken, tableName }) {
  const fields = JSON.stringify([
    { name: "群名", type: "text" },
    { name: "消息总结", type: "text" },
    { name: "消息链接", type: "text" },
    { name: "Thread ID", type: "text" },
    { name: "消息类型", type: "text" },
    { name: "AI初步回复", type: "text" },
    { name: "状态", type: "select", options: STATUS_OPTIONS },
  ]);

  let stdout;
  try {
    ({ stdout } = await execFileAsync("lark-cli", [
      "base", "+table-create",
      "--base-token", appToken,
      "--name", tableName,
      "--fields", fields,
      "--as", identity,
      "--json",
    ], { timeout: 30000 }));
  } catch (err) {
    const existingTableId = extractExistingTableId(err.stdout || err.message);
    if (existingTableId) {
      return existingTableId;
    }
    throw err;
  }

  const result = parseCliJson(stdout, "Create table");
  requireCliOk(result, stdout, "Create table");
  const tableId = result.data?.table_id || result.data?.table?.table_id;
  if (!tableId) {
    throw new Error(`Create table succeeded but no table id was found: ${stdout}`);
  }
  return tableId;
}

export async function upsertRecord({ identity, appToken, tableId, fields }) {
  const recordJson = JSON.stringify({
    "群名": fields.groupName || "",
    "消息总结": fields.messageSummary || "",
    "消息链接": fields.messageLink || "",
    "Thread ID": fields.threadId || "",
    "消息类型": fields.messageType || "",
    "AI初步回复": fields.aiReply || "",
    "状态": fields.status || "未开启",
  });

  const { stdout } = await execFileAsync("lark-cli", [
    "base", "+record-upsert",
    "--base-token", appToken,
    "--table-id", tableId,
    "--json", recordJson,
    "--as", identity,
    "--format", "json",
  ], { timeout: 30000 });

  const result = parseCliJson(stdout, "Upsert record");
  requireCliOk(result, stdout, "Upsert record");
  return result.data?.record || result.data;
}

export async function getTableFields({ identity, appToken, tableId }) {
  const { stdout } = await execFileAsync("lark-cli", [
    "base", "+table-get",
    "--base-token", appToken,
    "--table-id", tableId,
    "--as", identity,
    "--json",
  ], { timeout: 30000 });

  const result = parseCliJson(stdout, "Get table fields");
  requireCliOk(result, stdout, "Get table fields");
  return result.data?.table?.fields || result.data?.fields || [];
}
