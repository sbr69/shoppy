import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptMemo, verifyReceiptMemo } from '../src/services/receipt.service.js';
import { parseFiniteNonNegative, validateChatMessage, validateSiteUpdate } from '../src/services/validation.service.js';
import { xlmToStroops } from '../src/services/soroban.service.js';
import { normalizeSemanticIntent, retrievalQueries } from '../src/services/intent.service.js';
import { availableCatalogCategories, noCredibleMatchMessage, paymentFailureDetail, resolveActiveProductReference, resolveActiveProductReferences } from '../src/services/agent.service.js';
import { taskGoalToIntent, taskSeenProductKeys } from '../src/services/shopping-task.service.js';
import { chooseRankedProduct } from '../src/services/product.service.js';

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

test('XLM conversion retains exact seven-decimal stroop precision', () => {
  assert.equal(xlmToStroops('1.0000001'), 10_000_001n);
  assert.equal(xlmToStroops(2), 20_000_000n);
  assert.throws(() => xlmToStroops('0'));
  assert.throws(() => xlmToStroops('1.00000001'));
});

test('semantic decisions fail closed without a pending purchase', () => {
  assert.equal(normalizeSemanticIntent({ action: 'confirm_purchase' }).action, 'other');
  assert.equal(normalizeSemanticIntent({ action: 'confirm_purchase' }, {
    pendingPurchase: { state: 'selected', productName: 'Earbuds' },
  }).action, 'confirm_purchase');
  assert.equal(normalizeSemanticIntent({
    action: 'search', product: 'wireless earbuds', quantity: 1, searchQueries: ['Bluetooth earphones'],
  }).action, 'search');
  assert.deepEqual(retrievalQueries({ product: 'wireless earbuds', searchQueries: ['Bluetooth earphones', 'wireless earbuds'] }), ['wireless earbuds', 'Bluetooth earphones']);
});

test('semantic follow-up questions stay scoped to products already shown', () => {
  const productId = '8e7d154a-c7e0-4dcc-b98f-e46751af6114';
  const intent = normalizeSemanticIntent({
    action: 'question',
    questionType: 'compare_ratings',
    questionProductId: productId,
  }, {
    shownProducts: [{ purchaseIntentId: productId, name: 'Building Blocks Set', rating: 3.8, reviewCount: 55 }],
  });
  assert.equal(intent.action, 'question');
  assert.equal(intent.questionType, 'compare_ratings');
  assert.equal(intent.questionProductId, productId);
  assert.equal(normalizeSemanticIntent({ action: 'question', questionProductId: 'not-shown' }, {
    shownProducts: [{ purchaseIntentId: productId, name: 'Building Blocks Set' }],
  }).questionProductId, null);
});

test('semantic alternatives preserve the active shopping goal instead of starting a generic search', () => {
  const task = {
    goal: {
      rawQuery: 'Find wireless audio under 300 XLM', product: 'wireless audio', maxPrice: 300, currency: 'XLM',
      mustHave: ['wireless'], searchQueries: ['wireless audio', 'wireless headphones'], quantity: 1,
    },
    context: {
      seenProducts: [{ id: 'sony-xm5', siteId: 'store-1', name: 'Sony WH-1000XM5 Wireless Headphones' }],
    },
  };
  const intent = normalizeSemanticIntent({ action: 'browse_alternatives' }, { shoppingTask: task });
  assert.equal(intent.action, 'browse_alternatives');
  assert.equal(intent.shoppingTask.goal.product, 'wireless audio');
  assert.deepEqual(taskGoalToIntent(task).searchQueries, ['wireless audio', 'wireless headphones']);
  assert.deepEqual([...taskSeenProductKeys(task)], ['store-1:sony-xm5']);
  assert.equal(normalizeSemanticIntent({ action: 'browse_alternatives' }).action, 'other');
});

test('cross-currency caps do not turn a semantic wireless-audio match into a no-match', () => {
  const headphones = { id: 'sony-xm5', name: 'Sony WH-1000XM5 Wireless Headphones', currency: 'USD', price: 348, semanticScore: 0.72 };
  const chosen = chooseRankedProduct({ bestIndex: null, nearestIndex: 0, matchQuality: 0.82 }, [headphones], {
    rawQuery: 'Find wireless audio under 300 XLM', product: 'wireless audio', maxPrice: 300, currency: 'XLM',
  });
  assert.equal(chosen.bestMatch, headphones);
  assert.equal(chosen.budgetUnverified, true);
});

test('active product cards resolve exact names and generated checkout references', () => {
  const carIntent = '48875677-7864-4c69-8f9e-605ffb16e6ff';
  const blockIntent = '8e7d154a-c7e0-4dcc-b98f-e46751af6114';
  const shown = [
    { purchaseIntentId: carIntent, name: 'Remote Control Car' },
    { purchaseIntentId: blockIntent, name: 'Building Blocks Set' },
  ];
  assert.equal(resolveActiveProductReference(`Confirm purchase ${carIntent}`, shown), carIntent);
  assert.equal(resolveActiveProductReference('buy Remote Control Car', shown), carIntent);
  assert.equal(resolveActiveProductReference('tell me about the warranty', shown), null);
  assert.deepEqual(resolveActiveProductReferences('buy Remote Control Car and Building Blocks Set', shown), [carIntent, blockIntent]);
});

test('Soroban policy errors are presented as safe payment outcomes', () => {
  assert.match(paymentFailureDetail(new Error('HostError: Error(Contract, #8)')), /daily XLM allowance/i);
  assert.match(paymentFailureDetail(new Error('HostError: Error(Contract, #7)')), /per-transaction XLM limit/i);
  assert.match(paymentFailureDetail(new Error('HostError: Error(Contract, #5)')), /does not have enough XLM/i);
});

test('no-match shopping replies provide categories and only name a genuine near match', () => {
  const products = [
    { name: 'Science Kit for Kids', category: 'toys-and-games' },
    { name: 'Body Scrub', category: 'beauty_personal_care' },
    { name: 'Train Set', category: 'toys-and-games' },
  ];
  assert.deepEqual(availableCatalogCategories(products), ['Toys And Games', 'Beauty Personal Care']);
  const withoutNearMatch = noCredibleMatchMessage({ rawQuery: 'desk accessories' }, products);
  assert.match(withoutNearMatch, /Available categories include Toys And Games, Beauty Personal Care/);
  assert.doesNotMatch(withoutNearMatch, /Science Kit for Kids/);
  const withNearMatch = noCredibleMatchMessage({ rawQuery: 'learning gift' }, products, products[0]);
  assert.match(withNearMatch, /closest related listing is Science Kit for Kids/);
});
