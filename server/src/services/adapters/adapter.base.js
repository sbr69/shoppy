/**
 * Base E-commerce Adapter Interface.
 *
 * Every connected e-commerce site gets an adapter that knows how to:
 * - Search products on that site
 * - Add items to cart
 * - Execute checkout
 *
 * Subclasses override these methods with site-specific logic.
 */
export class BaseAdapter {
  constructor(site) {
    this.site = site;
    this.baseUrl = site.site_url;
    this.siteName = site.site_name;
  }

  /**
   * Search for products matching the query.
   * @param {string} query - Product search term
   * @param {object} filters - { maxPrice, minPrice, category }
   * @returns {Promise<Array>} Array of product objects
   */
  async searchProducts(query, filters = {}) {
    throw new Error('searchProducts() not implemented');
  }

  /**
   * Add a product to the cart.
   * @param {object} product - Product object from search results
   * @param {number} quantity - Quantity to add
   * @returns {Promise<object>} Cart state
   */
  async addToCart(product, quantity = 1) {
    throw new Error('addToCart() not implemented');
  }

  /**
   * Execute checkout.
   * @param {object} cartState - Current cart state
   * @returns {Promise<object>} Order confirmation
   */
  async checkout(cartState) {
    throw new Error('checkout() not implemented');
  }

  /**
   * Normalize a product object to a consistent shape.
   */
  normalizeProduct(raw) {
    const text = (value) => typeof value === 'string' || typeof value === 'number'
      ? String(value).trim().slice(0, 500)
      : '';
    const textList = (value) => {
      const entries = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
      return entries.map((entry) => {
        const direct = text(entry);
        if (direct) return direct;
        if (!entry || typeof entry !== 'object') return '';
        const key = text(entry.key ?? entry.name ?? entry.label);
        const attributeValue = entry.value ?? entry.values ?? entry.text;
        const values = Array.isArray(attributeValue)
          ? attributeValue.map(text).filter(Boolean).join(', ')
          : text(attributeValue);
        return key && values ? `${key}: ${values}` : key || values;
      }).filter(Boolean);
    };
    const finiteNumberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

    return {
      id: raw.id || null,
      name: raw.name || 'Unknown Product',
      price: parseFloat(raw.price) || 0,
      currency: raw.currency || 'INR',
      description: raw.description || '',
      image: raw.image || null,
      url: raw.url || null,
      rating: raw.rating || null,
      reviewCount: (() => {
        const value = raw.reviewCount ?? raw.review_count;
        return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
      })(),
      brand: raw.brand || null,
      category: raw.category || null,
      categoryName: raw.categoryName || raw.category_name || null,
      productType: raw.productType || raw.product_type || null,
      seller: raw.seller || null,
      tags: textList(raw.tags),
      attributes: textList(raw.attributes),
      taxonomyPath: textList(raw.taxonomyPath ?? raw.taxonomy_path),
      searchAliases: textList(raw.searchAliases ?? raw.search_aliases),
      // Merchant relevance is a discovery hint only. It is deliberately kept
      // separate from the agent's embedding-derived semanticScore so a store
      // can never override the agent's semantic or payment safeguards.
      merchantRelevance: finiteNumberOrNull(raw.merchantRelevance ?? raw.merchant_relevance ?? raw.relevance),
      inStock: raw.inStock !== false,
      siteName: this.siteName,
      siteUrl: this.baseUrl,
    };
  }
}
