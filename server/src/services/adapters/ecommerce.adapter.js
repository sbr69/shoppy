import * as cheerio from 'cheerio';
import { BaseAdapter } from './adapter.base.js';

/**
 * Generic HTML Scraping Adapter.
 *
 * Scrapes product data from any e-commerce site by:
 * 1. Fetching the site's HTML pages
 * 2. Searching for product-like patterns (cards, listings)
 * 3. Extracting name, price, image, description from common HTML structures
 *
 * This adapter uses a set of common CSS selectors and heuristics
 * to find product data across different site structures.
 */
export class EcommerceAdapter extends BaseAdapter {
  constructor(site) {
    super(site);
  }

  /**
   * Search for products by fetching the site and scraping product listings.
   */
  async searchProducts(query, filters = {}) {
    try {
      // Strategy 1: Try common search URL patterns
      const searchUrls = this.buildSearchUrls(query);

      for (const url of searchUrls) {
        try {
          const products = await this.scrapeProductsFromUrl(url, query);
          if (products.length > 0) {
            let results = products;

            // Apply price filters
            if (filters.maxPrice) {
              results = results.filter(p => p.price <= filters.maxPrice);
            }
            if (filters.minPrice) {
              results = results.filter(p => p.price >= filters.minPrice);
            }

            return results;
          }
        } catch (err) {
          console.log(`  ↳ Failed to scrape ${url}: ${err.message}`);
          continue;
        }
      }

      // Strategy 2: Scrape the homepage for any products
      console.log(`  ↳ Trying homepage scrape: ${this.baseUrl}`);
      const homepageProducts = await this.scrapeProductsFromUrl(this.baseUrl, query);

      if (filters.maxPrice) {
        return homepageProducts.filter(p => p.price <= filters.maxPrice);
      }

      return homepageProducts;
    } catch (err) {
      console.error(`❌ Adapter error for ${this.siteName}:`, err.message);
      return [];
    }
  }

  /**
   * Build possible search URLs for a given query.
   */
  buildSearchUrls(query) {
    const encoded = encodeURIComponent(query);
    return [
      `${this.baseUrl}/search?q=${encoded}`,
      `${this.baseUrl}/search?query=${encoded}`,
      `${this.baseUrl}/products?search=${encoded}`,
      `${this.baseUrl}/api/products?search=${encoded}`,
      `${this.baseUrl}/?s=${encoded}`,
      `${this.baseUrl}/shop?q=${encoded}`,
    ];
  }

  /**
   * Fetch a URL and scrape product data from the HTML.
   */
  async scrapeProductsFromUrl(url, query = '') {
    console.log(`  🔍 Scraping: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';

    // If it's JSON, try to parse as API response
    if (contentType.includes('application/json')) {
      const json = await response.json();
      return this.extractProductsFromJson(json, query);
    }

    // Otherwise parse as HTML
    const html = await response.text();
    return this.extractProductsFromHtml(html, query);
  }

  /**
   * Extract products from a JSON API response.
   */
  extractProductsFromJson(json, query) {
    const products = [];

    // Try common JSON structures
    const items = json.products || json.items || json.data || json.results || (Array.isArray(json) ? json : []);

    for (const item of items) {
      if (typeof item !== 'object') continue;

      const product = this.normalizeProduct({
        id: item.id || item._id,
        name: item.name || item.title || item.product_name,
        price: item.price || item.sale_price || item.current_price,
        description: item.description || item.short_description || item.summary || '',
        image: item.image || item.thumbnail || item.image_url || item.images?.[0],
        url: item.url || item.link || item.permalink || (item.slug ? `${this.baseUrl}/product/${item.slug}` : null),
        rating: item.rating || item.average_rating,
        inStock: item.in_stock !== false && item.inStock !== false && item.stock !== 0,
        currency: item.currency || 'INR',
      });

      // Basic relevance check
      if (this.isRelevant(product, query)) {
        products.push(product);
      }
    }

    return products;
  }

  /**
   * Extract products from HTML using common e-commerce patterns.
   */
  extractProductsFromHtml(html, query) {
    const $ = cheerio.load(html);
    const products = [];

    // Common product container selectors (ordered by specificity)
    const containerSelectors = [
      '[data-product]',
      '.product-card',
      '.product-item',
      '.product',
      '.product-grid-item',
      '.product-list-item',
      '.item-card',
      '.card[data-id]',
      '.woocommerce-loop-product__link',
      '.s-result-item',
      'article.product',
      '.grid-item',
      '.collection-item',
    ];

    let $products = $([]);

    // Try each selector until we find products
    for (const selector of containerSelectors) {
      $products = $(selector);
      if ($products.length > 0) {
        console.log(`  ✓ Found ${$products.length} items with selector: ${selector}`);
        break;
      }
    }

    // If no known container found, try heuristic: look for price + name patterns
    if ($products.length === 0) {
      // Find any element containing a price-like pattern
      $products = $('*').filter(function () {
        const text = $(this).text();
        const hasPrice = /₹\s*[\d,]+|Rs\.?\s*[\d,]+|\$\s*[\d,]+/.test(text);
        const hasLink = $(this).find('a').length > 0;
        const isSmallEnough = text.length < 500;
        return hasPrice && hasLink && isSmallEnough;
      });

      if ($products.length > 0) {
        console.log(`  ✓ Found ${$products.length} items via heuristic price detection`);
      }
    }

    $products.each((_, el) => {
      const $el = $(el);

      const name = this.extractName($, $el);
      const price = this.extractPrice($, $el);

      if (!name || !price) return;

      const product = this.normalizeProduct({
        name,
        price,
        description: this.extractDescription($, $el),
        image: this.extractImage($, $el),
        url: this.extractUrl($, $el),
        rating: this.extractRating($, $el),
      });

      if (this.isRelevant(product, query)) {
        products.push(product);
      }
    });

    return products;
  }

  /**
   * Extract product name from an element.
   */
  extractName($, $el) {
    const selectors = [
      '.product-name', '.product-title', '.item-name', '.item-title',
      'h2', 'h3', 'h4',
      '[data-name]', '[data-title]',
      'a[title]',
      '.name', '.title',
    ];

    for (const sel of selectors) {
      const text = $el.find(sel).first().text().trim();
      if (text && text.length > 2 && text.length < 200) return text;
    }

    // Try data attribute
    const dataName = $el.attr('data-name') || $el.attr('data-title');
    if (dataName) return dataName;

    return null;
  }

  /**
   * Extract price from an element.
   */
  extractPrice($, $el) {
    const priceSelectors = [
      '.price', '.product-price', '.item-price', '.sale-price',
      '.current-price', '[data-price]', '.amount',
      'span.price', '.offer-price',
    ];

    for (const sel of priceSelectors) {
      const text = $el.find(sel).first().text().trim();
      const price = this.parsePrice(text);
      if (price > 0) return price;
    }

    // Try data attribute
    const dataPrice = $el.attr('data-price');
    if (dataPrice) return parseFloat(dataPrice);

    // Fallback: scan the element text for price patterns
    const text = $el.text();
    const match = text.match(/₹\s*([\d,]+(?:\.\d{2})?)|Rs\.?\s*([\d,]+(?:\.\d{2})?)/);
    if (match) {
      return parseFloat((match[1] || match[2]).replace(/,/g, ''));
    }

    return 0;
  }

  /**
   * Parse a price string to a number.
   */
  parsePrice(text) {
    if (!text) return 0;
    const cleaned = text.replace(/[₹$€£Rs.INR\s,]/gi, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Extract description from an element.
   */
  extractDescription($, $el) {
    const selectors = [
      '.product-description', '.item-description', '.description',
      '.summary', '.excerpt', 'p',
    ];

    for (const sel of selectors) {
      const text = $el.find(sel).first().text().trim();
      if (text && text.length > 10 && text.length < 500) return text;
    }

    return '';
  }

  /**
   * Extract image URL from an element.
   */
  extractImage($, $el) {
    const $img = $el.find('img').first();

    const src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src');

    if (src) {
      // Make absolute URL if relative
      if (src.startsWith('//')) return `https:${src}`;
      if (src.startsWith('/')) return `${this.baseUrl}${src}`;
      if (src.startsWith('http')) return src;
    }

    return null;
  }

  /**
   * Extract product URL from an element.
   */
  extractUrl($, $el) {
    const $link = $el.find('a').first();
    const href = $link.attr('href') || $el.attr('href');

    if (href) {
      if (href.startsWith('http')) return href;
      if (href.startsWith('/')) return `${this.baseUrl}${href}`;
    }

    return null;
  }

  /**
   * Extract rating from an element.
   */
  extractRating($, $el) {
    const ratingSelectors = ['.rating', '.stars', '[data-rating]', '.review-score'];

    for (const sel of ratingSelectors) {
      const $rating = $el.find(sel).first();
      const dataRating = $rating.attr('data-rating');
      if (dataRating) return parseFloat(dataRating);

      const text = $rating.text().trim();
      const match = text.match(/([\d.]+)\s*(?:\/\s*5|stars?|★)/i);
      if (match) return parseFloat(match[1]);
    }

    return null;
  }

  /**
   * Check if a product is relevant to the search query.
   */
  isRelevant(product, query) {
    if (!query) return true;

    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
    const text = `${product.name} ${product.description}`.toLowerCase();

    // At least one keyword must match
    return keywords.some(kw => text.includes(kw));
  }

  /**
   * Add a product to cart (placeholder — requires site-specific implementation).
   */
  async addToCart(product, quantity = 1) {
    console.log(`🛒 [${this.siteName}] Add to cart: ${product.name} x${quantity}`);
    // Phase 4 placeholder — site-specific cart logic will be added
    return {
      success: true,
      product,
      quantity,
      message: 'Added to cart (simulated)',
    };
  }

  /**
   * Execute checkout (placeholder — requires site-specific implementation).
   */
  async checkout(cartState) {
    console.log(`💳 [${this.siteName}] Checkout for:`, cartState);
    // Phase 4 placeholder — site-specific checkout logic will be added
    return {
      success: true,
      orderId: `ORD-${Date.now()}`,
      message: 'Checkout completed (simulated)',
    };
  }
}
