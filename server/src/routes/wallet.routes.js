import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { fundAgentWalletWithFriendbot, fundWalletWithFriendbot, getAgentWalletByUserId, getWalletBalance, getWalletByUserId } from '../services/wallet.service.js';

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

export default router;
