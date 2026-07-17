import * as StellarSdk from '@stellar/stellar-sdk';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { encrypt, decrypt } from './crypto.service.js';

function encodedCiphertext(secretKey, googleSub) {
  const { encrypted, iv, authTag } = encrypt(secretKey, googleSub);
  return { encrypted: encrypted.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64') };
}

function keypairFromRecord(record, googleSub) {
  if (!record) throw new Error('Wallet not found for user');
  if (record.key_version !== config.encryptionKeyVersion) throw new Error('Wallet encryption key needs rotation before it can be used');
  const secretKey = decrypt(Buffer.from(record.encrypted_secret, 'base64'), Buffer.from(record.iv, 'base64'), Buffer.from(record.auth_tag, 'base64'), googleSub);
  return StellarSdk.Keypair.fromSecret(secretKey);
}

export async function createWalletsForUser(userId, googleSub) {
  const db = getDb();
  const owner = StellarSdk.Keypair.random();
  const agent = StellarSdk.Keypair.random();
  const ownerCiphertext = encodedCiphertext(owner.secret(), googleSub);
  const agentCiphertext = encodedCiphertext(agent.secret(), googleSub);
  await db.begin(async (tx) => {
    await tx`insert into wallets (user_id, public_key, encrypted_secret, iv, auth_tag, key_version) values (${userId}, ${owner.publicKey()}, ${ownerCiphertext.encrypted}, ${ownerCiphertext.iv}, ${ownerCiphertext.authTag}, ${config.encryptionKeyVersion})`;
    await tx`insert into agent_wallets (user_id, public_key, encrypted_secret, iv, auth_tag, key_version) values (${userId}, ${agent.publicKey()}, ${agentCiphertext.encrypted}, ${agentCiphertext.iv}, ${agentCiphertext.authTag}, ${config.encryptionKeyVersion})`;
  });
  return { publicKey: owner.publicKey(), agentPublicKey: agent.publicKey() };
}

export async function getWalletByUserId(userId) {
  const [wallet] = await getDb()`select public_key, created_at from wallets where user_id = ${userId}`;
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
    if (response.status === 400 && text.includes('createAccountAlreadyExist')) return { success: true, message: 'Account already funded', alreadyFunded: true };
    throw new Error(`Friendbot error: ${response.status}`);
  }
  const result = await response.json();
  return { success: true, message: 'Account funded with test XLM', txHash: result.hash, alreadyFunded: false };
}

export async function getOwnerKeypairForSigning(userId, googleSub) {
  const [wallet] = await getDb()`select encrypted_secret, iv, auth_tag, key_version from wallets where user_id = ${userId}`;
  return keypairFromRecord(wallet, googleSub);
}

export async function getAgentKeypairForSigning(userId, googleSub) {
  const [wallet] = await getDb()`select encrypted_secret, iv, auth_tag, key_version, status from agent_wallets where user_id = ${userId}`;
  if (wallet?.status !== 'active') throw new Error('Agent signing key is not active');
  return keypairFromRecord(wallet, googleSub);
}
