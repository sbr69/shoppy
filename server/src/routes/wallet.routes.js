import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getWalletByUserId,
  getOwnerKeypairForSigning,
  getWalletBalance,
  fundWalletWithFriendbot,
} from '../services/wallet.service.js';
import { depositEscrow } from '../services/soroban.service.js';

const router = Router();

/**
 * GET /api/wallet
 * Returns wallet public key + balance for the authenticated user.
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const wallet = await getWalletByUserId(req.user.userId);

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
    const wallet = await getWalletByUserId(req.user.userId);

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

/** Move XLM from the owner wallet into SpendGuard escrow. */
router.post('/escrow/deposit', authenticate, async (req, res) => {
  try {
    const amountXlm = Number(req.body?.amountXlm);
    if (!Number.isFinite(amountXlm) || amountXlm <= 0) return res.status(400).json({ error: 'amountXlm must be a positive number' });
    const wallet = await getWalletByUserId(req.user.userId);
    if (!wallet) return res.status(404).json({ error: 'No wallet found for this user' });
    const ownerKeypair = await getOwnerKeypairForSigning(req.user.userId, req.user.googleSub);
    const txHash = await depositEscrow({ ownerKeypair, ownerPublicKey: wallet.public_key, amountXlm });
    res.status(202).json({ txHash, status: 'submitted' });
  } catch (err) {
    console.error('Escrow deposit error:', err.message);
    res.status(500).json({ error: 'Failed to submit escrow deposit' });
  }
});

export default router;
