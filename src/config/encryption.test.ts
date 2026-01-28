import { encrypt, decrypt } from "./encryption.js";
import type { EncryptedEnvelope } from "./encryption.js";

describe("encryption", () => {
  const password = "test-password-123";
  const plaintext = "Hello, CoCoPilot!";

  describe("encrypt", () => {
    it("should return a valid JSON envelope", () => {
      const result = encrypt(plaintext, password);
      const envelope: EncryptedEnvelope = JSON.parse(result);

      expect(envelope.version).toBe(1);
      expect(typeof envelope.iv).toBe("string");
      expect(typeof envelope.salt).toBe("string");
      expect(typeof envelope.authTag).toBe("string");
      expect(typeof envelope.data).toBe("string");
    });

    it("should produce different output for the same input (random IV/salt)", () => {
      const a = encrypt(plaintext, password);
      const b = encrypt(plaintext, password);

      expect(a).not.toBe(b);
    });

    it("should produce hex-encoded fields", () => {
      const result = encrypt(plaintext, password);
      const envelope: EncryptedEnvelope = JSON.parse(result);

      // All fields should be valid hex
      expect(envelope.iv).toMatch(/^[a-f0-9]+$/);
      expect(envelope.salt).toMatch(/^[a-f0-9]+$/);
      expect(envelope.authTag).toMatch(/^[a-f0-9]+$/);
      expect(envelope.data).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe("decrypt", () => {
    it("should recover the original plaintext", () => {
      const encrypted = encrypt(plaintext, password);
      const decrypted = decrypt(encrypted, password);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle empty strings", () => {
      const encrypted = encrypt("", password);
      const decrypted = decrypt(encrypted, password);

      expect(decrypted).toBe("");
    });

    it("should handle JSON data", () => {
      const data = JSON.stringify({ anthropic: "sk-ant-test123", openai: "sk-test456" });
      const encrypted = encrypt(data, password);
      const decrypted = decrypt(encrypted, password);

      expect(JSON.parse(decrypted)).toEqual({
        anthropic: "sk-ant-test123",
        openai: "sk-test456",
      });
    });

    it("should handle unicode content", () => {
      const unicode = "CoCoPilot 🍫 keys: café résumé";
      const encrypted = encrypt(unicode, password);
      const decrypted = decrypt(encrypted, password);

      expect(decrypted).toBe(unicode);
    });

    it("should throw with wrong password", () => {
      const encrypted = encrypt(plaintext, password);

      expect(() => decrypt(encrypted, "wrong-password")).toThrow();
    });

    it("should throw with tampered ciphertext", () => {
      const encrypted = encrypt(plaintext, password);
      const envelope: EncryptedEnvelope = JSON.parse(encrypted);

      // Flip a byte in the encrypted data
      const tampered = envelope.data.slice(0, -2) + "ff";
      envelope.data = tampered;

      expect(() => decrypt(JSON.stringify(envelope), password)).toThrow();
    });

    it("should throw with tampered authTag", () => {
      const encrypted = encrypt(plaintext, password);
      const envelope: EncryptedEnvelope = JSON.parse(encrypted);

      envelope.authTag = "0".repeat(envelope.authTag.length);

      expect(() => decrypt(JSON.stringify(envelope), password)).toThrow();
    });

    it("should throw for unsupported version", () => {
      const encrypted = encrypt(plaintext, password);
      const envelope = JSON.parse(encrypted);
      envelope.version = 99;

      expect(() => decrypt(JSON.stringify(envelope), password)).toThrow(
        /Unsupported encryption envelope version/,
      );
    });
  });

  describe("round-trip", () => {
    it("should work with long data", () => {
      const longData = "x".repeat(100_000);
      const encrypted = encrypt(longData, password);
      const decrypted = decrypt(encrypted, password);

      expect(decrypted).toBe(longData);
    });

    it("should work with different passwords", () => {
      const passwords = ["short", "a-longer-password-here!", "p@$$w0rd!#%"];

      for (const pw of passwords) {
        const encrypted = encrypt(plaintext, pw);
        const decrypted = decrypt(encrypted, pw);
        expect(decrypted).toBe(plaintext);
      }
    });
  });
});
