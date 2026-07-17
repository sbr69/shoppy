import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptMemo, verifyReceiptMemo } from '../src/services/receipt.service.js';
import { parseFiniteNonNegative, validateChatMessage, validateSiteUpdate } from '../src/services/validation.service.js';

const receipt = {
  purchaseIntentId: '6e1467dc-c1fc-4b02-ae77-e5d1e0ea338a',
  merchantOrderId: 'order-123',
  productName: 'Earbuds',
  priceXlm: 2.5,
  currency: 'XLM',
  merchant: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  timestamp: '2026-01-01T00:00:00.000Z',
};

test('receipt memo is stable and changes when the merchant order changes', () => {
  const hash = buildReceiptMemo(receipt).toString('hex');
  assert.equal(hash.length, 64);
  assert.equal(verifyReceiptMemo(receipt, hash), true);
  assert.equal(verifyReceiptMemo({ ...receipt, merchantOrderId: 'order-124' }, hash), false);
});

test('request validation rejects unsafe numeric and message inputs', () => {
  assert.equal(parseFiniteNonNegative('4.5', 'cap'), 4.5);
  assert.throws(() => parseFiniteNonNegative(-1, 'cap'));
  assert.throws(() => validateChatMessage(''));
  assert.throws(() => validateSiteUpdate({ status: 'enabled' }));
  assert.deepEqual(validateSiteUpdate({ spendingCap: '10', autoConfirmThreshold: 0, status: 'paused' }), {
    spendingCap: 10, autoConfirmThreshold: 0, status: 'paused',
  });
});
