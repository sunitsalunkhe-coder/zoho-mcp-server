import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { replyToMessage } from "../zoho/mail-api.js";
import { toUserMessage } from "../utils/errors.js";
import { logToolCall } from "../utils/logger.js";
export const definition = {
    name: "zoho_reply_email",
    description: "Reply to an email, maintaining the thread.",
    inputSchema: {
        type: "object",
        properties: {
            message_id: { type: "string", description: "Message ID to reply to" },
            folder_id: { type: "string", description: "Folder ID (optional, from inbox list — speeds up fetch)" },
            body_html: { type: "string", description: "HTML reply body" },
            reply_all: { type: "boolean", description: "Reply to all recipients (default false)" },
        },
        required: ["message_id", "body_html"],
    },
};
const Schema = z.object({
    message_id: z.string().min(1),
    folder_id: z.string().optional(),
    body_html: z.string().min(1),
    reply_all: z.boolean().default(false),
});
export async function handler(args) {
    const params = Schema.parse(args);
    logToolCall("zoho_reply_email", { message_id: params.message_id, reply_all: params.reply_all });
    const sanitized = sanitizeHtml(params.body_html);
    try {
        const messageId = await replyToMessage(params.message_id, sanitized, params.reply_all, params.folder_id);
        return JSON.stringify({ success: true, messageId });
    }
    catch (e) {
        return JSON.stringify({ success: false, error: toUserMessage(e) });
    }
}
//# sourceMappingURL=reply.js.map