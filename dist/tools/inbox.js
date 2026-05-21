import { z } from "zod";
import { listMessages, getFolderIdByName } from "../zoho/mail-api.js";
import { toUserMessage } from "../utils/errors.js";
import { logToolCall } from "../utils/logger.js";
export const definition = {
    name: "zoho_list_inbox",
    description: "List inbox emails. Returns array of email summaries.",
    inputSchema: {
        type: "object",
        properties: {
            limit: { type: "number", description: "Max emails to return (default 20, max 100)" },
            unread_only: { type: "boolean", description: "Return only unread emails" },
            from_date: { type: "string", description: "Filter from date (YYYY-MM-DD)" },
        },
    },
};
const Schema = z.object({
    limit: z.number().int().min(1).max(100).default(20),
    unread_only: z.boolean().optional(),
    from_date: z.string().optional(),
});
export async function handler(args) {
    const params = Schema.parse(args);
    logToolCall("zoho_list_inbox", params);
    try {
        const folderId = await getFolderIdByName("INBOX");
        const messages = await listMessages({
            folderId: folderId ?? undefined,
            limit: params.limit,
            unreadOnly: params.unread_only,
            fromDate: params.from_date,
        });
        return JSON.stringify({
            success: true,
            count: messages.length,
            emails: messages.map((m) => ({
                id: m.messageId,
                from: m.fromAddress,
                subject: m.subject,
                snippet: m.summary,
                date: m.sentDateInGMT,
                unread: m.status === "0" || m.isUnread === true || m.isUnread === "true",
                hasAttachment: m.hasAttachment,
                threadId: m.threadId,
            })),
        });
    }
    catch (e) {
        return JSON.stringify({ success: false, error: toUserMessage(e) });
    }
}
//# sourceMappingURL=inbox.js.map