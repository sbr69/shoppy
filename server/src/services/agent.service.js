import { v4 as uuidv4 } from 'uuid';
import getDb from '../db/database.js';
import { parseIntent, retrievalQueries } from './intent.service.js';
import { rankProducts } from './product.service.js';
import { EcommerceAdapter } from './adapters/ecommerce.adapter.js';
import { executeCustodialPayment } from './payment.service.js';
import { markIntentState, reserveSpend } from './policy.service.js';
import { recordWorkflowEvent } from './workflow.service.js';
import { syncSitePolicy } from './site.service.js';
import { deliveryAddress, getProfile } from './profile.service.js';
import { cacheAuthorizedProducts, retrieveSemanticCandidates } from './catalog.service.js';
import { getShoppingPreferences, saveShoppingPreferences } from './shopping-preference.service.js';

const INTENT_TTL_MS = 10 * 60 * 1000;

export async function processMessage(userId, sessionId, message, googleSub) {
  const db = getDb();
  const [pendingRows, recentMessages, userPreferences] = await Promise.all([
    db`select state, product_json, merchant_order_id, price_xlm from purchase_intents where user_id = ${userId} and session_id = ${sessionId} and state in ('selected', 'confirmed') order by updated_at desc limit 1`,
    db`select role, content from messages where session_id = ${sessionId} order by created_at desc limit 4`,
    getShoppingPreferences(userId),
  ]);
  await db`insert into messages (session_id, role, content) values (${sessionId}, 'user', ${message})`;
  await db`update chat_sessions set title = case when title = 'New shopping chat' then left(${message}, 72) else title end, updated_at = now() where id = ${sessionId}`;
  const pending = pendingRows[0];
  const intent = await parseIntent(message, {
    pendingPurchase: pending ? {
      state: pending.state,
      productName: pending.product_json?.name,
      merchantOrderId: pending.merchant_order_id,
      finalAmountXlm: pending.price_xlm,
    } : null,
    recentMessages: [...recentMessages].reverse(),
    userPreferences,
  });
  let response;
  if (intent.action === 'search') response = await handleSearch(userId, sessionId, intent);
  else if (intent.action === 'confirm_purchase') response = await handleConfirmation(userId, sessionId, googleSub, intent.purchaseIntentId);
  else if (intent.action === 'cancel') response = await handleCancel(userId, sessionId);
  else if (intent.action === 'remember_preference') {
    const preferences = await saveShoppingPreferences(userId, intent.preferenceUpdate);
    response = { type: 'text', content: `I’ll remember those shopping preferences for future searches: ${[...preferences.likes, ...preferences.avoids.map((value) => `avoid ${value}`), ...preferences.useCases].join(', ') || 'no specific preference was provided'}.` };
  }
  else if (intent.action === 'greeting') response = { type: 'text', content: 'Hi! Tell me what you want to buy and I will search your authorized stores.' };
  else response = { type: 'text', content: intent.clarification || 'Tell me what you want to find, or ask about the item already shown. I will always ask before placing a payment.' };
  const [saved] = await db`insert into messages (session_id, role, content, metadata) values (${sessionId}, 'agent', ${response.content}, ${response.metadata ? db.json(response.metadata) : null}) returning id`;
  await db`update chat_sessions set updated_at = now() where id = ${sessionId}`;
  return { id: saved.id, ...response };
}

async function handleSearch(userId, sessionId, intent) {
  const db = getDb();
  await recordWorkflowEvent({ userId, sessionId, stage: 'search', status: 'running', detail: 'Searching authorized stores.' });
  const sites = await db`select * from connected_sites where user_id = ${userId} and status = 'active'`;
  if (!sites.length) {
    await recordWorkflowEvent({ userId, sessionId, stage: 'search', status: 'failed', detail: 'No authorized stores are active.' });
    return { type: 'text', content: 'I need an active store before I can search. Connect a store from the right-hand panel, complete its sign-in, then tell me what you need.' };
  }
  const queries = retrievalQueries(intent);
  if (!queries.length) return { type: 'text', content: 'Tell me a little more about the product you want me to find.' };
  // Cached semantic candidates and live merchant searches run together. The
  // merchant response remains authoritative for stock and checkout.
  const semanticCandidates = retrieveSemanticCandidates(sites.map((site) => site.id), intent).catch(() => []);
  const results = await Promise.allSettled([
    ...sites.flatMap((site) => queries.map(async (query) =>
      (await new EcommerceAdapter(site).searchProducts(query, { maxPrice: intent.maxPrice, minPrice: intent.minPrice }))
        .map((product) => ({ ...product, siteId: site.id, retrievalQuery: query })),
    )),
    // A bounded browse verifies the current merchant catalogue. Cached vectors
    // can improve recall, but never make a stale product purchasable.
    ...sites.map(async (site) =>
      (await new EcommerceAdapter(site).searchProducts('', { maxPrice: intent.maxPrice, minPrice: intent.minPrice }))
        .map((product) => ({ ...product, siteId: site.id, retrievalQuery: 'catalog browse' })),
    ),
  ]);
  let products = [...new Map(results
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value)
    .map((product) => [`${product.siteId}:${product.id}`, product])).values()];
  try { await Promise.all(sites.map((site) => cacheAuthorizedProducts(site.id, products.filter((product) => product.siteId === site.id)))); } catch (error) { console.warn('Catalog cache update skipped:', error.message); }
  let cachedProducts = await semanticCandidates;
  // On a first search the cache was empty at the start. Re-read it after the
  // authorized live catalogue has been embedded so semantic matching applies
  // immediately rather than only on the user's next message.
  if (!cachedProducts.length && products.length) cachedProducts = await retrieveSemanticCandidates(sites.map((site) => site.id), intent).catch(() => []);
  const semanticByProduct = new Map(cachedProducts.map((product) => [`${product.siteId}:${product.id}`, product.semanticScore]));
  products = products
    .filter((product) => product.inStock && (intent.maxPrice === null || Number(product.price) <= intent.maxPrice) && (intent.minPrice === null || Number(product.price) >= intent.minPrice))
    .map((product) => ({ ...product, semanticScore: semanticByProduct.get(`${product.siteId}:${product.id}`) ?? product.semanticScore }));
  if (!products.length) {
    await recordWorkflowEvent({ userId, sessionId, stage: 'search', status: 'failed', detail: 'No matching in-stock products were returned.' });
    return { type: 'text', content: `I searched your authorized stores for ${intent.product} using several meaning-based catalog queries, but none returned a live, in-stock match. I have not reserved an order or moved any funds.` };
  }
  const { bestMatch, reasoning, alternatives = [] } = await rankProducts(products, intent);
  const site = sites.find((candidate) => candidate.id === bestMatch?.siteId);
  if (!bestMatch || !site) return { type: 'text', content: `I found catalog items, but none were a safe semantic fit for “${intent.rawQuery}”. I will not guess or prepare a checkout. Try adding one preference or a different budget.` };
  const expiry = new Date(Date.now() + INTENT_TTL_MS).toISOString();
  const [created] = await db`
    insert into purchase_intents (user_id, session_id, site_id, product_json, quantity, state, idempotency_key, expires_at)
    values (${userId}, ${sessionId}, ${site.id}, ${db.json(bestMatch)}, ${Math.min(Math.max(Number(intent.quantity) || 1, 1), 100)}, 'selected', ${uuidv4()}, ${expiry}) returning *`;
  await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: created.id, stage: 'search', status: 'completed', detail: `Selected ${bestMatch.name}.`, metadata: { siteId: site.id, quantity: created.quantity, queries } });
  const alternativeNote = alternatives.length ? ` I also found ${alternatives.map((product) => product.name).join(' and ')} as ${alternatives.length === 1 ? 'an alternative' : 'alternatives'}.` : '';
  return { type: 'product_suggestion', content: `Best match: ${bestMatch.name} at ${site.site_name}. ${reasoning}${alternativeNote} It is live and in stock. Review it when you are ready; I will only verify the merchant total after your first approval, and I will ask again before any payment.`, metadata: { product: bestMatch, alternatives, reasoning, purchaseIntentId: created.id, quantity: created.quantity, expiresAt: expiry, policy: { dailyCapXlm: Number(site.spending_cap), perTransactionCapXlm: Number(site.per_transaction_cap) } } };
}

async function findIntent(userId, sessionId, requestedId) {
  const db = getDb();
  if (requestedId) { const [intent] = await db`select * from purchase_intents where id = ${requestedId} and user_id = ${userId} and session_id = ${sessionId}`; return intent; }
  const [intent] = await db`select * from purchase_intents where user_id = ${userId} and session_id = ${sessionId} and state in ('selected','confirmed') order by updated_at desc limit 1`;
  return intent;
}

export function paymentFailureDetail(error) {
  const detail = String(error?.message || 'Payment could not be completed.');
  // Both the direct smart wallet and SpendGuard use contract error #8 for a
  // daily-limit rejection. The transaction is atomic, so this path means no
  // XLM left the wallet.
  if (/Error\(Contract, #8\)/.test(detail)) {
    return 'This purchase exceeds the remaining daily XLM allowance for this store. No funds were transferred.';
  }
  if (/Error\(Contract, #7\)/.test(detail)) {
    return 'This purchase exceeds this store’s per-transaction XLM limit. No funds were transferred.';
  }
  if (/Error\(Contract, #5\)/.test(detail)) {
    return 'The agent wallet does not have enough XLM for this purchase. No funds were transferred.';
  }
  if (/Error\(Contract, #9\)/.test(detail)) {
    return 'This exact purchase approval was already used. No additional payment was sent.';
  }
  return detail;
}

async function handleConfirmation(userId, sessionId, googleSub, requestedId) {
  const db = getDb();
  const purchaseIntent = await findIntent(userId, sessionId, requestedId);
  if (!purchaseIntent) return { type: 'text', content: 'There is no purchase awaiting confirmation in this chat.' };
  if (new Date(purchaseIntent.expires_at).getTime() <= Date.now()) { await markIntentState(purchaseIntent.id, 'expired', { reserved_xlm: 0 }); return { type: 'text', content: 'That selection expired. Please search again.' }; }
  let [site] = await db`select * from connected_sites where id = ${purchaseIntent.site_id} and user_id = ${userId} and status = 'active'`;
  if (!site) return { type: 'text', content: 'The selected store is no longer active or authorized.' };
  const product = purchaseIntent.product_json;
  const profileState = await getProfile(userId);
  if (profileState.missing.length) {
    return { type: 'profile_required', content: `Before I can place a delivery order, open Settings → Personal details and complete: ${profileState.missing.join(', ')}. I will keep this product selected.`, metadata: { missing: profileState.missing, purchaseIntentId: purchaseIntent.id } };
  }
  if (!site.policy_synced_at) {
    try {
      await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: purchaseIntent.id, stage: 'policy', status: 'running', detail: 'Synchronizing SpendGuard and merchant trust policy.' });
      const synced = await syncSitePolicy(userId, googleSub, site.id);
      site = synced.site;
      await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: purchaseIntent.id, stage: 'policy', status: 'completed', detail: 'On-chain merchant policy synchronized.' });
    } catch (error) {
      await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: purchaseIntent.id, stage: 'policy', status: 'failed', detail: error.message });
      return { type: 'purchase_failed', content: `The store is authorized, but its on-chain spending safeguard could not be set up: ${error.message}` };
    }
  }
  const adapter = new EcommerceAdapter(site);
  if (purchaseIntent.state === 'selected') {
    try {
      await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: purchaseIntent.id, stage: 'checkout', status: 'running', detail: 'Verifying merchant checkout total.' });
      const checkout = await adapter.prepareCheckout(product, purchaseIntent.quantity, purchaseIntent.idempotency_key, deliveryAddress(profileState.profile));
      if (Number(checkout.xlmAmount) > Number(site.per_transaction_cap)) return { type: 'purchase_failed', content: 'The verified total exceeds this store’s on-chain per-transaction limit.' };
      await markIntentState(purchaseIntent.id, 'confirmed', { merchant_order_id: checkout.orderId, price_xlm: Number(checkout.xlmAmount), final_total_json: checkout });
      await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: purchaseIntent.id, stage: 'checkout', status: 'completed', detail: `Merchant order ${checkout.orderId} reserved.`, metadata: { amountXlm: Number(checkout.xlmAmount) } });
      return { type: 'purchase_ready', content: `The merchant reserved order ${checkout.orderId}. Final payment is ${Number(checkout.xlmAmount).toFixed(7)} XLM. Reply “buy it” once more to approve this exact amount.`, metadata: { product, purchaseIntentId: purchaseIntent.id, checkout } };
    } catch (error) {
      await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: purchaseIntent.id, stage: 'checkout', status: 'failed', detail: error.message });
      return { type: 'purchase_failed', content: `I could not prepare a verified merchant order: ${error.message}`, metadata: { product } };
    }
  }
  try {
    await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: purchaseIntent.id, stage: 'policy', status: 'running', detail: 'Checking spending policy.' });
    const reserved = await reserveSpend(purchaseIntent.id, userId, site.id);
    await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: purchaseIntent.id, stage: 'policy', status: 'completed', detail: 'Policy approved the exact spend.', metadata: { amountXlm: Number(reserved.price_xlm) } });
    await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: purchaseIntent.id, stage: 'payment', status: 'running', detail: 'Submitting guarded Stellar payment.' });
    const result = await executeCustodialPayment(userId, googleSub, reserved, site, product);
    await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: purchaseIntent.id, stage: 'payment', status: result.success ? 'completed' : 'pending', detail: result.success ? 'Stellar payment finalized.' : 'Stellar payment submitted; reconciliation pending.', metadata: { txHash: result.txHash } });
    return { type: result.success ? 'purchase_success' : 'purchase_pending', content: result.success ? 'Payment submitted and finalized on Stellar.' : 'Payment submitted; final confirmation is pending.', metadata: { product, purchase: result } };
  } catch (error) {
    const detail = paymentFailureDetail(error);
    await markIntentState(purchaseIntent.id, 'failed', { reserved_xlm: 0 });
    await recordWorkflowEvent({ userId, sessionId, purchaseIntentId: purchaseIntent.id, stage: 'payment', status: 'failed', detail });
    return { type: 'purchase_failed', content: `Payment was not completed: ${detail}`, metadata: { product, error: detail } };
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
  // Reuse an untouched draft on dashboard entry. An explicit New Chat action
  // still creates another session, but refreshes and re-entry do not clutter
  // history with duplicate empty conversations.
  return db.begin(async (tx) => {
    // Serialize only this user's draft lookup/create. This prevents two
    // concurrent page-entry requests from both inserting blank sessions.
    await tx`select pg_advisory_xact_lock(hashtext(${userId}))`;
    const [draft] = await tx`
      select session.* from chat_sessions session
      where session.user_id = ${userId} and session.archived_at is null
        and not exists (select 1 from messages where messages.session_id = session.id)
      order by session.updated_at desc limit 1`;
    if (draft) return draft;
    const [created] = await tx`insert into chat_sessions (user_id) values (${userId}) returning *`;
    return created;
  });
}
export async function getSessionMessages(sessionId, limit = 50) { return getDb()`select id, role, content, metadata, created_at from messages where session_id = ${sessionId} order by created_at asc limit ${limit}`; }
export async function listSessions(userId) { return getDb()`select id, title, created_at, updated_at from chat_sessions where user_id=${userId} and archived_at is null order by updated_at desc limit 50`; }
export async function createSession(userId) { const [session] = await getDb()`insert into chat_sessions (user_id) values (${userId}) returning *`; return session; }
export async function getSessionForUser(userId, sessionId) { const [session] = await getDb()`select * from chat_sessions where id = ${sessionId} and user_id = ${userId} and archived_at is null`; return session || null; }
export async function archiveSession(userId, sessionId) { const [session] = await getDb()`update chat_sessions set archived_at = now(), updated_at = now() where id = ${sessionId} and user_id = ${userId} and archived_at is null returning *`; return session || null; }
export async function renameSession(userId, sessionId, title) {
  const cleanTitle = String(title || '').trim().replace(/\s+/g, ' ').slice(0, 72);
  if (!cleanTitle) throw new Error('Chat name is required');
  const [session] = await getDb()`update chat_sessions set title = ${cleanTitle}, updated_at = now() where id = ${sessionId} and user_id = ${userId} and archived_at is null returning *`;
  return session || null;
}
