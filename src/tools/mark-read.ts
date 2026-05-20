import { z } from "zod";
import { markRead } from "../zoho/mail-api.js";
import { toUserMessage } from "../utils/errors.js";
import { logToolCall } from "../utils/logger.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const definition: Tool = {
  name: "zoho_mark_read",
  description: "Mark one or more emails as read or unread.",
  inputSchema: {
    type: "object",
    properties: {
      message_ids: { type: "array", items: { type: "string" }, description: "Message IDs" },
      read: { type: "boolean", description: "true = mark read, false = mark unread" },
    },
    required: ["message_ids", "read"],
  },
};

const Schema = z.object({
  message_ids: z.array(z.string().min(1)).min(1).max(50),
  read: z.boolean(),
});

export async function handler(args: unknown): Promise<string> {
  const params = Schema.parse(args);
  logToolCall("zoho_mark_read", params);

  try {
    await markRead(params.message_ids, params.read);
    return JSON.stringify({
      success: true,
      updated: params.message_ids.length,
      status: params.read ? "marked_read" : "marked_unread",
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: toUserMessage(e) });
  }
}
