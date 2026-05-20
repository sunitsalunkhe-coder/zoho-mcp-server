import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { createDraft } from "../zoho/mail-api.js";
import { getFromEmail } from "../zoho/client.js";
import { toUserMessage, ZohoValidationError } from "../utils/errors.js";
import { loadTokens } from "../auth/token-store.js";
import { logToolCall } from "../utils/logger.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const definition: Tool = {
  name: "zoho_create_draft",
  description: "Save an email as a draft in Zoho Mail. Returns draft ID.",
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "array", items: { type: "string" } },
      cc: { type: "array", items: { type: "string" } },
      bcc: { type: "array", items: { type: "string" } },
      subject: { type: "string" },
      body_html: { type: "string" },
      body_text: { type: "string" },
    },
    required: ["to", "subject", "body_html"],
  },
};

const Schema = z.object({
  to: z.array(z.string().email()),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1).max(1000),
  body_html: z.string().min(1),
  body_text: z.string().optional(),
});

export async function handler(args: unknown): Promise<string> {
  const params = Schema.parse(args);
  logToolCall("zoho_create_draft", params);

  if (!loadTokens()) throw new ZohoValidationError("Not authenticated. Run: npm run auth");

  const sanitized = sanitizeHtml(params.body_html);

  try {
    const fromAddress = await getFromEmail();
    const draftId = await createDraft({
      fromAddress,
      toAddress: params.to.join(","),
      ccAddress: params.cc?.join(","),
      bccAddress: params.bcc?.join(","),
      subject: params.subject,
      content: sanitized,
      mailFormat: "html",
      isDraft: "true",
    });
    return JSON.stringify({ success: true, draftId });
  } catch (e) {
    return JSON.stringify({ success: false, error: toUserMessage(e) });
  }
}
