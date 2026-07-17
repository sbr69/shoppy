import getDb from '../db/database.js';

const ACTIVE_RESERVATION_STATES = ['policy_authorized', 'payment_submitted', 'payment_confirmed'];

export async function getSpendSummary(userId, siteId) {
  const db = getDb();
  const [confirmed] = await db`
    select coalesce(sum(price_xlm), 0) total from purchases
    where user_id = ${userId} and site_id = ${siteId} and status = 'confirmed'
      and created_at >= date_trunc('day', now() at time zone 'utc')`;
  const [reserved] = await db`
    select coalesce(sum(reserved_xlm), 0) total from purchase_intents
    where user_id = ${userId} and site_id = ${siteId}
      and state in ${db(ACTIVE_RESERVATION_STATES)}
      and created_at >= date_trunc('day', now() at time zone 'utc')`;
  return { confirmed: Number(confirmed.total), reserved: Number(reserved.total) };
}

export async function reserveSpend(intentId, userId, siteId) {
  const [intent] = await getDb()`select * from reserve_purchase_intent(${intentId}, ${userId}, ${siteId})`;
  if (!intent) throw new Error('Purchase confirmation is no longer valid');
  return intent;
}

const allowedUpdates = new Set(['merchant_order_id', 'final_total_json', 'reserved_xlm', 'price_xlm', 'policy_tx_hash']);
export async function markIntentState(intentId, state, updates = {}) {
  const values = Object.fromEntries(Object.entries(updates).filter(([field]) => allowedUpdates.has(field)));
  const [intent] = await getDb()`
    update purchase_intents set state = ${state},
      merchant_order_id = coalesce(${values.merchant_order_id ?? null}, merchant_order_id),
      final_total_json = coalesce(${values.final_total_json ? getDb().json(values.final_total_json) : null}, final_total_json),
      reserved_xlm = coalesce(${values.reserved_xlm ?? null}, reserved_xlm),
      price_xlm = coalesce(${values.price_xlm ?? null}, price_xlm),
      policy_tx_hash = coalesce(${values.policy_tx_hash ?? null}, policy_tx_hash),
      updated_at = now()
    where id = ${intentId} returning *`;
  return intent;
}
