import { BaseAdapter } from './adapter.base.js';
import { getStoreAccessToken } from '../site-oauth.service.js';

/**
 * Adapter for a registered merchant's explicit agent API. It intentionally
 * does not scrape HTML or guess checkout endpoints: payment is only possible
 * after the merchant creates a verifiable order through this contract.
 */
export class EcommerceAdapter extends BaseAdapter {
  constructor(site, { accessTokenProvider = getStoreAccessToken } = {}) {
    super(site);
    this.manifest = site.agent_manifest;
    this.accessTokenProvider = accessTokenProvider;
    if (!this.manifest?.searchUrl || !this.manifest?.prepareUrl || !this.manifest?.confirmUrl) throw new Error('Store agent-commerce metadata is unavailable');
  }

  async request(url, options = {}) {
    const token = await this.accessTokenProvider(this.site);
    const response = await fetch(url, {
      ...options,
      headers: { Accept: 'application/json', Authorization: `${token.tokenType || 'Bearer'} ${token.accessToken}`, ...(options.headers || {}) },
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = typeof body?.error === 'string' ? `: ${body.error.slice(0, 240)}` : '';
      } catch {
        // Do not expose an arbitrary merchant response body in user-facing logs.
      }
      throw new Error(`Merchant API request failed (${response.status})${detail}`);
    }
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) throw new Error('Merchant API returned an invalid response type');
    return response.json();
  }

  async searchProducts(query, filters = {}) {
    const url = new URL(this.manifest.searchUrl);
    url.searchParams.set('q', query);
    if (filters.maxPrice !== null && filters.maxPrice !== undefined) url.searchParams.set('maxPrice', String(filters.maxPrice));
    if (filters.minPrice !== null && filters.minPrice !== undefined) url.searchParams.set('minPrice', String(filters.minPrice));
    const body = await this.request(url);
    const products = Array.isArray(body.products) ? body.products : [];
    return products.map((product) => this.normalizeProduct({ ...product, id: product.product_id, image: product.image_url, inStock: Number(product.stock) > 0 })).filter((product) => product.id && product.name && product.price > 0 && product.inStock);
  }

  async prepareCheckout(product, quantity, idempotencyKey, deliveryAddress) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('Invalid quantity');
    const body = await this.request(this.manifest.prepareUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ items: [{ product_id: product.id, quantity }], delivery_address: deliveryAddress }),
    });
    if (!body.checkout_id || body.currency !== 'XLM' || !Number.isFinite(Number(body.amount_xlm)) || Number(body.amount_xlm) <= 0) {
      throw new Error('Merchant did not return a valid payable order');
    }
    if (body.merchant_stellar_address !== this.site.merchant_stellar_address || body.network !== 'testnet') {
      throw new Error('Merchant payment destination does not match the registered store');
    }
    return { ...body, orderId: body.checkout_id, xlmAmount: Number(body.amount_xlm) };
  }

  async confirmPayment(orderId, txHash, idempotencyKey) {
    const body = await this.request(this.manifest.confirmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ checkout_id: orderId, payment_method: `Stellar Wallet (Tx: ${txHash})` }),
    });
    if (!body.order_id) throw new Error('Merchant has not confirmed the order');
    return { ...body, status: 'confirmed', orderId: body.order_id };
  }
}
