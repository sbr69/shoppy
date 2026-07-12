import * as StellarSdk from '@stellar/stellar-sdk';
import { v4 as uuidv4 } from 'uuid';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { encrypt, decrypt } from './crypto.service.js';

/**
 * Generate a new Stellar keypair, encrypt the secret, and store in DB.
 */
export async function createWalletForUser(userId, googleSub) {
  const keypair = StellarSdk.Keypair.random();
  const publicKey = keypair.publicKey();
  const secretKey = keypair.secret();

  // Encrypt the secret key
  const { encrypted, iv, authTag } = encrypt(secretKey, googleSub);

  const db = getDb();
  const walletId = uuidv4();

  db.prepare(
    'INSERT INTO wallets (id, user_id, public_key, encrypted_secret, iv, auth_tag) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(walletId, userId, publicKey, encrypted, iv, authTag);

  console.log(`🔑 Wallet created for user ${userId}: ${publicKey}`);

  return { publicKey };
}

/**
 * Get a user's wallet public key.
 */
export function getWalletByUserId(userId) {
  const db = getDb();
  return db.prepare('SELECT public_key, created_at FROM wallets WHERE user_id = ?').get(userId);
}

/**
 * Get wallet balance from the Stellar Horizon testnet.
 */
export async function getWalletBalance(publicKey) {
  try {
    const server = new StellarSdk.Horizon.Server(config.horizonUrl);
    const account = await server.loadAccount(publicKey);

    const nativeBalance = account.balances.find(b => b.asset_type === 'native');
    return {
      balance: nativeBalance ? nativeBalance.balance : '0',
      funded: true,
    };
  } catch (err) {
    // Account not found on the network (not funded yet)
    if (err?.response?.status === 404) {
      return { balance: '0', funded: false };
    }
    throw err;
  }
}

/**
 * Fund a wallet using Stellar Friendbot (testnet only).
 */
export async function fundWalletWithFriendbot(publicKey) {
  const response = await fetch(`${config.friendbotUrl}?addr=${publicKey}`);

  if (!response.ok) {
    const text = await response.text();
    // Friendbot returns 400 if already funded
    if (response.status === 400 && text.includes('createAccountAlreadyExist')) {
      return { success: true, message: 'Account already funded', alreadyFunded: true };
    }
    throw new Error(`Friendbot error: ${response.status} — ${text}`);
  }

  const result = await response.json();
  return {
    success: true,
    message: 'Account funded with 10,000 XLM',
    txHash: result.hash,
    alreadyFunded: false,
  };
}

/**
 * Decrypt and return the Stellar keypair for signing transactions.
 * WARNING: The returned secret key must be used immediately and never stored/logged.
 */
export function getKeypairForSigning(userId, googleSub) {
  const db = getDb();
  const wallet = db.prepare(
    'SELECT encrypted_secret, iv, auth_tag FROM wallets WHERE user_id = ?'
  ).get(userId);

  if (!wallet) {
    throw new Error('Wallet not found for user');
  }

  const secretKey = decrypt(wallet.encrypted_secret, wallet.iv, wallet.auth_tag, googleSub);
  return StellarSdk.Keypair.fromSecret(secretKey);
}
