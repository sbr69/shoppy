import * as StellarSdk from '@stellar/stellar-sdk';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { encrypt, decrypt } from './crypto.service.js';

function encodedCiphertext(secretKey, keyScope) {
  const { encrypted, iv, authTag } = encrypt(secretKey, keyScope);
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function agentScope(googleSub) {
  return `agent-signer:${googleSub}`;
}

/**
 * Create the only key the backend may hold: a separate, constrained agent
 * signer. It cannot move owner account funds directly; SpendGuard additionally
 * requires a fresh owner authorization for every purchase.
 */
export async function ensureAgentWalletForUser(userId, googleSub) {
  const db = getDb();
  const [existing] = await db`select public_key from agent_wallets where user_id = ${userId}`;
  if (existing) return { agentPublicKey: existing.public_key };

  const agent = StellarSdk.Keypair.random();
  const ciphertext = encodedCiphertext(agent.secret(), agentScope(googleSub));
  await db`
    insert into agent_wallets (user_id, public_key, encrypted_secret, iv, auth_tag, key_version)
    values (${userId}, ${agent.publicKey()}, ${ciphertext.encrypted}, ${ciphertext.iv}, ${ciphertext.authTag}, ${config.encryptionKeyVersion})`;
  return { agentPublicKey: agent.publicKey() };
}

/** Ensure that an account has a passkey-vault wallet placeholder, never a secret. */
export async function ensureOwnerWalletRecord(userId) {
  const db = getDb();
  const [existing] = await db`select id, public_key, status from wallets where user_id = ${userId}`;
  if (existing) return existing;
  const [wallet] = await db`
    insert into wallets (user_id, custody_mode, status)
    values (${userId}, 'passkey_vault', 'setup_required')
    returning id, public_key, status`;
  return wallet;
}

/** Create the user-visible custodial wallet only when none exists. */
export async function ensureCustodialWalletForUser(userId, googleSub) {
  const db = getDb();
  const [existing] = await db`select public_key, encrypted_secret, status from wallets where user_id = ${userId}`;
  if (existing?.public_key && existing.encrypted_secret && existing.status === 'active') return { publicKey: existing.public_key };
  const owner = StellarSdk.Keypair.random();
  const ciphertext = encodedCiphertext(owner.secret(), `owner-wallet:${googleSub}`);
  const [wallet] = await db`
    insert into wallets (user_id, public_key, encrypted_secret, iv, auth_tag, key_version, custody_mode, status, provisioned_at)
    values (${userId}, ${owner.publicKey()}, ${ciphertext.encrypted}, ${ciphertext.iv}, ${ciphertext.authTag}, ${config.encryptionKeyVersion}, 'server_custody', 'active', now())
    on conflict (user_id) do update set public_key = excluded.public_key, encrypted_secret = excluded.encrypted_secret,
      iv = excluded.iv, auth_tag = excluded.auth_tag, key_version = excluded.key_version, custody_mode = 'server_custody',
      status = 'active', provisioned_at = now()
    returning public_key`;
  return { publicKey: wallet.public_key };
}

export async function getWalletByUserId(userId) {
  const [wallet] = await getDb()`
    select public_key, status, custody_mode, passkey_credential_id, provisioned_at, created_at
    from wallets where user_id = ${userId}`;
  return wallet;
}

export async function getVaultRecord(userId) {
  const [wallet] = await getDb()`
    select public_key, status, custody_mode, vault_ciphertext, vault_iv, vault_salt,
           passkey_credential_id, provisioned_at
    from wallets where user_id = ${userId}`;
  return wallet;
}

export async function getAgentWalletByUserId(userId) {
  const [wallet] = await getDb()`select public_key, status, created_at from agent_wallets where user_id = ${userId}`;
  return wallet;
}

export async function getWalletBalance(publicKey) {
  try {
    const account = await new StellarSdk.Horizon.Server(config.horizonUrl).loadAccount(publicKey);
    const nativeBalance = account.balances.find((balance) => balance.asset_type === 'native');
    return { balance: nativeBalance ? nativeBalance.balance : '0', funded: true };
  } catch (error) {
    if (error?.response?.status === 404) return { balance: '0', funded: false };
    throw error;
  }
}

export async function fundWalletWithFriendbot(publicKey) {
  if (config.stellarNetwork !== 'testnet') throw new Error('Friendbot is disabled outside Stellar testnet');
  const response = await fetch(`${config.friendbotUrl}?addr=${publicKey}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 400 && text.includes('createAccountAlreadyExist')) {
      return { success: true, message: 'Account already funded', alreadyFunded: true };
    }
    throw new Error(`Friendbot error: ${response.status}`);
  }
  const result = await response.json();
  return { success: true, message: 'Account funded with test XLM', txHash: result.hash, alreadyFunded: false };
}

/** The agent needs a small testnet account balance to submit Soroban fees. */
export async function fundAgentWalletWithFriendbot(userId) {
  const agent = await getAgentWalletByUserId(userId);
  if (!agent) throw new Error('Agent signer is not configured');
  return fundWalletWithFriendbot(agent.public_key);
}

export async function getAgentKeypairForSigning(userId, googleSub) {
  const [wallet] = await getDb()`
    select encrypted_secret, iv, auth_tag, key_version, status from agent_wallets where user_id = ${userId}`;
  if (!wallet || wallet.status !== 'active') throw new Error('Agent signing key is not active');
  if (wallet.key_version !== config.encryptionKeyVersion) throw new Error('Agent signing key requires rotation before use');
  const secretKey = decrypt(
    Buffer.from(wallet.encrypted_secret, 'base64'),
    Buffer.from(wallet.iv, 'base64'),
    Buffer.from(wallet.auth_tag, 'base64'),
    agentScope(googleSub),
  );
  return StellarSdk.Keypair.fromSecret(secretKey);
}

export async function getOwnerKeypairForSigning(userId, googleSub) {
  const [wallet] = await getDb()`select encrypted_secret, iv, auth_tag, key_version, status from wallets where user_id = ${userId}`;
  if (!wallet?.encrypted_secret || wallet.status !== 'active') throw new Error('Custodial wallet is not active');
  if (wallet.key_version !== config.encryptionKeyVersion) throw new Error('Custodial wallet key requires rotation before use');
  const secretKey = decrypt(Buffer.from(wallet.encrypted_secret, 'base64'), Buffer.from(wallet.iv, 'base64'), Buffer.from(wallet.auth_tag, 'base64'), `owner-wallet:${googleSub}`);
  return StellarSdk.Keypair.fromSecret(secretKey);
}
