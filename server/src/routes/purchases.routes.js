import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getPurchaseHistory } from '../services/payment.service.js';

const router = Router();

/**
 * GET /api/purchases
 * Returns the user's purchase history with Stellar tx hashes.
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const purchases = await getPurchaseHistory(req.user.userId);

    const formatted = purchases.map(p => ({
      ...p,
      explorerUrl: p.stellar_tx_hash
        ? `https://stellar.expert/explorer/testnet/tx/${p.stellar_tx_hash}`
        : null,
    }));

    res.json({ purchases: formatted });
  } catch (err) {
    console.error('Purchases error:', err.message);
    res.status(500).json({ error: 'Failed to fetch purchase history' });
  }
});

export default router;
