import { createHash } from 'crypto';
import getDb from '../db/database.js';
import config from '../config/env.js';
import { parseFiniteNonNegative, validateSiteUpdate } from './validation.service.js';
import { getOwnerKeypairForSigning, getWalletByUserId } from './wallet.service.js';
import { submitCustodialOwnerAction } from './soroban.service.js';

const domainHash = (origin) => createHash('sha256').update(new URL(origin).hostname.toLowerCase()).digest('hex');

export function getRegisteredStore(siteUrl) {
  let parsed;
  try { parsed = new URL(siteUrl); } catch { throw new Error('siteUrl must be a valid URL'); }
  if (parsed.protocol !== 'https:' && !(config.nodeEnv !== 'production' && parsed.protocol === 'http:')) throw new Error('Production stores must use HTTPS');
  const store = config.supportedStores.find((candidate) => candidate.origin === parsed.origin);
  if (!store) throw new Error('This store is not registered. Only verified merchant APIs can be connected.');
  return { store, normalizedUrl: parsed.origin };
}

export async function addSite(userId, { siteUrl, spendingCap = 1000, perTransactionCap, autoConfirmThreshold = 0 }) {
  const { store, normalizedUrl } = getRegisteredStore(siteUrl);
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

export async function getOrCreateOAuthSite(userId, { siteUrl, spendingCap = 1000, perTransactionCap }) {
  const { store, normalizedUrl } = getRegisteredStore(siteUrl);
  if (!store.oauth) throw new Error('This registered store has not enabled OAuth connection yet');
  const cap = parseFiniteNonNegative(spendingCap, 'spendingCap');
  const transactionCap = parseFiniteNonNegative(perTransactionCap ?? cap, 'perTransactionCap');
  if (transactionCap > cap) throw new Error('perTransactionCap cannot exceed spendingCap');
  const db = getDb();
  const [site] = await db`
    insert into connected_sites (user_id, site_url, site_name, adapter_id, merchant_stellar_address, merchant_domain_hash, spending_cap, per_transaction_cap, status)
    values (${userId}, ${normalizedUrl}, ${store.name}, ${store.id}, ${store.merchantStellarAddress}, ${domainHash(normalizedUrl)}, ${cap}, ${transactionCap}, 'pending_authorization')
    on conflict (user_id, site_url) do update set status = 'pending_authorization', policy_sync_error = null, updated_at = now()
    returning *`;
  return { site, store };
}

export async function getUserSites(userId) {
  // A row is created before the merchant OAuth redirect so the encrypted PKCE
  // attempt can be associated with a site. It is not a connected store until
  // the merchant actually grants an access token.
  return getDb()`
    select * from connected_sites
    where user_id = ${userId}
      and status in ('active', 'paused')
      and auth_token_ciphertext is not null
    order by authorized_at desc nulls last, created_at desc`;
}

export async function updateSite(userId, googleSub, siteId, updates) {
  const clean = validateSiteUpdate(updates);
  const [site] = await getDb()`select * from connected_sites where id = ${siteId} and user_id = ${userId}`;
  if (!site) throw new Error('Site not found');
  if (clean.status === 'active' && !site.auth_token_ciphertext) throw new Error('This store needs merchant authorization before it can be activated');
  if (clean.spendingCap !== undefined && Number(clean.spendingCap) < Number(clean.perTransactionCap ?? site.per_transaction_cap)) throw new Error('spendingCap cannot be lower than perTransactionCap');
  if (clean.perTransactionCap !== undefined && Number(clean.perTransactionCap) > Number(clean.spendingCap ?? site.spending_cap)) throw new Error('perTransactionCap cannot exceed spendingCap');
  if (Object.keys(clean).length === 0) return site;
  // Limits are enforced by the smart wallet, not merely by this database.
  // Any limit change must invalidate the last policy sync so checkout will
  // submit an owner-authorized TrustList update before it can pay again.
  const policyChanged = clean.spendingCap !== undefined || clean.perTransactionCap !== undefined || (clean.status !== undefined && clean.status !== site.status);
  if (clean.status === 'paused' && site.status !== 'paused') await removeSitePolicy(userId, googleSub, site);
  const [updated] = await getDb()`
    update connected_sites set site_name = coalesce(${clean.siteName ?? null}, site_name), spending_cap = coalesce(${clean.spendingCap ?? null}, spending_cap), per_transaction_cap = coalesce(${clean.perTransactionCap ?? null}, per_transaction_cap), auto_confirm_threshold = coalesce(${clean.autoConfirmThreshold ?? null}, auto_confirm_threshold), status = coalesce(${clean.status ?? null}, status), trust_rule_version = trust_rule_version + case when ${policyChanged} then 1 else 0 end, policy_synced_at = case when ${policyChanged} then null else policy_synced_at end, policy_sync_error = case when ${policyChanged} then null else policy_sync_error end, updated_at = now()
    where id = ${siteId} and user_id = ${userId} returning *`;
  if (updated.status === 'active' && policyChanged) return (await syncSitePolicy(userId, googleSub, updated.id)).site;
  return updated;
}

export async function removeSite(userId, siteId) {
  const deleted = await getDb()`delete from connected_sites where id = ${siteId} and user_id = ${userId} returning id`;
  if (!deleted.length) throw new Error('Site not found');
  return { success: true };
}

/** Synchronize a registered merchant's TrustList policy for its smart wallet. */
export async function syncSitePolicy(userId, googleSub, siteId) {
  const db = getDb();
  const [site] = await db`select * from connected_sites where id = ${siteId} and user_id = ${userId}`;
  if (!site) throw new Error('Site not found');
  const [wallet, ownerKeypair] = await Promise.all([
    getWalletByUserId(userId), getOwnerKeypairForSigning(userId, googleSub),
  ]);
  if (!wallet?.public_key) throw new Error('Custodial funding account is unavailable');
  try {
    const ruleResult = await submitCustodialOwnerAction({ actionType: 'set_trust_rule', ownerKeypair, ownerPublicKey: wallet.public_key, site });
    const [updated] = await db`update connected_sites set policy_synced_at = now(), policy_sync_error = null, updated_at = now() where id = ${site.id} returning *`;
    await db`insert into audit_events (user_id, event_type, payload) values (${userId}, 'site_policy_synced', ${db.json({ siteId: site.id, setRuleTx: ruleResult.txHash })})`;
    return { site: updated, transactions: { setRule: ruleResult.txHash } };
  } catch (error) {
    await db`update connected_sites set policy_sync_error = ${error.message}, updated_at = now() where id = ${site.id}`;
    throw error;
  }
}

/** Remove a previously synchronized merchant rule when a user disconnects it. */
export async function removeSitePolicy(userId, googleSub, site) {
  if (!site.policy_synced_at) return null;
  const db = getDb();
  const [wallet, ownerKeypair] = await Promise.all([
    getWalletByUserId(userId),
    getOwnerKeypairForSigning(userId, googleSub),
  ]);
  if (!wallet?.public_key) throw new Error('Custodial wallet is unavailable');

  const result = await submitCustodialOwnerAction({
    actionType: 'remove_trust_rule',
    ownerKeypair,
    ownerPublicKey: wallet.public_key,
    site,
  });
  await db`insert into audit_events (user_id, event_type, payload) values (${userId}, 'site_policy_removed', ${db.json({ siteId: site.id, removeRuleTx: result.txHash })})`;
  return result;
}
