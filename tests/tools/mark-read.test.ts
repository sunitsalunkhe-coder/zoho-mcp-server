import { describe, it, expect, vi } from "vitest";
import { handler } from "../../src/tools/mark-read.js";

vi.mock("../../src/zoho/mail-api.js", () => ({
  markRead: vi.fn().mockResolvedValue(undefined),
}));

describe("zoho_mark_read", () => {
  it("marks messages as read", async () => {
    const result = JSON.parse(await handler({ message_ids: ["1", "2"], read: true }));
    expect(result.success).toBe(true);
    expect(result.status).toBe("marked_read");
    expect(result.updated).toBe(2);
  });

  it("marks messages as unread", async () => {
    const result = JSON.parse(await handler({ message_ids: ["1"], read: false }));
    expect(result.success).toBe(true);
    expect(result.status).toBe("marked_unread");
  });

  it("rejects empty message_ids", async () => {
    await expect(handler({ message_ids: [], read: true })).rejects.toThrow();
  });
});
