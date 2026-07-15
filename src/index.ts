import crypto from "crypto";
import { loadConfig } from "./utils/config.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { logger } from "./utils/logger.js";
import { toUserMessage } from "./utils/errors.js";
import { userContext } from "./utils/context.js";
import { createOAuthApp } from "./server/oauth-callback.js";
import { createOAuthProvider } from "./auth/oauth-provider.js";

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

async function createMcpServer(userId: string): Promise<Server> {
  const server = new Server(
    { name: "zoho-mail-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => t.definition),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return userContext.run(userId, async () => {
      const { name, arguments: args } = request.params;
      const handler = toolMap.get(name);
      if (!handler) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
      }
      logger.info({ tool: name, userId }, "tool_dispatch");
      try {
        const result = await handler(args ?? {});
        return { content: [{ type: "text" as const, text: result }] };
      } catch (e) {
        const msg = toUserMessage(e);
        logger.error({ tool: name, userId, err: e }, "tool_error");
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
          isError: true,
        };
      }
    });
  });

  return server;
}

async function main(): Promise<void> {
  await loadConfig();
  const transport = process.env["MCP_TRANSPORT"] ?? "stdio";
  const port = parseInt(process.env["PORT"] ?? "3000");

  if (transport === "stdio") {
    logger.info("Starting MCP server (stdio transport)");
    const server = await createMcpServer("default");
    const t = new StdioServerTransport();
    await server.connect(t);
    logger.info("MCP server ready (stdio)");
  } else {
    logger.info({ port }, "Starting MCP server (Streamable HTTP transport)");
    const app = createOAuthApp();
    const oauthProvider = createOAuthProvider();
    const serverUrl = new URL(process.env["SERVER_URL"] ?? `http://localhost:${port}`);

    // Mount MCP auth router — handles /authorize, /token, /register, /.well-known/*
    app.use(mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: serverUrl,
      baseUrl: serverUrl,
      serviceDocumentationUrl: new URL("https://github.com/sunitsalunkhe-coder/zoho-mcp-server"),
    }));

    // session → { server, transport }
    const sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();

    app.post("/mcp",
      requireBearerAuth({ verifier: oauthProvider }),
      async (req, res) => {
        const userId = (req.auth?.extra?.userId as string) ?? "default";
        const existingSessionId = req.headers["mcp-session-id"] as string | undefined;

        if (existingSessionId && sessions.has(existingSessionId)) {
          const { transport } = sessions.get(existingSessionId)!;
          await transport.handleRequest(req, res, req.body);
          return;
        }

        // New session
        const server = await createMcpServer(userId);
        const t = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });

        await server.connect(t);
        await t.handleRequest(req, res, req.body);

        if (t.sessionId) {
          sessions.set(t.sessionId, { server, transport: t });
          t.onclose = () => {
            if (t.sessionId) sessions.delete(t.sessionId);
            logger.info({ userId, sessionId: t.sessionId }, "session closed");
          };
          logger.info({ userId, sessionId: t.sessionId }, "session created");
        }
      }
    );

    app.get("/mcp",
      requireBearerAuth({ verifier: oauthProvider }),
      async (req, res) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
          res.status(400).json({ error: "Invalid or missing session ID" });
          return;
        }
        const { transport } = sessions.get(sessionId)!;
        await transport.handleRequest(req, res);
      }
    );

    app.delete("/mcp",
      requireBearerAuth({ verifier: oauthProvider }),
      async (req, res) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        if (sessionId && sessions.has(sessionId)) {
          const { server, transport } = sessions.get(sessionId)!;
          await transport.close();
          await server.close();
          sessions.delete(sessionId);
        }
        res.status(200).json({ ok: true });
      }
    );

    app.listen(port, () => {
      logger.info({ port }, "HTTP server listening");
      logger.info(`MCP endpoint: ${serverUrl.href}mcp`);
      logger.info(`OAuth metadata: ${serverUrl.href}.well-known/oauth-authorization-server`);
      logger.info(`Health: ${serverUrl.href}health`);
    });
  }
}

main().catch((e) => {
  logger.error({ err: e }, "fatal_startup_error");
  process.exit(1);
});
