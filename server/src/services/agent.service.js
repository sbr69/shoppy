import { v4 as uuidv4 } from 'uuid';
import getDb from '../db/database.js';
import { parseIntent } from './intent.service.js';
import { rankProducts } from './product.service.js';
import { EcommerceAdapter } from './adapters/ecommerce.adapter.js';
import { executeCustodialPayment } from './payment.service.js';
import { markIntentState, reserveSpend } from './policy.service.js';

const INTENT_TTL_MS = 10 * 60 * 1000;

export async function processMessage(userId, sessionId, message, googleSub) {
  const db = getDb();
  await db`insert into messages (session_id, role, content) values (${sessionId}, 'user', ${message})`;
  const intent = await parseIntent(message);
  let response;
  if (intent.action === 'search') response = await handleSearch(userId, sessionId, intent);
  else if (intent.action === 'confirm_purchase') response = await handleConfirmation(userId, sessionId, googleSub, intent.purchaseIntentId);
  else if (intent.action === 'cancel') response = await handleCancel(userId, sessionId);
  else if (intent.action === 'greeting') response = { type: 'text', content: 'Hi! Tell me what you want to buy and I will search your authorized stores.' };
  else response = { type: 'text', content: 'I can search authorized stores, prepare an order, then require your confirmation before a guarded on-chain payment.' };
  const [saved] = await db`insert into messages (session_id, role, content, metadata) values (${sessionId}, 'agent', ${response.content}, ${response.metadata ? db.json(response.metadata) : null}) returning id`;
  return { id: saved.id, ...response };
}

async function handleSearch(userId, sessionId, intent) {
  const db = getDb();
  const sites = await db`select * from connected_sites where user_id = ${userId} and status = 'active'`;
  if (!sites.length) return { type: 'text', content: 'You do not have an active, authorized store.' };
  const results = await Promise.allSettled(sites.map(async (site) => (await new EcommerceAdapter(site).searchProducts(intent.product, { maxPrice: intent.maxPrice, minPrice: intent.minPrice })).map((product) => ({ ...product, siteId: site.id }))));
  const products = results.filter((result) => result.status === 'fulfilled').flatMap((result) => result.value);
  if (!products.length) return { type: 'text', content: 'No live, in-stock products matched your request in authorized stores.' };
  const { bestMatch, reasoning } = await rankProducts(products, intent);
  const site = sites.find((candidate) => candidate.id === bestMatch?.siteId);
  if (!bestMatch || !site) return { type: 'text', content: 'I could not safely identify a product to purchase.' };
  const expiry = new Date(Date.now() + INTENT_TTL_MS).toISOString();
  const [created] = await db`
    insert into purchase_intents (user_id, session_id, site_id, product_json, quantity, state, idempotency_key, expires_at)
    values (${userId}, ${sessionId}, ${site.id}, ${db.json(bestMatch)}, ${Math.min(Math.max(Number(intent.quantity) || 1, 1), 100)}, 'selected', ${uuidv4()}, ${expiry}) returning *`;
  return { type: 'product_suggestion', content: `I found a live match at ${site.site_name}. I will verify the merchant total before any payment.`, metadata: { product: bestMatch, reasoning, purchaseIntentId: created.id, quantity: created.quantity, expiresAt: expiry, policy: { dailyCapXlm: Number(site.spending_cap), perTransactionCapXlm: Number(site.per_transaction_cap) } } };
}

async function findIntent(userId, sessionId, requestedId) {
  const db = getDb();
  if (requestedId) { const [intent] = await db`select * from purchase_intents where id = ${requestedId} and user_id = ${userId} and session_id = ${sessionId}`; return intent; }
  const [intent] = await db`select * from purchase_intents where user_id = ${userId} and session_id = ${sessionId} and state in ('selected','confirmed') order by updated_at desc limit 1`;
  return intent;
}

async function handleConfirmation(userId, sessionId, googleSub, requestedId) {
  const db = getDb();
  const purchaseIntent = await findIntent(userId, sessionId, requestedId);
  if (!purchaseIntent) return { type: 'text', content: 'There is no purchase awaiting confirmation in this chat.' };
  if (new Date(purchaseIntent.expires_at).getTime() <= Date.now()) { await markIntentState(purchaseIntent.id, 'expired', { reserved_xlm: 0 }); return { type: 'text', content: 'That selection expired. Please search again.' }; }
  const [site] = await db`select * from connected_sites where id = ${purchaseIntent.site_id} and user_id = ${userId} and status = 'active'`;
  if (!site) return { type: 'text', content: 'The selected store is no longer active or authorized.' };
  const product = purchaseIntent.product_json;
  const adapter = new EcommerceAdapter(site);
  if (purchaseIntent.state === 'selected') {
    try {
      const checkout = await adapter.prepareCheckout(product, purchaseIntent.quantity, purchaseIntent.idempotency_key);
      if (Number(checkout.xlmAmount) > Number(site.per_transaction_cap)) return { type: 'purchase_failed', content: 'The verified total exceeds this store’s on-chain per-transaction limit.' };
      await markIntentState(purchaseIntent.id, 'confirmed', { merchant_order_id: checkout.orderId, price_xlm: Number(checkout.xlmAmount), final_total_json: checkout });
      return { type: 'purchase_ready', content: `The merchant reserved order ${checkout.orderId}. Final payment is ${Number(checkout.xlmAmount).toFixed(7)} XLM. Reply “buy it” once more to approve this exact amount.`, metadata: { product, purchaseIntentId: purchaseIntent.id, checkout } };
    } catch (error) { return { type: 'purchase_failed', content: `I could not prepare a verified merchant order: ${error.message}`, metadata: { product } }; }
  }
  try {
    const reserved = await reserveSpend(purchaseIntent.id, userId, site.id);
    const result = await executeCustodialPayment(userId, googleSub, reserved, site, product);
    return { type: result.success ? 'purchase_success' : 'purchase_pending', content: result.success ? 'Payment submitted and finalized on Stellar.' : 'Payment submitted; final confirmation is pending.', metadata: { product, purchase: result } };
  } catch (error) {
    await markIntentState(purchaseIntent.id, 'failed', { reserved_xlm: 0 });
    return { type: 'purchase_failed', content: `Payment was not completed: ${error.message}`, metadata: { product, error: error.message } };
  }
}

async function handleCancel(userId, sessionId) {
  const db = getDb();
  await db.begin(async (tx) => {
    const intents = await tx`
      update purchase_intents set state = 'cancelled', reserved_xlm = 0, updated_at = now()
      where user_id = ${userId} and session_id = ${sessionId}
        and state in ('selected', 'confirmed', 'policy_authorized', 'approval_required', 'approval_authorized')
      returning id`;
    if (intents.length) {
      await tx`update purchase_approvals set state = 'expired' where user_id = ${userId} and purchase_intent_id in ${tx(intents.map((intent) => intent.id))} and state in ('prepared', 'authorized')`;
    }
  });
  return { type: 'text', content: 'The pending selection was cancelled. No payment was made.' };
}

export async function getOrCreateSession(userId) {
  const db = getDb();
  let [session] = await db`select * from chat_sessions where user_id = ${userId} order by created_at desc limit 1`;
  if (!session) [session] = await db`insert into chat_sessions (user_id) values (${userId}) returning *`;
  return session;
}
export async function getSessionMessages(sessionId, limit = 50) { return getDb()`select id, role, content, metadata, created_at from messages where session_id = ${sessionId} order by created_at asc limit ${limit}`; }
