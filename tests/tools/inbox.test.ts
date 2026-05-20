import { describe, it, expect, vi } from "vitest";
import { handler } from "../../src/tools/inbox.js";

vi.mock("../../src/zoho/mail-api.js", () => ({
  listMessages: vi.fn().mockResolvedValue([
    {
      messageId: "1",
      subject: "Test",
      fromAddress: "a@b.com",
      toAddress: "me@binnys.in",
      sentDateInGMT: "1700000000000",
      folderId: "INBOX",
      summary: "preview",
      isUnread: true,
      hasAttachment: false,
      threadId: "thread1",
    },
  ]),
  getFolderIdByName: vi.fn().mockResolvedValue("inbox_id"),
}));

describe("zoho_list_inbox", () => {
  it("returns email summaries", async () => {
    const result = JSON.parse(await handler({ limit: 10 }));
    expect(result.success).toBe(true);
    expect(result.emails).toHaveLength(1);
    expect(result.emails[0].id).toBe("1");
  });

  it("applies default limit", async () => {
    const result = JSON.parse(await handler({}));
    expect(result.success).toBe(true);
  });

  it("rejects limit > 100", async () => {
    await expect(handler({ limit: 101 })).rejects.toThrow();
  });
});
