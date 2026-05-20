import { z } from "zod";
import { applyLabel } from "../zoho/mail-api.js";
import { toUserMessage } from "../utils/errors.js";
import { logToolCall } from "../utils/logger.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const definition: Tool = {
  name: "zoho_apply_label",
  description: "Apply a label to one or more emails. Creates the label if it does not exist.",
  inputSchema: {
    type: "object",
    properties: {
      message_ids: { type: "array", items: { type: "string" } },
      label_name: { type: "string", description: "Label/folder name to apply" },
    },
    required: ["message_ids", "label_name"],
  },
};

const Schema = z.object({
  message_ids: z.array(z.string().min(1)).min(1).max(50),
  label_name: z.string().min(1).max(100),
});

export async function handler(args: unknown): Promise<string> {
  const params = Schema.parse(args);
  logToolCall("zoho_apply_label", params);

  try {
    await applyLabel(params.message_ids, params.label_name);
    return JSON.stringify({
      success: true,
      updated: params.message_ids.length,
      label: params.label_name,
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: toUserMessage(e) });
  }
}
