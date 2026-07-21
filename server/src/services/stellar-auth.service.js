import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import * as StellarSdk from '@stellar/stellar-sdk';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { ensureAgentWalletForUser, ensureCustodialWalletForUser } from './wallet.service.js';
import { autoConnectTestMarketForNewUser } from './site-oauth.service.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Keep challenge signing cryptographically separate from application sessions
// without adding another deploy-time secret to manage.
const challengeSecret = crypto.createHmac('sha256', config.jwtSecret)
  .update('jarvispayz:stellar-login-challenge:v1')
  .digest();

function assertPublicKey(publicKey) {
  if (typeof publicKey !== 'string' || publicKey.length > 56) throw new Error('Invalid Stellar public key');
  try { StellarSdk.Keypair.fromPublicKey(publicKey); } catch { throw new Error('Invalid Stellar public key'); }
  return publicKey;
}

function signedMessageHash(challenge) {
  return crypto.createHash('sha256').update(`Stellar Signed Message:\n${challenge}`).digest();
}

function issueSession(user) {
  return jwt.sign({
    userId: user.id,
    email: user.email,
    name: user.name,
    googleSub: user.google_sub || null,
    walletScope: user.wallet_scope,
  }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function publicWalletName(publicKey) {
  return `Stellar wallet ${publicKey.slice(0, 5)}…${publicKey.slice(-4)}`;
}

export async function createStellarChallenge(publicKey, { purpose = 'login', userId = null } = {}) {
  const verifiedKey = assertPublicKey(publicKey);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  const db = getDb();
  await db.begin(async (tx) => {
    await tx`delete from stellar_login_challenges where expires_at <= now()`;
    await tx`insert into stellar_login_challenges (id, public_key, purpose, user_id, expires_at) values (${id}, ${verifiedKey}, ${purpose}, ${userId}, ${expiresAt})`;
  });
  return jwt.sign({ type: 'stellar_wallet_login', publicKey: verifiedKey, purpose }, challengeSecret, { expiresIn: '5m', jwtid: id, audience: 'jarvispayz-wallet-login' });
}

async function consumeVerifiedChallenge({ publicKey, challenge, signature, purpose, userId = null }) {
  const verifiedKey = assertPublicKey(publicKey);
  if (typeof challenge !== 'string' || challenge.length > 2000 || typeof signature !== 'string' || signature.length > 1024) throw new Error('Wallet signature is required');
  let claims;
  try { claims = jwt.verify(challenge, challengeSecret, { audience: 'jarvispayz-wallet-login' }); } catch { throw new Error('Wallet sign-in challenge is invalid or expired'); }
  if (claims.type !== 'stellar_wallet_login' || claims.publicKey !== verifiedKey || claims.purpose !== purpose || !claims.jti) throw new Error('Wallet sign-in challenge is invalid');
  let signatureBuffer;
  try { signatureBuffer = Buffer.from(signature, 'base64'); } catch { throw new Error('Invalid wallet signature'); }
  if (signatureBuffer.length === 0 || !StellarSdk.Keypair.fromPublicKey(verifiedKey).verify(signedMessageHash(challenge), signatureBuffer)) throw new Error('Invalid wallet signature');
  const db = getDb();
  const [consumed] = await db`
    delete from stellar_login_challenges
    where id = ${claims.jti} and public_key = ${verifiedKey} and purpose = ${purpose}
      and expires_at > now() and (${userId}::uuid is null or user_id = ${userId})
    returning id`;
  if (!consumed) throw new Error('Wallet sign-in challenge has expired or was already used');
  return verifiedKey;
}

export async function loginWithStellarWallet({ publicKey, challenge, signature }) {
  const verifiedKey = await consumeVerifiedChallenge({ publicKey, challenge, signature, purpose: 'login' });
  const db = getDb();
  const [identity] = await db`
    select u.* from stellar_identities i join users u on u.id = i.user_id
    where i.public_key = ${verifiedKey}`;
  let user = identity;
  if (!user) {
    const walletScope = crypto.randomUUID();
    const email = `stellar-${verifiedKey.toLowerCase()}@identity.jarvispayz.invalid`;
    const [created] = await db`
      insert into users (google_sub, email, name, wallet_scope)
      values (null, ${email}, ${publicWalletName(verifiedKey)}, ${walletScope}) returning *`;
    try {
      await Promise.all([
        ensureCustodialWalletForUser(created.id, walletScope),
        ensureAgentWalletForUser(created.id, walletScope),
      ]);
      await autoConnectTestMarketForNewUser(created.id, walletScope);
      await db`insert into stellar_identities (user_id, public_key) values (${created.id}, ${verifiedKey})`;
    } catch (error) {
      await db`delete from users where id = ${created.id}`;
      throw error;
    }
    user = created;
  } else {
    await Promise.all([
      ensureCustodialWalletForUser(user.id, user.wallet_scope),
      ensureAgentWalletForUser(user.id, user.wallet_scope),
    ]);
  }
  return { token: issueSession(user), user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url || null, authMethod: 'stellar' } };
}

export async function linkStellarWallet({ userId, publicKey, challenge, signature }) {
  const verifiedKey = await consumeVerifiedChallenge({ publicKey, challenge, signature, purpose: 'link', userId });
  const db = getDb();
  const [existing] = await db`select user_id from stellar_identities where public_key = ${verifiedKey}`;
  if (existing && existing.user_id !== userId) {
    const error = new Error('This Stellar wallet is already linked to another JarvisPayz account');
    error.status = 409;
    throw error;
  }
  if (!existing) await db`insert into stellar_identities (user_id, public_key) values (${userId}, ${verifiedKey})`;
  return { publicKey: verifiedKey };
}

export async function listStellarWalletIdentities(userId) {
  return getDb()`select public_key, created_at from stellar_identities where user_id = ${userId} order by created_at asc`;
}
