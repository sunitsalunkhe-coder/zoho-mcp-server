import { z } from "zod";
import { getFollowupRequired } from "../zoho/mail-api.js";
import { toUserMessage } from "../utils/errors.js";
import { logToolCall } from "../utils/logger.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const definition: Tool = {
  name: "zoho_followup_check",
  description:
    "Find sent emails that have received no reply within the specified time window. Useful for follow-up reminders.",
  inputSchema: {
    type: "object",
    properties: {
      days_since_sent: {
        type: "number",
        description: "Check emails sent in the last N days with no reply (default 3)",
      },
    },
  },
};

const Schema = z.object({
  days_since_sent: z.number().int().min(1).max(90).default(3),
});

export async function handler(args: unknown): Promise<string> {
  const params = Schema.parse(args);
  logToolCall("zoho_followup_check", params);

  try {
    const messages = await getFollowupRequired(params.days_since_sent);
    return JSON.stringify({
      success: true,
      days_window: params.days_since_sent,
      count: messages.length,
      emails_needing_followup: messages.map((m) => ({
        id: m.messageId,
        to: m.toAddress,
        subject: m.subject,
        sent_date: m.sentDateInGMT,
        threadId: m.threadId,
      })),
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: toUserMessage(e) });
  }
}
