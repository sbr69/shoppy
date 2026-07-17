import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { addSite, getUserSites, updateSite, removeSite } from '../services/site.service.js';

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

/**
 * Kept as a clear migration response for older dashboard clients. Contract
 * configuration now goes through /wallet/actions/prepare so the browser owner
 * key signs each exact action after a passkey unlock.
 */
router.post('/:id/policy/sync', authenticate, async (req, res) => {
  res.status(409).json({
    error: 'Policy sync now requires a passkey-signed owner action. Prepare set_agent and set_trust_rule actions through /api/wallet/actions/prepare.',
  });
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
