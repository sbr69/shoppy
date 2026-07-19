import { generateText, parseJsonResponse } from './llm.service.js';

const normalizedCurrency = (value) => String(value || '').trim().toUpperCase();
const hasComparableCatalogBudget = (intent, product) => Boolean(
  intent?.maxPrice && intent?.currency && normalizedCurrency(intent.currency) === normalizedCurrency(product?.currency),
);
const hasSemanticRetrievalSupport = (product) => Number(product?.semanticScore) >= 0.38;

function indexedProduct(products, index) {
  return Number.isInteger(index) && index >= 0 && index < products.length ? products[index] : null;
}

/**
 * Keep semantic suitability separate from the financial policy decision.
 * A USD catalogue card cannot prove or disprove an XLM cap; checkout does.
 */
export function chooseRankedProduct(parsed, products, intent) {
  const nearestMatch = indexedProduct(products, parsed?.nearestIndex);
  const selected = indexedProduct(products, parsed?.bestIndex);
  const quality = Number(parsed?.matchQuality);
  const hasUsableQuality = !Number.isFinite(quality) || quality >= 0.4;
  const budgetUnverified = selected && intent?.maxPrice && !hasComparableCatalogBudget(intent, selected);
  const mayUseSelected = selected && (hasUsableQuality || hasSemanticRetrievalSupport(selected));

  if (mayUseSelected) return { bestMatch: selected, nearestMatch, budgetUnverified };

  // The model is required to use nearestIndex only for a genuine semantic
  // relationship. When the only uncertainty is a cross-currency budget, that
  // candidate is safe to show—not to pay—because checkout re-verifies XLM.
  const nearestBudgetUnverified = nearestMatch && intent?.maxPrice && !hasComparableCatalogBudget(intent, nearestMatch);
  if (nearestMatch && nearestBudgetUnverified && (hasUsableQuality || hasSemanticRetrievalSupport(nearestMatch))) {
    return { bestMatch: nearestMatch, nearestMatch, budgetUnverified: true };
  }
  return { bestMatch: null, nearestMatch, budgetUnverified: false };
}

/**
 * Rank merchant candidates by semantic fit to the user's stated need.
 * The LLM may choose only an indexed candidate and must explain trade-offs.
 *
 * LLM Call 2: Given products + user intent, rank and explain the best pick.
 */
export async function rankProducts(products, intent) {
  if (!products || products.length === 0) {
    return { bestMatch: null, reasoning: 'No products found matching your criteria.' };
  }

  const prompt = `You are a smart shopping assistant. The user wants: "${intent.rawQuery}"
${intent.maxPrice ? `Requested budget: max ${intent.currency || 'unspecified currency'} ${intent.maxPrice}. A catalog price is comparable to this cap only when it uses the same currency. If the catalog uses another currency (especially USD versus an XLM cap), the amount is unverified—not over budget and not a relevance failure. The merchant's XLM checkout total must be verified before payment.` : ''}
${intent.mustHave?.length ? `Must have: ${intent.mustHave.join(', ')}` : ''}
${intent.preferences?.length ? `Nice to have: ${intent.preferences.join(', ')}` : ''}
${intent.exclusions?.length ? `Must avoid: ${intent.exclusions.join(', ')}` : ''}
${intent.useCases?.length ? `Primary use: ${intent.useCases.join(', ')}` : ''}

Here are the available products:
${JSON.stringify(products.map((p, i) => ({
  index: i,
  name: p.name,
  price: p.price,
  currency: p.currency || 'INR',
  description: p.description,
  brand: p.brand,
  rating: p.rating,
  inStock: p.inStock,
  semanticScore: p.semanticScore,
  catalogBudgetStatus: intent.maxPrice ? (hasComparableCatalogBudget(intent, p) ? 'comparable' : 'requires_checkout_verification') : 'not_requested',
})), null, 2)}

Pick the BEST product for the user. Consider:
1. First reject candidates that conflict with a must-have, exclusion, or a comparable-currency budget. A cross-currency catalog price must never make a semantically matching item ineligible; mark it for checkout verification instead.
2. Compare meaning, use case, attributes, and product descriptions—not only overlapping words.
3. Prefer stronger ratings/value only after relevance.
3a. For requests such as "best reviewed gift for a child", use ratings only to choose among child-gift candidates. Never replace the requested category with an unrelated highly rated product.
4. Do not claim an attribute that is missing from the merchant data.
5. When no product is suitable by meaning, set bestIndex to null. Set nearestIndex only for a product that is genuinely related by category or use case. Do not downgrade wireless headphones or earbuds when the request is for wireless audio; they are direct matches. Never name an arbitrary catalog item as a near match.
5. When at least two reasonable candidates exist, always return one or two distinct alternativeIndexes. Leave it empty only when no other candidate is genuinely relevant.

Respond with JSON:
{
  "bestIndex": <number or null when no candidate is suitable>,
  "alternativeIndexes": ["up to two distinct candidate indexes that are reasonable alternatives"],
  "nearestIndex": <number or null; a related but unsuitable item, only when there is a genuine category or use-case relationship>,
  "matchQuality": <number from 0 to 1>,
  "reasoning": "<1-2 sentence explanation of why this is the best fit and any trade-off>",
  "unmetRequirements": ["<requirement not verified>"]
}`;

  let parsed = null;
  try {
    const response = await generateText(prompt, { jsonMode: true });
    parsed = parseJsonResponse(response);
  } catch (error) {
    console.warn('Semantic product ranking unavailable; no product will be selected:', error.message);
  }

  const { bestMatch, nearestMatch, budgetUnverified } = chooseRankedProduct(parsed, products, intent);

  if (parsed?.bestIndex === null && typeof parsed.reasoning === 'string') {
    if (bestMatch) {
      const priceNote = budgetUnverified
        ? ` The catalog displays its price in ${bestMatch.currency || 'another currency'}, so the ${intent.currency || 'requested'} budget will be verified from the merchant’s final checkout total.`
        : '';
      return {
        bestMatch,
        nearestMatch,
        reasoning: `${bestMatch.name} is a direct semantic match for ${intent.product || 'your request'}.${priceNote}`,
        allProducts: products,
      };
    }
    return { bestMatch: null, nearestMatch, reasoning: parsed.reasoning, allProducts: products };
  }
  if (parsed && bestMatch && typeof parsed.reasoning === 'string') {
    return {
      bestMatch,
      reasoning: `${parsed.reasoning}${Array.isArray(parsed.unmetRequirements) && parsed.unmetRequirements.length ? ` Note: ${parsed.unmetRequirements.join(', ')}.` : ''}`,
      alternatives: Array.isArray(parsed.alternativeIndexes) ? parsed.alternativeIndexes
        .filter((index) => Number.isInteger(index) && index >= 0 && index < products.length && products[index] !== bestMatch)
        .slice(0, 2).map((index) => products[index]) : [],
      nearestMatch,
      allProducts: products,
    };
  }

  return {
    bestMatch: null,
    reasoning: 'I could not complete semantic product evaluation right now, so I will not guess a product. Please try again shortly.',
    nearestMatch: null,
    allProducts: products,
  };
}
