import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import config from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits

/**
 * Derive a scoped backend key from the master secret. This must only be used
 * for backend-owned, constrained agent signers; never for an owner wallet.
 */
function deriveKey(googleSub) {
  return createHmac('sha256', config.masterSecret)
    .update(googleSub)
    .digest(); // 32 bytes = 256 bits
}

/**
 * Encrypt a Stellar secret key.
 * Returns { encrypted, iv, authTag } as Buffers.
 */
export function encrypt(plaintext, keyScope) {
  const key = deriveKey(keyScope);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv,
    authTag,
  };
}

/**
 * Decrypt a Stellar secret key.
 * Returns the plaintext string.
 */
export function decrypt(encryptedData, iv, authTag, keyScope) {
  const key = deriveKey(keyScope);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}
