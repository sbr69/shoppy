import { v4 as uuidv4 } from 'uuid';
import getDb from '../db/database.js';
import config from '../config/env.js';
import { parseFiniteNonNegative, validateSiteUpdate } from './validation.service.js';

/**
 * Add a new connected site for a user.
 */
export function addSite(userId, { siteUrl, spendingCap = 1000, autoConfirmThreshold = 0 }) {
  const db = getDb();
  let parsed;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new Error('siteUrl must be a valid URL');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('siteUrl must use HTTP or HTTPS');
  const normalizedUrl = parsed.origin;
  const store = config.supportedStores.find((candidate) => candidate.origin === normalizedUrl);
  if (!store) {
    throw new Error('This store is not supported. Only registered stores with a verified agent API can be connected.');
  }
  const cap = parseFiniteNonNegative(spendingCap, 'spendingCap');
  const threshold = parseFiniteNonNegative(autoConfirmThreshold, 'autoConfirmThreshold');

  // Check for duplicate
  const existing = db.prepare(
    'SELECT id FROM connected_sites WHERE user_id = ? AND site_url = ?'
  ).get(userId, normalizedUrl);

  if (existing) {
    throw new Error('This site is already connected');
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO connected_sites (id, user_id, site_url, site_name, adapter_id, merchant_stellar_address, spending_cap, auto_confirm_threshold, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, normalizedUrl, store.name, store.id, store.merchantStellarAddress, cap, threshold, store.testMode === true && config.nodeEnv !== 'production' ? 'active' : 'paused');

  return {
    id,
    user_id: userId,
    site_url: normalizedUrl,
    site_name: store.name,
    adapter_id: store.id,
    merchant_stellar_address: store.merchantStellarAddress,
    spending_cap: cap,
    auto_confirm_threshold: threshold,
    // Production stores remain paused until their OAuth/API authorization is complete.
    status: store.testMode === true && config.nodeEnv !== 'production' ? 'active' : 'paused',
  };
}

/**
 * Get all connected sites for a user.
 */
export function getUserSites(userId) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM connected_sites WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
}

/**
 * Update a connected site.
 */
export function updateSite(userId, siteId, updates) {
  const db = getDb();
  const clean = validateSiteUpdate(updates);

  const site = db.prepare(
    'SELECT * FROM connected_sites WHERE id = ? AND user_id = ?'
  ).get(siteId, userId);

  if (!site) {
    throw new Error('Site not found');
  }
  if (clean.status === 'active' && !site.auth_token && config.nodeEnv === 'production') {
    throw new Error('This store needs merchant authorization before it can be activated');
  }

  const fields = [];
  const values = [];

  if (clean.siteName !== undefined) {
    fields.push('site_name = ?');
    values.push(clean.siteName);
  }
  if (clean.spendingCap !== undefined) {
    fields.push('spending_cap = ?');
    values.push(clean.spendingCap);
  }
  if (clean.autoConfirmThreshold !== undefined) {
    fields.push('auto_confirm_threshold = ?');
    values.push(clean.autoConfirmThreshold);
  }
  if (clean.status !== undefined) {
    fields.push('status = ?');
    values.push(clean.status);
  }

  if (fields.length === 0) {
    return site;
  }

  values.push(siteId, userId);
  db.prepare(
    `UPDATE connected_sites SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  ).run(...values);

  return { ...site, ...clean };
}

/**
 * Remove a connected site.
 */
export function removeSite(userId, siteId) {
  const db = getDb();

  const result = db.prepare(
    'DELETE FROM connected_sites WHERE id = ? AND user_id = ?'
  ).run(siteId, userId);

  if (result.changes === 0) {
    throw new Error('Site not found');
  }

  return { success: true };
}
