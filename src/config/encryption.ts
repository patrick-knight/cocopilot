/**
 * AES-256-GCM encryption utilities for CoCoPilot BYOK key storage.
 *
 * Uses Node.js crypto with scrypt key derivation to encrypt/decrypt
 * sensitive data (API keys) at rest.
 */

import * as crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, recommended for GCM
const SALT_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits for AES-256
const SCRYPT_COST = 16384; // N parameter
const SCRYPT_BLOCK_SIZE = 8; // r parameter
const SCRYPT_PARALLELISM = 1; // p parameter

/** Envelope format stored on disk. */
export interface EncryptedEnvelope {
  version: 1;
  iv: string; // hex
  salt: string; // hex
  authTag: string; // hex
  data: string; // hex
}

/**
 * Derive a 256-bit key from a password using scrypt.
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
  });
}

/**
 * Encrypt plaintext data with a password using AES-256-GCM.
 *
 * @param data - The plaintext string to encrypt.
 * @param password - The password used to derive the encryption key via scrypt.
 * @returns JSON string of the encrypted envelope.
 */
export function encrypt(data: string, password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(data, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const envelope: EncryptedEnvelope = {
    version: 1,
    iv: iv.toString("hex"),
    salt: salt.toString("hex"),
    authTag: authTag.toString("hex"),
    data: encrypted.toString("hex"),
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypt data previously encrypted with {@link encrypt}.
 *
 * @param envelopeJson - JSON string of the encrypted envelope.
 * @param password - The password used during encryption.
 * @returns The original plaintext string.
 * @throws If the password is wrong or the data has been tampered with.
 */
export function decrypt(envelopeJson: string, password: string): string {
  const envelope: EncryptedEnvelope = JSON.parse(envelopeJson);

  if (envelope.version !== 1) {
    throw new Error(`Unsupported encryption envelope version: ${envelope.version}`);
  }

  const salt = Buffer.from(envelope.salt, "hex");
  const iv = Buffer.from(envelope.iv, "hex");
  const authTag = Buffer.from(envelope.authTag, "hex");
  const encryptedData = Buffer.from(envelope.data, "hex");

  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
