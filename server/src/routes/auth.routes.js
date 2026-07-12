import { Router } from 'express';
import { loginWithGoogle } from '../services/auth.service.js';

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
    res.status(401).json({ error: 'Authentication failed', details: err.message });
  }
});

export default router;
