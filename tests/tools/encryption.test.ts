import { describe, it, expect, beforeAll } from "vitest";

// Set up key before importing encryption
beforeAll(() => {
  process.env["TOKEN_ENCRYPTION_KEY"] = "a".repeat(64);
});

describe("encryption", () => {
  it("encrypts and decrypts round-trip", async () => {
    const { encrypt, decrypt } = await import("../../src/utils/encryption.js");
    const plaintext = JSON.stringify({ accessToken: "tok123", refreshToken: "ref456" });
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext each time (random IV)", async () => {
    const { encrypt } = await import("../../src/utils/encryption.js");
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
  });
});
