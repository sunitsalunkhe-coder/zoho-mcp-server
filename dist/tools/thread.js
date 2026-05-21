import { z } from "zod";
import { getThread } from "../zoho/mail-api.js";
import { toUserMessage } from "../utils/errors.js";
import { logToolCall } from "../utils/logger.js";
export const definition = {
    name: "zoho_get_thread",
    description: "Get all messages in an email thread, sorted chronologically.",
    inputSchema: {
        type: "object",
        properties: {
            thread_id: { type: "string", description: "Zoho thread ID" },
        },
        required: ["thread_id"],
    },
};
const Schema = z.object({
    thread_id: z.string().min(1),
});
export async function handler(args) {
    const params = Schema.parse(args);
    logToolCall("zoho_get_thread", params);
    try {
        const messages = await getThread(params.thread_id);
        return JSON.stringify({
            success: true,
            threadId: params.thread_id,
            count: messages.length,
            messages: messages.map((m) => ({
                id: m.messageId,
                from: m.fromAddress,
                to: m.toAddress,
                subject: m.subject,
                date: m.sentDateInGMT,
                snippet: m.summary,
                unread: m.isUnread,
                hasAttachment: m.hasAttachment,
            })),
        });
    }
    catch (e) {
        return JSON.stringify({ success: false, error: toUserMessage(e) });
    }
}
//# sourceMappingURL=thread.js.map