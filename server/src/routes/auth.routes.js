import { Router } from 'express';
import { loginWithGoogle } from '../services/auth.service.js';
import { createStellarChallenge, linkStellarWallet, listStellarWalletIdentities, loginWithStellarWallet } from '../services/stellar-auth.service.js';
import { authenticate } from '../middleware/auth.js';
import config from '../config/env.js';

const router = Router();

/**
 * POST /api/auth/google
 * Body: { credential: "google-id-token" }
 * Returns: { token, user }
 */
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Missing Google credential' });
    }

    const result = await loginWithGoogle(credential);
    res.json(result);
  } catch (err) {
    console.error('❌ Google auth error:', err.message);
    res.status(401).json({
      error: 'Authentication failed',
      ...(config.nodeEnv === 'production' ? {} : { details: err.message }),
    });
  }
});

router.post('/stellar/challenge', async (req, res) => {
  try { res.json({ challenge: await createStellarChallenge(req.body?.publicKey) }); }
  catch (err) { res.status(400).json({ error: err.message || 'Unable to create wallet sign-in challenge' }); }
});

router.post('/stellar', async (req, res) => {
  try { res.json(await loginWithStellarWallet(req.body || {})); }
  catch (err) { res.status(401).json({ error: err.message || 'Stellar wallet authentication failed' }); }
});

router.get('/stellar/identities', authenticate, async (req, res, next) => {
  try { res.json({ identities: await listStellarWalletIdentities(req.user.userId) }); } catch (error) { next(error); }
});

router.post('/stellar/link/challenge', authenticate, async (req, res) => {
  try { res.json({ challenge: await createStellarChallenge(req.body?.publicKey, { purpose: 'link', userId: req.user.userId }) }); }
  catch (err) { res.status(400).json({ error: err.message || 'Unable to create wallet link challenge' }); }
});

router.post('/stellar/link', authenticate, async (req, res) => {
  try { res.json(await linkStellarWallet({ userId: req.user.userId, ...(req.body || {}) })); }
  catch (err) { res.status(err.status || 401).json({ error: err.message || 'Unable to link Stellar wallet' }); }
});

export default router;
