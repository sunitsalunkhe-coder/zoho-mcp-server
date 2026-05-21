import { z } from "zod";
import { moveToSpam } from "../zoho/mail-api.js";
import { toUserMessage } from "../utils/errors.js";
import { logToolCall } from "../utils/logger.js";
export const definition = {
    name: "zoho_mark_spam",
    description: "Move one or more emails to the Spam/Junk folder.",
    inputSchema: {
        type: "object",
        properties: {
            message_ids: {
                type: "array",
                items: { type: "string" },
                description: "Message IDs to mark as spam",
            },
        },
        required: ["message_ids"],
    },
};
const Schema = z.object({
    message_ids: z.array(z.string().min(1)).min(1).max(50),
});
export async function handler(args) {
    const params = Schema.parse(args);
    logToolCall("zoho_mark_spam", params);
    try {
        await moveToSpam(params.message_ids);
        return JSON.stringify({
            success: true,
            moved_to_spam: params.message_ids.length,
        });
    }
    catch (e) {
        return JSON.stringify({ success: false, error: toUserMessage(e) });
    }
}
//# sourceMappingURL=spam.js.map