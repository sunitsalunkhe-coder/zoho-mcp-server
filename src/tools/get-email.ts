import { z } from "zod";
import { getMessage, markRead } from "../zoho/mail-api.js";
import { toUserMessage } from "../utils/errors.js";
import { logToolCall } from "../utils/logger.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const definition: Tool = {
  name: "zoho_get_email",
  description: "Get a full email by message ID including headers, body, and attachment metadata. Automatically marks the email as read. Pass folder_id from inbox listing for faster fetch.",
  inputSchema: {
    type: "object",
    properties: {
      message_id: { type: "string", description: "Zoho message ID" },
      folder_id: { type: "string", description: "Folder ID (optional, from inbox list — speeds up fetch)" },
    },
    required: ["message_id"],
  },
};

const Schema = z.object({
  message_id: z.string().min(1),
  folder_id: z.string().optional(),
});

export async function handler(args: unknown): Promise<string> {
  const params = Schema.parse(args);
  logToolCall("zoho_get_email", { message_id: params.message_id });

  try {
    const msg = await getMessage(params.message_id, params.folder_id);
    // Auto-mark as read when email is fetched
    await markRead([params.message_id], true).catch(() => {/* non-fatal */});
    return JSON.stringify({
      success: true,
      email: {
        id: msg.messageId,
        from: msg.fromAddress,
        to: msg.toAddress,
        cc: msg.ccAddress,
        bcc: msg.bccAddress,
        subject: msg.subject,
        date: msg.sentDateInGMT,
        threadId: msg.threadId,
        htmlBody: msg.htmlBody,
        textBody: msg.textBody,
        attachments:
          msg.attachments?.map((a) => ({
            id: a.attachmentId,
            name: a.attachmentName,
            size: a.attachmentSize,
            contentType: a.contentType,
          })) ?? [],
        headers: msg.headers ?? {},
      },
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: toUserMessage(e) });
  }
}
