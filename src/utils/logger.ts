import pino from "pino";

const isStdio = (process.env["MCP_TRANSPORT"] ?? "stdio") === "stdio";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  ...(isStdio
    ? { transport: { target: "pino/file", options: { destination: 2 } } }
    : process.env["NODE_ENV"] !== "production"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
        },
      }
    : {}),
});

export function logToolCall(tool: string, params: Record<string, unknown>): void {
  const safe = { ...params };
  // Redact email body content from logs
  for (const key of ["body_html", "body_text", "content", "htmlBody", "textBody"]) {
    if (key in safe) safe[key] = "[REDACTED]";
  }
  logger.info({ tool, params: safe }, "tool_call");
}
