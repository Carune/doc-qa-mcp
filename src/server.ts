import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "doc-qa-mcp",
  version: "0.1.0",
});

server.registerTool(
  "health_check",
  {
    title: "Health Check",
    description: "Returns basic server status.",
    inputSchema: {
      name: z.string().optional().describe("Optional caller name"),
    },
  },
  async ({ name }) => {
    const who = name?.trim() || "anonymous";
    return {
      content: [
        {
          type: "text",
          text: `doc-qa-mcp is running. hello ${who}`,
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
