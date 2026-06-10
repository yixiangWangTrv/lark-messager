import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ServerManager } from "./server-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DashboardServer {
  constructor({ config, botEvents, configPath }) {
    this._config = config;
    this._botEvents = botEvents;
    this._configPath = configPath;
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
    if (path === "/api/prompts" && req.method === "GET") {
      return this._jsonResponse(res, this._config.prompt);
    }
    if (path === "/api/prompts" && req.method === "PUT") {
      return this._handlePutPrompts(req, res);
    }
    if (path === "/api/servers" && req.method === "GET") {
      return this._jsonResponse(res, this._serverManager.list());
    }
    if (path === "/api/servers" && req.method === "POST") {
      return this._handlePostServer(req, res);
    }
    if (path === "/api/events" && req.method === "GET") {
      return this._handleSSE(req, res);
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
      Object.assign(this._config, body);
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
    const ok = this._serverManager.stop(id);
    if (!ok) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "server not found" }));
      return;
    }
    this._jsonResponse(res, { ok: true });
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
