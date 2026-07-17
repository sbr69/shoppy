import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { fundAgentWalletWithFriendbot, fundWalletWithFriendbot, getAgentWalletByUserId, getWalletBalance, getWalletByUserId } from '../services/wallet.service.js';
import getDb from '../db/database.js';

const router = Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const [wallet, agent] = await Promise.all([getWalletByUserId(req.user.userId), getAgentWalletByUserId(req.user.userId)]);
    if (!wallet?.public_key || wallet.status !== 'active') return res.status(404).json({ error: 'Custodial wallet is unavailable' });
    let balanceInfo; let networkAvailable = true;
    try { balanceInfo = await getWalletBalance(wallet.public_key); } catch { balanceInfo = { balance: '0', funded: false }; networkAvailable = false; }
    res.json({ publicKey: wallet.public_key, agentPublicKey: agent?.public_key || null, balance: balanceInfo.balance, funded: balanceInfo.funded, networkAvailable, createdAt: wallet.created_at, network: 'testnet', custody: 'server_custody' });
  } catch (error) { res.status(500).json({ error: 'Failed to fetch wallet info' }); }
});

router.post('/fund', authenticate, async (req, res) => {
  try {
    const wallet = await getWalletByUserId(req.user.userId);
    if (!wallet?.public_key) return res.status(404).json({ error: 'Custodial wallet is unavailable' });
    const [owner, agent] = await Promise.all([fundWalletWithFriendbot(wallet.public_key), fundAgentWalletWithFriendbot(req.user.userId)]);
    res.json({ ...owner, agent });
  } catch (error) { res.status(500).json({ error: 'Failed to fund testnet wallet' }); }
});

router.get('/activity', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const [purchases, events] = await Promise.all([
      db`select id, product_name, price_xlm, stellar_tx_hash, status, created_at, confirmed_at from purchases where user_id = ${req.user.userId} order by created_at desc limit 50`,
      db`select id, event_type, payload, created_at from audit_events where user_id = ${req.user.userId} order by created_at desc limit 50`,
    ]);
    const activity = [
      ...purchases.map((purchase) => ({ id: `purchase-${purchase.id}`, type: 'purchase', title: purchase.product_name, amountXlm: Number(purchase.price_xlm), status: purchase.status, txHash: purchase.stellar_tx_hash, createdAt: purchase.created_at })),
      ...events.map((event) => ({ id: `audit-${event.id}`, type: event.event_type, title: event.event_type.replaceAll('_', ' '), metadata: event.payload, createdAt: event.created_at })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ activity });
  } catch (error) { res.status(500).json({ error: 'Failed to load wallet activity' }); }
});

export default router;
