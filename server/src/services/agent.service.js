import { v4 as uuidv4 } from 'uuid';
import getDb from '../db/database.js';
import { parseIntent } from './intent.service.js';
import { rankProducts } from './product.service.js';
import { EcommerceAdapter } from './adapters/ecommerce.adapter.js';
import { executePayment } from './payment.service.js';
import { markIntentState, reserveSpend } from './policy.service.js';

const INTENT_TTL_MS = 10 * 60 * 1000;

export async function processMessage(userId, sessionId, message, googleSub) {
  const db = getDb();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)')
    .run(uuidv4(), sessionId, 'user', message);

  const intent = await parseIntent(message);
  let agentResponse;
  switch (intent.action) {
    case 'search': agentResponse = await handleSearch(userId, sessionId, intent); break;
    case 'confirm_purchase': agentResponse = await handleConfirmation(userId, sessionId, googleSub, intent.purchaseIntentId); break;
    case 'cancel': agentResponse = handleCancel(userId, sessionId); break;
    case 'greeting': agentResponse = handleGreeting(); break;
    default: agentResponse = handleQuestion(); break;
  }

  const id = uuidv4();
  db.prepare('INSERT INTO messages (id, session_id, role, content, metadata) VALUES (?, ?, ?, ?, ?)')
    .run(id, sessionId, 'agent', agentResponse.content, JSON.stringify(agentResponse.metadata || null));
  return { id, ...agentResponse };
}

async function handleSearch(userId, sessionId, intent) {
  const db = getDb();
  const sites = db.prepare("SELECT * FROM connected_sites WHERE user_id = ? AND status = 'active'").all(userId);
  if (!sites.length) {
    return { type: 'text', content: 'You do not have an active, authorized store. Connect a registered store and complete its authorization before searching.' };
  }

  const results = await Promise.allSettled(sites.map(async (site) => {
    const adapter = new EcommerceAdapter(site);
    const products = await adapter.searchProducts(intent.product, { maxPrice: intent.maxPrice, minPrice: intent.minPrice });
    return products.map((product) => ({ ...product, siteId: site.id }));
  }));
  const products = results.filter((result) => result.status === 'fulfilled').flatMap((result) => result.value);
  if (!products.length) {
    const unavailable = results.filter((result) => result.status === 'rejected').length;
    return { type: 'text', content: unavailable ? 'I could not retrieve live inventory from your authorized stores. Please reconnect the store or try again.' : `No live, in-stock products match “${intent.product}”.` };
  }

  const { bestMatch, reasoning } = await rankProducts(products, intent);
  if (!bestMatch?.id || !bestMatch.siteId) return { type: 'text', content: 'I found products but could not safely identify one to purchase.' };
  const site = sites.find((candidate) => candidate.id === bestMatch.siteId);
  const id = uuidv4();
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS).toISOString();
  const quantity = Math.min(Math.max(Number(intent.quantity) || 1, 1), 100);
  db.prepare(
    `INSERT INTO purchase_intents (id, user_id, session_id, site_id, product_json, quantity, state, idempotency_key, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'selected', ?, ?)`
  ).run(id, userId, sessionId, site.id, JSON.stringify(bestMatch), quantity, uuidv4(), expiresAt);

  return {
    type: 'product_suggestion',
    content: `I found a live match at ${site.site_name}. I will obtain the merchant’s final total before any Stellar payment.`,
    metadata: { product: bestMatch, reasoning, purchaseIntentId: id, quantity, expiresAt, policy: { dailyCapXlm: site.spending_cap, autoConfirmThresholdXlm: site.auto_confirm_threshold } },
  };
}

function findIntent(userId, sessionId, requestedId) {
  const db = getDb();
  if (requestedId) return db.prepare('SELECT * FROM purchase_intents WHERE id = ? AND user_id = ? AND session_id = ?').get(requestedId, userId, sessionId);
  return db.prepare(
    `SELECT * FROM purchase_intents WHERE user_id = ? AND session_id = ?
     AND state IN ('selected', 'confirmed') ORDER BY updated_at DESC LIMIT 1`
  ).get(userId, sessionId);
}

async function handleConfirmation(userId, sessionId, googleSub, requestedId) {
  const db = getDb();
  const purchaseIntent = findIntent(userId, sessionId, requestedId);
  if (!purchaseIntent) return { type: 'text', content: 'There is no purchase awaiting confirmation in this chat.' };
  if (new Date(purchaseIntent.expires_at).getTime() <= Date.now()) {
    markIntentState(purchaseIntent.id, 'expired', { reserved_xlm: 0 });
    return { type: 'text', content: 'That product selection expired. Please search again so I can re-check price and stock.' };
  }
  const site = db.prepare("SELECT * FROM connected_sites WHERE id = ? AND user_id = ? AND status = 'active'").get(purchaseIntent.site_id, userId);
  if (!site) return { type: 'text', content: 'The selected store is no longer active or authorized.' };
  const product = JSON.parse(purchaseIntent.product_json);
  const adapter = new EcommerceAdapter(site);

  // First approval creates a merchant order and obtains the exact payable total.
  if (purchaseIntent.state === 'selected') {
    try {
      const checkout = await adapter.prepareCheckout(product, purchaseIntent.quantity, purchaseIntent.idempotency_key);
      markIntentState(purchaseIntent.id, 'confirmed', {
        merchant_order_id: checkout.orderId,
        price_xlm: Number(checkout.xlmAmount),
        final_total_json: JSON.stringify(checkout),
      });
      return {
        type: 'purchase_ready',
        content: `The merchant reserved order ${checkout.orderId}. Final payment is ${Number(checkout.xlmAmount).toFixed(7)} XLM. Reply “buy it” once more to approve this exact amount.`,
        metadata: { product, purchaseIntentId: purchaseIntent.id, checkout },
      };
    } catch (error) {
      return { type: 'purchase_failed', content: `I could not prepare a verified merchant order: ${error.message}`, metadata: { product, error: error.message } };
    }
  }

  try {
    const reserved = reserveSpend(purchaseIntent.id, userId, site);
    const result = await executePayment(userId, googleSub, reserved, site, product);
    try {
      const confirmation = await adapter.confirmPayment(reserved.merchant_order_id, result.txHash, reserved.idempotency_key);
      db.prepare("UPDATE purchases SET status = 'confirmed' WHERE id = ?").run(result.purchaseId);
      markIntentState(purchaseIntent.id, 'order_confirmed', { reserved_xlm: 0 });
      return {
        type: 'purchase_success',
        content: `Purchase complete. The merchant confirmed order ${confirmation.orderId || reserved.merchant_order_id}.`,
        metadata: { product, purchase: { ...result, orderId: confirmation.orderId || reserved.merchant_order_id, timestamp: new Date().toISOString() } },
      };
    } catch (merchantError) {
      markIntentState(purchaseIntent.id, 'payment_confirmed', { reserved_xlm: 0 });
      return {
        type: 'purchase_pending',
        content: `Your Stellar payment succeeded, but the merchant has not yet confirmed the order. Do not pay again; transaction ${result.txHash} is recorded for support.`,
        metadata: { product, purchase: { ...result, orderId: reserved.merchant_order_id, timestamp: new Date().toISOString() }, error: merchantError.message },
      };
    }
  } catch (error) {
    if (error.indeterminate) {
      return {
        type: 'purchase_pending',
        content: 'Payment submission status is unknown. The purchase is locked to prevent a duplicate payment; check Stellar before any manual resolution.',
        metadata: { product, error: error.message },
      };
    }
    markIntentState(purchaseIntent.id, 'failed', { reserved_xlm: 0 });
    return { type: 'purchase_failed', content: `Payment was not completed: ${error.message}`, metadata: { product, error: error.message } };
  }
}

function handleCancel(userId, sessionId) {
  const db = getDb();
  db.prepare("UPDATE purchase_intents SET state = 'cancelled', reserved_xlm = 0, updated_at = datetime('now') WHERE user_id = ? AND session_id = ? AND state IN ('selected', 'confirmed')")
    .run(userId, sessionId);
  return { type: 'text', content: 'The pending product selection was cancelled. No payment was made.' };
}

function handleGreeting() { return { type: 'text', content: 'Hi! Tell me what you want to buy and I will search your active, authorized stores.' }; }
function handleQuestion() { return { type: 'text', content: 'I can search active connected stores and create a verified merchant order before requesting an exact payment confirmation.' }; }

export function getOrCreateSession(userId) {
  const db = getDb();
  let session = db.prepare('SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId);
  if (!session) {
    session = { id: uuidv4(), user_id: userId };
    db.prepare('INSERT INTO chat_sessions (id, user_id) VALUES (?, ?)').run(session.id, userId);
  }
  return session;
}

export function getSessionMessages(sessionId, limit = 50) {
  return getDb().prepare('SELECT id, role, content, metadata, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?').all(sessionId, limit);
}
