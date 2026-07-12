import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { createWalletForUser } from './wallet.service.js';

const googleClient = new OAuth2Client(config.googleClientId);

/**
 * Verify a Google ID token and return the payload.
 */
async function verifyGoogleToken(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: config.googleClientId,
  });
  return ticket.getPayload();
}

/**
 * Handle Google login:
 * 1. Verify the Google ID token
 * 2. Find or create the user in DB
 * 3. If new user, create a Stellar wallet
 * 4. Issue a JWT
 */
export async function loginWithGoogle(idToken) {
  // 1. Verify with Google
  const payload = await verifyGoogleToken(idToken);
  const { sub: googleSub, email, name } = payload;

  const db = getDb();

  // 2. Check if user exists
  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(googleSub);

  if (!user) {
    // 3. Create new user
    const userId = uuidv4();
    db.prepare(
      'INSERT INTO users (id, google_sub, email, name) VALUES (?, ?, ?, ?)'
    ).run(userId, googleSub, email, name);

    user = { id: userId, google_sub: googleSub, email, name };

    // 4. Create Stellar wallet for this user
    await createWalletForUser(userId, googleSub);

    console.log(`🆕 New user created: ${email} (${userId})`);
  } else {
    console.log(`👤 Returning user: ${email}`);
  }

  // 5. Issue JWT
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      googleSub: user.google_sub,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: null,
    },
  };
}
