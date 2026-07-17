import getDb from '../db/database.js';

const ACTIVE_RESERVATION_STATES = ['awaiting_payment', 'payment_submitted', 'payment_confirmed'];

function utcDayStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function getSpendSummary(userId, siteId) {
  const db = getDb();
  const since = utcDayStart();
  const confirmed = db.prepare(
    `SELECT COALESCE(SUM(price_xlm), 0) AS total FROM purchases
     WHERE user_id = ? AND site_id = ? AND status = 'confirmed' AND created_at >= ?`
  ).get(userId, siteId, since).total;
  const placeholders = ACTIVE_RESERVATION_STATES.map(() => '?').join(', ');
  const reserved = db.prepare(
    `SELECT COALESCE(SUM(reserved_xlm), 0) AS total FROM purchase_intents
     WHERE user_id = ? AND site_id = ? AND state IN (${placeholders}) AND created_at >= ?`
  ).get(userId, siteId, ...ACTIVE_RESERVATION_STATES, since).total;
  return { confirmed: Number(confirmed), reserved: Number(reserved), since };
}

/**
 * Atomically reserves budget immediately before a Stellar transaction is built.
 * SQLite's immediate transaction prevents two confirmations from both passing
 * a daily cap check.
 */
export function reserveSpend(intentId, userId, site) {
  const db = getDb();
  const reserve = db.transaction(() => {
    const intent = db.prepare(
      `SELECT * FROM purchase_intents WHERE id = ? AND user_id = ? AND state = 'confirmed'`
    ).get(intentId, userId);
    if (!intent) throw new Error('Purchase confirmation is no longer valid');
    const amount = Number(intent.price_xlm);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Final Stellar amount is invalid');
    const summary = getSpendSummary(userId, site.id);
    if (summary.confirmed + summary.reserved + amount > Number(site.spending_cap)) {
      throw new Error(`Purchase exceeds the remaining daily allowance of ${(Number(site.spending_cap) - summary.confirmed - summary.reserved).toFixed(7)} XLM`);
    }
    db.prepare(
      `UPDATE purchase_intents SET state = 'awaiting_payment', reserved_xlm = ?, updated_at = datetime('now')
       WHERE id = ? AND state = 'confirmed'`
    ).run(amount, intentId);
    return { ...intent, price_xlm: amount };
  });
  return reserve();
}

export function markIntentState(intentId, state, updates = {}) {
  const db = getDb();
  const fields = ['state = ?', "updated_at = datetime('now')"];
  const values = [state];
  for (const [field, value] of Object.entries(updates)) {
    if (!['merchant_order_id', 'final_total_json', 'reserved_xlm', 'price_xlm'].includes(field)) continue;
    fields.push(`${field} = ?`);
    values.push(value);
  }
  values.push(intentId);
  db.prepare(`UPDATE purchase_intents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}
