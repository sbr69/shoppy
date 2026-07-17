import { createHash, randomBytes } from 'crypto';
import config from '../config/env.js';
import getDb from '../db/database.js';
import { decrypt, encrypt } from './crypto.service.js';
import { getOrCreateOAuthSite } from './site.service.js';

const OAUTH_TTL_MS = 10 * 60 * 1000;
const base64Url = (value) => Buffer.from(value).toString('base64url');
const stateHash = (state) => createHash('sha256').update(state).digest('hex');
const attemptScope = (hash) => `store-oauth-attempt:${hash}`;
const tokenScope = (siteId) => `store-oauth-token:${siteId}`;

function callbackUrl() { return new URL('/api/sites/oauth/callback', `${config.serverPublicUrl}/`).toString(); }

function safeDashboardRedirect(params) {
  const url = new URL('/dashboard', `${config.clientUrl}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** Start OAuth authorization code flow; this endpoint deliberately never accepts a return URL. */
export async function startStoreOAuth(userId, input) {
  const { site, store } = await getOrCreateOAuthSite(userId, input);
  const state = randomBytes(32).toString('base64url');
  const hash = stateHash(state);
  const verifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  const sealed = encrypt(verifier, attemptScope(hash));
  const db = getDb();
  await db`delete from site_oauth_attempts where user_id = ${userId} and site_id = ${site.id} and consumed_at is null`;
  await db`insert into site_oauth_attempts (user_id, site_id, state_hash, code_verifier_ciphertext, code_verifier_iv, code_verifier_tag, expires_at)
    values (${userId}, ${site.id}, ${hash}, ${sealed.encrypted.toString('base64')}, ${sealed.iv.toString('base64')}, ${sealed.authTag.toString('base64')}, ${new Date(Date.now() + OAUTH_TTL_MS).toISOString()})`;
  const authorize = new URL(store.oauth.authorizationUrl);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', store.oauth.clientId);
  authorize.searchParams.set('redirect_uri', callbackUrl());
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', codeChallenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  if (store.oauth.scopes.length) authorize.searchParams.set('scope', store.oauth.scopes.join(' '));
  return { authorizationUrl: authorize.toString(), site: { id: site.id, siteUrl: site.site_url, siteName: site.site_name } };
}

export async function completeStoreOAuth({ code, state, error, errorDescription }) {
  if (error) return { redirectUrl: safeDashboardRedirect({ storeConnection: 'failed' }), error: errorDescription || error };
  if (typeof code !== 'string' || code.length > 10_000 || typeof state !== 'string' || state.length > 512) return { redirectUrl: safeDashboardRedirect({ storeConnection: 'failed' }), error: 'Invalid OAuth callback' };
  const hash = stateHash(state);
  const db = getDb();
  const [claimed] = await db`update site_oauth_attempts set consumed_at = now() where state_hash = ${hash} and consumed_at is null and expires_at > now() returning *`;
  if (!claimed) return { redirectUrl: safeDashboardRedirect({ storeConnection: 'failed' }), error: 'This store connection expired or was already completed' };
  const [site] = await db`select adapter_id, site_url, site_name from connected_sites where id = ${claimed.site_id}`;
  const attempt = { ...claimed, ...site };
  const store = config.supportedStores.find((candidate) => candidate.id === attempt.adapter_id && candidate.origin === attempt.site_url);
  if (!store?.oauth) return { redirectUrl: safeDashboardRedirect({ storeConnection: 'failed' }), error: 'Store OAuth configuration is unavailable' };
  try {
    const verifier = decrypt(Buffer.from(attempt.code_verifier_ciphertext, 'base64'), Buffer.from(attempt.code_verifier_iv, 'base64'), Buffer.from(attempt.code_verifier_tag, 'base64'), attemptScope(hash));
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(), client_id: store.oauth.clientId, code_verifier: verifier });
    if (store.oauth.clientSecret) body.set('client_secret', store.oauth.clientSecret);
    const response = await fetch(store.oauth.tokenUrl, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Token exchange failed (${response.status})`);
    const token = await response.json();
    if (!token?.access_token || typeof token.access_token !== 'string') throw new Error('Token response did not include an access token');
    const expiresAt = Number.isFinite(Number(token.expires_in)) ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null;
    const sealed = encrypt(JSON.stringify({ accessToken: token.access_token, refreshToken: token.refresh_token || null, tokenType: token.token_type || 'Bearer', expiresAt, scope: token.scope || store.oauth.scopes.join(' ') }), tokenScope(attempt.site_id));
    await db.begin(async (tx) => {
      await tx`update connected_sites set auth_token_ciphertext = ${sealed.encrypted.toString('base64')}, auth_token_iv = ${sealed.iv.toString('base64')}, auth_token_tag = ${sealed.authTag.toString('base64')}, auth_token_expires_at = ${expiresAt}, auth_scope = ${token.scope || store.oauth.scopes.join(' ')}, authorized_at = now(), status = 'active', updated_at = now() where id = ${attempt.site_id}`;
      await tx`insert into audit_events (user_id, event_type, payload) values (${attempt.user_id}, 'store_oauth_connected', ${tx.json({ siteId: attempt.site_id, siteUrl: attempt.site_url, scopes: token.scope || store.oauth.scopes })})`;
    });
    return { redirectUrl: safeDashboardRedirect({ storeConnection: 'success', siteId: attempt.site_id }) };
  } catch (exchangeError) {
    await db`update connected_sites set status = 'pending_authorization', policy_sync_error = ${exchangeError.message}, updated_at = now() where id = ${attempt.site_id}`;
    return { redirectUrl: safeDashboardRedirect({ storeConnection: 'failed' }), error: exchangeError.message };
  }
}

export async function getStoreAccessToken(site) {
  if (!site.auth_token_ciphertext || !site.auth_token_iv || !site.auth_token_tag) throw new Error('The store is not authorized');
  const value = decrypt(Buffer.from(site.auth_token_ciphertext, 'base64'), Buffer.from(site.auth_token_iv, 'base64'), Buffer.from(site.auth_token_tag, 'base64'), tokenScope(site.id));
  const token = JSON.parse(value);
  // Refresh a minute early so an in-flight checkout cannot start with a token
  // that expires while the merchant processes it.
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now() + 60_000) {
    if (!token.refreshToken) throw new Error('Store authorization expired. Reconnect the store to continue.');
    const store = config.supportedStores.find((candidate) => candidate.id === site.adapter_id);
    if (!store?.oauth) throw new Error('Store OAuth configuration is unavailable');
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refreshToken, client_id: store.oauth.clientId });
    if (store.oauth.clientSecret) body.set('client_secret', store.oauth.clientSecret);
    const response = await fetch(store.oauth.tokenUrl, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw new Error('Store authorization expired. Reconnect the store to continue.');
    const refreshed = await response.json();
    if (!refreshed?.access_token) throw new Error('Store authorization refresh returned no access token');
    token.accessToken = refreshed.access_token;
    token.refreshToken = refreshed.refresh_token || token.refreshToken;
    token.tokenType = refreshed.token_type || token.tokenType || 'Bearer';
    token.expiresAt = Number.isFinite(Number(refreshed.expires_in)) ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString() : null;
    token.scope = refreshed.scope || token.scope;
    const sealed = encrypt(JSON.stringify(token), tokenScope(site.id));
    await getDb()`update connected_sites set auth_token_ciphertext = ${sealed.encrypted.toString('base64')}, auth_token_iv = ${sealed.iv.toString('base64')}, auth_token_tag = ${sealed.authTag.toString('base64')}, auth_token_expires_at = ${token.expiresAt}, auth_scope = ${token.scope || null}, updated_at = now() where id = ${site.id}`;
  }
  return token;
}
