import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export async function startStdio(server) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return transport;
}
