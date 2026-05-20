import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "../../src/tools/send.js";

vi.mock("../../src/zoho/mail-api.js", () => ({
  sendEmail: vi.fn().mockResolvedValue("MSG_001"),
}));
vi.mock("../../src/auth/token-store.js", () => ({
  loadTokens: vi.fn().mockReturnValue({
    accessToken: "tok",
    refreshToken: "ref",
    expiresAt: Date.now() + 3_600_000,
    accountId: "ACCT_001",
  }),
  saveTokens: vi.fn(),
  isTokenExpired: vi.fn().mockReturnValue(false),
}));

describe("zoho_send_email", () => {
  it("sends email and returns messageId", async () => {
    const result = JSON.parse(
      await handler({ to: ["test@example.com"], subject: "Hello", body_html: "<p>Hi</p>" }),
    );
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("MSG_001");
  });

  it("rejects invalid email address", async () => {
    await expect(
      handler({ to: ["not-an-email"], subject: "Hello", body_html: "<p>Hi</p>" }),
    ).rejects.toThrow();
  });

  it("rejects missing required fields", async () => {
    await expect(handler({ to: ["a@b.com"] })).rejects.toThrow();
  });
});
