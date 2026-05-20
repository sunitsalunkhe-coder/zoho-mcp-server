import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./utils/logger.js";
import { toUserMessage } from "./utils/errors.js";
import { createOAuthApp } from "./server/oauth-callback.js";

import * as sendTool from "./tools/send.js";
import * as draftTool from "./tools/draft.js";
import * as inboxTool from "./tools/inbox.js";
import * as searchTool from "./tools/search.js";
import * as getEmailTool from "./tools/get-email.js";
import * as threadTool from "./tools/thread.js";
import * as replyTool from "./tools/reply.js";
import * as markReadTool from "./tools/mark-read.js";
import * as labelTool from "./tools/label.js";
import * as followupTool from "./tools/followup.js";
import * as spamTool from "./tools/spam.js";
import * as trashTool from "./tools/trash.js";

const TOOLS: { definition: Tool; handler: (args: unknown) => Promise<string> }[] = [
  sendTool,
  draftTool,
  inboxTool,
  searchTool,
  getEmailTool,
  threadTool,
  replyTool,
  markReadTool,
  labelTool,
  followupTool,
  spamTool,
  trashTool,
];

const toolMap = new Map(TOOLS.map((t) => [t.definition.name, t.handler]));

async function createServer(): Promise<Server> {
  const server = new Server(
    { name: "zoho-mail-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => t.definition),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = toolMap.get(name);
    if (!handler) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }
    logger.info({ tool: name }, "tool_dispatch");
    try {
      const result = await handler(args ?? {});
      return { content: [{ type: "text" as const, text: result }] };
    } catch (e) {
      const msg = toUserMessage(e);
      logger.error({ tool: name, err: e }, "tool_error");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
        isError: true,
      };
    }
  });

  return server;
}

async function main(): Promise<void> {
  const transport = process.env["MCP_TRANSPORT"] ?? "stdio";
  const port = parseInt(process.env["PORT"] ?? "3000");

  const server = await createServer();

  if (transport === "stdio") {
    logger.info("Starting MCP server (stdio transport)");
    const t = new StdioServerTransport();
    await server.connect(t);
    logger.info("MCP server ready (stdio)");
  } else {
    logger.info({ port }, "Starting MCP server (HTTP/SSE transport)");
    const app = createOAuthApp();
    let sseTransport: SSEServerTransport | null = null;

    app.get("/sse", async (req, res) => {
      logger.info("SSE client connected");
      sseTransport = new SSEServerTransport("/messages", res);
      await server.connect(sseTransport);
    });

    app.post("/messages", async (req, res) => {
      if (!sseTransport) {
        res.status(503).json({ error: "No SSE connection" });
        return;
      }
      await sseTransport.handlePostMessage(req, res);
    });

    app.listen(port, () => {
      logger.info({ port }, "HTTP server listening");
      logger.info(`SSE endpoint: http://localhost:${port}/sse`);
      logger.info(`Health: http://localhost:${port}/health`);
    });
  }
}

main().catch((e) => {
  logger.error({ err: e }, "fatal_startup_error");
  process.exit(1);
});
