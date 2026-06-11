import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function parseOpencodeServeProcesses(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("opencode serve") && line.includes("--port"))
    .map((line) => {
      const pidMatch = line.match(/^(\d+)/);
      const portMatch = line.match(/--port\s+(\d+)/);
      if (!pidMatch || !portMatch) return null;
      const passwordMatch = line.match(/OPENCODE_SERVER_PASSWORD=([^\s]+)/);
      return {
        pid: Number(pidMatch[1]),
        port: Number(portMatch[1]),
        password: passwordMatch ? passwordMatch[1] : "",
      };
    })
    .filter(Boolean);
}

export function prioritizeOpencodeServeProcesses(processes, preferredPort) {
  return [...processes].sort((a, b) => {
    const aPreferred = a.port === preferredPort ? 0 : 1;
    const bPreferred = b.port === preferredPort ? 0 : 1;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    return a.port - b.port;
  });
}

export async function detectOpencodeServeProcesses() {
  try {
    const { stdout } = await execFileAsync("ps", ["eww", "-axo", "pid=,command="], { timeout: 5000 });
    return parseOpencodeServeProcesses(stdout);
  } catch {
    return [];
  }
}
