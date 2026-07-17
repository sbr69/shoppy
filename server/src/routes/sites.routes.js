import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { addSite, getUserSites, updateSite, removeSite } from '../services/site.service.js';
import { getAgentWalletByUserId, getOwnerKeypairForSigning, getWalletByUserId } from '../services/wallet.service.js';
import { configureGuardedSite } from '../services/soroban.service.js';

const router = Router();

/**
 * GET /api/sites
 * List all connected sites for the authenticated user.
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const sites = await getUserSites(req.user.userId);
    res.json({ sites });
  } catch (err) {
    console.error('❌ Sites list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sites' });
  }
});

/**
 * POST /api/sites
 * Body: { siteUrl, siteName, spendingCap? }
 * Add a new connected site.
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { siteUrl, spendingCap, perTransactionCap, autoConfirmThreshold } = req.body;

    if (!siteUrl) {
      return res.status(400).json({ error: 'siteUrl is required' });
    }

    const site = await addSite(req.user.userId, { siteUrl, spendingCap, perTransactionCap, autoConfirmThreshold });
    res.status(201).json({ site });
  } catch (err) {
    if (['This site is already connected', 'siteUrl must be a valid URL', 'siteUrl must use HTTP or HTTPS', 'This store needs merchant authorization before it can be activated'].includes(err.message) || err.message.startsWith('This store is not supported')) {
      return res.status(409).json({ error: err.message });
    }
    console.error('❌ Site add error:', err.message);
    res.status(500).json({ error: 'Failed to add site' });
  }
});

/**
 * PATCH /api/sites/:id
 * Body: { siteName?, spendingCap?, status? }
 * Update a connected site.
 */
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const site = await updateSite(req.user.userId, req.params.id, req.body);
    res.json({ site });
  } catch (err) {
    if (err.message === 'Site not found') {
      return res.status(404).json({ error: err.message });
    }
    console.error('❌ Site update error:', err.message);
    res.status(500).json({ error: 'Failed to update site' });
  }
});

/** Writes the site rule and delegated agent key to the Soroban contracts. */
router.post('/:id/policy/sync', authenticate, async (req, res) => {
  try {
    const sites = await getUserSites(req.user.userId);
    const site = sites.find((candidate) => candidate.id === req.params.id);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const [ownerWallet, agentWallet] = await Promise.all([
      getWalletByUserId(req.user.userId),
      getAgentWalletByUserId(req.user.userId),
    ]);
    if (!ownerWallet || !agentWallet) return res.status(404).json({ error: 'Wallet setup is incomplete' });
    const ownerKeypair = await getOwnerKeypairForSigning(req.user.userId, req.user.googleSub);
    const submitted = await configureGuardedSite({ ownerKeypair, ownerPublicKey: ownerWallet.public_key, agentPublicKey: agentWallet.public_key, site });
    const updated = await updateSite(req.user.userId, site.id, { status: 'active' });
    res.status(202).json({ site: updated, transactions: submitted, status: 'submitted' });
  } catch (err) {
    console.error('Policy sync error:', err.message);
    res.status(500).json({ error: 'Failed to sync the on-chain policy' });
  }
});

/**
 * DELETE /api/sites/:id
 * Remove a connected site.
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await removeSite(req.user.userId, req.params.id);
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'Site not found') {
      return res.status(404).json({ error: err.message });
    }
    console.error('❌ Site delete error:', err.message);
    res.status(500).json({ error: 'Failed to remove site' });
  }
});

export default router;
