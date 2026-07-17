import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getPurchaseHistory, submitPurchaseApproval } from '../services/payment.service.js';

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

/** Receives a browser-created owner authorization entry, never an owner secret. */
router.post('/approvals/:id/authorize', authenticate, async (req, res) => {
  try {
    const result = await submitPurchaseApproval(
      req.user.userId,
      req.user.googleSub,
      req.params.id,
      req.body?.signedAuthorizationEntryXdr,
    );
    res.status(202).json({ purchase: result });
  } catch (error) {
    console.error('Purchase approval submission failed:', error.message);
    res.status(error.indeterminate ? 202 : 400).json({
      error: error.indeterminate ? 'Payment status is being reconciled. Do not approve or pay again.' : error.message,
      indeterminate: Boolean(error.indeterminate),
    });
  }
});

export default router;
