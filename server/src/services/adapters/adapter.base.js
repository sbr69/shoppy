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
    return {
      id: raw.id || null,
      name: raw.name || 'Unknown Product',
      price: parseFloat(raw.price) || 0,
      currency: raw.currency || 'INR',
      description: raw.description || '',
      image: raw.image || null,
      url: raw.url || null,
      rating: raw.rating || null,
      reviewCount: Number.isFinite(Number(raw.reviewCount ?? raw.review_count)) ? Number(raw.reviewCount ?? raw.review_count) : null,
      brand: raw.brand || null,
      category: raw.category || null,
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      attributes: Array.isArray(raw.attributes) ? raw.attributes : [],
      inStock: raw.inStock !== false,
      siteName: this.siteName,
      siteUrl: this.baseUrl,
    };
  }
}
