import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getWalletByUserId,
  getWalletBalance,
  fundWalletWithFriendbot,
} from '../services/wallet.service.js';

const router = Router();

/**
 * GET /api/wallet
 * Returns wallet public key + balance for the authenticated user.
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const wallet = getWalletByUserId(req.user.userId);

    if (!wallet) {
      return res.status(404).json({ error: 'No wallet found for this user' });
    }

    // A local wallet is still usable when Stellar Horizon is temporarily
    // unreachable (for example, from a restricted development environment).
    let balanceInfo;
    let networkAvailable = true;
    try {
      balanceInfo = await getWalletBalance(wallet.public_key);
    } catch (err) {
      console.warn('⚠️ Stellar Horizon unavailable:', err.message);
      balanceInfo = { balance: '0', funded: false };
      networkAvailable = false;
    }

    res.json({
      publicKey: wallet.public_key,
      balance: balanceInfo.balance,
      funded: balanceInfo.funded,
      networkAvailable,
      createdAt: wallet.created_at,
    });
  } catch (err) {
    console.error('❌ Wallet fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch wallet info' });
  }
});

/**
 * POST /api/wallet/fund
 * Fund the user's wallet using Stellar Friendbot (testnet).
 */
router.post('/fund', authenticate, async (req, res) => {
  try {
    const wallet = getWalletByUserId(req.user.userId);

    if (!wallet) {
      return res.status(404).json({ error: 'No wallet found for this user' });
    }

    const result = await fundWalletWithFriendbot(wallet.public_key);
    res.json(result);
  } catch (err) {
    console.error('❌ Wallet fund error:', err.message);
    res.status(500).json({ error: 'Failed to fund wallet', details: err.message });
  }
});

export default router;
