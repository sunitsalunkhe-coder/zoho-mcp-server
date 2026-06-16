import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { sendEmail } from "../zoho/mail-api.js";
import { getFromEmail } from "../zoho/client.js";
import { loadTokens } from "../auth/token-store.js";
import { toUserMessage, ZohoValidationError } from "../utils/errors.js";
import { logToolCall } from "../utils/logger.js";
export const definition = {
    name: "zoho_send_email",
    description: "Send an email via Zoho Mail (India DC). Returns message ID.",
    inputSchema: {
        type: "object",
        properties: {
            to: { type: "array", items: { type: "string" }, description: "Recipient email addresses" },
            cc: { type: "array", items: { type: "string" }, description: "CC recipients" },
            bcc: { type: "array", items: { type: "string" }, description: "BCC recipients" },
            subject: { type: "string", description: "Email subject" },
            body_html: { type: "string", description: "HTML email body" },
            body_text: { type: "string", description: "Plain text fallback" },
            attachments: {
                type: "array",
                description: "File attachments (base64-encoded)",
                items: {
                    type: "object",
                    properties: {
                        filename: { type: "string", description: "File name with extension" },
                        content_base64: { type: "string", description: "Base64-encoded file content" },
                        mime_type: { type: "string", description: "MIME type e.g. application/pdf" },
                    },
                    required: ["filename", "content_base64", "mime_type"],
                },
            },
        },
        required: ["to", "subject", "body_html"],
    },
};
const AttachmentSchema = z.object({
    filename: z.string().min(1),
    content_base64: z.string().min(1),
    mime_type: z.string().min(1),
});
const Schema = z.object({
    to: z.array(z.string().email()),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    subject: z.string().min(1).max(1000),
    body_html: z.string().min(1),
    body_text: z.string().optional(),
    attachments: z.array(AttachmentSchema).optional(),
});
export async function handler(args) {
    const params = Schema.parse(args);
    logToolCall("zoho_send_email", { ...params, body_html: "[REDACTED]" });
    const tokens = loadTokens();
    if (!tokens)
        throw new ZohoValidationError("Not authenticated. Run: npm run auth");
    const sanitized = sanitizeHtml(params.body_html, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "h3"]),
        allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, "*": ["style"] },
    });
    try {
        const fromAddress = await getFromEmail();
        const messageId = await sendEmail({
            fromAddress,
            toAddress: params.to.join(","),
            ccAddress: params.cc?.join(","),
            bccAddress: params.bcc?.join(","),
            subject: params.subject,
            content: sanitized,
            mailFormat: "html",
            attachments: params.attachments,
        });
        return JSON.stringify({ success: true, messageId });
    }
    catch (e) {
        return JSON.stringify({ success: false, error: toUserMessage(e) });
    }
}
//# sourceMappingURL=send.js.map