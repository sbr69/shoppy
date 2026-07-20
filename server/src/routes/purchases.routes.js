import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getPurchaseHistory, getPurchaseInvoice } from '../services/payment.service.js';
import { getWorkflowEvents } from '../services/workflow.service.js';

const router = Router();

function purchaseStatus(purchase) {
  if (purchase.status === 'confirmed') return { stage: 'confirmed', label: 'Merchant order confirmed', description: 'The merchant accepted the verified Stellar payment.' };
  if (purchase.status === 'failed') return { stage: 'failed', label: 'Payment failed', description: 'The Stellar transaction did not finalize successfully.' };
  if (purchase.status === 'payment_confirmed') return { stage: 'merchant_pending', label: 'Merchant confirmation pending', description: 'Stellar payment finalized; the merchant confirmation will retry automatically.' };
  return { stage: 'payment_finalizing', label: 'Payment finalizing', description: 'Waiting for the guarded Stellar payment to reach finality.' };
}

/**
 * GET /api/purchases
 * Returns the user's purchase history with Stellar tx hashes.
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const purchases = await getPurchaseHistory(req.user.userId);

    const formatted = purchases.map(p => ({
      ...p,
      statusInfo: purchaseStatus(p),
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
router.get('/:id/workflow', authenticate, async (req, res, next) => {
  try {
    const [purchase] = await getPurchaseHistory(req.user.userId).then((purchases) => purchases.filter((item) => item.id === req.params.id));
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    return res.json({ events: await getWorkflowEvents(req.user.userId, { purchaseIntentId: purchase.purchase_intent_id }) });
  } catch (error) { return next(error); }
});

// Invoice snapshots contain encrypted delivery details. They are only
// decrypted after ownership is verified and are never stored in chat metadata.
router.get('/:id/invoice', authenticate, async (req, res, next) => {
  try {
    const result = await getPurchaseInvoice(req.user.userId, req.params.id);
    if (!result) return res.status(404).json({ error: 'Purchase not found' });
    return res.json(result);
  } catch (error) { return next(error); }
});

export default router;
