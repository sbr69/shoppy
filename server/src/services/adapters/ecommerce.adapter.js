import { BaseAdapter } from './adapter.base.js';
import { getStoreAccessToken } from '../site-oauth.service.js';
import getDb from '../../db/database.js';

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
    if (typeof filters.category === 'string' && filters.category.trim()) url.searchParams.set('category', filters.category.trim());
    if (filters.inStock !== undefined) url.searchParams.set('in_stock', String(Boolean(filters.inStock)));
    if (typeof filters.sort === 'string' && filters.sort.trim()) url.searchParams.set('sort', filters.sort.trim());
    if (Number.isInteger(filters.limit) && filters.limit > 0) url.searchParams.set('limit', String(Math.min(filters.limit, 100)));
    if (Number.isInteger(filters.offset) && filters.offset >= 0) url.searchParams.set('offset', String(filters.offset));
    const body = await this.request(url);
    const products = Array.isArray(body.products) ? body.products : [];
    return products.map((product) => {
      const category = typeof product.category === 'object' && product.category
        ? (product.category.slug || product.category.name || null)
        : product.category;
      return this.normalizeProduct({
        ...product,
        id: product.product_id,
        price: product.price ?? product.price_xlm,
        image: product.image_url,
        category,
        categoryName: product.category_name,
        productType: product.product_type,
        taxonomyPath: product.taxonomy_path,
        searchAliases: product.search_aliases,
        merchantRelevance: product.relevance,
        inStock: product.availability ? product.availability === 'in_stock' : Number(product.stock) > 0,
      });
    }).filter((product) => product.id && product.name && product.price > 0 && product.inStock);
  }

  async reviewUrlTemplate() {
    if (this.manifest?.reviewsUrlTemplate) return this.manifest.reviewsUrlTemplate;
    // Existing connections retain their OAuth session. Refresh only the public
    // merchant capability document so users never have to reconnect to obtain
    // a newly published read-only reviews capability.
    try {
      const origin = new URL(this.baseUrl).origin;
      const response = await fetch(`${origin}/.well-known/agent-commerce?capability=reviews-v1`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000), redirect: 'error',
      });
      const metadata = response.ok ? await response.json() : null;
      const template = typeof metadata?.reviews_endpoint_template === 'string' ? metadata.reviews_endpoint_template : null;
      if (!template || !template.includes('{product_id}')) return null;
      const sample = new URL(template.replace('{product_id}', 'sample-product'));
      if (sample.protocol !== 'https:' || sample.origin !== origin) return null;
      this.manifest = { ...this.manifest, reviewsUrlTemplate: template };
      const db = getDb();
      await db`update connected_sites set agent_manifest = ${db.json(this.manifest)}, updated_at = now() where id = ${this.site.id}`;
      return template;
    } catch (error) {
      console.warn('Merchant review capability discovery skipped:', error.message);
      return null;
    }
  }

  async getProductReviews(product, limit = 12) {
    const template = await this.reviewUrlTemplate();
    if (!template || !product?.id) return null;
    const url = new URL(template.replace('{product_id}', encodeURIComponent(String(product.id))));
    url.searchParams.set('limit', String(Math.min(Math.max(Number(limit) || 12, 1), 50)));
    const body = await this.request(url);
    if (!Array.isArray(body)) throw new Error('Merchant review endpoint returned an invalid response');
    return body.slice(0, 50).map((review) => ({
      rating: Number(review?.rating),
      title: String(review?.title || '').slice(0, 180),
      body: String(review?.body || '').slice(0, 1_500),
      verified: Boolean(review?.verified),
      date: review?.date || null,
    })).filter((review) => Number.isFinite(review.rating) && review.rating >= 1 && review.rating <= 5 && review.body);
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
