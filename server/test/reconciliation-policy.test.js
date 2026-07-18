import test from 'node:test';
import assert from 'node:assert/strict';
import { reconciliationRetryDelayMs } from '../src/services/payment.service.js';

test('durable reconciliation uses bounded exponential retry delays', () => {
  assert.equal(reconciliationRetryDelayMs(1), 10_000);
  assert.equal(reconciliationRetryDelayMs(2), 20_000);
  assert.equal(reconciliationRetryDelayMs(7), 640_000);
  assert.equal(reconciliationRetryDelayMs(999), 900_000);
});

