// lib/distill.js — Distillation engine: collect messages via lark-cli, analyze with OpenCode, generate persona
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DISTILLED_DIR = resolve(__dirname, "../distilled");

// Ensure distilled directory exists
if (!existsSync(DISTILLED_DIR)) {
  mkdirSync(DISTILLED_DIR, { recursive: true });
}

// Active style state (in-memory, persisted via config)
let _activeStyleSlug = null;

export function getActiveStyle() {
  return _activeStyleSlug;
}

export function setActiveStyle(slug) {
  _activeStyleSlug = slug || null;
}

export function getActiveStylePrompt() {
  if (!_activeStyleSlug) return null;
  const profile = getDistilled(_activeStyleSlug);
  if (!profile) {
    _activeStyleSlug = null;
    return null;
  }
  return {
    slug: profile.slug,
    name: profile.name,
    relation: profile.relationLabel || profile.relation,
    prompt: profile.persona?.system_prompt || null,
  };
}

const RELATIONS = [
  { id: "peer", label: "平级", emoji: "" },
  { id: "junior", label: "下级", emoji: "" },
  { id: "senior", label: "上级", emoji: "" },
  { id: "mentor", label: "导师", emoji: "" },
  { id: "crush", label: "暗恋对象", emoji: "😏" },
  { id: "ex", label: "前任", emoji: "🤡" },
];

export { RELATIONS };

/**
 * Search lark contacts by name
 */
export async function searchContact(name, identity = "user") {
  const args = ["contact", "+search-user", "--query", name, "--as", identity, "--json"];
  try {
    const { stdout } = await execFileAsync("lark-cli", args, { timeout: 15000 });
    const result = JSON.parse(stdout);
    const users = result.data?.users || result.users || [];
    return users.map((u) => ({
      open_id: u.open_id,
      name: u.localized_name || u.name || u.en_name || name,
      department: u.department || u.department_name || "",
      avatar: u.avatar?.avatar_72 || "",
      p2p_chat_id: u.p2p_chat_id || null,
    }));
  } catch (err) {
    throw new Error(`Contact search failed: ${err.message}`);
  }
}

/**
 * Search group chats by name keyword
 */
export async function searchGroup(query, identity = "user") {
  const args = ["im", "+chat-search", "--query", query, "--as", identity, "--json"];
  try {
    const { stdout } = await execFileAsync("lark-cli", args, { timeout: 15000 });
    const result = JSON.parse(stdout);
    const chats = result.data?.chats || result.chats || [];
    return chats.map((c) => ({
      chat_id: c.chat_id,
      name: c.name || "",
      description: c.description || "",
    }));
  } catch (err) {
    throw new Error(`Group search failed: ${err.message}`);
  }
}

/**
 * Find P2P chat with a user by open_id
 */
async function findP2PChatId(openId, identity = "user") {
  // List chats and find the p2p one with target user
  const args = ["im", "chats", "list", "--as", identity, "--json"];
  try {
    const { stdout } = await execFileAsync("lark-cli", args, { timeout: 15000 });
    const result = JSON.parse(stdout);
    const chats = result.data?.items || result.items || [];
    // p2p chats have chat_type "p2p"
    const p2p = chats.find(
      (c) => c.chat_type === "p2p" && (c.owner_id === openId || c.name === "")
    );
    return p2p?.chat_id || null;
  } catch {
    return null;
  }
}

/**
 * Fetch messages from a chat (p2p or group)
 */
export async function fetchMessages({ chatId, openId, p2pChatId, limit = 50, identity = "user", source = "p2p" }) {
  // If no chatId provided for p2p, use p2pChatId from search result or try to find it
  let resolvedChatId = chatId;
  if (!resolvedChatId && source === "p2p") {
    resolvedChatId = p2pChatId || (openId ? await findP2PChatId(openId, identity) : null);
    if (!resolvedChatId) {
      throw new Error(`无法找到与该用户的私聊记录。请确认已与对方有过飞书私聊，或选择指定群聊。`);
    }
  }

  if (!resolvedChatId) {
    throw new Error("缺少 chat_id，请提供群聊 ID 或确认私聊存在。");
  }

  const args = [
    "im", "+chat-messages-list",
    "--chat-id", resolvedChatId,
    "--page-size", String(Math.min(limit, 200)),
    "--sort", "desc",
    "--as", identity,
    "--json",
  ];

  try {
    const { stdout } = await execFileAsync("lark-cli", args, { timeout: 30000 });
    const result = JSON.parse(stdout);
    const messages = result.data?.messages || result.messages || [];

    // Format and filter messages from the target user
    const formatted = messages
      .reverse()
      .map((msg) => {
        const sender = msg.sender?.name || msg.sender_name || msg.sender_id || "unknown";
        const content = extractContent(msg);
        const time = formatTime(msg.create_time);
        return { sender, content, time, raw: msg };
      })
      .filter((m) => m.content);

    return { messages: formatted, chatId: resolvedChatId, totalFetched: formatted.length };
  } catch (err) {
    throw new Error(`消息获取失败: ${err.message}`);
  }
}

/**
 * Distill persona from collected messages using OpenCode
 */
export async function distillPersona({ name, relation, messages, openCodeClient }) {
  const targetMessages = messages.filter(
    (m) => m.sender.includes(name) || m.sender === name
  );

  if (targetMessages.length < 5) {
    throw new Error(
      `消息数量不足：仅找到 ${targetMessages.length} 条来自"${name}"的消息（最少需要5条）。请增加采集行数或选择其他数据来源。`
    );
  }

  const relationInfo = RELATIONS.find((r) => r.id === relation) || RELATIONS[0];

  // Build analysis prompt
  const sampleMessages = targetMessages.slice(0, 100).map((m) => `[${m.time}] ${m.sender}: ${m.content}`).join("\n");

  const analysisPrompt = `你是一个语言风格分析专家。请分析以下聊天记录中"${name}"（身份：${relationInfo.label}）的说话风格和性格特征。

聊天记录：
${sampleMessages}

请用以下JSON格式输出分析结果（直接输出JSON，不要包裹在代码块中）：
{
  "summary": "一句话总结此人的沟通风格",
  "style_tags": ["标签1", "标签2", "标签3"],
  "expression_patterns": {
    "tone": "整体语气描述",
    "sentence_length": "短句多/长句多/混合",
    "punctuation_habits": "标点使用习惯",
    "emoji_usage": "emoji使用频率和类型",
    "口头禅": ["常用词1", "常用词2"]
  },
  "personality_traits": ["性格特点1", "性格特点2", "性格特点3"],
  "communication_style": {
    "response_speed": "回复倾向（秒回/慢热/看心情）",
    "initiative": "主动性（主动发起/被动回应）",
    "conflict_mode": "面对冲突时的反应模式"
  },
  "system_prompt": "完整的角色扮演提示词，让AI能模仿此人的说话方式。要求：1)使用此人的口头禅和表达习惯 2)模拟其语气和态度 3)保持其回复长度和节奏 4)融入其性格特点。提示词要具体且可执行。"
}`;

  // If we have openCodeClient, use it; otherwise do local analysis
  if (openCodeClient) {
    try {
      const session = await openCodeClient.findOrCreateSession({
        title: `distill-${name}-${Date.now()}`,
        cacheKey: null,
      });

      const response = await openCodeClient.sendMessage(session.sessionId, analysisPrompt);
      // Try to parse JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error("Failed to parse analysis response");
    } catch (err) {
      // Fallback to local simple analysis
      return localAnalysis(name, relationInfo, targetMessages);
    }
  }

  return localAnalysis(name, relationInfo, targetMessages);
}

/**
 * Local fallback analysis without OpenCode
 */
function localAnalysis(name, relationInfo, messages) {
  const allContent = messages.map((m) => m.content).join(" ");
  const avgLength = Math.round(allContent.length / messages.length);
  const hasEmoji = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/u.test(allContent);
  const shortMessages = messages.filter((m) => m.content.length < 10).length;
  const shortRatio = shortMessages / messages.length;

  const styleTags = [];
  if (shortRatio > 0.6) styleTags.push("简洁");
  else if (shortRatio < 0.3) styleTags.push("话多");
  if (hasEmoji) styleTags.push("爱用emoji");
  if (avgLength < 15) styleTags.push("惜字如金");
  if (allContent.includes("？") || allContent.includes("?")) styleTags.push("爱反问");
  if (styleTags.length === 0) styleTags.push("风格平衡");

  return {
    summary: `${name}（${relationInfo.label}）- 平均每条消息${avgLength}字，${shortRatio > 0.5 ? "偏简洁" : "表达较完整"}`,
    style_tags: styleTags,
    expression_patterns: {
      tone: shortRatio > 0.6 ? "简洁直接" : "温和详细",
      sentence_length: avgLength < 15 ? "短句多" : avgLength > 40 ? "长句多" : "混合",
      punctuation_habits: "基于本地分析",
      emoji_usage: hasEmoji ? "偶尔使用" : "很少使用",
      口头禅: [],
    },
    personality_traits: styleTags,
    communication_style: {
      response_speed: "未知",
      initiative: "未知",
      conflict_mode: "未知",
    },
    system_prompt: `你现在是${name}，身份是我的${relationInfo.label}。请用以下风格说话：${styleTags.join("、")}。平均每条消息${avgLength}字左右。${hasEmoji ? "偶尔使用emoji。" : "很少使用emoji。"}保持${shortRatio > 0.5 ? "简洁直接" : "温和详细"}的语气。`,
  };
}

/**
 * Save distilled result
 */
export function saveDistilled(slug, data) {
  const filePath = resolve(DISTILLED_DIR, `${slug}.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

/**
 * Load all distilled profiles
 */
export function listDistilled() {
  try {
    const files = readdirSync(DISTILLED_DIR).filter((f) => f.endsWith(".json"));
    return files.map((f) => {
      const content = JSON.parse(readFileSync(resolve(DISTILLED_DIR, f), "utf-8"));
      return content;
    });
  } catch {
    return [];
  }
}

/**
 * Get one distilled profile by slug
 */
export function getDistilled(slug) {
  const filePath = resolve(DISTILLED_DIR, `${slug}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

/**
 * Delete a distilled profile
 */
export function deleteDistilled(slug) {
  const filePath = resolve(DISTILLED_DIR, `${slug}.json`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Generate a chat response using distilled persona
 */
export async function generateStyledReply({ slug, userMessage, openCodeClient }) {
  const profile = getDistilled(slug);
  if (!profile) {
    throw new Error(`未找到蒸馏风格: ${slug}`);
  }

  const systemPrompt = profile.persona?.system_prompt || `模仿${profile.name}的说话方式回复。`;
  const fullPrompt = `${systemPrompt}\n\n用户说: ${userMessage}\n\n请用${profile.name}的风格回复（直接回复内容，不要加任何前缀或解释）:`;

  if (openCodeClient) {
    try {
      const session = await openCodeClient.findOrCreateSession({
        title: `style-reply-${slug}-${Date.now()}`,
        cacheKey: null,
      });
      const response = await openCodeClient.sendMessage(session.sessionId, fullPrompt);
      return response;
    } catch {
      return `[${profile.name}风格回复生成失败]`;
    }
  }

  return `[需要 OpenCode 连接才能生成${profile.name}风格的回复]`;
}

// Helper functions
function extractContent(msg) {
  const type = msg.msg_type || msg.message_type;
  const body = msg.body?.content || msg.content || "";

  if (type === "text") {
    if (typeof body !== "string") return "";
    try {
      const parsed = JSON.parse(body);
      return typeof parsed?.text === "string" ? parsed.text : body;
    } catch {
      return body;
    }
  }
  if (type === "post") {
    try {
      const parsed = JSON.parse(body);
      const locale = parsed.zh_cn || parsed.en_us || Object.values(parsed)[0];
      const lines = Array.isArray(locale?.content) ? locale.content : [];
      return lines
        .map((line) => line.map((seg) => seg.text || "").join(""))
        .filter(Boolean)
        .join(" ");
    } catch {
      return body;
    }
  }
  return null;
}

function formatTime(timestamp) {
  if (!timestamp) return "??:??";
  const ms = Number(timestamp);
  if (isNaN(ms)) return "??:??";
  return new Date(ms).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Convert name to slug (simple ASCII conversion)
 */
export function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/[\s]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
    .slice(0, 20) || `user-${Date.now()}`;
}
