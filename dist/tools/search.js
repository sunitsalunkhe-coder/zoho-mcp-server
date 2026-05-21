import { z } from "zod";
import { searchMessages } from "../zoho/mail-api.js";
import { toUserMessage } from "../utils/errors.js";
import { logToolCall } from "../utils/logger.js";
export const definition = {
    name: "zoho_search_emails",
    description: "Search emails in Zoho Mail using query parameters.",
    inputSchema: {
        type: "object",
        properties: {
            query: { type: "string", description: "Full-text search query" },
            folder: { type: "string", description: "Folder to search in" },
            from: { type: "string", description: "Filter by sender email" },
            to: { type: "string", description: "Filter by recipient email" },
            subject: { type: "string", description: "Filter by subject" },
            date_range: { type: "string", description: "Date range string e.g. 'after:2024-01-01 before:2024-12-31'" },
            has_attachment: { type: "boolean", description: "Only emails with attachments" },
            limit: { type: "number", description: "Max results (default 20)" },
        },
    },
};
const Schema = z.object({
    query: z.string().optional(),
    folder: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    subject: z.string().optional(),
    date_range: z.string().optional(),
    has_attachment: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(20),
});
export async function handler(args) {
    const params = Schema.parse(args);
    logToolCall("zoho_search_emails", params);
    try {
        const messages = await searchMessages({
            query: params.query,
            folder: params.folder,
            from: params.from,
            to: params.to,
            subject: params.subject,
            dateRange: params.date_range,
            hasAttachment: params.has_attachment,
            limit: params.limit,
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
                unread: m.isUnread,
                hasAttachment: m.hasAttachment,
                threadId: m.threadId,
            })),
        });
    }
    catch (e) {
        return JSON.stringify({ success: false, error: toUserMessage(e) });
    }
}
//# sourceMappingURL=search.js.map