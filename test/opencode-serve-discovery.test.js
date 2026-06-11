import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseOpencodeServeProcesses, prioritizeOpencodeServeProcesses } from "../lib/opencode-serve-discovery.js";

describe("parseOpencodeServeProcesses", () => {
  it("extracts existing opencode serve port and password from ps eww output", () => {
    const output = [
      "30964 /Users/test/.opencode/bin/opencode serve --hostname 127.0.0.1 --port 56817 OPENCODE_SERVER_PASSWORD=secret-123",
      "31125 node oncall-bot.js --config oncall-bot.config.json",
    ].join("\n");

    assert.deepEqual(parseOpencodeServeProcesses(output), [
      {
        pid: 30964,
        port: 56817,
        password: "secret-123",
      },
    ]);
  });

  it("ignores non-opencode processes and entries without a port", () => {
    const output = [
      "31125 node oncall-bot.js --config oncall-bot.config.json",
      "31200 /Users/test/.opencode/bin/opencode serve --hostname 127.0.0.1",
    ].join("\n");

    assert.deepEqual(parseOpencodeServeProcesses(output), []);
  });
});

describe("prioritizeOpencodeServeProcesses", () => {
  it("prefers the configured port when multiple existing servers are running", () => {
    const processes = [
      { pid: 30964, port: 56817, password: "secret-a" },
      { pid: 31125, port: 4096, password: "secret-b" },
    ];

    assert.deepEqual(prioritizeOpencodeServeProcesses(processes, 4096), [
      { pid: 31125, port: 4096, password: "secret-b" },
      { pid: 30964, port: 56817, password: "secret-a" },
    ]);
  });
});
