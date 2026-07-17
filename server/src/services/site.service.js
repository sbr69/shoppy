import { createHash } from 'crypto';
import getDb from '../db/database.js';
import config from '../config/env.js';
import { parseFiniteNonNegative, validateSiteUpdate } from './validation.service.js';

const domainHash = (origin) => createHash('sha256').update(new URL(origin).hostname.toLowerCase()).digest('hex');

export async function addSite(userId, { siteUrl, spendingCap = 1000, perTransactionCap, autoConfirmThreshold = 0 }) {
  let parsed;
  try { parsed = new URL(siteUrl); } catch { throw new Error('siteUrl must be a valid URL'); }
  if (parsed.protocol !== 'https:' && !(config.nodeEnv !== 'production' && parsed.protocol === 'http:')) throw new Error('Production stores must use HTTPS');
  const normalizedUrl = parsed.origin;
  const store = config.supportedStores.find((candidate) => candidate.origin === normalizedUrl);
  if (!store) throw new Error('This store is not supported. Only registered stores with a verified agent API can be connected.');
  const cap = parseFiniteNonNegative(spendingCap, 'spendingCap');
  const transactionCap = parseFiniteNonNegative(perTransactionCap ?? cap, 'perTransactionCap');
  const threshold = parseFiniteNonNegative(autoConfirmThreshold, 'autoConfirmThreshold');
  if (transactionCap > cap) throw new Error('perTransactionCap cannot exceed spendingCap');
  try {
    const [site] = await getDb()`
      insert into connected_sites (user_id, site_url, site_name, adapter_id, merchant_stellar_address, merchant_domain_hash, spending_cap, per_transaction_cap, auto_confirm_threshold, status)
      values (${userId}, ${normalizedUrl}, ${store.name}, ${store.id}, ${store.merchantStellarAddress}, ${domainHash(normalizedUrl)}, ${cap}, ${transactionCap}, ${threshold}, 'pending_authorization') returning *`;
    return site;
  } catch (error) {
    if (error.code === '23505') throw new Error('This site is already connected');
    throw error;
  }
}

export async function getUserSites(userId) { return getDb()`select * from connected_sites where user_id = ${userId} order by created_at desc`; }

export async function updateSite(userId, siteId, updates) {
  const clean = validateSiteUpdate(updates);
  const [site] = await getDb()`select * from connected_sites where id = ${siteId} and user_id = ${userId}`;
  if (!site) throw new Error('Site not found');
  if (clean.status === 'active' && !site.auth_token_ciphertext) throw new Error('This store needs merchant authorization before it can be activated');
  if (clean.spendingCap !== undefined && Number(clean.spendingCap) < Number(site.per_transaction_cap)) throw new Error('spendingCap cannot be lower than perTransactionCap');
  if (Object.keys(clean).length === 0) return site;
  const [updated] = await getDb()`
    update connected_sites set site_name = coalesce(${clean.siteName ?? null}, site_name), spending_cap = coalesce(${clean.spendingCap ?? null}, spending_cap), auto_confirm_threshold = coalesce(${clean.autoConfirmThreshold ?? null}, auto_confirm_threshold), status = coalesce(${clean.status ?? null}, status), trust_rule_version = trust_rule_version + 1, updated_at = now()
    where id = ${siteId} and user_id = ${userId} returning *`;
  return updated;
}

export async function removeSite(userId, siteId) {
  const deleted = await getDb()`delete from connected_sites where id = ${siteId} and user_id = ${userId} returning id`;
  if (!deleted.length) throw new Error('Site not found');
  return { success: true };
}
