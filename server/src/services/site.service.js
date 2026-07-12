import { v4 as uuidv4 } from 'uuid';
import getDb from '../db/database.js';

/**
 * Add a new connected site for a user.
 */
export function addSite(userId, { siteUrl, siteName, spendingCap = 1000 }) {
  const db = getDb();

  // Normalize URL
  let normalizedUrl = siteUrl.trim();
  if (!normalizedUrl.startsWith('http')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }
  // Remove trailing slash
  normalizedUrl = normalizedUrl.replace(/\/+$/, '');

  // Check for duplicate
  const existing = db.prepare(
    'SELECT id FROM connected_sites WHERE user_id = ? AND site_url = ?'
  ).get(userId, normalizedUrl);

  if (existing) {
    throw new Error('This site is already connected');
  }

  const id = uuidv4();
  db.prepare(
    'INSERT INTO connected_sites (id, user_id, site_url, site_name, spending_cap, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, userId, normalizedUrl, siteName, spendingCap, 'active');

  return {
    id,
    user_id: userId,
    site_url: normalizedUrl,
    site_name: siteName,
    spending_cap: spendingCap,
    status: 'active',
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

  const site = db.prepare(
    'SELECT * FROM connected_sites WHERE id = ? AND user_id = ?'
  ).get(siteId, userId);

  if (!site) {
    throw new Error('Site not found');
  }

  const fields = [];
  const values = [];

  if (updates.siteName !== undefined) {
    fields.push('site_name = ?');
    values.push(updates.siteName);
  }
  if (updates.spendingCap !== undefined) {
    fields.push('spending_cap = ?');
    values.push(updates.spendingCap);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) {
    return site;
  }

  values.push(siteId, userId);
  db.prepare(
    `UPDATE connected_sites SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  ).run(...values);

  return { ...site, ...updates };
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
