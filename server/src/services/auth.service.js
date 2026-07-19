import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { ensureAgentWalletForUser, ensureCustodialWalletForUser } from './wallet.service.js';

function issueSession(user) {
  return jwt.sign({
    userId: user.id,
    email: user.email,
    name: user.name,
    googleSub: user.google_sub || null,
    walletScope: user.wallet_scope || user.google_sub,
  }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/**
 * Verify a Google ID token and return the payload.
 */
async function verifyGoogleToken(idToken) {
  if (!config.googleClientId || config.googleClientId === 'YOUR_GOOGLE_CLIENT_ID') {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }
  try {
    const client = new OAuth2Client(config.googleClientId);
    const ticket = await client.verifyIdToken({ idToken, audience: config.googleClientId });
    const payload = ticket.getPayload();
    if (!payload) throw new Error('Google returned an empty token payload');
    return payload;
  } catch (err) {
    // Some local/firewalled environments block Google's certificate CDN while
    // allowing the OAuth API. Google tokeninfo validates the signature at
    // Google's side, so it is safe as a fallback; we still validate claims
    // locally and never decode an unverified JWT.
    try {
      const endpoint = new URL('https://oauth2.googleapis.com/tokeninfo');
      endpoint.searchParams.set('id_token', idToken);
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Google tokeninfo returned HTTP ${response.status}`);
      const payload = await response.json();
      const expiresAt = Number(payload.exp) * 1000;
      if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('Google token has an invalid issuer');
      if (payload.aud !== config.googleClientId) throw new Error('Google token was issued for a different client');
      if (payload.email_verified !== 'true' && payload.email_verified !== true) throw new Error('Google account email is not verified');
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Google sign-in token has expired');
      return payload;
    } catch (fallbackError) {
      // Never decode a JWT locally as a fallback: an attacker can forge claims.
      throw new Error(`Google sign-in could not reach a verification service. Check outbound HTTPS/DNS access to www.googleapis.com and oauth2.googleapis.com. Certificate error: ${err.message}; tokeninfo error: ${fallbackError.message}`);
    }
  }
}

/**
 * Handle Google login:
 * 1. Verify the Google ID token
 * 2. Find or create the user in DB
 * 3. Ensure the custodial owner account and constrained agent signer exist
 * 4. Issue a JWT
 */
export async function loginWithGoogle(idToken) {
  // 1. Verify with Google
  const payload = await verifyGoogleToken(idToken);
  const { sub: googleSub, email, name, picture } = payload;

  const db = getDb();

  // 2. Check if user exists
  let [user] = await db`select * from users where google_sub = ${googleSub}`;

  if (!user) {
    // 3. Create the custodial owner account and separate constrained signer.
    // Both secrets are encrypted server-side and the C... wallet later holds
    // all spendable shopping funds under on-chain policy.
    const [createdUser] = await db`
      insert into users (google_sub, email, name, avatar_url, wallet_scope)
      values (${googleSub}, ${email}, ${name || email}, ${picture || null}, ${googleSub}) returning *`;
    try {
      await Promise.all([
        ensureCustodialWalletForUser(createdUser.id, createdUser.wallet_scope),
        ensureAgentWalletForUser(createdUser.id, createdUser.wallet_scope),
      ]);
    } catch (error) {
      await db`delete from users where id = ${createdUser.id}`;
      throw error;
    }
    user = createdUser;

    console.log(`🆕 New user created: ${email} (${createdUser.id})`);
  } else {
    await Promise.all([
      ensureCustodialWalletForUser(user.id, user.wallet_scope || googleSub),
      ensureAgentWalletForUser(user.id, user.wallet_scope || googleSub),
    ]);
    console.log(`👤 Returning user: ${email}`);
  }

  // 5. Issue JWT
  const token = issueSession(user);

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url || picture || null,
    },
  };
}
