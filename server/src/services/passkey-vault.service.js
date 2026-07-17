import { randomBytes } from 'crypto';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { ensureOwnerWalletRecord, getVaultRecord } from './wallet.service.js';

const CHALLENGE_TTL_SECONDS = 5 * 60;
const RECENT_UNLOCK_SECONDS = 2 * 60;

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function validBase64Url(value, minLength = 1, maxLength = 20_000) {
  return typeof value === 'string'
    && value.length >= minLength
    && value.length <= maxLength
    && /^[A-Za-z0-9_-]+$/.test(value);
}

async function saveChallenge(userId, purpose, challenge, metadata = {}) {
  const db = getDb();
  await db`delete from passkey_challenges where user_id = ${userId} and purpose = ${purpose} and (expires_at <= now() or consumed_at is null)`;
  const expiry = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString();
  await db`
    insert into passkey_challenges (user_id, challenge, purpose, metadata, expires_at)
    values (${userId}, ${challenge}, ${purpose}, ${db.json(metadata)}, ${expiry})`;
  return expiry;
}

async function pendingChallenge(userId, purpose) {
  const [challenge] = await getDb()`
    select * from passkey_challenges
    where user_id = ${userId} and purpose = ${purpose} and consumed_at is null and expires_at > now()
    order by created_at desc limit 1`;
  if (!challenge) throw new Error('This passkey request expired. Please try again.');
  return challenge;
}

async function consumeChallenge(id, metadata) {
  await getDb()`update passkey_challenges set consumed_at = now(), metadata = ${getDb().json(metadata)} where id = ${id} and consumed_at is null`;
}

function asTransports(value) {
  return Array.isArray(value) ? value.filter((transport) => typeof transport === 'string') : [];
}

// SimpleWebAuthn emits the PRF salts as Buffers. Express JSON would turn those
// into {type,data} objects, which the browser WebAuthn API does not accept.
function webauthnOptionsToJSON(options) {
  const prf = options.extensions?.prf;
  if (!prf?.eval) return options;
  return {
    ...options,
    extensions: {
      ...options.extensions,
      prf: {
        ...prf,
        eval: {
          ...prf.eval,
          first: base64Url(prf.eval.first),
          ...(prf.eval.second ? { second: base64Url(prf.eval.second) } : {}),
        },
      },
    },
  };
}

export async function createPasskeyRegistrationOptions(user) {
  const existing = await getVaultRecord(user.id);
  if (existing?.status === 'active' || existing?.passkey_credential_id) {
    throw new Error('A passkey vault already exists for this account');
  }
  const vaultSalt = base64Url(randomBytes(32));
  const options = await generateRegistrationOptions({
    rpName: config.passkeyRpName,
    rpID: config.passkeyRpId,
    userName: user.email,
    userDisplayName: user.name || user.email,
    userID: Buffer.from(user.id),
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
    // PRF support is mandatory because it is the only key-encryption material
    // available to the browser. The client explicitly blocks setup if absent.
    extensions: { prf: { eval: { first: Buffer.from(vaultSalt, 'base64url') } } },
  });
  const expiresAt = await saveChallenge(user.id, 'registration', options.challenge, { vaultSalt });
  return { options: webauthnOptionsToJSON(options), expiresAt, vaultSalt };
}

export async function verifyPasskeyRegistration(user, response) {
  const challenge = await pendingChallenge(user.id, 'registration');
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.passkeyOrigin,
      expectedRPID: config.passkeyRpId,
      requireUserVerification: true,
    });
  } catch (error) {
    throw new Error(`Passkey registration could not be verified: ${error.message}`);
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey registration was not verified');
  }

  const { registrationInfo } = verification;
  const credential = registrationInfo.credential;
  const vaultSalt = challenge.metadata?.vaultSalt;
  if (!validBase64Url(vaultSalt, 32, 100)) throw new Error('Passkey vault setup is invalid');

  const db = getDb();
  await db.begin(async (tx) => {
    const [wallet] = await tx`select status from wallets where user_id = ${user.id} for update`;
    if (wallet?.status === 'active') throw new Error('A passkey vault already exists for this account');
    await tx`
      insert into passkey_credentials (user_id, credential_id, public_key, counter, transports, device_type, backed_up)
      values (${user.id}, ${credential.id}, ${Buffer.from(credential.publicKey)}, ${credential.counter}, ${tx.json(asTransports(credential.transports))}, ${registrationInfo.credentialDeviceType}, ${registrationInfo.credentialBackedUp})
      on conflict (user_id) do update set credential_id = excluded.credential_id, public_key = excluded.public_key,
        counter = excluded.counter, transports = excluded.transports, device_type = excluded.device_type, backed_up = excluded.backed_up`;
    await tx`
      update wallets set custody_mode = 'passkey_vault', status = 'setup_required', vault_salt = ${vaultSalt},
        passkey_credential_id = ${credential.id}
      where user_id = ${user.id}`;
    await tx`update passkey_challenges set consumed_at = now(), metadata = ${tx.json({ ...challenge.metadata, verified: true })} where id = ${challenge.id} and consumed_at is null`;
    await tx`insert into audit_events (user_id, event_type, payload) values (${user.id}, 'passkey_registered', ${tx.json({ credentialDeviceType: registrationInfo.credentialDeviceType, backedUp: registrationInfo.credentialBackedUp })})`;
  });
  return { credentialId: credential.id, credentialDeviceType: registrationInfo.credentialDeviceType, backedUp: registrationInfo.credentialBackedUp };
}

export async function createPasskeyUnlockOptions(userId) {
  await ensureOwnerWalletRecord(userId);
  const [credential, wallet] = await Promise.all([
    getDb()`select credential_id, transports from passkey_credentials where user_id = ${userId}`.then(([row]) => row),
    getVaultRecord(userId),
  ]);
  if (!credential || !wallet?.vault_salt) throw new Error('Set up your passkey vault first');
  const options = await generateAuthenticationOptions({
    rpID: config.passkeyRpId,
    allowCredentials: [{ id: credential.credential_id, transports: asTransports(credential.transports) }],
    userVerification: 'required',
    extensions: { prf: { eval: { first: Buffer.from(wallet.vault_salt, 'base64url') } } },
  });
  const expiresAt = await saveChallenge(userId, 'unlock', options.challenge);
  return { options: webauthnOptionsToJSON(options), expiresAt };
}

export async function verifyPasskeyUnlock(userId, response) {
  const [challenge, credential, wallet] = await Promise.all([
    pendingChallenge(userId, 'unlock'),
    getDb()`select credential_id, public_key, counter, transports from passkey_credentials where user_id = ${userId}`.then(([row]) => row),
    getVaultRecord(userId),
  ]);
  if (!credential || !wallet?.vault_salt) throw new Error('Set up your passkey vault first');
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.passkeyOrigin,
      expectedRPID: config.passkeyRpId,
      requireUserVerification: true,
      credential: {
        id: credential.credential_id,
        publicKey: new Uint8Array(credential.public_key),
        counter: Number(credential.counter),
        transports: asTransports(credential.transports),
      },
    });
  } catch (error) {
    throw new Error(`Passkey unlock could not be verified: ${error.message}`);
  }
  if (!verification.verified || !verification.authenticationInfo?.userVerified) {
    throw new Error('Passkey unlock was not verified');
  }
  const info = verification.authenticationInfo;
  const verificationMetadata = { verified: true, verifiedAt: new Date().toISOString() };
  await getDb().begin(async (tx) => {
    await tx`
      update passkey_credentials set counter = ${info.newCounter}, last_used_at = now(),
        device_type = ${info.credentialDeviceType}, backed_up = ${info.credentialBackedUp}
      where user_id = ${userId} and credential_id = ${info.credentialID}`;
    await tx`update passkey_challenges set consumed_at = now(), metadata = ${tx.json(verificationMetadata)} where id = ${challenge.id} and consumed_at is null`;
    await tx`insert into audit_events (user_id, event_type, payload) values (${userId}, 'passkey_unlocked', ${tx.json({ credentialDeviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp })})`;
  });
  return {
    vault: wallet.status === 'active' ? {
      publicKey: wallet.public_key,
      ciphertext: wallet.vault_ciphertext,
      iv: wallet.vault_iv,
      salt: wallet.vault_salt,
      credentialId: wallet.passkey_credential_id,
    } : null,
    vaultSetupRequired: wallet.status !== 'active',
  };
}

async function requireRecentUnlock(userId) {
  const since = new Date(Date.now() - RECENT_UNLOCK_SECONDS * 1000).toISOString();
  const [proof] = await getDb()`
    select id from passkey_challenges
    where user_id = ${userId} and purpose = 'unlock' and consumed_at is not null
      and (metadata->>'verified') = 'true' and consumed_at > ${since}
    order by consumed_at desc limit 1`;
  if (!proof) throw new Error('Unlock your passkey vault again before continuing');
}

export async function provisionPasskeyVault(userId, payload) {
  await requireRecentUnlock(userId);
  const { publicKey, ciphertext, iv, credentialId } = payload || {};
  if (typeof publicKey !== 'string') throw new Error('A Stellar owner public key is required');
  try { StellarSdk.Keypair.fromPublicKey(publicKey); } catch { throw new Error('Invalid Stellar owner public key'); }
  if (!validBase64Url(ciphertext, 32) || !validBase64Url(iv, 12, 40) || typeof credentialId !== 'string') {
    throw new Error('Invalid encrypted vault payload');
  }

  const db = getDb();
  await db.begin(async (tx) => {
    const [wallet, credential] = await Promise.all([
      tx`select status, vault_salt from wallets where user_id = ${userId} for update`.then(([row]) => row),
      tx`select credential_id from passkey_credentials where user_id = ${userId}`.then(([row]) => row),
    ]);
    if (!wallet?.vault_salt || !credential || credential.credential_id !== credentialId) throw new Error('Passkey vault setup is invalid');
    if (wallet.status === 'active') throw new Error('A passkey vault already exists for this account');
    await tx`
      update wallets set public_key = ${publicKey}, vault_ciphertext = ${ciphertext}, vault_iv = ${iv},
        custody_mode = 'passkey_vault', status = 'active', provisioned_at = now()
      where user_id = ${userId}`;
    await tx`insert into audit_events (user_id, event_type, payload) values (${userId}, 'passkey_vault_provisioned', ${tx.json({ ownerPublicKey: publicKey })})`;
  });
  return { publicKey };
}
