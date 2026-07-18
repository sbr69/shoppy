import getDb from '../db/database.js';
import { decrypt, encrypt } from './crypto.service.js';

const REQUIRED = ['fullName', 'phone', 'line1', 'city', 'state', 'postalCode', 'country'];
const scope = (userId) => `profile:${userId}`;

function clean(input = {}) {
  const output = {};
  for (const key of REQUIRED) {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (value.length > 160) throw new Error(`${key} is too long`);
    output[key] = value;
  }
  return output;
}

export async function getProfile(userId) {
  const [record] = await getDb()`select encrypted_payload, iv, auth_tag, updated_at from user_profiles where user_id = ${userId}`;
  if (!record) return { profile: {}, missing: REQUIRED };
  const profile = JSON.parse(decrypt(Buffer.from(record.encrypted_payload, 'base64'), Buffer.from(record.iv, 'base64'), Buffer.from(record.auth_tag, 'base64'), scope(userId)));
  return { profile, missing: REQUIRED.filter((key) => !profile[key]), updatedAt: record.updated_at };
}

export async function saveProfile(userId, input) {
  const profile = clean(input);
  const sealed = encrypt(JSON.stringify(profile), scope(userId));
  await getDb()`insert into user_profiles (user_id, encrypted_payload, iv, auth_tag) values (${userId}, ${sealed.encrypted.toString('base64')}, ${sealed.iv.toString('base64')}, ${sealed.authTag.toString('base64')}) on conflict (user_id) do update set encrypted_payload = excluded.encrypted_payload, iv = excluded.iv, auth_tag = excluded.auth_tag, updated_at = now()`;
  return { profile, missing: REQUIRED.filter((key) => !profile[key]) };
}

export function deliveryAddress(profile) { return [profile.fullName, profile.line1, profile.city, profile.state, profile.postalCode, profile.country].filter(Boolean).join(', '); }
