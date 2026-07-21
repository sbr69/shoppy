import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceiptMemo, verifyReceiptMemo } from '../src/services/receipt.service.js';
import { parseFiniteNonNegative, validateChatMessage, validateSiteUpdate } from '../src/services/validation.service.js';
import { xlmToStroops } from '../src/services/soroban.service.js';
import { literalCatalogQueries, normalizeSemanticIntent, retrievalQueries } from '../src/services/intent.service.js';
import { availableCatalogCategories, browseMerchantCatalog, isScopedContinuationTurn, mergeCatalogProducts, noCredibleMatchMessage, paymentFailureDetail, recommendationCandidates, resolveActiveProductReference, resolveActiveProductReferences, shouldBrowseCatalogFallback, supportedAlternatives } from '../src/services/agent.service.js';
import { taskGoalToIntent, taskSeenProductKeys } from '../src/services/shopping-task.service.js';
import { chooseRankedProduct, fallbackSemanticRank } from '../src/services/product.service.js';
import { boundedConversation, buildConversationMemory } from '../src/services/conversation-memory.service.js';

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
  assert.deepEqual(literalCatalogQueries(['true wireless earbuds', 'wireless headphones']), [
    'true wireless earbuds', 'wireless headphones', 'earbuds', 'headphones',
  ]);
  assert.equal(normalizeSemanticIntent({ action: 'checkout_cart' }, {
    pendingBatch: { id: 'basket-1', state: 'selected', itemCount: 2 },
  }).action, 'checkout_cart');
  assert.equal(normalizeSemanticIntent({ action: 'confirm_batch' }, {
    pendingBatch: { id: 'basket-1', state: 'selected', itemCount: 2 },
  }).action, 'checkout_cart');
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

test('catalog browsing retrieves later pages instead of mistaking the newest page for the whole store', async () => {
  const calls = [];
  const pages = [
    [{ id: 'toy', name: 'Building Blocks', category: 'toys' }, { id: 'beauty', name: 'Face Serum', category: 'beauty' }],
    [{ id: 'kettle', name: 'Electric Kettle', category: 'home-kitchen' }, { id: 'headphones', name: 'Wireless Headphones', category: 'electronics' }],
    [{ id: 'earbuds', name: 'Wireless Earbuds', category: 'electronics' }],
  ];
  const adapter = {
    async searchProducts(query, filters) {
      calls.push({ query, offset: filters.offset });
      return pages[filters.offset / 2] || [];
    },
  };
  const products = await browseMerchantCatalog(adapter, {}, { pageSize: 2, maxPages: 4 });
  assert.deepEqual(calls, [{ query: '', offset: 0 }, { query: '', offset: 2 }, { query: '', offset: 4 }]);
  assert.deepEqual(products.map((product) => product.id), ['toy', 'beauty', 'kettle', 'headphones', 'earbuds']);
  assert.deepEqual(availableCatalogCategories(products), ['Electronics', 'Beauty', 'Home Kitchen', 'Toys']);
});

test('catalog browsing stops safely when a merchant ignores offset pagination', async () => {
  let calls = 0;
  const adapter = {
    async searchProducts() {
      calls += 1;
      return [{ id: 'first' }, { id: 'second' }];
    },
  };
  const products = await browseMerchantCatalog(adapter, {}, { pageSize: 2, maxPages: 8 });
  assert.equal(calls, 2);
  assert.deepEqual(products.map((product) => product.id), ['first', 'second']);
});

test('duplicate merchant search and browse results retain the strongest relevance and rich taxonomy', () => {
  const products = mergeCatalogProducts([
    {
      id: 'earbuds-1', siteId: 'store-1', name: 'Wireless Earbuds',
      merchantRelevance: 0.91, searchAliases: ['wireless audio'],
    },
    {
      id: 'earbuds-1', siteId: 'store-1', name: 'Wireless Earbuds',
      merchantRelevance: null, taxonomyPath: ['Electronics', 'Audio', 'Earbuds'],
      attributes: ['Battery life: 24 hours'],
    },
    { id: 'vacuum-1', siteId: 'store-1', name: 'Robot Vacuum', merchantRelevance: 0.2 },
  ]);
  assert.equal(products.length, 2);
  const earbuds = products.find((product) => product.id === 'earbuds-1');
  assert.equal(earbuds.merchantRelevance, 0.91);
  assert.deepEqual(earbuds.searchAliases, ['wireless audio']);
  assert.deepEqual(earbuds.taxonomyPath, ['Electronics', 'Audio', 'Earbuds']);
  assert.deepEqual(earbuds.attributes, ['Battery life: 24 hours']);
});

test('catalog fallback runs only when merchant search has no credible semantic signal', () => {
  assert.equal(shouldBrowseCatalogFallback([]), true);
  assert.equal(shouldBrowseCatalogFallback([{ name: 'Unrelated item', merchantRelevance: 0.12 }]), true);
  assert.equal(shouldBrowseCatalogFallback([{ name: 'Wireless earbuds', merchantRelevance: 0.84 }]), false);
});

test('a missing semantic alternative never becomes an arbitrary high-rated product card', () => {
  const earbuds = { id: 'earbuds', siteId: 'store-1', name: 'QuietComfort Earbuds' };
  const robotVacuum = { id: 'vacuum', siteId: 'store-1', name: 'Robot Vacuum Cleaner', rating: 4.4 };
  assert.deepEqual(recommendationCandidates(earbuds, []), [earbuds]);
  assert.deepEqual(recommendationCandidates(earbuds, [robotVacuum, robotVacuum]), [earbuds, robotVacuum]);
});

test('merchant-supported same-category alternatives are shown even if the model omits optional indexes', () => {
  const science = { id: 'science', siteId: 'store', name: 'Science Kit', category: 'toys', merchantRelevance: 305, rating: 3.7, currency: 'XLM', price: 35 };
  const blocks = { id: 'blocks', siteId: 'store', name: 'Building Blocks', category: 'toys', merchantRelevance: 245, rating: 3.8, currency: 'XLM', price: 40 };
  const teddy = { id: 'teddy', siteId: 'store', name: 'Teddy Bear', category: 'toys', merchantRelevance: 245, rating: 4, currency: 'XLM', price: 30 };
  const serum = { id: 'serum', siteId: 'store', name: 'Face Serum', category: 'beauty', merchantRelevance: 999, rating: 4.8, currency: 'XLM', price: 30 };
  assert.deepEqual(supportedAlternatives(science, [], [science, blocks, teddy, serum], { currency: 'XLM', maxPrice: 100 }).map((item) => item.name), ['Teddy Bear', 'Building Blocks']);
});

test('short follow-up turns preserve an active shopping goal', () => {
  const task = { goal: { product: 'gift for kids' } };
  assert.equal(isScopedContinuationTurn('show some more gifts', task), true);
  assert.equal(isScopedContinuationTurn('any other audio product?', task), true);
  assert.equal(isScopedContinuationTurn('checkout my cart', task), false);
  assert.equal(isScopedContinuationTurn('show some more gifts', null), false);
});

test('cross-currency caps do not turn a semantic wireless-audio match into a no-match', () => {
  const headphones = { id: 'sony-xm5', name: 'Sony WH-1000XM5 Wireless Headphones', currency: 'USD', price: 348, semanticScore: 0.72 };
  const chosen = chooseRankedProduct({ bestIndex: null, nearestIndex: 0, matchQuality: 0.82 }, [headphones], {
    rawQuery: 'Find wireless audio under 300 XLM', product: 'wireless audio', maxPrice: 300, currency: 'XLM',
  });
  assert.equal(chosen.bestMatch, headphones);
  assert.equal(chosen.budgetUnverified, true);
});

test('a comparable-currency cap cannot be bypassed by a model ranking response', () => {
  const overBudget = { id: 'over-budget', name: 'Wireless Headphones', currency: 'XLM', price: 301, semanticScore: 0.98 };
  const chosen = chooseRankedProduct({ bestIndex: 0, nearestIndex: 0, matchQuality: 0.99 }, [overBudget], {
    rawQuery: 'wireless audio under 300 XLM', product: 'wireless audio', maxPrice: 300, currency: 'XLM',
  });
  assert.equal(chosen.bestMatch, null);
  assert.equal(chosen.nearestMatch, overBudget);
});

test('a weak, unsupported semantic candidate is not promoted solely because currencies differ', () => {
  const unrelated = { id: 'toy-car', name: 'Remote Control Car', currency: 'USD', price: 45, semanticScore: 0.12 };
  const chosen = chooseRankedProduct({ bestIndex: null, nearestIndex: 0, matchQuality: 0.2 }, [unrelated], {
    rawQuery: 'wireless audio under 300 XLM', product: 'wireless audio', maxPrice: 300, currency: 'XLM',
  });
  assert.equal(chosen.bestMatch, null);
});

test('supported merchant semantic retrieval remains safe when the ranker is temporarily unavailable', () => {
  const earbuds = { id: 'earbuds', name: 'Bose QuietComfort Earbuds II', currency: 'XLM', price: 249, merchantRelevance: 0.91, rating: 3.5 };
  const vacuum = { id: 'vacuum', name: 'Robot Vacuum Cleaner', currency: 'XLM', price: 299, merchantRelevance: 0.11, rating: 4.4 };
  const ranked = fallbackSemanticRank([earbuds, vacuum], {
    rawQuery: 'wireless audio under 300 XLM', product: 'wireless audio', maxPrice: 300, currency: 'XLM',
  });
  assert.equal(ranked.bestMatch, earbuds);
  assert.deepEqual(ranked.alternatives, []);
  assert.match(ranked.reasoning, /live semantic match/i);
});

test('semantic fallback still enforces a comparable XLM cap', () => {
  const overBudget = { id: 'headphones', name: 'Wireless Headphones', currency: 'XLM', price: 301, merchantRelevance: 0.99 };
  assert.equal(fallbackSemanticRank([overBudget], {
    product: 'wireless audio', maxPrice: 300, currency: 'XLM',
  }), null);
});

test('durable conversation memory preserves shopping context without sending an unbounded transcript', () => {
  const messages = Array.from({ length: 22 }, (_, index) => ({
    role: index % 2 ? 'agent' : 'user',
    content: index === 0 ? 'I need a gift for a child under 100 XLM' : `turn ${index}`,
  }));
  const memory = buildConversationMemory({
    messages,
    shoppingTask: { goal: { rawQuery: 'gift for a child under 100 XLM', product: 'child gift' } },
    preferences: { likes: ['educational toys'], avoids: ['plastic waste'] },
  });
  assert.match(memory.summary, /Active shopping goal: gift for a child under 100 XLM/i);
  assert.match(memory.summary, /educational toys/i);
  assert.match(memory.summary, /I need a gift for a child under 100 XLM/i);
  const context = boundedConversation(messages, memory, 16);
  assert.equal(context.recentMessages.length, 16);
  assert.match(context.durableMemory, /Earlier user context/i);
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
