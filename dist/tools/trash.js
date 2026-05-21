import { z } from "zod";
import { moveToTrash } from "../zoho/mail-api.js";
import { toUserMessage } from "../utils/errors.js";
import { logToolCall } from "../utils/logger.js";
export const definition = {
    name: "zoho_trash_email",
    description: "Move one or more emails to the Trash folder.",
    inputSchema: {
        type: "object",
        properties: {
            message_ids: {
                type: "array",
                items: { type: "string" },
                description: "Message IDs to move to trash",
            },
        },
        required: ["message_ids"],
    },
};
const Schema = z.object({
    message_ids: z.array(z.string().min(1)).min(1).max(20),
});
export async function handler(args) {
    const params = Schema.parse(args);
    logToolCall("zoho_trash_email", params);
    try {
        await moveToTrash(params.message_ids);
        return JSON.stringify({
            success: true,
            moved_to_trash: params.message_ids.length,
        });
    }
    catch (e) {
        return JSON.stringify({ success: false, error: toUserMessage(e) });
    }
}
//# sourceMappingURL=trash.js.map