import { BaseAdapter } from './adapter.base.js';
import config from '../../config/env.js';
import { getStoreAccessToken } from '../site-oauth.service.js';

/**
 * Adapter for a registered merchant's explicit agent API. It intentionally
 * does not scrape HTML or guess checkout endpoints: payment is only possible
 * after the merchant creates a verifiable order through this contract.
 */
export class EcommerceAdapter extends BaseAdapter {
  constructor(site) {
    super(site);
    this.definition = config.supportedStores.find((store) => store.id === site.adapter_id);
    if (!this.definition) throw new Error('This store has no registered adapter');
    this.apiBaseUrl = this.definition.apiBaseUrl;
  }

  async request(path, options = {}) {
    const token = await getStoreAccessToken(this.site);
    const response = await fetch(new URL(path, `${this.apiBaseUrl}/`), {
      ...options,
      headers: { Accept: 'application/json', Authorization: `${token.tokenType || 'Bearer'} ${token.accessToken}`, ...(options.headers || {}) },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Merchant API request failed (${response.status})`);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) throw new Error('Merchant API returned an invalid response type');
    return response.json();
  }

  async searchProducts(query, filters = {}) {
    const url = new URL('/api/agent/products', this.apiBaseUrl);
    url.searchParams.set('q', query);
    if (filters.maxPrice !== null && filters.maxPrice !== undefined) url.searchParams.set('maxPrice', String(filters.maxPrice));
    if (filters.minPrice !== null && filters.minPrice !== undefined) url.searchParams.set('minPrice', String(filters.minPrice));
    const body = await this.request(url.pathname + url.search);
    const products = Array.isArray(body.products) ? body.products : [];
    return products.map((product) => this.normalizeProduct(product)).filter((product) => product.id && product.name && product.price > 0 && product.inStock);
  }

  async prepareCheckout(product, quantity, idempotencyKey) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('Invalid quantity');
    const body = await this.request('/api/agent/checkout/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ productId: product.id, quantity }),
    });
    if (!body.orderId || !Number.isFinite(Number(body.xlmAmount)) || Number(body.xlmAmount) <= 0) {
      throw new Error('Merchant did not return a valid payable order');
    }
    if (body.merchantStellarAddress !== this.site.merchant_stellar_address) {
      throw new Error('Merchant payment destination does not match the registered store');
    }
    return body;
  }

  async confirmPayment(orderId, txHash, idempotencyKey) {
    const body = await this.request('/api/agent/checkout/confirm-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ orderId, stellarTransactionHash: txHash }),
    });
    if (body.status !== 'confirmed') throw new Error('Merchant has not confirmed the order');
    return body;
  }
}
