import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshStoreToken, revokeStoreTokens, tokenNeedsRefresh } from '../src/services/site-oauth.service.js';

const client = { clientId: 'client-1', clientSecret: 'secret-1' };
const token = { accessToken: 'old-access', refreshToken: 'old-refresh', tokenType: 'Bearer', expiresAt: '2026-01-01T00:00:00.000Z', scope: 'profile checkout:confirm' };

test('expired merchant OAuth access tokens are refreshed and rotation is preserved', async () => {
  const refreshed = await refreshStoreToken({
    token,
    client,
    tokenUrl: 'https://merchant.example/oauth/token',
    now: Date.parse('2026-01-01T00:00:00.000Z'),
    fetchImpl: async (_url, options) => {
      assert.match(String(options.body), /grant_type=refresh_token/);
      return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 900 }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(refreshed.accessToken, 'new-access');
  assert.equal(refreshed.refreshToken, 'new-refresh');
  assert.equal(tokenNeedsRefresh(refreshed, Date.parse('2026-01-01T00:00:00.000Z')), false);
});

test('failed refresh forces a reconnect instead of reusing an expired token', async () => {
  await assert.rejects(
    () => refreshStoreToken({ token, client, tokenUrl: 'https://merchant.example/oauth/token', fetchImpl: async () => new Response('', { status: 401 }) }),
    /Reconnect the store/i,
  );
});

test('revocation attempts both refresh and access tokens and reports partial failure', async () => {
  const calls = [];
  const result = await revokeStoreTokens({
    token,
    client,
    revocationUrl: 'https://merchant.example/oauth/revoke',
    fetchImpl: async (_url, options) => {
      calls.push(String(options.body));
      return new Response('', { status: calls.length === 1 ? 200 : 503 });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.remoteRevoked, false);
});

