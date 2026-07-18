import test from 'node:test';
import assert from 'node:assert/strict';
import { EcommerceAdapter } from '../src/services/adapters/ecommerce.adapter.js';

const merchant = 'GAS7MXJI3CIRUPZTA75VBMJXAJGUYCLBPHCTZQWGC7OTVSAKZN553WYX';
const txHash = 'a'.repeat(64);
const site = {
  id: 'site-1',
  site_name: 'TestMarket',
  site_url: 'https://merchant.example',
  merchant_stellar_address: merchant,
  agent_manifest: {
    searchUrl: 'https://merchant.example/search',
    prepareUrl: 'https://merchant.example/prepare',
    confirmUrl: 'https://merchant.example/confirm',
  },
};

function adapter() {
  return new EcommerceAdapter(site, { accessTokenProvider: async () => ({ accessToken: 'test-token', tokenType: 'Bearer' }) });
}

test('merchant contract supports search, verified checkout preparation, and idempotent confirmation', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).startsWith(site.agent_manifest.searchUrl)) {
      return new Response(JSON.stringify({ products: [{ product_id: 'earbuds-1', name: 'Wireless earbuds', description: 'Noise isolation', price: 299, currency: 'XLM', stock: 8, rating: 4.6, image_url: null }] }), { headers: { 'content-type': 'application/json' } });
    }
    if (String(url) === site.agent_manifest.prepareUrl) {
      return new Response(JSON.stringify({ checkout_id: 'checkout-1', currency: 'XLM', amount_xlm: '299.0000000', merchant_stellar_address: merchant, network: 'testnet' }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ order_id: 'order-1', status: 'Processing' }), { headers: { 'content-type': 'application/json' } });
  };

  try {
    const products = await adapter().searchProducts('headphones', { maxPrice: 500 });
    assert.equal(products.length, 1);
    const checkout = await adapter().prepareCheckout(products[0], 1, 'idempotency-1', 'Shipping address');
    assert.equal(checkout.orderId, 'checkout-1');
    const confirmation = await adapter().confirmPayment(checkout.orderId, txHash, 'idempotency-1');
    assert.equal(confirmation.orderId, 'order-1');
    assert.match(String(requests[2].options.body), new RegExp(txHash));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('merchant contract rejects a checkout that changes the registered payment destination', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ checkout_id: 'checkout-1', currency: 'XLM', amount_xlm: '1.0000000', merchant_stellar_address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', network: 'testnet' }), { headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(() => adapter().prepareCheckout({ id: 'product-1' }, 1, 'idempotency-2', 'Address'), /destination does not match/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('merchant outage is surfaced as retryable confirmation failure without fabricating an order', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Maintenance window' }), { status: 503, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(() => adapter().confirmPayment('checkout-1', txHash, 'idempotency-3'), /503.*Maintenance window/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

