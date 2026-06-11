import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ServerManager } from "./server-manager.js";
import {
  RELATIONS, searchContact, searchGroup, fetchMessages, distillPersona,
  saveDistilled, listDistilled, getDistilled, deleteDistilled, clearAllDistilled,
  generateStyledReply, nameToSlug, getActiveStyle, setActiveStyle, getActiveStylePrompt,
} from "./distill.js";
import { createKnowledgeBaseItem, refreshKnowledgeBaseItem } from "./knowledge-base.js";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DashboardServer {
  constructor({ config, botEvents, configPath, opencode }) {
    this._config = config;
    this._botEvents = botEvents;
    this._configPath = configPath;
    this._opencode = opencode || null;
    this._sessions = [];
    this._sseClients = new Set();
    this._serverManager = new ServerManager();
    this._httpServer = null;

    this._botEvents.on("session:created", (session) => {
      this._sessions.push(session);
      if (this._sessions.length > 100) {
        this._sessions.shift();
      }
      this._broadcast({ type: "session_created", data: session });
    });
  }

  _broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this._sseClients) {
      try {
        res.write(payload);
      } catch {
        this._sseClients.delete(res);
      }
    }
  }

  async start() {
    const port = this._config.dashboard?.port || 8080;
    this._httpServer = createServer((req, res) => this._handleRequest(req, res));
    return new Promise((resolve_p) => {
      this._httpServer.listen(port, () => resolve_p());
    });
  }

  stop() {
    if (this._httpServer) {
      this._httpServer.close();
      this._httpServer = null;
    }
    for (const client of this._sseClients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this._sseClients.clear();
    this._serverManager.stopAll();
  }

  _handleRequest(req, res) {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // Route dispatch
    if (path === "/" && req.method === "GET") {
      return this._serveHtml(res);
    }
    if (path === "/api/status" && req.method === "GET") {
      return this._jsonResponse(res, this._getStatus());
    }
    if (path === "/api/sessions" && req.method === "GET") {
      return this._jsonResponse(res, this._sessions);
    }
    if (path === "/api/config" && req.method === "GET") {
      return this._jsonResponse(res, this._config);
    }
    if (path === "/api/config" && req.method === "PUT") {
      return this._handlePutConfig(req, res);
    }
    if (path === "/api/trigger-modes" && req.method === "GET") {
      return this._jsonResponse(res, this._config.lark.trigger_modes);
    }
    if (path === "/api/trigger-modes" && req.method === "PUT") {
      return this._handlePutTriggerModes(req, res);
    }
    if (path === "/api/prompts" && req.method === "GET") {
      return this._jsonResponse(res, this._config.prompt);
    }
    if (path === "/api/prompts" && req.method === "PUT") {
      return this._handlePutPrompts(req, res);
    }
    if (path === "/api/pua-mode" && req.method === "GET") {
      return this._jsonResponse(res, this._config.pua || { enabled: false, intents: {} });
    }
    if (path === "/api/pua-mode" && req.method === "PUT") {
      return this._handlePutPuaMode(req, res);
    }
    if (path === "/api/knowledge-base" && req.method === "GET") {
      return this._jsonResponse(res, this._getKnowledgeBaseConfig());
    }
    if (path === "/api/knowledge-base" && req.method === "PUT") {
      return this._handlePutKnowledgeBase(req, res);
    }
    if (path === "/api/knowledge-base/items" && req.method === "POST") {
      return this._handlePostKnowledgeBaseItem(req, res);
    }
    if (path === "/api/servers" && req.method === "GET") {
      return this._handleGetServers(res);
    }
    if (path === "/api/servers" && req.method === "POST") {
      return this._handlePostServer(req, res);
    }
    if (path === "/api/events" && req.method === "GET") {
      return this._handleSSE(req, res);
    }

    // Dynamic session routes: /api/sessions/:id/messages
    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (sessionMatch && req.method === "GET") {
      return this._handleGetSessionMessages(sessionMatch[1], res);
    }

    const knowledgeBaseItemMatch = path.match(/^\/api\/knowledge-base\/items\/([^/]+)$/);
    if (knowledgeBaseItemMatch && req.method === "PUT") {
      return this._handlePutKnowledgeBaseItem(knowledgeBaseItemMatch[1], req, res);
    }
    if (knowledgeBaseItemMatch && req.method === "DELETE") {
      return this._handleDeleteKnowledgeBaseItem(knowledgeBaseItemMatch[1], res);
    }

    const knowledgeBaseRefreshMatch = path.match(/^\/api\/knowledge-base\/items\/([^/]+)\/refresh$/);
    if (knowledgeBaseRefreshMatch && req.method === "POST") {
      return this._handleRefreshKnowledgeBaseItem(knowledgeBaseRefreshMatch[1], res);
    }

    // Dynamic server routes: /api/servers/:id/action
    const serverMatch = path.match(/^\/api\/servers\/([^/]+)(\/(.+))?$/);
    if (serverMatch) {
      const id = serverMatch[1];
      const action = serverMatch[3];
      if (req.method === "DELETE" && !action) {
        return this._handleStopServer(id, res);
      }
      if (req.method === "POST" && action === "stop") {
        return this._handleStopServer(id, res);
      }
      if (req.method === "POST" && action === "restart") {
        return this._handleRestartServer(id, res);
      }
      if (req.method === "POST" && action === "bind") {
        return this._handleBindServer(id, req, res);
      }
    }

    // Distill API routes
    if (path === "/api/distill/relations" && req.method === "GET") {
      return this._jsonResponse(res, RELATIONS);
    }
    if (path === "/api/distill/search" && req.method === "POST") {
      return this._handleDistillSearch(req, res);
    }
    if (path === "/api/distill/search-group" && req.method === "POST") {
      return this._handleDistillSearchGroup(req, res);
    }
    if (path === "/api/distill/start" && req.method === "POST") {
      return this._handleDistillStart(req, res);
    }
    if (path === "/api/distill/list" && req.method === "GET") {
      return this._jsonResponse(res, listDistilled());
    }
    if (path === "/api/distill/chat" && req.method === "POST") {
      return this._handleDistillChat(req, res);
    }
    if (path === "/api/distill/active-style" && req.method === "GET") {
      return this._jsonResponse(res, { slug: getActiveStyle(), ...(getActiveStylePrompt() || {}) });
    }
    if (path === "/api/distill/active-style" && req.method === "PUT") {
      return this._handleSetActiveStyle(req, res);
    }
    if (path === "/api/distill/clear-all" && req.method === "POST") {
      const count = clearAllDistilled();
      return this._jsonResponse(res, { ok: true, deleted: count });
    }
    const distillDeleteMatch = path.match(/^\/api\/distill\/([^/]+)$/);
    if (distillDeleteMatch && req.method === "DELETE") {
      const slug = distillDeleteMatch[1];
      const ok = deleteDistilled(slug);
      return this._jsonResponse(res, { ok });
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }

  _serveHtml(res) {
    const htmlPath = resolve(__dirname, "../dashboard/index.html");
    try {
      const html = readFileSync(htmlPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body><p>Dashboard loading...</p></body></html>");
    }
  }

  _getStatus() {
    return {
      status: "running",
      boundServer: this._config.opencode?.base_url || null,
      dashboardPort: this._config.dashboard?.port || 8080,
      sessionsCount: this._sessions.length,
    };
  }

  _jsonResponse(res, data) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  _getKnowledgeBaseConfig() {
    if (!this._config.knowledge_base || typeof this._config.knowledge_base !== "object") {
      this._config.knowledge_base = { enabled: true, items: [] };
    }

    if (!Array.isArray(this._config.knowledge_base.items)) {
      this._config.knowledge_base.items = [];
    }

    if (typeof this._config.knowledge_base.enabled !== "boolean") {
      this._config.knowledge_base.enabled = true;
    }

    return this._config.knowledge_base;
  }

  _readBody(req) {
    return new Promise((resolve_p, reject) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        try {
          resolve_p(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    });
  }

  async _handlePutConfig(req, res) {
    try {
      const body = await this._readBody(req);
      // Deep merge for nested objects (reply, dashboard, lark, etc.)
      for (const [key, val] of Object.entries(body)) {
        if (val && typeof val === "object" && !Array.isArray(val) && this._config[key] && typeof this._config[key] === "object") {
          Object.assign(this._config[key], val);
        } else {
          this._config[key] = val;
        }
      }
      this._saveConfig();
      this._jsonResponse(res, this._config);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePutPrompts(req, res) {
    try {
      const body = await this._readBody(req);
      Object.assign(this._config.prompt, body);
      this._saveConfig();
      this._jsonResponse(res, this._config.prompt);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePutPuaMode(req, res) {
    try {
      const body = await this._readBody(req);
      if (!this._config.pua) {
        this._config.pua = { enabled: false, intents: {} };
      }
      if (typeof body.enabled === "boolean") {
        this._config.pua.enabled = body.enabled;
      }
      if (body.intents && typeof body.intents === "object") {
        this._config.pua.intents = { ...this._config.pua.intents, ...body.intents };
      }
      this._saveConfig();
      this._jsonResponse(res, this._config.pua);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePutKnowledgeBase(req, res) {
    try {
      const body = await this._readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "body must be a JSON object" }));
        return;
      }
      if (typeof body.enabled !== "boolean") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "enabled must be a boolean" }));
        return;
      }

      const knowledgeBase = this._getKnowledgeBaseConfig();
      knowledgeBase.enabled = body.enabled;
      this._saveConfig();
      this._jsonResponse(res, knowledgeBase);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePostKnowledgeBaseItem(req, res) {
    try {
      const body = await this._readBody(req);
      const knowledgeBase = this._getKnowledgeBaseConfig();
      const item = createKnowledgeBaseItem(body);
      knowledgeBase.items.push(item);
      this._saveConfig();
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(item));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePutKnowledgeBaseItem(id, req, res) {
    try {
      const body = await this._readBody(req);
      const knowledgeBase = this._getKnowledgeBaseConfig();
      const index = knowledgeBase.items.findIndex((item) => item.id === id);
      if (index === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "knowledge base item not found" }));
        return;
      }

      const item = createKnowledgeBaseItem({ ...body, id });
      knowledgeBase.items[index] = item;
      this._saveConfig();
      this._jsonResponse(res, item);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  _handleDeleteKnowledgeBaseItem(id, res) {
    const knowledgeBase = this._getKnowledgeBaseConfig();
    const index = knowledgeBase.items.findIndex((item) => item.id === id);
    if (index === -1) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "knowledge base item not found" }));
      return;
    }

    const [item] = knowledgeBase.items.splice(index, 1);
    this._saveConfig();
    this._jsonResponse(res, item);
  }

  _handleRefreshKnowledgeBaseItem(id, res) {
    try {
      const knowledgeBase = this._getKnowledgeBaseConfig();
      const index = knowledgeBase.items.findIndex((item) => item.id === id);
      if (index === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "knowledge base item not found" }));
        return;
      }

      const item = refreshKnowledgeBaseItem(knowledgeBase.items[index]);
      knowledgeBase.items[index] = item;
      this._saveConfig();
      this._jsonResponse(res, item);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handlePutTriggerModes(req, res) {
    try {
      const body = await this._readBody(req);
      const modes = this._config.lark.trigger_modes;
      if (typeof body.mention_bot === "boolean") modes.mention_bot = body.mention_bot;
      if (typeof body.mention_owner === "boolean") modes.mention_owner = body.mention_owner;
      if (typeof body.all_messages === "boolean") modes.all_messages = body.all_messages;
      this._saveConfig();
      this._jsonResponse(res, modes);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handleGetSessionMessages(sessionId, res) {
    if (!this._opencode) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "opencode client not available" }));
      return;
    }
    try {
      const messages = await this._opencode.listMessages(sessionId);
      this._jsonResponse(res, messages);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handleGetServers(res) {
    const managed = this._serverManager.list();
    const external = await this._detectExternalServers();
    // Merge: managed first, then external (exclude duplicates by port)
    const managedPorts = new Set(managed.map((s) => s.port));
    const merged = [
      ...managed,
      ...external.filter((s) => !managedPorts.has(s.port)),
    ];
    // Mark which one the bot is bound to
    const boundUrl = this._config.opencode?.base_url || "";
    for (const s of merged) {
      s.bound = boundUrl.includes(`:${s.port}`);
    }
    this._jsonResponse(res, merged);
  }

  async _detectExternalServers() {
    try {
      const { stdout } = await execFileAsync("ps", ["aux"], { timeout: 5000 });
      const results = [];
      const lines = stdout.split("\n");
      for (const line of lines) {
        if (!line.includes("opencode") || !line.includes("serve")) continue;
        const portMatch = line.match(/--port\s+(\d+)/);
        const pidMatch = line.match(/^\S+\s+(\d+)/);
        if (portMatch && pidMatch) {
          results.push({
            id: `ext-${pidMatch[1]}`,
            port: parseInt(portMatch[1], 10),
            pid: parseInt(pidMatch[1], 10),
            status: "running",
            source: "external",
            startedAt: null,
          });
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  async _handlePostServer(req, res) {
    try {
      const body = await this._readBody(req);
      const { port, projectDir } = body;
      if (!port || !projectDir) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "port and projectDir required" }));
        return;
      }
      const result = this._serverManager.start({ port, projectDir });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  _handleStopServer(id, res) {
    // Try managed servers first
    const ok = this._serverManager.stop(id);
    if (ok) {
      this._jsonResponse(res, { ok: true });
      return;
    }
    // Try external server (id format: ext-<pid>)
    if (id.startsWith("ext-")) {
      const pid = parseInt(id.slice(4), 10);
      if (pid > 0) {
        try {
          process.kill(pid, "SIGTERM");
          this._jsonResponse(res, { ok: true, killed_pid: pid });
          return;
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Failed to kill PID ${pid}: ${e.message}` }));
          return;
        }
      }
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "server not found" }));
  }

  _handleRestartServer(id, res) {
    const result = this._serverManager.restart(id);
    if (!result) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "server not found" }));
      return;
    }
    this._jsonResponse(res, result);
  }

  async _handleBindServer(id, req, res) {
    const servers = this._serverManager.list();
    const server = servers.find((s) => s.id === id);
    if (!server) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "server not found" }));
      return;
    }
    this._config.opencode = this._config.opencode || {};
    this._config.opencode.base_url = `http://localhost:${server.port}`;
    this._saveConfig();
    this._jsonResponse(res, { ok: true, base_url: this._config.opencode.base_url });
  }

  _handleSSE(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("data: {\"type\":\"connected\"}\n\n");
    this._sseClients.add(res);
    req.on("close", () => {
      this._sseClients.delete(res);
    });
  }

  // --- Distill API Handlers ---

  async _handleDistillSearch(req, res) {
    try {
      const { name } = await this._readBody(req);
      if (!name) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "name required" }));
        return;
      }
      const identity = this._config.lark.context_identity || "user";
      const results = await searchContact(name, identity);
      this._jsonResponse(res, results);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handleDistillSearchGroup(req, res) {
    try {
      const { query } = await this._readBody(req);
      if (!query) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "query required" }));
        return;
      }
      const identity = this._config.lark.context_identity || "user";
      const results = await searchGroup(query, identity);
      this._jsonResponse(res, results);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handleDistillStart(req, res) {
    try {
      const { name, openId, p2pChatId, relation, limit = 50, source = "p2p", chatId } = await this._readBody(req);
      if (!name) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "name required" }));
        return;
      }
      const identity = this._config.lark.context_identity || "user";

      // Step 1: Fetch messages
      const fetchResult = await fetchMessages({
        chatId: chatId || null,
        openId: openId || null,
        p2pChatId: p2pChatId || null,
        limit,
        identity,
        source,
      });

      // Step 2: Distill persona (openCodeClient passed if available)
      // Detect language from config response_format or dashboard.language
      const respFmt = this._config.prompt?.other?.response_format || "";
      let cfgLang = "en";
      if (respFmt.includes("Chinese")) cfgLang = "zh";
      else if (respFmt.includes("Indonesia")) cfgLang = "id";
      else if (respFmt.includes("Elvish")) cfgLang = "elv";
      else if (this._config.dashboard?.language) cfgLang = this._config.dashboard.language;
      const persona = await distillPersona({
        name,
        relation: relation || "peer",
        messages: fetchResult.messages,
        openCodeClient: this._openCodeClient || null,
        lang: cfgLang,
        source,
      });

      // Step 3: Save result
      const slug = nameToSlug(name);
      const relationInfo = RELATIONS.find((r) => r.id === relation) || RELATIONS[0];
      const distilledData = {
        slug,
        name,
        relation: relation || "peer",
        relationLabel: `${relationInfo.label}${relationInfo.emoji ? " " + relationInfo.emoji : ""}`,
        created_at: new Date().toISOString(),
        source: { type: source, chatId: fetchResult.chatId, msgCount: fetchResult.totalFetched },
        persona,
      };

      saveDistilled(slug, distilledData);

      this._jsonResponse(res, distilledData);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handleDistillChat(req, res) {
    try {
      const { slug, message } = await this._readBody(req);
      if (!slug || !message) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "slug and message required" }));
        return;
      }
      const reply = await generateStyledReply({
        slug,
        userMessage: message,
        openCodeClient: this._openCodeClient || null,
      });
      this._jsonResponse(res, { reply });
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  async _handleSetActiveStyle(req, res) {
    try {
      const { slug } = await this._readBody(req);
      // slug=null or "" means deactivate
      if (slug) {
        const profile = getDistilled(slug);
        if (!profile) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Style "${slug}" not found` }));
          return;
        }
      }
      setActiveStyle(slug || null);
      this._jsonResponse(res, { ok: true, slug: getActiveStyle(), ...(getActiveStylePrompt() || {}) });
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  // Allow external code to set the opencode client reference
  setOpenCodeClient(client) {
    this._openCodeClient = client;
  }

  _saveConfig() {
    try {
      const tmp = this._configPath + ".tmp";
      writeFileSync(tmp, JSON.stringify(this._config, null, 2));
      renameSync(tmp, this._configPath);
    } catch {
      // Swallow write errors in non-critical path
    }
  }
}
