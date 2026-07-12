import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import config from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits

/**
 * Derive a per-user encryption key from the master secret + user's Google sub ID.
 * This means each user's private key is encrypted with a unique derived key.
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
export function encrypt(plaintext, googleSub) {
  const key = deriveKey(googleSub);
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
export function decrypt(encryptedData, iv, authTag, googleSub) {
  const key = deriveKey(googleSub);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}
