import { createHash, randomBytes } from 'crypto';
import { lookup } from 'dns/promises';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { decrypt, encrypt } from './crypto.service.js';
import { removeSitePolicy, syncSitePolicy } from './site.service.js';

const OAUTH_TTL_MS = 10 * 60 * 1000;
const REQUIRED_SCOPES = ['profile', 'checkout:prepare', 'checkout:confirm', 'orders:read'];
// A semantic search issues several independent catalogue queries at once.
// Merchants correctly rotate refresh tokens, so those requests must never try
// to exchange the same refresh token concurrently.
const tokenRefreshesInFlight = new Map();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const attemptScope = (value) => `store-oauth-attempt:${value}`;
const tokenScope = (siteId) => `store-oauth-token:${siteId}`;
const clientScope = (siteId) => `store-oauth-client:${siteId}`;
const callbackUrl = () => new URL('/api/sites/oauth/callback', `${config.serverPublicUrl}/`).toString();
const dashboard = (params) => { const url = new URL('/dashboard', `${config.clientUrl}/`); Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v)); return url.toString(); };

function isPrivateAddress(address) {
  return address === '::1' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd') || /^127\./.test(address) || /^10\./.test(address) || /^192\.168\./.test(address) || /^169\.254\./.test(address) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) || address === '0.0.0.0';
}
async function safeOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Stores must use a public HTTPS URL');
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) throw new Error('Private or local store URLs cannot be connected');
  return url.origin;
}
async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Store discovery endpoint did not return valid JSON');
  return response.json();
}
function endpoint(value, origin, name) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== origin) throw new Error(`${name} must be an HTTPS endpoint on the store origin`);
  return url.toString();
}

function endpointTemplate(value, origin, name) {
  if (typeof value !== 'string' || !value.includes('{product_id}')) throw new Error(`${name} must include {product_id}`);
  const url = new URL(value.replace('{product_id}', 'sample-product'));
  if (url.protocol !== 'https:' || url.origin !== origin) throw new Error(`${name} must be an HTTPS endpoint on the store origin`);
  return value;
}

async function discover(siteUrl) {
  const origin = await safeOrigin(siteUrl);
  const [oauth, commerce] = await Promise.all([getJson(`${origin}/.well-known/oauth-authorization-server`), getJson(`${origin}/.well-known/agent-commerce`)]);
  const authorizationUrl = endpoint(oauth.authorization_endpoint, origin, 'authorization_endpoint');
  const tokenUrl = endpoint(oauth.token_endpoint, origin, 'token_endpoint');
  const registrationUrl = endpoint(oauth.registration_endpoint, origin, 'registration_endpoint');
  if (!oauth.revocation_endpoint) throw new Error('Store must publish an OAuth revocation endpoint');
  const revocationUrl = endpoint(oauth.revocation_endpoint, origin, 'revocation_endpoint');
  if (!Array.isArray(oauth.code_challenge_methods_supported) || !oauth.code_challenge_methods_supported.includes('S256')) throw new Error('Store must support OAuth PKCE S256');
  const searchUrl = endpoint(commerce.search_endpoint, origin, 'search_endpoint');
  const prepareUrl = endpoint(commerce.checkout_prepare_endpoint, origin, 'checkout_prepare_endpoint');
  const confirmUrl = endpoint(commerce.checkout_confirm_endpoint, origin, 'checkout_confirm_endpoint');
  const merchant = commerce.settlement?.merchant_stellar_address;
  if (commerce.settlement?.network !== 'testnet' || commerce.settlement?.asset !== 'XLM' || typeof merchant !== 'string' || !/^G[A-Z2-7]{55}$/.test(merchant)) throw new Error('Store must publish a valid testnet XLM settlement configuration');
  return { origin, oauth: { authorizationUrl, tokenUrl, registrationUrl, revocationUrl }, commerce: { searchUrl, prepareUrl, confirmUrl, ordersUrl: commerce.orders_endpoint ? endpoint(commerce.orders_endpoint, origin, 'orders_endpoint') : null, reviewsUrlTemplate: commerce.reviews_endpoint_template ? endpointTemplate(commerce.reviews_endpoint_template, origin, 'reviews_endpoint_template') : null, settlement: commerce.settlement } };
}
function readClient(site) { return JSON.parse(decrypt(Buffer.from(site.oauth_client_ciphertext, 'base64'), Buffer.from(site.oauth_client_iv, 'base64'), Buffer.from(site.oauth_client_tag, 'base64'), clientScope(site.id))); }

async function createSiteAndClient(userId, input) {
  const discovered = await discover(input.siteUrl);
  const db = getDb();
  const cap = Number(input.spendingCap ?? 1000); const perCap = Number(input.perTransactionCap ?? cap);
  if (!Number.isFinite(cap) || !Number.isFinite(perCap) || cap < 0 || perCap < 0 || perCap > cap) throw new Error('Invalid spending limits');
  const [existing] = await db`select id, status, auth_token_ciphertext from connected_sites where user_id = ${userId} and site_url = ${discovered.origin}`;
  if (existing?.auth_token_ciphertext && ['active', 'paused'].includes(existing.status)) {
    throw new Error('This store is already connected. Disconnect it first if you need to authorize a different store account.');
  }
  const [site] = await db`insert into connected_sites (user_id, site_url, site_name, adapter_id, merchant_stellar_address, merchant_domain_hash, spending_cap, per_transaction_cap, status, oauth_server_metadata, agent_manifest) values (${userId}, ${discovered.origin}, ${new URL(discovered.origin).hostname}, 'agent-commerce-v1', ${discovered.commerce.settlement.merchant_stellar_address}, ${hash(new URL(discovered.origin).hostname)}, ${cap}, ${perCap}, 'pending_authorization', ${db.json(discovered.oauth)}, ${db.json(discovered.commerce)}) on conflict (user_id, site_url) do update set oauth_server_metadata = excluded.oauth_server_metadata, agent_manifest = excluded.agent_manifest, merchant_stellar_address = excluded.merchant_stellar_address, status = 'pending_authorization', updated_at = now() returning *`;
  const registration = await fetch(discovered.oauth.registrationUrl, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'JarvisPayz Shopping Agent', redirect_uris: [callbackUrl()], token_endpoint_auth_method: 'client_secret_post', scope: REQUIRED_SCOPES.join(' ') }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!registration.ok) throw new Error(`Store client registration failed (${registration.status})`);
  const client = await registration.json();
  if (!client.client_id || !client.client_secret) throw new Error('Store registration did not provide confidential client credentials');
  const sealed = encrypt(JSON.stringify({ clientId: client.client_id, clientSecret: client.client_secret, scopes: REQUIRED_SCOPES }), clientScope(site.id));
  const [updated] = await db`update connected_sites set oauth_client_ciphertext = ${sealed.encrypted.toString('base64')}, oauth_client_iv = ${sealed.iv.toString('base64')}, oauth_client_tag = ${sealed.authTag.toString('base64')} where id = ${site.id} returning *`;
  return updated;
}

function tokenRecord(token, client) {
  if (!token?.access_token || typeof token.access_token !== 'string') throw new Error('TestMarket auto-grant did not return an access token');
  const expiresAt = new Date(Date.now() + Number(token.expires_in || 900) * 1000).toISOString();
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || null,
    tokenType: token.token_type || 'Bearer',
    expiresAt,
    scope: token.scope || client.scopes.join(' '),
  };
}

async function activateSiteWithToken(site, client, token) {
  const db = getDb();
  const credential = tokenRecord(token, client);
  const sealed = encrypt(JSON.stringify(credential), tokenScope(site.id));
  await db`update connected_sites set auth_token_ciphertext = ${sealed.encrypted.toString('base64')}, auth_token_iv = ${sealed.iv.toString('base64')}, auth_token_tag = ${sealed.authTag.toString('base64')}, auth_token_expires_at = ${credential.expiresAt}, auth_scope = ${credential.scope}, authorized_at = now(), status = 'active', policy_sync_error = null, updated_at = now() where id = ${site.id}`;
  return credential;
}

/**
 * Test-only onboarding path. It calls a private TestMarket endpoint that is
 * disabled unless TestMarket is explicitly configured with the same secret.
 * It neither changes nor bypasses the normal OAuth path for any other store.
 */
export async function autoConnectTestMarketForNewUser(userId, googleSub) {
  if (!config.testMarketAutoConnect) return null;
  const siteUrl = new URL(config.testMarketAutoConnectUrl).origin;
  const db = getDb();
  const [existing] = await db`select * from connected_sites where user_id = ${userId} and site_url = ${siteUrl}`;
  if (existing?.auth_token_ciphertext && ['active', 'paused'].includes(existing.status)) return existing;

  const site = await createSiteAndClient(userId, {
    siteUrl,
    spendingCap: config.testMarketAutoConnectCap,
    perTransactionCap: config.testMarketAutoConnectCap,
  });
  const client = readClient(site);
  const grantUrl = new URL('/api/agent/commerce/v1/test-grants', siteUrl);
  const response = await fetch(grantUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-JarvisPayz-Test-Grant': config.testMarketAutoGrantSecret,
    },
    body: JSON.stringify({ client_id: client.clientId, client_secret: client.clientSecret, subject: userId }),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`TestMarket automatic authorization failed (${response.status})`);
  const token = await response.json();
  await activateSiteWithToken(site, client, token);
  try {
    await syncSitePolicy(userId, googleSub, site.id);
  } catch (error) {
    // Keep the authorized connection. Checkout retries policy synchronization
    // before it can submit any payment, matching normal OAuth behaviour.
    await db`update connected_sites set policy_sync_error = ${error.message}, updated_at = now() where id = ${site.id}`;
  }
  const [active] = await db`select * from connected_sites where id = ${site.id}`;
  return active;
}

export async function startStoreOAuth(userId, input) {
  const site = await createSiteAndClient(userId, input);
  const client = readClient(site); const state = randomBytes(32).toString('base64url'); const stateHash = hash(state); const verifier = randomBytes(48).toString('base64url');
  const sealed = encrypt(verifier, attemptScope(stateHash)); const db = getDb();
  await db`delete from site_oauth_attempts where user_id = ${userId} and site_id = ${site.id} and consumed_at is null`;
  await db`insert into site_oauth_attempts (user_id, site_id, state_hash, code_verifier_ciphertext, code_verifier_iv, code_verifier_tag, expires_at) values (${userId}, ${site.id}, ${stateHash}, ${sealed.encrypted.toString('base64')}, ${sealed.iv.toString('base64')}, ${sealed.authTag.toString('base64')}, ${new Date(Date.now() + OAUTH_TTL_MS).toISOString()})`;
  const authorize = new URL(site.oauth_server_metadata.authorizationUrl); authorize.search = new URLSearchParams({ response_type: 'code', client_id: client.clientId, redirect_uri: callbackUrl(), state, scope: client.scopes.join(' '), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return { authorizationUrl: authorize.toString(), site: { id: site.id, siteUrl: site.site_url, siteName: site.site_name } };
}

export async function completeStoreOAuth({ code, state, error, errorDescription }) {
  if (error || typeof code !== 'string' || typeof state !== 'string') return { redirectUrl: dashboard({ storeConnection: 'failed' }), error: errorDescription || error || 'Invalid OAuth callback' };
  const db = getDb(); const [attempt] = await db`update site_oauth_attempts set consumed_at = now() where state_hash = ${hash(state)} and consumed_at is null and expires_at > now() returning *`;
  if (!attempt) return { redirectUrl: dashboard({ storeConnection: 'failed' }), error: 'This store connection expired or was already completed' };
  const [site] = await db`select * from connected_sites where id = ${attempt.site_id}`;
  try {
    const verifier = decrypt(Buffer.from(attempt.code_verifier_ciphertext, 'base64'), Buffer.from(attempt.code_verifier_iv, 'base64'), Buffer.from(attempt.code_verifier_tag, 'base64'), attemptScope(hash(state)));
    const client = readClient(site); const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(), client_id: client.clientId, client_secret: client.clientSecret, code_verifier: verifier });
    const response = await fetch(site.oauth_server_metadata.tokenUrl, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Token exchange failed (${response.status})`); const token = await response.json(); if (!token.access_token) throw new Error('Token response did not include an access token');
    await activateSiteWithToken(site, client, token);
    const [user] = await db`select id, wallet_scope, google_sub from users where id = ${site.user_id}`;
    try {
      await syncSitePolicy(user.id, user.wallet_scope || user.google_sub, site.id);
    } catch (policyError) {
      // The connection remains valid. Checkout will retry this automatically
      // before it can move funds, and the failure is visible on the store.
      await db`update connected_sites set policy_sync_error = ${policyError.message}, updated_at = now() where id = ${site.id}`;
    }
    return { redirectUrl: dashboard({ storeConnection: 'success', siteId: site.id }) };
  } catch (err) { await db`update connected_sites set status = 'pending_authorization', policy_sync_error = ${err.message} where id = ${site.id}`; return { redirectUrl: dashboard({ storeConnection: 'failed' }), error: err.message }; }
}

export function tokenNeedsRefresh(token, now = Date.now()) {
  return !token?.expiresAt || new Date(token.expiresAt).getTime() <= now + 60_000;
}

export async function refreshStoreToken({ token, client, tokenUrl, fetchImpl = fetch, now = Date.now() }) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refreshToken, client_id: client.clientId, client_secret: client.clientSecret });
  const response = await fetchImpl(tokenUrl, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw new Error('Store authorization refresh failed. Reconnect the store to continue.');
  const refreshed = await response.json();
  if (!refreshed?.access_token) throw new Error('Store authorization refresh did not return an access token');
  return {
    ...token,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || token.refreshToken,
    tokenType: refreshed.token_type || token.tokenType || 'Bearer',
    expiresAt: new Date(now + Number(refreshed.expires_in || 900) * 1000).toISOString(),
    scope: refreshed.scope || token.scope,
  };
}

export async function revokeStoreTokens({ token, client, revocationUrl, fetchImpl = fetch }) {
  const revoke = async (tokenValue) => {
    if (!tokenValue) return true;
    const response = await fetchImpl(revocationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tokenValue, client_id: client.clientId, client_secret: client.clientSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  };
  const refreshRevoked = await revoke(token.refreshToken);
  const accessRevoked = await revoke(token.accessToken);
  return { remoteRevoked: refreshRevoked && accessRevoked };
}

export async function getStoreAccessToken(site) {
  const token = JSON.parse(decrypt(Buffer.from(site.auth_token_ciphertext, 'base64'), Buffer.from(site.auth_token_iv, 'base64'), Buffer.from(site.auth_token_tag, 'base64'), tokenScope(site.id)));
  if (!tokenNeedsRefresh(token)) return token;

  const existingRefresh = tokenRefreshesInFlight.get(site.id);
  if (existingRefresh) return existingRefresh;

  const refresh = (async () => {
    const db = getDb();
    // Re-read the encrypted credential after acquiring the in-process lock.
    // A preceding request may already have persisted the rotated refresh token.
    const [currentSite] = await db`select * from connected_sites where id = ${site.id}`;
    if (!currentSite?.auth_token_ciphertext) throw new Error('Store authorization is unavailable. Reconnect the store to continue.');
    const currentToken = JSON.parse(decrypt(
      Buffer.from(currentSite.auth_token_ciphertext, 'base64'),
      Buffer.from(currentSite.auth_token_iv, 'base64'),
      Buffer.from(currentSite.auth_token_tag, 'base64'),
      tokenScope(currentSite.id),
    ));
    if (!tokenNeedsRefresh(currentToken)) return currentToken;

    const client = readClient(currentSite);
    Object.assign(currentToken, await refreshStoreToken({ token: currentToken, client, tokenUrl: currentSite.oauth_server_metadata.tokenUrl }));
    const sealed = encrypt(JSON.stringify(currentToken), tokenScope(currentSite.id));
    await db`update connected_sites set auth_token_ciphertext = ${sealed.encrypted.toString('base64')}, auth_token_iv = ${sealed.iv.toString('base64')}, auth_token_tag = ${sealed.authTag.toString('base64')}, auth_token_expires_at = ${currentToken.expiresAt}, updated_at = now() where id = ${currentSite.id}`;
    return currentToken;
  })();

  tokenRefreshesInFlight.set(site.id, refresh);
  try {
    return await refresh;
  } finally {
    tokenRefreshesInFlight.delete(site.id);
  }
}

export async function disconnectStore(userId, googleSub, siteId) {
  const db = getDb();
  const [site] = await db`select * from connected_sites where id = ${siteId} and user_id = ${userId}`;
  if (!site) throw new Error('Store not found');

  // The local credential erase is authoritative for JarvisPayz. Remote OAuth
  // revocation is best-effort: an unavailable merchant must never prevent the
  // user from cutting off this application's access immediately.
  let remoteRevoked = !site.auth_token_ciphertext;
  let remoteRevocationError = null;
  let policyRevoked = !site.policy_synced_at;
  let policyRevocationError = null;
  if (site.auth_token_ciphertext) {
    try {
      const token = JSON.parse(decrypt(
        Buffer.from(site.auth_token_ciphertext, 'base64'),
        Buffer.from(site.auth_token_iv, 'base64'),
        Buffer.from(site.auth_token_tag, 'base64'),
        tokenScope(site.id),
      ));
      const client = readClient(site);
      const revocationUrl = site.oauth_server_metadata?.revocationUrl;
      if (!revocationUrl) throw new Error('The store did not provide an OAuth revocation endpoint');

      // Revoke the refresh token first because it prevents future access-token
      // renewal. Also send the access token where one exists; conforming stores
      // may invalidate the entire authorization grant on either request.
      ({ remoteRevoked } = await revokeStoreTokens({ token, client, revocationUrl }));
      if (!remoteRevoked) remoteRevocationError = 'The store did not confirm token revocation.';
    } catch (error) {
      remoteRevocationError = error.message || 'Remote token revocation could not be confirmed.';
    }
  }

  if (site.policy_synced_at) {
    try {
      await removeSitePolicy(userId, googleSub, site);
      policyRevoked = true;
    } catch (error) {
      policyRevocationError = error.message || 'On-chain trust-rule removal could not be confirmed.';
    }
  }

  await db`update connected_sites set
    auth_token_ciphertext = null, auth_token_iv = null, auth_token_tag = null,
    auth_token_expires_at = null, auth_scope = null, authorized_at = null,
    oauth_client_ciphertext = null, oauth_client_iv = null, oauth_client_tag = null,
    status = 'revoked',
    policy_sync_error = ${policyRevocationError},
    policy_synced_at = case when ${policyRevoked} then null else policy_synced_at end,
    updated_at = now()
    where id = ${site.id}`;
  await db`insert into audit_events (user_id, event_type, payload) values (${userId}, 'store_disconnected', ${db.json({ siteId: site.id, remoteRevoked, remoteRevocationError, policyRevoked, policyRevocationError })})`;
  return { success: true, remoteRevoked, remoteRevocationError, policyRevoked, policyRevocationError };
}
