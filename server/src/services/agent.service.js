import { v4 as uuidv4 } from 'uuid';
import getDb from '../db/database.js';
import { parseIntent } from './intent.service.js';
import { rankProducts } from './product.service.js';
import { EcommerceAdapter } from './adapters/ecommerce.adapter.js';

/**
 * The Agent Orchestrator.
 *
 * Flow:
 * 1. Parse user intent (LLM Call 1)
 * 2. Route based on action type
 * 3. For "search" → query connected sites with real adapters → rank products (LLM Call 2)
 * 4. For "confirm_purchase" → execute purchase (Phase 5)
 * 5. For other actions → respond conversationally
 */
export async function processMessage(userId, sessionId, message) {
  const db = getDb();

  // Save user message
  const userMsgId = uuidv4();
  db.prepare(
    'INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)'
  ).run(userMsgId, sessionId, 'user', message);

  // 1. Parse intent
  const intent = await parseIntent(message);
  console.log('🧠 Intent:', JSON.stringify(intent, null, 2));

  let agentResponse;

  switch (intent.action) {
    case 'search':
      agentResponse = await handleSearch(userId, intent);
      break;

    case 'confirm_purchase':
      agentResponse = await handleConfirmPurchase(userId, sessionId);
      break;

    case 'cancel':
      agentResponse = handleCancel(sessionId);
      break;

    case 'greeting':
      agentResponse = handleGreeting();
      break;

    case 'question':
      agentResponse = handleQuestion(message);
      break;

    default:
      agentResponse = {
        type: 'text',
        content: "I'm your shopping assistant! Tell me what you'd like to buy. For example: \"buy wireless earbuds under 2000 rupees\"",
      };
  }

  // Save agent response
  const agentMsgId = uuidv4();
  db.prepare(
    'INSERT INTO messages (id, session_id, role, content, metadata) VALUES (?, ?, ?, ?, ?)'
  ).run(agentMsgId, sessionId, 'agent', agentResponse.content, JSON.stringify(agentResponse.metadata || null));

  return {
    id: agentMsgId,
    ...agentResponse,
  };
}

/**
 * Handle product search — now uses real adapters to scrape connected sites.
 */
async function handleSearch(userId, intent) {
  const db = getDb();

  // Get connected sites
  const sites = db.prepare(
    'SELECT * FROM connected_sites WHERE user_id = ? AND status = ?'
  ).all(userId, 'active');

  if (sites.length === 0) {
    return {
      type: 'text',
      content: "You don't have any connected stores yet. Open the sidebar and click \"+ Connect Store\" to add an e-commerce site first, then I can search for products there.",
    };
  }

  // Search across all connected sites using adapters
  console.log(`\n🔍 Searching ${sites.length} site(s) for: "${intent.product}"`);

  const allProducts = [];
  const searchErrors = [];

  for (const site of sites) {
    try {
      const adapter = new EcommerceAdapter(site);
      const products = await adapter.searchProducts(intent.product, {
        maxPrice: intent.maxPrice,
        minPrice: intent.minPrice,
      });
      console.log(`  ✓ ${site.site_name}: ${products.length} products found`);
      allProducts.push(...products);
    } catch (err) {
      console.error(`  ✗ ${site.site_name}: ${err.message}`);
      searchErrors.push({ site: site.site_name, error: err.message });
    }
  }

  // If scraping found nothing, fall back to mock data for demo purposes
  if (allProducts.length === 0) {
    console.log('  ↳ No products from scrapers, using mock catalog');
    const mockProducts = getMockProducts(sites, intent);

    if (mockProducts.length === 0) {
      let errorMsg = `I couldn't find any "${intent.product}" on your connected stores.`;
      if (searchErrors.length > 0) {
        errorMsg += ` Some stores had issues: ${searchErrors.map(e => e.site).join(', ')}.`;
      }
      errorMsg += ` Try a different search term or check if the store is accessible.`;
      return { type: 'text', content: errorMsg };
    }

    return await buildProductSuggestion(userId, mockProducts, intent, true);
  }

  return await buildProductSuggestion(userId, allProducts, intent, false);
}

/**
 * Build a product suggestion response after ranking.
 */
async function buildProductSuggestion(userId, products, intent, isMock) {
  // Rank products (LLM Call 2)
  const { bestMatch, reasoning } = await rankProducts(products, intent);

  if (!bestMatch) {
    return {
      type: 'text',
      content: `I found some products but none match your criteria well. Try broadening your search.`,
    };
  }

  // Store the pending product for confirmation
  const pendingKey = `pending_${userId}`;
  pendingPurchases.set(pendingKey, {
    product: bestMatch,
    intent,
    timestamp: Date.now(),
  });

  const content = isMock
    ? `I found a match for you! (Using demo catalog — connect a real store for live results)`
    : `I found a great match for you from ${bestMatch.siteName}!`;

  return {
    type: 'product_suggestion',
    content,
    metadata: {
      product: bestMatch,
      reasoning,
      totalResults: products.length,
      intent,
      isMock,
    },
  };
}

// In-memory store for pending purchases
const pendingPurchases = new Map();

/**
 * Handle purchase confirmation.
 */
async function handleConfirmPurchase(userId, sessionId) {
  const pendingKey = `pending_${userId}`;
  const pending = pendingPurchases.get(pendingKey);

  if (!pending) {
    return {
      type: 'text',
      content: "There's nothing pending for me to purchase. Search for a product first, and I'll ask for your confirmation before buying.",
    };
  }

  // Check if the pending purchase is stale (> 10 minutes)
  if (Date.now() - pending.timestamp > 10 * 60 * 1000) {
    pendingPurchases.delete(pendingKey);
    return {
      type: 'text',
      content: "The previous product suggestion has expired. Please search again.",
    };
  }

  const { product } = pending;
  pendingPurchases.delete(pendingKey);

  // Phase 5 will add real Stellar payment + checkout here
  return {
    type: 'purchase_pending',
    content: `Purchasing "${product.name}" for ${product.currency === 'INR' ? '₹' : product.currency}${product.price?.toLocaleString()}... This will be completed with Stellar payment in the next update.`,
    metadata: {
      product,
      status: 'pending_payment',
      message: 'Stellar payment integration coming in Phase 5.',
    },
  };
}

/**
 * Handle cancellation.
 */
function handleCancel(sessionId) {
  return {
    type: 'text',
    content: "No problem! The purchase has been cancelled. Let me know if you'd like to search for something else.",
  };
}

/**
 * Handle greeting.
 */
function handleGreeting() {
  const greetings = [
    "Hey there! 👋 I'm your AI shopping assistant. Tell me what you'd like to buy, and I'll find the best deal across your connected stores.",
    "Hello! 🛍️ Ready to shop? Just tell me what you need — like \"buy wireless earbuds under ₹2000\" — and I'll handle the rest.",
    "Hi! ⚡ I'm JarvisPayz, your shopping agent. What can I help you find today?",
  ];
  return {
    type: 'text',
    content: greetings[Math.floor(Math.random() * greetings.length)],
  };
}

/**
 * Handle general questions.
 */
function handleQuestion(message) {
  return {
    type: 'text',
    content: "I'm your shopping assistant! I can search for products on your connected stores and make purchases on your behalf. Try saying something like:\n\n• \"Buy wireless earbuds under ₹2000\"\n• \"Find me a laptop bag\"\n• \"Get 10 pens\"",
  };
}

/**
 * Mock product catalog — fallback when real scraping returns no results.
 */
function getMockProducts(sites, intent) {
  const siteName = sites[0]?.site_name || 'Store';
  const mockCatalog = [
    { name: 'Wireless Bluetooth Earbuds Pro', price: 1499, currency: 'INR', description: 'Premium wireless earbuds with ANC, 30hr battery', rating: 4.5, inStock: true, image: null, url: '#', siteName },
    { name: 'Budget Wireless Earbuds', price: 599, currency: 'INR', description: 'Lightweight earbuds with 20hr battery, IPX4', rating: 4.0, inStock: true, image: null, url: '#', siteName },
    { name: 'Premium ANC Headphones', price: 3499, currency: 'INR', description: 'Over-ear headphones with active noise cancellation', rating: 4.7, inStock: true, image: null, url: '#', siteName },
    { name: 'Gaming Earbuds RGB', price: 999, currency: 'INR', description: 'Low latency gaming earbuds with RGB lighting', rating: 4.2, inStock: true, image: null, url: '#', siteName },
    { name: 'Ballpoint Pen Set (10 Pack)', price: 149, currency: 'INR', description: 'Smooth writing ballpoint pens, blue ink, 10-pack', rating: 4.3, inStock: true, image: null, url: '#', siteName },
    { name: 'Premium Gel Pens (10 Pack)', price: 299, currency: 'INR', description: 'Smooth gel pens with comfort grip, assorted colors', rating: 4.6, inStock: true, image: null, url: '#', siteName },
    { name: 'Laptop Backpack', price: 1299, currency: 'INR', description: 'Water-resistant laptop backpack with USB port', rating: 4.4, inStock: true, image: null, url: '#', siteName },
    { name: 'USB-C Hub 7-in-1', price: 899, currency: 'INR', description: 'USB-C hub with HDMI, USB 3.0, SD card reader', rating: 4.1, inStock: true, image: null, url: '#', siteName },
    { name: 'Mechanical Keyboard', price: 2499, currency: 'INR', description: 'RGB mechanical keyboard with blue switches', rating: 4.5, inStock: true, image: null, url: '#', siteName },
    { name: 'Wireless Mouse', price: 499, currency: 'INR', description: 'Ergonomic wireless mouse, 1600 DPI, USB receiver', rating: 4.3, inStock: true, image: null, url: '#', siteName },
  ];

  const query = (intent.product || '').toLowerCase();
  const keywords = query.split(/\s+/).filter(k => k.length > 2);

  let results = mockCatalog.filter(p => {
    const text = `${p.name} ${p.description}`.toLowerCase();
    return keywords.some(kw => text.includes(kw));
  });

  if (intent.maxPrice) {
    results = results.filter(p => p.price <= intent.maxPrice);
  }

  if (results.length === 0 && keywords.length > 0) {
    results = mockCatalog.slice(0, 3);
  }

  return results;
}

/**
 * Get or create a chat session for the user.
 */
export function getOrCreateSession(userId) {
  const db = getDb();

  let session = db.prepare(
    'SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(userId);

  if (!session) {
    const sessionId = uuidv4();
    db.prepare('INSERT INTO chat_sessions (id, user_id) VALUES (?, ?)').run(sessionId, userId);
    session = { id: sessionId, user_id: userId };
  }

  return session;
}

/**
 * Get message history for a session.
 */
export function getSessionMessages(sessionId, limit = 50) {
  const db = getDb();
  return db.prepare(
    'SELECT id, role, content, metadata, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?'
  ).all(sessionId, limit);
}
