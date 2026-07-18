import { randomUUID } from 'crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import getDb, { closeDatabase } from '../src/db/database.js';

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === '1';

test('database policy rejects over-budget and duplicate approvals atomically', { skip: !enabled }, async () => {
  const db = getDb();
  const rollback = new Error('intentional integration-test rollback');
  try {
    await db.begin(async (tx) => {
      const suffix = randomUUID();
      const domainHash = '0'.repeat(64);
      const [user] = await tx`insert into users (google_sub, email, name) values (${`integration-${suffix}`}, ${`integration-${suffix}@example.test`}, 'Integration test') returning id`;
      const [site] = await tx`insert into connected_sites (user_id, site_url, site_name, adapter_id, merchant_stellar_address, merchant_domain_hash, spending_cap, per_transaction_cap, status) values (${user.id}, ${`https://integration-${suffix}.example.test`}, 'Integration store', 'agent-commerce-v1', 'GAS7MXJI3CIRUPZTA75VBMJXAJGUYCLBPHCTZQWGC7OTVSAKZN553WYX', ${domainHash}, 10, 10, 'active') returning id`;
      const [session] = await tx`insert into chat_sessions (user_id) values (${user.id}) returning id`;
      const [settled] = await tx`insert into purchase_intents (user_id, session_id, site_id, product_json, quantity, price_xlm, state, idempotency_key, expires_at) values (${user.id}, ${session.id}, ${site.id}, ${tx.json({ name: 'Settled item' })}, 1, 8, 'order_confirmed', ${randomUUID()}, now() + interval '10 minutes') returning id`;
      await tx`insert into purchases (user_id, site_id, purchase_intent_id, product_name, price_xlm, receipt_memo_hash, status) values (${user.id}, ${site.id}, ${settled.id}, 'Settled item', 8, ${'a'.repeat(64)}, 'confirmed')`;
      const [overBudget] = await tx`insert into purchase_intents (user_id, session_id, site_id, product_json, quantity, price_xlm, state, idempotency_key, expires_at) values (${user.id}, ${session.id}, ${site.id}, ${tx.json({ name: 'Over-budget item' })}, 1, 3, 'confirmed', ${randomUUID()}, now() + interval '10 minutes') returning id`;
      await assert.rejects(() => tx.savepoint(async (savepoint) => savepoint`select * from reserve_purchase_intent(${overBudget.id}, ${user.id}, ${site.id})`), /exceeds remaining daily allowance/i);

      const [duplicate] = await tx`insert into purchase_intents (user_id, session_id, site_id, product_json, quantity, price_xlm, state, idempotency_key, expires_at) values (${user.id}, ${session.id}, ${site.id}, ${tx.json({ name: 'One-time approval' })}, 1, 2, 'confirmed', ${randomUUID()}, now() + interval '10 minutes') returning id`;
      const first = await tx`select * from reserve_purchase_intent(${duplicate.id}, ${user.id}, ${site.id})`;
      assert.equal(first[0].state, 'policy_authorized');
      await assert.rejects(() => tx.savepoint(async (savepoint) => savepoint`select * from reserve_purchase_intent(${duplicate.id}, ${user.id}, ${site.id})`), /no longer valid/i);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await closeDatabase();
  }
});
