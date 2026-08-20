#!/usr/bin/env node
import { createCircuitCore } from "../src/core.mjs";
import { buildCircuitMcpServer } from "../src/server.mjs";
import { startStdio } from "../src/transports/stdio.mjs";
import { startHttp } from "../src/transports/http.mjs";

const args = process.argv.slice(2);
const transport = args.includes("--http") ? "http" : args.includes("--stdio") ? "stdio" : "stdio";
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : undefined;

const core = createCircuitCore();
const options = { core, port };

if (transport === "http") {
  await startHttp(options);
} else {
  await startStdio(buildCircuitMcpServer(options));
  console.error("CIRCUIT MCP (STDIO) ready");
}
